IF COL_LENGTH(N'dbo.Leads', N'ScoreBand') IS NULL
    ALTER TABLE dbo.Leads ADD ScoreBand NVARCHAR(20) NOT NULL CONSTRAINT DF_Leads_ScoreBand DEFAULT N'COLD' WITH VALUES;
IF COL_LENGTH(N'dbo.Leads', N'IntentScore') IS NULL
    ALTER TABLE dbo.Leads ADD IntentScore INT NOT NULL CONSTRAINT DF_Leads_IntentScore DEFAULT 0 WITH VALUES;
IF COL_LENGTH(N'dbo.Leads', N'EngagementScore') IS NULL
    ALTER TABLE dbo.Leads ADD EngagementScore INT NOT NULL CONSTRAINT DF_Leads_EngagementScore DEFAULT 0 WITH VALUES;
IF COL_LENGTH(N'dbo.Leads', N'FitScore') IS NULL
    ALTER TABLE dbo.Leads ADD FitScore INT NOT NULL CONSTRAINT DF_Leads_FitScore DEFAULT 0 WITH VALUES;
IF COL_LENGTH(N'dbo.Leads', N'RecencyScore') IS NULL
    ALTER TABLE dbo.Leads ADD RecencyScore INT NOT NULL CONSTRAINT DF_Leads_RecencyScore DEFAULT 0 WITH VALUES;
IF COL_LENGTH(N'dbo.Leads', N'SourceScore') IS NULL
    ALTER TABLE dbo.Leads ADD SourceScore INT NOT NULL CONSTRAINT DF_Leads_SourceScore DEFAULT 0 WITH VALUES;
IF COL_LENGTH(N'dbo.Leads', N'ScoreReason') IS NULL ALTER TABLE dbo.Leads ADD ScoreReason NVARCHAR(1000) NULL;
IF COL_LENGTH(N'dbo.Leads', N'LastScoredAt') IS NULL ALTER TABLE dbo.Leads ADD LastScoredAt DATETIME2(3) NULL;
IF COL_LENGTH(N'dbo.Leads', N'LastInteractionAt') IS NULL ALTER TABLE dbo.Leads ADD LastInteractionAt DATETIME2(3) NULL;
IF COL_LENGTH(N'dbo.Leads', N'LastInteractionType') IS NULL ALTER TABLE dbo.Leads ADD LastInteractionType NVARCHAR(64) NULL;
IF COL_LENGTH(N'dbo.Leads', N'LastInteractionText') IS NULL ALTER TABLE dbo.Leads ADD LastInteractionText NVARCHAR(MAX) NULL;
IF COL_LENGTH(N'dbo.Leads', N'LastResponseAt') IS NULL ALTER TABLE dbo.Leads ADD LastResponseAt DATETIME2(3) NULL;
IF COL_LENGTH(N'dbo.Leads', N'LastResponseType') IS NULL ALTER TABLE dbo.Leads ADD LastResponseType NVARCHAR(64) NULL;
IF COL_LENGTH(N'dbo.Leads', N'LastResponseText') IS NULL ALTER TABLE dbo.Leads ADD LastResponseText NVARCHAR(MAX) NULL;
GO

UPDATE dbo.Leads
SET ScoreBand = CASE
        WHEN LeadScore >= 80 THEN N'HOT'
        WHEN LeadScore >= 60 THEN N'QUALIFIED'
        WHEN LeadScore >= 30 THEN N'WARM'
        ELSE N'COLD'
    END
WHERE ScoreBand IS NULL OR ScoreBand = N'COLD';
GO

IF COL_LENGTH(N'dbo.SocialInteractions', N'ExternalInteractionId') IS NULL
    ALTER TABLE dbo.SocialInteractions ADD ExternalInteractionId NVARCHAR(255) NULL;
IF COL_LENGTH(N'dbo.SocialInteractions', N'IntentConfidence') IS NULL
    ALTER TABLE dbo.SocialInteractions ADD IntentConfidence DECIMAL(5,4) NULL;
IF COL_LENGTH(N'dbo.SocialInteractions', N'CampaignPostId') IS NULL
    ALTER TABLE dbo.SocialInteractions ADD CampaignPostId BIGINT NULL;
IF COL_LENGTH(N'dbo.SocialInteractions', N'ProcessedAt') IS NULL
    ALTER TABLE dbo.SocialInteractions ADD ProcessedAt DATETIME2(3) NULL;
GO

UPDATE si
SET ExternalInteractionId = e.ExternalEventId,
    ProcessedAt = COALESCE(si.ProcessedAt, e.ProcessedAt, si.CreatedAt)
FROM dbo.SocialInteractions si
JOIN dbo.SocialEvents e ON e.SocialEventId = si.SocialEventId
WHERE si.ExternalInteractionId IS NULL OR si.ProcessedAt IS NULL;
GO

UPDATE dbo.SocialInteractions SET ProcessedAt = CreatedAt WHERE ProcessedAt IS NULL;
GO

IF EXISTS
(
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.SocialInteractions') AND name = N'ProcessedAt' AND is_nullable = 1
)
    ALTER TABLE dbo.SocialInteractions ALTER COLUMN ProcessedAt DATETIME2(3) NOT NULL;
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.default_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.SocialInteractions') AND name = N'DF_SocialInteractions_ProcessedAt'
)
    ALTER TABLE dbo.SocialInteractions ADD CONSTRAINT DF_SocialInteractions_ProcessedAt DEFAULT SYSUTCDATETIME() FOR ProcessedAt;
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.SocialInteractions') AND name = N'UX_SocialInteractions_Platform_ExternalInteraction'
)
    CREATE UNIQUE INDEX UX_SocialInteractions_Platform_ExternalInteraction
        ON dbo.SocialInteractions(SocialPlatformId, ExternalInteractionId)
        WHERE ExternalInteractionId IS NOT NULL;
GO

CREATE OR ALTER PROCEDURE dbo.LeadScore_Recalculate
    @LeadId BIGINT,
    @ScoredAt DATETIME2(3) = NULL,
    @ReturnResult BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.Leads WHERE LeadId = @LeadId) RETURN;

    SET @ScoredAt = COALESCE(@ScoredAt, SYSUTCDATETIME());
    DECLARE @IntentRaw DECIMAL(19,4) = 0, @EngagementRaw DECIMAL(19,4) = 0;
    DECLARE @IntentScore INT = 0, @EngagementScore INT = 0, @FitScore INT = 0;
    DECLARE @RecencyScore INT = 0, @SourceScore INT = 0, @LeadScore INT = 0;
    DECLARE @Band NVARCHAR(20) = N'COLD', @Reason NVARCHAR(1000), @InteractionCount INT = 0;
    DECLARE @LastInteractionAt DATETIME2(3), @LastInteractionType NVARCHAR(64), @LastInteractionText NVARCHAR(MAX);
    DECLARE @LastResponseAt DATETIME2(3), @LastResponseType NVARCHAR(64), @LastResponseText NVARCHAR(MAX);
    DECLARE @LatestIntent NVARCHAR(64), @LatestAgeDays INT;

    ;WITH Meaningful AS
    (
        SELECT si.InteractionType, si.Intent, si.IntentConfidence, si.OccurredAt,
            CASE WHEN DATEDIFF(DAY, si.OccurredAt, @ScoredAt) < 0 THEN 0 ELSE DATEDIFF(DAY, si.OccurredAt, @ScoredAt) END AS AgeDays,
            CASE
                WHEN si.Intent = N'PURCHASE_INTENT' THEN 18
                WHEN si.Intent IN (N'QUOTE_REQUEST', N'DEMO_REQUEST', N'APPOINTMENT_REQUEST') THEN 16
                WHEN si.Intent IN (N'PRICE_REQUEST', N'AVAILABILITY_REQUEST', N'CALL_REQUEST') THEN 12
                WHEN si.Intent IN (N'INFORMATION_REQUEST', N'PRODUCT_QUESTION', N'LOCATION_REQUEST', N'INSTALLATION_REQUEST', N'CUSTOMIZATION_REQUEST') THEN 8
                ELSE 2
            END AS IntentPoints,
            CASE WHEN si.InteractionType IN (N'DM', N'DIRECT_MESSAGE', N'STORY_REPLY') THEN 5 ELSE 3 END AS EngagementPoints
        FROM dbo.SocialInteractions si
        WHERE si.LeadId = @LeadId
          AND UPPER(si.Direction) = N'INBOUND'
          AND si.InteractionType IN (N'COMMENT', N'REPLY', N'MENTION', N'STORY_MENTION', N'DM', N'DIRECT_MESSAGE', N'STORY_REPLY')
    ), Weighted AS
    (
        SELECT *, CASE
            WHEN AgeDays <= 7 THEN CAST(1.00 AS DECIMAL(5,2))
            WHEN AgeDays <= 30 THEN CAST(0.75 AS DECIMAL(5,2))
            WHEN AgeDays <= 90 THEN CAST(0.40 AS DECIMAL(5,2))
            ELSE CAST(0.10 AS DECIMAL(5,2))
        END AS RecencyWeight
        FROM Meaningful
    )
    SELECT @IntentRaw = COALESCE(SUM(IntentPoints * RecencyWeight * COALESCE(IntentConfidence, 1)), 0),
           @EngagementRaw = COALESCE(SUM(EngagementPoints * RecencyWeight), 0),
           @InteractionCount = COUNT(*)
    FROM Weighted;

    SET @IntentScore = CASE WHEN ROUND(@IntentRaw, 0) > 35 THEN 35 ELSE CONVERT(INT, ROUND(@IntentRaw, 0)) END;
    SET @EngagementScore = CASE WHEN ROUND(@EngagementRaw, 0) > 20 THEN 20 ELSE CONVERT(INT, ROUND(@EngagementRaw, 0)) END;

    SELECT @FitScore =
        CASE WHEN NULLIF(LTRIM(RTRIM(Email)), N'') IS NOT NULL THEN 3 ELSE 0 END +
        CASE WHEN NULLIF(LTRIM(RTRIM(Phone)), N'') IS NOT NULL THEN 4 ELSE 0 END +
        CASE WHEN NULLIF(LTRIM(RTRIM(ProductServiceInterest)), N'') IS NOT NULL OR JSON_VALUE(QualificationJson, '$.productService') IS NOT NULL THEN 3 ELSE 0 END +
        CASE WHEN Budget IS NOT NULL OR TRY_CONVERT(DECIMAL(19,4), JSON_VALUE(QualificationJson, '$.budget')) IS NOT NULL THEN 2 ELSE 0 END +
        CASE WHEN NULLIF(LTRIM(RTRIM(PurchaseTimeline)), N'') IS NOT NULL OR JSON_VALUE(QualificationJson, '$.purchaseTimeline') IS NOT NULL THEN 2 ELSE 0 END +
        CASE WHEN JSON_VALUE(QualificationJson, '$.decisionMaker') IN (N'true', N'1') THEN 1 ELSE 0 END
    FROM dbo.Leads WHERE LeadId = @LeadId;
    SET @FitScore = CASE WHEN @FitScore > 15 THEN 15 ELSE COALESCE(@FitScore, 0) END;

    SELECT TOP (1)
        @LastInteractionAt = si.OccurredAt,
        @LastInteractionType = CASE WHEN si.InteractionType IN (N'DIRECT_MESSAGE', N'STORY_REPLY') THEN N'DM' ELSE si.InteractionType END,
        @LastInteractionText = si.MessageText,
        @LatestIntent = si.Intent
    FROM dbo.SocialInteractions si
    WHERE si.LeadId = @LeadId AND UPPER(si.Direction) = N'INBOUND'
      AND si.InteractionType IN (N'COMMENT', N'REPLY', N'MENTION', N'STORY_MENTION', N'DM', N'DIRECT_MESSAGE', N'STORY_REPLY')
    ORDER BY si.OccurredAt DESC, si.SocialInteractionId DESC;

    SELECT TOP (1)
        @LastResponseAt = si.OccurredAt,
        @LastResponseType = CASE WHEN si.InteractionType IN (N'DIRECT_MESSAGE', N'STORY_REPLY') THEN N'DM' ELSE si.InteractionType END,
        @LastResponseText = si.MessageText
    FROM dbo.SocialInteractions si
    WHERE si.LeadId = @LeadId AND UPPER(si.Direction) = N'OUTBOUND'
      AND si.InteractionType IN (N'COMMENT', N'REPLY', N'MENTION', N'STORY_MENTION', N'DM', N'DIRECT_MESSAGE', N'STORY_REPLY')
    ORDER BY si.OccurredAt DESC, si.SocialInteractionId DESC;

    IF @LastInteractionAt IS NOT NULL
    BEGIN
        SET @LatestAgeDays = CASE WHEN DATEDIFF(DAY, @LastInteractionAt, @ScoredAt) < 0 THEN 0 ELSE DATEDIFF(DAY, @LastInteractionAt, @ScoredAt) END;
        SET @RecencyScore = CASE WHEN @LatestAgeDays <= 1 THEN 15 WHEN @LatestAgeDays <= 7 THEN 12 WHEN @LatestAgeDays <= 30 THEN 8 WHEN @LatestAgeDays <= 90 THEN 4 ELSE 1 END;
    END;

    SELECT @SourceScore = COALESCE(MAX(CASE
        WHEN si.LeadFormId IS NOT NULL THEN 15
        WHEN si.SourceType = N'PAID' OR si.AdvertisementId IS NOT NULL THEN 12
        WHEN si.CampaignExternalId IS NOT NULL OR si.CampaignName IS NOT NULL THEN 8
        ELSE 5
    END), 0)
    FROM dbo.SocialInteractions si
    WHERE si.LeadId = @LeadId AND UPPER(si.Direction) = N'INBOUND'
      AND si.InteractionType IN (N'COMMENT', N'REPLY', N'MENTION', N'STORY_MENTION', N'DM', N'DIRECT_MESSAGE', N'STORY_REPLY');

    SET @LeadScore = @IntentScore + @EngagementScore + @FitScore + @RecencyScore + @SourceScore;
    SET @LeadScore = CASE WHEN @LeadScore > 100 THEN 100 WHEN @LeadScore < 0 THEN 0 ELSE @LeadScore END;
    SET @Band = CASE WHEN @LeadScore >= 80 THEN N'HOT' WHEN @LeadScore >= 60 THEN N'QUALIFIED' WHEN @LeadScore >= 30 THEN N'WARM' ELSE N'COLD' END;
    SET @Reason = CASE WHEN @InteractionCount = 0
        THEN CONCAT(N'Intent 0/35; engagement 0/20; fit ', @FitScore, N'/15; recency 0/15; source 0/15. No inbound comment or DM history.')
        ELSE CONCAT(N'Intent ', @IntentScore, N'/35; engagement ', @EngagementScore, N'/20 across ', @InteractionCount,
            N' inbound interaction', CASE WHEN @InteractionCount = 1 THEN N'' ELSE N's' END,
            N'; fit ', @FitScore, N'/15; recency ', @RecencyScore, N'/15 (', @LatestAgeDays,
            N' day', CASE WHEN @LatestAgeDays = 1 THEN N'' ELSE N's' END, N'); source ', @SourceScore, N'/15.') END;

    UPDATE dbo.Leads
    SET LeadScore = @LeadScore, LeadTemperature = @Band, ScoreBand = @Band,
        IntentScore = @IntentScore, EngagementScore = @EngagementScore, FitScore = @FitScore,
        RecencyScore = @RecencyScore, SourceScore = @SourceScore, ScoreReason = @Reason,
        LastScoredAt = @ScoredAt, LastIntent = COALESCE(@LatestIntent, LastIntent),
        LastInteractionAt = @LastInteractionAt, LastInteractionType = @LastInteractionType,
        LastInteractionText = @LastInteractionText, LastResponseAt = @LastResponseAt,
        LastResponseType = @LastResponseType, LastResponseText = @LastResponseText,
        LastContactAt = CASE WHEN @LastInteractionAt IS NOT NULL AND (LastContactAt IS NULL OR @LastInteractionAt > LastContactAt) THEN @LastInteractionAt ELSE LastContactAt END,
        UpdatedAt = SYSUTCDATETIME()
    WHERE LeadId = @LeadId;

    IF @ReturnResult = 1
        SELECT LeadId, LeadScore, ScoreBand, IntentScore, EngagementScore, FitScore, RecencyScore,
            SourceScore, ScoreReason, LastScoredAt, CAST(CASE WHEN LeadScore >= 60 THEN 1 ELSE 0 END AS BIT) Qualified
        FROM dbo.Leads WHERE LeadId = @LeadId;
END;
GO

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
    @SourceType NVARCHAR(16) = N'ORGANIC', @RawRetentionDays INT = 7
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
    DECLARE @LeadCreated BIT = 0, @LeadUpdated BIT = 0, @IdentityKey NVARCHAR(255);
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

        SELECT @SocialInteractionId = si.SocialInteractionId, @SocialEventId = si.SocialEventId, @LeadId = si.LeadId
        FROM dbo.SocialInteractions si WITH (UPDLOCK, HOLDLOCK)
        WHERE si.SocialPlatformId = @SocialPlatformId AND si.ExternalInteractionId = @ExternalEventId;
        IF @SocialInteractionId IS NOT NULL
        BEGIN
            COMMIT TRANSACTION;
            SELECT CAST(1 AS BIT) Duplicate, CAST(0 AS BIT) LeadCreated, CAST(0 AS BIT) LeadUpdated,
                CAST(0 AS BIT) InteractionInserted, @LeadId LeadId, @SocialEventId SocialEventId,
                l.LeadScore, l.LeadTemperature, l.ScoreBand,
                CAST(CASE WHEN COALESCE(l.LeadScore, 0) >= 60 THEN 1 ELSE 0 END AS BIT) Qualified
            FROM (SELECT 1 AS Value) seed LEFT JOIN dbo.Leads l ON l.LeadId = @LeadId;
            RETURN;
        END;

        SELECT @SocialEventId = SocialEventId FROM dbo.SocialEvents WITH (UPDLOCK, HOLDLOCK)
        WHERE Channel = @Channel AND ExternalEventId = @ExternalEventId;
        IF @SocialEventId IS NOT NULL
        BEGIN
            SELECT TOP (1) @LeadId = LeadId FROM dbo.LeadSourceAttribution WHERE SocialEventId = @SocialEventId;
            COMMIT TRANSACTION;
            SELECT CAST(1 AS BIT) Duplicate, CAST(0 AS BIT) LeadCreated, CAST(0 AS BIT) LeadUpdated,
                CAST(0 AS BIT) InteractionInserted, @LeadId LeadId, @SocialEventId SocialEventId,
                l.LeadScore, l.LeadTemperature, l.ScoreBand,
                CAST(CASE WHEN COALESCE(l.LeadScore, 0) >= 60 THEN 1 ELSE 0 END AS BIT) Qualified
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
            IF @IdentityKey IS NOT NULL
                SELECT TOP (1) @LeadId = sa.LeadId FROM dbo.SocialAccounts sa WITH (UPDLOCK, HOLDLOCK)
                WHERE sa.SocialPlatformId = @SocialPlatformId AND sa.PlatformUserId = @IdentityKey;
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
                UPDATE dbo.SocialAccounts SET LeadId = @LeadId, Username = COALESCE(@Username, Username),
                    DisplayName = COALESCE(@DisplayName, DisplayName), ProfileUrl = COALESCE(@SourceUrl, ProfileUrl),
                    LastVerifiedAt = @OccurredAt, UpdatedAt = SYSUTCDATETIME()
                WHERE SocialPlatformId = @SocialPlatformId AND PlatformUserId = @IdentityKey;
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
            @NextScore LeadScore, @Band LeadTemperature, @Band ScoreBand, @IsQualified Qualified;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialLead_GetRecent @Limit INT = 100
AS
BEGIN
    SET NOCOUNT ON;
    SET @Limit = CASE WHEN @Limit < 1 THEN 1 WHEN @Limit > 500 THEN 500 ELSE @Limit END;
    SELECT TOP (@Limit) l.LeadId, l.Name, l.FirstName, l.LastName, l.DisplayName, l.Company, l.Email, l.Phone,
        l.SocialUsername, l.Facebook, l.Instagram, l.[X], COALESCE(NULLIF(l.[Source], N''), N'Manual') SourceChannel,
        l.Status, l.EstimatedValue Value, l.LeadScore, l.LeadTemperature, l.ScoreBand, l.IntentScore,
        l.EngagementScore, l.FitScore, l.RecencyScore, l.SourceScore, l.ScoreReason, l.LastScoredAt,
        l.LastIntent, l.CrmNotes, l.ProductServiceInterest, l.QualificationJson, l.Budget, l.PurchaseTimeline,
        l.PreferredContactMethod, l.AssignedSalesperson, l.ConsentStatus, l.ConvertedCustomer, l.LostReason,
        l.FirstContactAt, l.LastContactAt, l.LastInteractionAt, l.LastInteractionType, l.LastInteractionText,
        l.LastResponseAt, l.LastResponseType, l.LastResponseText, l.CreatedAt, l.UpdatedAt
    FROM dbo.Leads l ORDER BY l.UpdatedAt DESC, l.LeadId DESC;
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
    SELECT si.SocialInteractionId, sp.Code Platform, si.ExternalInteractionId, si.PlatformUserId,
        si.PlatformPostId, si.PlatformPostId ExternalPostId, si.PlatformConversationId,
        CASE WHEN si.InteractionType IN (N'DIRECT_MESSAGE', N'STORY_REPLY') THEN N'DM' ELSE si.InteractionType END InteractionType,
        si.MessageText, si.OccurredAt, si.Direction, si.Intent, si.IntentConfidence, si.Sentiment, si.ProductService,
        si.CampaignExternalId, si.CampaignPostId, si.CampaignName, si.AdvertisementId, si.LeadFormId, si.SourceType,
        si.ResponseStatus, si.QualificationJson, si.ProcessedAt
    FROM dbo.SocialInteractions si JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId = si.SocialPlatformId
    WHERE si.LeadId = @LeadId ORDER BY si.OccurredAt DESC, si.SocialInteractionId DESC;
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

DECLARE @BackfillLeadId BIGINT;
DECLARE lead_score_backfill CURSOR LOCAL FAST_FORWARD FOR
    SELECT DISTINCT LeadId FROM dbo.SocialInteractions WHERE LeadId IS NOT NULL;
OPEN lead_score_backfill;
FETCH NEXT FROM lead_score_backfill INTO @BackfillLeadId;
WHILE @@FETCH_STATUS = 0
BEGIN
    EXEC dbo.LeadScore_Recalculate @LeadId = @BackfillLeadId, @ScoredAt = NULL, @ReturnResult = 0;
    FETCH NEXT FROM lead_score_backfill INTO @BackfillLeadId;
END;
CLOSE lead_score_backfill;
DEALLOCATE lead_score_backfill;
GO
