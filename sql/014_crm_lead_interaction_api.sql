CREATE OR ALTER PROCEDURE dbo.SocialEvent_Process
    @Channel NVARCHAR(32), @ExternalEventId NVARCHAR(255), @EventType NVARCHAR(100),
    @ExternalUserId NVARCHAR(255) = NULL, @Username NVARCHAR(255) = NULL, @DisplayName NVARCHAR(255) = NULL,
    @Email NVARCHAR(320) = NULL, @Phone NVARCHAR(80) = NULL, @Message NVARCHAR(MAX) = NULL, @PostId NVARCHAR(255) = NULL,
    @CampaignId NVARCHAR(255) = NULL, @AdId NVARCHAR(255) = NULL, @LeadFormId NVARCHAR(255) = NULL,
    @CampaignName NVARCHAR(255) = NULL, @ConversationId NVARCHAR(255) = NULL, @Direction NVARCHAR(16) = N'INBOUND',
    @SourceUrl NVARCHAR(2048) = NULL, @OccurredAt DATETIME2(3), @RawPayload NVARCHAR(MAX), @Qualified BIT,
    @LeadName NVARCHAR(255) = NULL, @InteractionType NVARCHAR(64) = N'POST_INTERACTION', @Intent NVARCHAR(64) = N'OTHER',
    @Sentiment NVARCHAR(20) = N'NEUTRAL', @QualificationJson NVARCHAR(MAX) = NULL, @ScoreDelta INT = 0,
    @IntentConfidence DECIMAL(5,4) = NULL, @CampaignPostId BIGINT = NULL,
    @SourceType NVARCHAR(16) = N'ORGANIC', @RawRetentionDays INT = 7,
    @RequestedLeadId BIGINT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @Channel = LOWER(LTRIM(RTRIM(@Channel)));
    SET @Direction = UPPER(LTRIM(RTRIM(COALESCE(@Direction, N'INBOUND'))));
    SET @InteractionType = UPPER(LTRIM(RTRIM(COALESCE(@InteractionType, N'POST_INTERACTION'))));
    IF @Direction NOT IN (N'INBOUND', N'OUTBOUND') THROW 51120, 'Direction must be INBOUND or OUTBOUND.', 1;
    IF @IntentConfidence IS NOT NULL AND (@IntentConfidence < 0 OR @IntentConfidence > 1) THROW 51121, 'Intent confidence must be between 0 and 1.', 1;

    DECLARE @SocialEventId BIGINT, @SocialInteractionId BIGINT, @LeadId BIGINT, @SocialPlatformId INT;
    DECLARE @LeadCreated BIT = 0, @LeadUpdated BIT = 0, @IdentityKey NVARCHAR(255), @IdentityLeadId BIGINT;
    DECLARE @NextScore INT, @Band NVARCHAR(20), @IsQualified BIT = 0;
    SET @IdentityKey = CASE
        WHEN NULLIF(LTRIM(RTRIM(@ExternalUserId)), N'') IS NOT NULL THEN LTRIM(RTRIM(@ExternalUserId))
        WHEN NULLIF(LTRIM(RTRIM(@Username)), N'') IS NOT NULL THEN CONCAT(N'username:', LOWER(LTRIM(RTRIM(@Username))))
        ELSE NULL
    END;

    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT @SocialPlatformId = SocialPlatformId FROM dbo.SocialPlatforms WHERE Code = @Channel;
        IF @SocialPlatformId IS NULL THROW 51108, 'Unsupported social platform.', 1;
        IF @RequestedLeadId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.Leads WITH (UPDLOCK, HOLDLOCK) WHERE LeadId = @RequestedLeadId)
            THROW 51122, 'Lead not found.', 1;

        SELECT @SocialInteractionId = si.SocialInteractionId, @SocialEventId = si.SocialEventId, @LeadId = si.LeadId
        FROM dbo.SocialInteractions si WITH (UPDLOCK, HOLDLOCK)
        WHERE si.SocialPlatformId = @SocialPlatformId AND si.ExternalInteractionId = @ExternalEventId;
        IF @SocialInteractionId IS NOT NULL
        BEGIN
            IF @RequestedLeadId IS NOT NULL AND @LeadId IS NOT NULL AND @LeadId <> @RequestedLeadId
                THROW 51123, 'The interaction belongs to a different lead.', 1;
            COMMIT TRANSACTION;
            SELECT CAST(1 AS BIT) Duplicate, CAST(0 AS BIT) LeadCreated, CAST(0 AS BIT) LeadUpdated,
                CAST(0 AS BIT) InteractionInserted, @LeadId LeadId, @SocialEventId SocialEventId,
                @SocialInteractionId InteractionId, l.LeadScore, l.LeadTemperature, l.ScoreBand,
                l.ScoreReason, CAST(CASE WHEN COALESCE(l.LeadScore, 0) >= 60 THEN 1 ELSE 0 END AS BIT) Qualified
            FROM (SELECT 1 AS Value) seed LEFT JOIN dbo.Leads l ON l.LeadId = @LeadId;
            RETURN;
        END;

        SELECT @SocialEventId = SocialEventId FROM dbo.SocialEvents WITH (UPDLOCK, HOLDLOCK)
        WHERE Channel = @Channel AND ExternalEventId = @ExternalEventId;
        IF @SocialEventId IS NOT NULL
        BEGIN
            SELECT TOP (1) @LeadId = LeadId FROM dbo.LeadSourceAttribution WHERE SocialEventId = @SocialEventId;
            IF @RequestedLeadId IS NOT NULL AND @LeadId IS NOT NULL AND @LeadId <> @RequestedLeadId
                THROW 51123, 'The interaction belongs to a different lead.', 1;
            SELECT TOP (1) @SocialInteractionId = SocialInteractionId
            FROM dbo.SocialInteractions WHERE SocialEventId = @SocialEventId ORDER BY SocialInteractionId;
            COMMIT TRANSACTION;
            SELECT CAST(1 AS BIT) Duplicate, CAST(0 AS BIT) LeadCreated, CAST(0 AS BIT) LeadUpdated,
                CAST(0 AS BIT) InteractionInserted, @LeadId LeadId, @SocialEventId SocialEventId,
                @SocialInteractionId InteractionId, l.LeadScore, l.LeadTemperature, l.ScoreBand,
                l.ScoreReason, CAST(CASE WHEN COALESCE(l.LeadScore, 0) >= 60 THEN 1 ELSE 0 END AS BIT) Qualified
            FROM (SELECT 1 AS Value) seed LEFT JOIN dbo.Leads l ON l.LeadId = @LeadId;
            RETURN;
        END;

        INSERT dbo.SocialEvents(Channel, ExternalEventId, EventType, ExternalUserId, Username, DisplayName, Email, Phone, Message,
            PostId, CampaignId, AdId, SourceUrl, OccurredAt, RawPayload, LeadFormId, CampaignName, ConversationId, SourceType, RawPayloadExpiresAt)
        VALUES(@Channel, @ExternalEventId, @EventType, @ExternalUserId, @Username, @DisplayName, @Email, @Phone, @Message,
            @PostId, @CampaignId, @AdId, @SourceUrl, @OccurredAt, @RawPayload, @LeadFormId, @CampaignName, @ConversationId, @SourceType,
            DATEADD(DAY, CASE WHEN @RawRetentionDays BETWEEN 1 AND 90 THEN @RawRetentionDays ELSE 7 END, @OccurredAt));
        SET @SocialEventId = SCOPE_IDENTITY();

        IF @Qualified = 1
        BEGIN
            SET @LeadId = @RequestedLeadId;
            IF @IdentityKey IS NOT NULL
                SELECT TOP (1) @IdentityLeadId = sa.LeadId FROM dbo.SocialAccounts sa WITH (UPDLOCK, HOLDLOCK)
                WHERE sa.SocialPlatformId = @SocialPlatformId AND sa.PlatformUserId = @IdentityKey;
            IF @LeadId IS NULL SET @LeadId = @IdentityLeadId;
            ELSE IF @IdentityLeadId IS NOT NULL AND @IdentityLeadId <> @LeadId
                THROW 51123, 'The supplied social identity belongs to a different lead.', 1;

            IF @LeadId IS NULL AND (@Email IS NOT NULL OR @Phone IS NOT NULL)
                SELECT TOP (1) @LeadId = LeadId FROM dbo.Leads WITH (UPDLOCK, HOLDLOCK)
                WHERE (@Email IS NOT NULL AND Email = @Email) OR (@Phone IS NOT NULL AND Phone = @Phone) ORDER BY LeadId;

            IF @LeadId IS NULL
            BEGIN
                INSERT dbo.Leads(Name, DisplayName, Email, Phone, SocialUsername, Facebook, Instagram, [X], [Source], Status,
                    LeadScore, LeadTemperature, ScoreBand, LastIntent, ProductServiceInterest, QualificationJson, Budget, PurchaseTimeline,
                    FirstContactAt, LastContactAt)
                VALUES(COALESCE(NULLIF(@LeadName, N''), NULLIF(@DisplayName, N''), NULLIF(@Username, N''), N'Social prospect'),
                    @DisplayName, @Email, @Phone, @Username,
                    CASE WHEN @Channel = N'facebook' THEN @Username END, CASE WHEN @Channel = N'instagram' THEN @Username END,
                    CASE WHEN @Channel = N'x' THEN @Username END, @Channel, N'New', 0, N'COLD', N'COLD', @Intent,
                    JSON_VALUE(@QualificationJson, '$.productService'), @QualificationJson,
                    TRY_CONVERT(DECIMAL(19,4), JSON_VALUE(@QualificationJson, '$.budget')),
                    JSON_VALUE(@QualificationJson, '$.purchaseTimeline'), @OccurredAt, @OccurredAt);
                SET @LeadId = SCOPE_IDENTITY();
                SET @LeadCreated = 1;
            END
            ELSE
            BEGIN
                UPDATE dbo.Leads SET
                    Name = COALESCE(NULLIF(@LeadName, N''), Name), DisplayName = COALESCE(NULLIF(@DisplayName, N''), DisplayName),
                    Email = COALESCE(NULLIF(@Email, N''), Email), Phone = COALESCE(NULLIF(@Phone, N''), Phone),
                    SocialUsername = COALESCE(NULLIF(@Username, N''), SocialUsername),
                    Facebook = CASE WHEN @Channel = N'facebook' THEN COALESCE(NULLIF(@Username, N''), Facebook) ELSE Facebook END,
                    Instagram = CASE WHEN @Channel = N'instagram' THEN COALESCE(NULLIF(@Username, N''), Instagram) ELSE Instagram END,
                    [X] = CASE WHEN @Channel = N'x' THEN COALESCE(NULLIF(@Username, N''), [X]) ELSE [X] END,
                    [Source] = COALESCE(NULLIF([Source], N''), @Channel),
                    LastIntent = CASE WHEN @Direction = N'INBOUND' THEN @Intent ELSE LastIntent END,
                    ProductServiceInterest = COALESCE(ProductServiceInterest, JSON_VALUE(@QualificationJson, '$.productService')),
                    QualificationJson = CASE WHEN @QualificationJson IS NOT NULL THEN @QualificationJson ELSE QualificationJson END,
                    Budget = COALESCE(Budget, TRY_CONVERT(DECIMAL(19,4), JSON_VALUE(@QualificationJson, '$.budget'))),
                    PurchaseTimeline = COALESCE(PurchaseTimeline, JSON_VALUE(@QualificationJson, '$.purchaseTimeline')),
                    FirstContactAt = COALESCE(FirstContactAt, @OccurredAt),
                    LastContactAt = CASE WHEN @Direction = N'INBOUND' THEN @OccurredAt ELSE LastContactAt END,
                    UpdatedAt = SYSUTCDATETIME()
                WHERE LeadId = @LeadId;
                SET @LeadUpdated = 1;
            END;

            IF @IdentityKey IS NOT NULL
            BEGIN
                UPDATE dbo.SocialAccounts SET Username = COALESCE(@Username, Username),
                    DisplayName = COALESCE(@DisplayName, DisplayName), ProfileUrl = COALESCE(@SourceUrl, ProfileUrl),
                    LastVerifiedAt = @OccurredAt, UpdatedAt = SYSUTCDATETIME()
                WHERE SocialPlatformId = @SocialPlatformId AND PlatformUserId = @IdentityKey AND LeadId = @LeadId;
                IF @@ROWCOUNT = 0
                    INSERT dbo.SocialAccounts(LeadId, SocialPlatformId, PlatformUserId, Username, DisplayName, ProfileUrl, LastVerifiedAt)
                    VALUES(@LeadId, @SocialPlatformId, @IdentityKey, @Username, @DisplayName, @SourceUrl, @OccurredAt);
            END;
            INSERT dbo.LeadSourceAttribution(LeadId, SocialEventId, SourceChannel, ExternalUserId, SocialUsername, CampaignId, AdId, PostId, ExternalEventId, FirstTouchAt, LastInteractionAt)
            VALUES(@LeadId, @SocialEventId, @Channel, @ExternalUserId, @Username, @CampaignId, @AdId, @PostId, @ExternalEventId, @OccurredAt, @OccurredAt);
        END;

        INSERT dbo.SocialInteractions(SocialEventId, LeadId, SocialPlatformId, PlatformUserId, PlatformPostId, PlatformConversationId,
            ExternalInteractionId, InteractionType, MessageText, OccurredAt, Direction, Intent, IntentConfidence, Sentiment, ProductService,
            CampaignExternalId, CampaignPostId, CampaignName, AdvertisementId, LeadFormId, SourceType, ResponseStatus, RequiresReview, QualificationJson, ProcessedAt)
        VALUES(@SocialEventId, @LeadId, @SocialPlatformId, @ExternalUserId, @PostId, @ConversationId,
            @ExternalEventId, @InteractionType, @Message, @OccurredAt, @Direction, @Intent, @IntentConfidence, @Sentiment,
            JSON_VALUE(@QualificationJson, '$.productService'), @CampaignId, @CampaignPostId, @CampaignName, @AdId, @LeadFormId, @SourceType,
            CASE WHEN @Direction = N'OUTBOUND' THEN N'SENT' ELSE N'PENDING' END,
            CASE WHEN @Qualified = 0 AND @Intent <> N'OTHER' THEN 1 ELSE 0 END, @QualificationJson, SYSUTCDATETIME());
        SET @SocialInteractionId = SCOPE_IDENTITY();

        IF @ConversationId IS NOT NULL
        BEGIN
            UPDATE dbo.SocialConversations SET LeadId = COALESCE(@LeadId, LeadId), LastMessageAt = @OccurredAt, Direction = @Direction,
                ImportantMessage = @Message, ReferenceUrl = COALESCE(@SourceUrl, ReferenceUrl), UpdatedAt = SYSUTCDATETIME()
            WHERE SocialPlatformId = @SocialPlatformId AND PlatformConversationId = @ConversationId;
            IF @@ROWCOUNT = 0
                INSERT dbo.SocialConversations(LeadId, SocialPlatformId, PlatformConversationId, LastMessageAt, Direction, ImportantMessage, ReferenceUrl)
                VALUES(@LeadId, @SocialPlatformId, @ConversationId, @OccurredAt, @Direction, @Message, @SourceUrl);
        END;
        IF @LeadId IS NOT NULL
            INSERT dbo.LeadActivities(LeadId, ActivityType, Summary, SourceReference, CampaignExternalId, OccurredAt)
            VALUES(@LeadId, @InteractionType, COALESCE(@Message, @Intent), @SourceUrl, @CampaignId, @OccurredAt);

        IF @LeadId IS NOT NULL EXEC dbo.LeadScore_Recalculate @LeadId = @LeadId, @ScoredAt = NULL, @ReturnResult = 0;
        SELECT @NextScore = LeadScore, @Band = ScoreBand FROM dbo.Leads WHERE LeadId = @LeadId;
        SET @IsQualified = CASE WHEN COALESCE(@NextScore, 0) >= 60 THEN 1 ELSE 0 END;

        UPDATE dbo.SocialListenerStatus SET LastReceivedEvent = @OccurredAt, EventsProcessed = EventsProcessed + 1,
            LeadsGenerated = LeadsGenerated + CASE WHEN @LeadCreated = 1 THEN 1 ELSE 0 END, UpdatedAt = SYSUTCDATETIME()
        WHERE Channel = @Channel;
        IF @@ROWCOUNT = 0
            INSERT dbo.SocialListenerStatus(Channel, Status, LastReceivedEvent, EventsProcessed, LeadsGenerated)
            VALUES(@Channel, N'disconnected', @OccurredAt, 1, CASE WHEN @LeadCreated = 1 THEN 1 ELSE 0 END);

        COMMIT TRANSACTION;
        SELECT CAST(0 AS BIT) Duplicate, @LeadCreated LeadCreated, @LeadUpdated LeadUpdated,
            CAST(1 AS BIT) InteractionInserted, @LeadId LeadId, @SocialEventId SocialEventId,
            @SocialInteractionId InteractionId, l.LeadScore, l.LeadTemperature, l.ScoreBand, l.ScoreReason,
            CAST(CASE WHEN COALESCE(l.LeadScore, 0) >= 60 THEN 1 ELSE 0 END AS BIT) Qualified
        FROM (SELECT 1 AS Value) seed LEFT JOIN dbo.Leads l ON l.LeadId = @LeadId;
    END TRY
    BEGIN CATCH
        DECLARE @ErrorNumber INT = ERROR_NUMBER();
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        IF @ErrorNumber IN (2601, 2627)
        BEGIN
            SELECT TOP (1) @SocialInteractionId = si.SocialInteractionId, @SocialEventId = si.SocialEventId, @LeadId = si.LeadId
            FROM dbo.SocialInteractions si
            WHERE si.SocialPlatformId = @SocialPlatformId AND si.ExternalInteractionId = @ExternalEventId;
            IF @SocialInteractionId IS NOT NULL
            BEGIN
                SELECT CAST(1 AS BIT) Duplicate, CAST(0 AS BIT) LeadCreated, CAST(0 AS BIT) LeadUpdated,
                    CAST(0 AS BIT) InteractionInserted, @LeadId LeadId, @SocialEventId SocialEventId,
                    @SocialInteractionId InteractionId, l.LeadScore, l.LeadTemperature, l.ScoreBand,
                    l.ScoreReason, CAST(CASE WHEN COALESCE(l.LeadScore, 0) >= 60 THEN 1 ELSE 0 END AS BIT) Qualified
                FROM (SELECT 1 AS Value) seed LEFT JOIN dbo.Leads l ON l.LeadId = @LeadId;
                RETURN;
            END;
        END;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.LeadInteraction_UpdateIntent
    @LeadId BIGINT,
    @InteractionId BIGINT,
    @Intent NVARCHAR(64),
    @IntentConfidence DECIMAL(5,4) = NULL,
    @PricingIntent BIT = NULL,
    @PurchaseIntent BIT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @Intent = UPPER(LTRIM(RTRIM(@Intent)));
    IF @Intent NOT IN (
        N'INFORMATION_REQUEST', N'PRICE_REQUEST', N'QUOTE_REQUEST', N'DEMO_REQUEST',
        N'APPOINTMENT_REQUEST', N'CALL_REQUEST', N'PURCHASE_INTENT', N'SUPPORT_REQUEST',
        N'COMPLAINT', N'REFUND_REQUEST', N'PRODUCT_QUESTION', N'AVAILABILITY_REQUEST',
        N'LOCATION_REQUEST', N'INSTALLATION_REQUEST', N'CUSTOMIZATION_REQUEST',
        N'PARTNERSHIP', N'JOB_INQUIRY', N'SPAM', N'OTHER'
    ) THROW 51124, 'Unsupported CRM intent category.', 1;
    IF @IntentConfidence IS NOT NULL AND (@IntentConfidence < 0 OR @IntentConfidence > 1)
        THROW 51121, 'Intent confidence must be between 0 and 1.', 1;

    DECLARE @AIClassificationJson NVARCHAR(MAX) = (
        SELECT @Intent intent, @IntentConfidence intentConfidence,
            @PricingIntent pricingIntent, @PurchaseIntent purchaseIntent
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES
    );

    BEGIN TRANSACTION;
    IF NOT EXISTS (
        SELECT 1 FROM dbo.SocialInteractions WITH (UPDLOCK, HOLDLOCK)
        WHERE SocialInteractionId = @InteractionId AND LeadId = @LeadId
    )
    BEGIN
        ROLLBACK TRANSACTION;
        RETURN;
    END;

    UPDATE dbo.SocialInteractions
    SET Intent = @Intent,
        IntentConfidence = @IntentConfidence,
        QualificationJson = JSON_MODIFY(
            CASE WHEN ISJSON(QualificationJson) = 1 THEN QualificationJson ELSE N'{}' END,
            N'$.aiClassification',
            JSON_QUERY(@AIClassificationJson)
        ),
        ProcessedAt = SYSUTCDATETIME()
    WHERE SocialInteractionId = @InteractionId AND LeadId = @LeadId;

    EXEC dbo.LeadScore_Recalculate @LeadId = @LeadId, @ScoredAt = NULL, @ReturnResult = 0;
    COMMIT TRANSACTION;

    SELECT si.LeadId, si.SocialInteractionId InteractionId, si.Intent, si.IntentConfidence,
        JSON_QUERY(si.QualificationJson, '$.aiClassification') AIClassificationJson,
        l.LeadScore, l.ScoreBand, l.IntentScore, l.EngagementScore, l.FitScore,
        l.RecencyScore, l.SourceScore, l.ScoreReason, l.LastScoredAt,
        CAST(CASE WHEN l.LeadScore >= 60 THEN 1 ELSE 0 END AS BIT) Qualified
    FROM dbo.SocialInteractions si
    JOIN dbo.Leads l ON l.LeadId = si.LeadId
    WHERE si.SocialInteractionId = @InteractionId AND si.LeadId = @LeadId;
END;
GO
