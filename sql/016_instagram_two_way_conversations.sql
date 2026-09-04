SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF COL_LENGTH(N'dbo.SocialInteractions', N'InReplyToInteractionId') IS NULL
    ALTER TABLE dbo.SocialInteractions ADD InReplyToInteractionId BIGINT NULL;
IF COL_LENGTH(N'dbo.SocialInteractions', N'ExternalReplyId') IS NULL
    ALTER TABLE dbo.SocialInteractions ADD ExternalReplyId NVARCHAR(255) NULL;
IF COL_LENGTH(N'dbo.SocialInteractions', N'ResponseMode') IS NULL
    ALTER TABLE dbo.SocialInteractions ADD ResponseMode NVARCHAR(32) NULL;
IF COL_LENGTH(N'dbo.SocialInteractions', N'SentByUserId') IS NULL
    ALTER TABLE dbo.SocialInteractions ADD SentByUserId BIGINT NULL;
IF COL_LENGTH(N'dbo.SocialInteractions', N'SentAt') IS NULL
    ALTER TABLE dbo.SocialInteractions ADD SentAt DATETIME2(3) NULL;
IF COL_LENGTH(N'dbo.SocialInteractions', N'DeliveryError') IS NULL
    ALTER TABLE dbo.SocialInteractions ADD DeliveryError NVARCHAR(1000) NULL;
GO

UPDATE dbo.SocialInteractions
SET ResponseMode = N'AI_AUTOMATIC',
    ExternalReplyId = COALESCE(ExternalReplyId, ExternalInteractionId),
    SentAt = COALESCE(SentAt, OccurredAt),
    ResponseStatus = N'SENT'
WHERE UPPER(Direction) = N'OUTBOUND'
  AND ResponseStatus = N'SENT'
  AND ResponseMode IS NULL;
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.foreign_keys
    WHERE parent_object_id = OBJECT_ID(N'dbo.SocialInteractions')
      AND name = N'FK_SocialInteractions_InReplyTo'
)
    ALTER TABLE dbo.SocialInteractions ADD CONSTRAINT FK_SocialInteractions_InReplyTo
        FOREIGN KEY (InReplyToInteractionId) REFERENCES dbo.SocialInteractions(SocialInteractionId);
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.foreign_keys
    WHERE parent_object_id = OBJECT_ID(N'dbo.SocialInteractions')
      AND name = N'FK_SocialInteractions_SentByUser'
)
    ALTER TABLE dbo.SocialInteractions ADD CONSTRAINT FK_SocialInteractions_SentByUser
        FOREIGN KEY (SentByUserId) REFERENCES dbo.AppUsers(UserId);
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.SocialInteractions')
      AND name = N'CK_SocialInteractions_ResponseMode'
)
    ALTER TABLE dbo.SocialInteractions ADD CONSTRAINT CK_SocialInteractions_ResponseMode
        CHECK (ResponseMode IS NULL OR ResponseMode IN (N'AI_AUTOMATIC', N'AI_ASSISTED', N'MANUAL'));
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.SocialInteractions')
      AND name = N'UX_SocialInteractions_Platform_ExternalReply'
)
    CREATE UNIQUE INDEX UX_SocialInteractions_Platform_ExternalReply
        ON dbo.SocialInteractions(SocialPlatformId, ExternalReplyId)
        WHERE ExternalReplyId IS NOT NULL;
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.SocialInteractions')
      AND name = N'IX_SocialInteractions_ReplyTarget_Status'
)
    CREATE INDEX IX_SocialInteractions_ReplyTarget_Status
        ON dbo.SocialInteractions(InReplyToInteractionId, ResponseStatus, ResponseMode)
        INCLUDE (LeadId, SentByUserId, SentAt, ExternalReplyId)
        WHERE InReplyToInteractionId IS NOT NULL;
GO

CREATE OR ALTER PROCEDURE dbo.LeadReply_Create
    @LeadId BIGINT,
    @InReplyToInteractionId BIGINT,
    @MessageText NVARCHAR(MAX),
    @ResponseMode NVARCHAR(32),
    @SentByUserId BIGINT = NULL,
    @IdempotencyKey NVARCHAR(255),
    @MaxAttempts INT = 4
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

    SET @MessageText = NULLIF(LTRIM(RTRIM(@MessageText)), N'');
    SET @ResponseMode = UPPER(LTRIM(RTRIM(@ResponseMode)));
    SET @IdempotencyKey = NULLIF(LTRIM(RTRIM(@IdempotencyKey)), N'');
    IF @MessageText IS NULL THROW 51200, 'Reply text is required.', 1;
    IF LEN(@MessageText) > 100000 THROW 51201, 'Reply text is too long.', 1;
    IF @ResponseMode NOT IN (N'AI_AUTOMATIC', N'AI_ASSISTED', N'MANUAL')
        THROW 51202, 'Response mode must be AI_AUTOMATIC, AI_ASSISTED, or MANUAL.', 1;
    IF @IdempotencyKey IS NULL THROW 51203, 'An idempotency key is required.', 1;
    IF @ResponseMode IN (N'AI_ASSISTED', N'MANUAL') AND @SentByUserId IS NULL
        THROW 51204, 'An authenticated CRM user is required for this reply.', 1;
    IF @ResponseMode = N'AI_AUTOMATIC' SET @SentByUserId = NULL;

    DECLARE @SocialPlatformId INT, @TargetType NVARCHAR(64), @TargetDirection NVARCHAR(16);
    DECLARE @TargetExternalId NVARCHAR(255), @TargetPostId NVARCHAR(255), @TargetConversationId NVARCHAR(255);
    DECLARE @TargetUserId NVARCHAR(255), @SocialEventId BIGINT, @ReplyId BIGINT, @ExistingReplyId BIGINT;
    DECLARE @Now DATETIME2(3) = SYSUTCDATETIME(), @RequestJson NVARCHAR(MAX);

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @SocialPlatformId = si.SocialPlatformId,
               @TargetType = CASE WHEN si.InteractionType IN (N'DIRECT_MESSAGE', N'STORY_REPLY') THEN N'DM' ELSE si.InteractionType END,
               @TargetDirection = UPPER(si.Direction),
               @TargetExternalId = si.ExternalInteractionId,
               @TargetPostId = si.PlatformPostId,
               @TargetConversationId = si.PlatformConversationId,
               @TargetUserId = si.PlatformUserId
        FROM dbo.SocialInteractions si WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId = si.SocialPlatformId
        WHERE si.SocialInteractionId = @InReplyToInteractionId
          AND si.LeadId = @LeadId
          AND sp.Code = N'instagram';

        IF @SocialPlatformId IS NULL OR @TargetDirection <> N'INBOUND' OR @TargetType NOT IN (N'COMMENT', N'DM')
            THROW 51205, 'The reply target must be an inbound Instagram comment or DM for this lead.', 1;

        IF @SentByUserId IS NOT NULL AND NOT EXISTS
        (
            SELECT 1 FROM dbo.AppUsers WITH (UPDLOCK, HOLDLOCK)
            WHERE UserId = @SentByUserId AND IsActive = 1
        )
            THROW 51206, 'The authenticated CRM user is not active.', 1;

        SELECT @ExistingReplyId = si.SocialInteractionId
        FROM dbo.SocialInteractions si WITH (UPDLOCK, HOLDLOCK)
        WHERE si.SocialPlatformId = @SocialPlatformId
          AND si.ExternalInteractionId = @IdempotencyKey;

        IF @ExistingReplyId IS NOT NULL
        BEGIN
            COMMIT TRANSACTION;
            SELECT si.SocialInteractionId, sp.Code Platform, si.ExternalInteractionId, si.ExternalReplyId,
                si.PlatformUserId, si.PlatformPostId, si.PlatformConversationId, si.InReplyToInteractionId,
                si.InteractionType, si.MessageText, si.OccurredAt, si.Direction, si.Intent, si.IntentConfidence,
                si.Sentiment, si.ProductService, si.CampaignExternalId, si.CampaignPostId, si.CampaignName,
                si.AdvertisementId, si.LeadFormId, si.SourceType, si.ResponseMode, si.SentByUserId,
                u.Username SentByUsername, si.ResponseStatus, si.SentAt, si.DeliveryError, si.ProcessedAt,
                CAST(1 AS BIT) Duplicate
            FROM dbo.SocialInteractions si
            JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId = si.SocialPlatformId
            LEFT JOIN dbo.AppUsers u ON u.UserId = si.SentByUserId
            WHERE si.SocialInteractionId = @ExistingReplyId;
            RETURN;
        END;

        IF EXISTS
        (
            SELECT 1 FROM dbo.SocialInteractions WITH (UPDLOCK, HOLDLOCK)
            WHERE InReplyToInteractionId = @InReplyToInteractionId AND ResponseStatus = N'SENT'
        )
            THROW 51207, 'A successful reply already exists for this Instagram interaction.', 1;

        IF @ResponseMode = N'AI_AUTOMATIC' AND EXISTS
        (
            SELECT 1 FROM dbo.SocialInteractions WITH (UPDLOCK, HOLDLOCK)
            WHERE InReplyToInteractionId = @InReplyToInteractionId
              AND ResponseStatus IN (N'PENDING', N'SENT')
        )
            THROW 51208, 'A reply is already pending or sent for this Instagram interaction.', 1;

        IF @ResponseMode IN (N'AI_ASSISTED', N'MANUAL')
        BEGIN
            IF EXISTS
            (
                SELECT 1
                FROM dbo.SocialInteractions si WITH (UPDLOCK, HOLDLOCK)
                JOIN dbo.IntegrationEvents ie WITH (UPDLOCK, HOLDLOCK)
                  ON ie.SocialInteractionId = si.SocialInteractionId
                WHERE si.InReplyToInteractionId = @InReplyToInteractionId
                  AND si.ResponseMode = N'AI_AUTOMATIC'
                  AND ie.Status = N'PROCESSING'
            )
                THROW 51209, 'An automatic reply is already being delivered. Refresh before replying.', 1;

            IF EXISTS
            (
                SELECT 1 FROM dbo.SocialInteractions WITH (UPDLOCK, HOLDLOCK)
                WHERE InReplyToInteractionId = @InReplyToInteractionId
                  AND ResponseMode IN (N'AI_ASSISTED', N'MANUAL')
                  AND ResponseStatus = N'PENDING'
            )
                THROW 51210, 'A human-reviewed reply is already pending for this Instagram interaction.', 1;

            UPDATE ie
               SET Status = N'FAILED', LastError = N'Superseded by a human reply before delivery.',
                   ProcessedAt = @Now, NextAttemptAt = NULL, LockToken = NULL, LockedAt = NULL, UpdatedAt = @Now
            FROM dbo.IntegrationEvents ie
            JOIN dbo.SocialInteractions si ON si.SocialInteractionId = ie.SocialInteractionId
            WHERE si.InReplyToInteractionId = @InReplyToInteractionId
              AND si.ResponseMode = N'AI_AUTOMATIC'
              AND si.ResponseStatus = N'PENDING'
              AND ie.Status IN (N'PENDING', N'RETRY_SCHEDULED');

            UPDATE dbo.SocialInteractions
               SET ResponseStatus = N'FAILED', DeliveryError = N'Superseded by a human reply before delivery.',
                   ProcessedAt = @Now
            WHERE InReplyToInteractionId = @InReplyToInteractionId
              AND ResponseMode = N'AI_AUTOMATIC'
              AND ResponseStatus = N'PENDING';
        END;

        INSERT dbo.SocialEvents
            (Channel, ExternalEventId, EventType, Message, PostId, SourceUrl, OccurredAt, ProcessedAt,
             RawPayload, RawPayloadExpiresAt, ConversationId, SourceType)
        VALUES
            (N'instagram', @IdempotencyKey,
             CASE WHEN @TargetType = N'DM' THEN N'outbound_dm_reply' ELSE N'outbound_comment_reply' END,
             @MessageText, @TargetPostId, NULL, @Now, @Now,
             N'{"source":"crm_reply_queue"}', DATEADD(DAY, 7, @Now), @TargetConversationId, N'ORGANIC');
        SET @SocialEventId = SCOPE_IDENTITY();

        INSERT dbo.SocialInteractions
            (SocialEventId, LeadId, SocialPlatformId, PlatformUserId, PlatformPostId, PlatformConversationId,
             ExternalInteractionId, InReplyToInteractionId, InteractionType, MessageText, OccurredAt, Direction,
             Intent, Sentiment, SourceType, ResponseStatus, ResponseMode, SentByUserId, RequiresReview, ProcessedAt)
        VALUES
            (@SocialEventId, @LeadId, @SocialPlatformId, @TargetUserId, @TargetPostId, @TargetConversationId,
             @IdempotencyKey, @InReplyToInteractionId, @TargetType, @MessageText, @Now, N'OUTBOUND',
             N'OTHER', N'NEUTRAL', N'ORGANIC', N'PENDING', @ResponseMode, @SentByUserId,
             CASE WHEN @ResponseMode = N'AI_ASSISTED' THEN 1 ELSE 0 END, @Now);
        SET @ReplyId = SCOPE_IDENTITY();

        SELECT @RequestJson =
        (
            SELECT @ReplyId replyId, @LeadId leadId, N'instagram' platform, @TargetType interactionType,
                   @TargetExternalId inReplyToExternalInteractionId, @TargetPostId externalPostId,
                   @TargetConversationId conversationId, @TargetUserId externalUserId,
                   @MessageText messageText, @ResponseMode responseMode
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES
        );

        INSERT dbo.IntegrationEvents
            (Provider, Channel, Direction, EventType, IdempotencyKey, Status, AttemptCount, MaxAttempts,
             NextAttemptAt, LeadId, SocialInteractionId, RequestJson)
        VALUES
            (N'n8n', N'instagram', N'OUTBOUND',
             CASE WHEN @TargetType = N'DM' THEN N'INSTAGRAM_DM_REPLY' ELSE N'INSTAGRAM_COMMENT_REPLY' END,
             @IdempotencyKey, N'PENDING', 0,
             CASE WHEN @MaxAttempts < 1 THEN 1 WHEN @MaxAttempts > 10 THEN 10 ELSE @MaxAttempts END,
             NULL, @LeadId, @ReplyId, @RequestJson);

        COMMIT TRANSACTION;

        SELECT si.SocialInteractionId, sp.Code Platform, si.ExternalInteractionId, si.ExternalReplyId,
            si.PlatformUserId, si.PlatformPostId, si.PlatformConversationId, si.InReplyToInteractionId,
            si.InteractionType, si.MessageText, si.OccurredAt, si.Direction, si.Intent, si.IntentConfidence,
            si.Sentiment, si.ProductService, si.CampaignExternalId, si.CampaignPostId, si.CampaignName,
            si.AdvertisementId, si.LeadFormId, si.SourceType, si.ResponseMode, si.SentByUserId,
            u.Username SentByUsername, si.ResponseStatus, si.SentAt, si.DeliveryError, si.ProcessedAt,
            CAST(0 AS BIT) Duplicate
        FROM dbo.SocialInteractions si
        JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId = si.SocialPlatformId
        LEFT JOIN dbo.AppUsers u ON u.UserId = si.SentByUserId
        WHERE si.SocialInteractionId = @ReplyId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.LeadReply_Claim
    @Now DATETIME2(3),
    @Limit INT,
    @LockToken UNIQUEIDENTIFIER,
    @ReplyId BIGINT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Claimed TABLE (IntegrationEventId BIGINT PRIMARY KEY);
    ;WITH Due AS
    (
        SELECT TOP (CASE WHEN @Limit < 1 THEN 1 WHEN @Limit > 50 THEN 50 ELSE @Limit END)
            ie.IntegrationEventId
        FROM dbo.IntegrationEvents ie WITH (UPDLOCK, READPAST, ROWLOCK)
        JOIN dbo.SocialInteractions si ON si.SocialInteractionId = ie.SocialInteractionId
        WHERE ie.Provider = N'n8n' AND ie.Channel = N'instagram' AND ie.Direction = N'OUTBOUND'
          AND ie.EventType IN (N'INSTAGRAM_COMMENT_REPLY', N'INSTAGRAM_DM_REPLY')
          AND ie.Status IN (N'PENDING', N'RETRY_SCHEDULED')
          AND si.ResponseStatus = N'PENDING'
          AND (ie.NextAttemptAt IS NULL OR ie.NextAttemptAt <= @Now)
          AND (@ReplyId IS NULL OR si.SocialInteractionId = @ReplyId)
        ORDER BY ie.CreatedAt, ie.IntegrationEventId
    )
    UPDATE target
       SET Status = N'PROCESSING', AttemptCount = AttemptCount + 1,
           LastAttemptAt = @Now, LockToken = @LockToken, LockedAt = @Now, UpdatedAt = @Now
    OUTPUT inserted.IntegrationEventId INTO @Claimed(IntegrationEventId)
    FROM dbo.IntegrationEvents target
    JOIN Due ON Due.IntegrationEventId = target.IntegrationEventId;

    SELECT ie.IntegrationEventId, ie.LockToken, ie.AttemptCount, ie.MaxAttempts,
        si.SocialInteractionId ReplyId, si.LeadId, sp.Code Platform, si.InteractionType,
        si.MessageText, si.ResponseMode, si.InReplyToInteractionId,
        target.ExternalInteractionId InReplyToExternalInteractionId,
        target.PlatformPostId ExternalPostId, target.PlatformConversationId ConversationId,
        target.PlatformUserId ExternalUserId
    FROM @Claimed claimed
    JOIN dbo.IntegrationEvents ie ON ie.IntegrationEventId = claimed.IntegrationEventId
    JOIN dbo.SocialInteractions si ON si.SocialInteractionId = ie.SocialInteractionId
    JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId = si.SocialPlatformId
    JOIN dbo.SocialInteractions target ON target.SocialInteractionId = si.InReplyToInteractionId
    ORDER BY ie.CreatedAt, ie.IntegrationEventId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.LeadReply_Complete
    @ReplyId BIGINT,
    @LockToken UNIQUEIDENTIFIER,
    @Succeeded BIT,
    @ExternalReplyId NVARCHAR(255) = NULL,
    @ExternalStatus NVARCHAR(100) = NULL,
    @ProviderResponseJson NVARCHAR(MAX) = NULL,
    @LastError NVARCHAR(1000) = NULL,
    @Retryable BIT = 0,
    @NextAttemptAt DATETIME2(3) = NULL,
    @SentAt DATETIME2(3) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

    SET @ExternalReplyId = NULLIF(LTRIM(RTRIM(@ExternalReplyId)), N'');
    SET @LastError = NULLIF(LTRIM(RTRIM(@LastError)), N'');
    SET @SentAt = COALESCE(@SentAt, SYSUTCDATETIME());
    IF @Succeeded = 1 AND @ExternalReplyId IS NULL
        THROW 51211, 'A successful Instagram delivery requires the external reply ID.', 1;
    IF @ProviderResponseJson IS NOT NULL AND ISJSON(@ProviderResponseJson) <> 1
        THROW 51212, 'Provider response metadata must be valid JSON.', 1;

    DECLARE @IntegrationEventId BIGINT, @Status NVARCHAR(32), @StoredLock UNIQUEIDENTIFIER;
    DECLARE @AttemptCount INT, @MaxAttempts INT, @LeadId BIGINT, @InteractionType NVARCHAR(64);
    DECLARE @MessageText NVARCHAR(MAX), @ConversationId NVARCHAR(255), @DuplicateCompletion BIT = 0;
    DECLARE @RetryScheduled BIT = 0, @Now DATETIME2(3) = SYSUTCDATETIME();

    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT @IntegrationEventId = ie.IntegrationEventId, @Status = ie.Status, @StoredLock = ie.LockToken,
               @AttemptCount = ie.AttemptCount, @MaxAttempts = ie.MaxAttempts,
               @LeadId = si.LeadId, @InteractionType = si.InteractionType,
               @MessageText = si.MessageText, @ConversationId = si.PlatformConversationId
        FROM dbo.IntegrationEvents ie WITH (UPDLOCK, HOLDLOCK)
        JOIN dbo.SocialInteractions si WITH (UPDLOCK, HOLDLOCK)
          ON si.SocialInteractionId = ie.SocialInteractionId
        WHERE ie.SocialInteractionId = @ReplyId
          AND ie.Provider = N'n8n' AND ie.Channel = N'instagram';

        IF @IntegrationEventId IS NULL THROW 51213, 'Reply request not found.', 1;
        IF @Status IN (N'SUCCEEDED', N'FAILED')
        BEGIN
            SET @DuplicateCompletion = 1;
            COMMIT TRANSACTION;
        END
        ELSE
        BEGIN
            IF @Status <> N'PROCESSING' OR @StoredLock <> @LockToken
                THROW 51214, 'The reply claim is no longer active.', 1;

            IF @Succeeded = 1 AND EXISTS
            (
                SELECT 1 FROM dbo.SocialInteractions WITH (UPDLOCK, HOLDLOCK)
                WHERE SocialPlatformId = (SELECT SocialPlatformId FROM dbo.SocialInteractions WHERE SocialInteractionId = @ReplyId)
                  AND ExternalReplyId = @ExternalReplyId AND SocialInteractionId <> @ReplyId
            )
            BEGIN
                SET @Succeeded = 0;
                SET @Retryable = 0;
                SET @ExternalReplyId = NULL;
                SET @LastError = N'The provider reply ID is already recorded.';
            END;

            SET @RetryScheduled = CASE
                WHEN @Succeeded = 0 AND @Retryable = 1 AND @AttemptCount < @MaxAttempts THEN 1 ELSE 0 END;

            UPDATE dbo.IntegrationEvents
               SET Status = CASE WHEN @Succeeded = 1 THEN N'SUCCEEDED'
                                 WHEN @RetryScheduled = 1 THEN N'RETRY_SCHEDULED' ELSE N'FAILED' END,
                   ExternalId = COALESCE(@ExternalReplyId, ExternalId),
                   ExternalStatus = COALESCE(@ExternalStatus, ExternalStatus),
                   ResponseJson = COALESCE(@ProviderResponseJson, ResponseJson),
                   LastError = CASE WHEN @Succeeded = 1 THEN NULL ELSE COALESCE(@LastError, N'Instagram delivery failed.') END,
                   NextAttemptAt = CASE WHEN @RetryScheduled = 1 THEN COALESCE(@NextAttemptAt, DATEADD(MINUTE, 1, @Now)) ELSE NULL END,
                   ProcessedAt = CASE WHEN @Succeeded = 1 OR @RetryScheduled = 0 THEN @Now ELSE ProcessedAt END,
                   LockToken = NULL, LockedAt = NULL, UpdatedAt = @Now
            WHERE IntegrationEventId = @IntegrationEventId;

            UPDATE dbo.SocialInteractions
               SET ExternalReplyId = CASE WHEN @Succeeded = 1 THEN @ExternalReplyId ELSE ExternalReplyId END,
                   ResponseStatus = CASE WHEN @Succeeded = 1 THEN N'SENT'
                                         WHEN @RetryScheduled = 1 THEN N'PENDING' ELSE N'FAILED' END,
                   SentAt = CASE WHEN @Succeeded = 1 THEN @SentAt ELSE SentAt END,
                   DeliveryError = CASE WHEN @Succeeded = 1 THEN NULL ELSE COALESCE(@LastError, N'Instagram delivery failed.') END,
                   ProcessedAt = @Now
            WHERE SocialInteractionId = @ReplyId;

            IF @Succeeded = 1
            BEGIN
                UPDATE dbo.Leads
                   SET LastResponseAt = @SentAt, LastResponseType = @InteractionType,
                       LastResponseText = @MessageText, UpdatedAt = @Now
                WHERE LeadId = @LeadId;

                IF @ConversationId IS NOT NULL
                    UPDATE dbo.SocialConversations
                       SET LastMessageAt = @SentAt, Direction = N'OUTBOUND', ImportantMessage = @MessageText,
                           UpdatedAt = @Now
                    WHERE LeadId = @LeadId AND PlatformConversationId = @ConversationId;
            END;

            COMMIT TRANSACTION;
        END;

        SELECT si.SocialInteractionId, sp.Code Platform, si.ExternalInteractionId, si.ExternalReplyId,
            si.PlatformUserId, si.PlatformPostId, si.PlatformConversationId, si.InReplyToInteractionId,
            si.InteractionType, si.MessageText, si.OccurredAt, si.Direction, si.Intent, si.IntentConfidence,
            si.Sentiment, si.ProductService, si.CampaignExternalId, si.CampaignPostId, si.CampaignName,
            si.AdvertisementId, si.LeadFormId, si.SourceType, si.ResponseMode, si.SentByUserId,
            u.Username SentByUsername, si.ResponseStatus, si.SentAt, si.DeliveryError, si.ProcessedAt,
            ie.Status QueueStatus, CAST(@DuplicateCompletion AS BIT) DuplicateCompletion
        FROM dbo.SocialInteractions si
        JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId = si.SocialPlatformId
        LEFT JOIN dbo.AppUsers u ON u.UserId = si.SentByUserId
        JOIN dbo.IntegrationEvents ie ON ie.SocialInteractionId = si.SocialInteractionId
        WHERE si.SocialInteractionId = @ReplyId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialLead_GetUnified @LeadId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT LeadId, Name, FirstName, LastName, DisplayName, Company, Email, Phone, Country, StateRegion, City,
        [Source] SourceChannel, Status, EstimatedValue Value, LeadScore, LeadTemperature, ScoreBand,
        IntentScore, EngagementScore, FitScore, RecencyScore, SourceScore, ScoreReason, LastScoredAt,
        LastIntent, ProductServiceInterest, QualificationJson, Budget, PurchaseTimeline, PreferredContactMethod,
        AssignedSalesperson, ConsentStatus, CrmNotes, ConvertedCustomer, LostReason, FirstContactAt, LastContactAt,
        LastInteractionAt, LastInteractionType, LastInteractionText, LastResponseAt, LastResponseType,
        LastResponseText, CreatedAt, UpdatedAt
    FROM dbo.Leads WHERE LeadId = @LeadId;
    SELECT sa.SocialAccountId, sp.Code Platform, sa.PlatformUserId, sa.Username, sa.DisplayName, sa.ProfileUrl, sa.LastVerifiedAt
    FROM dbo.SocialAccounts sa JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId = sa.SocialPlatformId WHERE sa.LeadId = @LeadId;
    SELECT si.SocialInteractionId, sp.Code Platform, si.ExternalInteractionId, si.ExternalReplyId,
        si.PlatformUserId, si.PlatformPostId, si.PlatformPostId ExternalPostId, si.PlatformConversationId,
        si.InReplyToInteractionId,
        CASE WHEN si.InteractionType IN (N'DIRECT_MESSAGE', N'STORY_REPLY') THEN N'DM' ELSE si.InteractionType END InteractionType,
        si.MessageText, si.OccurredAt, si.Direction, si.Intent, si.IntentConfidence, si.Sentiment, si.ProductService,
        si.CampaignExternalId, si.CampaignPostId, si.CampaignName, si.AdvertisementId, si.LeadFormId, si.SourceType,
        COALESCE(si.ResponseMode, CASE WHEN UPPER(si.Direction) = N'OUTBOUND' THEN N'AI_AUTOMATIC' END) ResponseMode,
        si.SentByUserId, u.Username SentByUsername, si.ResponseStatus,
        COALESCE(si.SentAt, CASE WHEN UPPER(si.Direction) = N'OUTBOUND' AND si.ResponseStatus = N'SENT' THEN si.OccurredAt END) SentAt,
        si.DeliveryError, si.QualificationJson, si.ProcessedAt
    FROM dbo.SocialInteractions si
    JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId = si.SocialPlatformId
    LEFT JOIN dbo.AppUsers u ON u.UserId = si.SentByUserId
    WHERE si.LeadId = @LeadId ORDER BY COALESCE(si.SentAt, si.OccurredAt) DESC, si.SocialInteractionId DESC;
    SELECT sc.SocialConversationId, sp.Code Platform, sc.PlatformConversationId, sc.LastMessageAt, sc.Direction,
        sc.ImportantMessage, sc.Status, sc.AssignedCrmUser, sc.ReferenceUrl
    FROM dbo.SocialConversations sc JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId = sc.SocialPlatformId
    WHERE sc.LeadId = @LeadId ORDER BY sc.LastMessageAt DESC;
    SELECT LeadActivityId, ActivityType, Summary, SourceReference, CampaignExternalId, OccurredAt
    FROM dbo.LeadActivities WHERE LeadId = @LeadId ORDER BY OccurredAt DESC;
    SELECT OpportunityId, CampaignId, Name, Stage, EstimatedValue, Status, CreatedAt, UpdatedAt FROM dbo.Opportunities WHERE LeadId = @LeadId ORDER BY UpdatedAt DESC;
    SELECT QuoteId, OpportunityId, Amount, Status, IssuedAt FROM dbo.Quotes WHERE LeadId = @LeadId ORDER BY IssuedAt DESC;
    SELECT AppointmentId, ScheduledAt, Status, AssignedCrmUser, Notes, CreatedAt FROM dbo.Appointments WHERE LeadId = @LeadId ORDER BY ScheduledAt DESC;
    SELECT CustomerConversionId, CustomerId, CampaignId, ConversionType, Value, ConvertedAt FROM dbo.CustomerConversions WHERE LeadId = @LeadId ORDER BY ConvertedAt DESC;
END;
GO
