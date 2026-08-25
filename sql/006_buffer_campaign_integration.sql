IF COL_LENGTH(N'dbo.Campaigns', N'CampaignObjective') IS NULL
    ALTER TABLE dbo.Campaigns ADD CampaignObjective NVARCHAR(2000) NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'PostText') IS NULL
    ALTER TABLE dbo.Campaigns ADD PostText NVARCHAR(MAX) NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'MediaType') IS NULL
    ALTER TABLE dbo.Campaigns ADD MediaType NVARCHAR(16) NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'MediaUrl') IS NULL
    ALTER TABLE dbo.Campaigns ADD MediaUrl NVARCHAR(2048) NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'PublishDateTime') IS NULL
    ALTER TABLE dbo.Campaigns ADD PublishDateTime DATETIME2(3) NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'HighIntentKeywords') IS NULL
    ALTER TABLE dbo.Campaigns ADD HighIntentKeywords NVARCHAR(2000) NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'AIReplyEnabled') IS NULL
    ALTER TABLE dbo.Campaigns ADD AIReplyEnabled BIT NOT NULL
        CONSTRAINT DF_Campaigns_AIReplyEnabled DEFAULT 0;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'TargetSocialChannelsJson') IS NULL
    ALTER TABLE dbo.Campaigns ADD TargetSocialChannelsJson NVARCHAR(MAX) NULL;
GO

IF OBJECT_ID(N'dbo.CampaignPosts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CampaignPosts
    (
        CampaignPostId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CampaignPosts PRIMARY KEY,
        CampaignId BIGINT NOT NULL,
        Platform NVARCHAR(64) NOT NULL,
        BufferChannelId NVARCHAR(255) NOT NULL,
        BufferPostId NVARCHAR(255) NULL,
        ScheduledAt DATETIME2(3) NULL,
        PublishedAt DATETIME2(3) NULL,
        PostStatus NVARCHAR(16) NOT NULL CONSTRAINT DF_CampaignPosts_PostStatus DEFAULT N'DRAFT',
        ExternalPostId NVARCHAR(255) NULL,
        PostUrl NVARCHAR(2048) NULL,
        LastCheckedAt DATETIME2(3) NULL,
        ErrorSource NVARCHAR(32) NULL,
        ErrorMessage NVARCHAR(1000) NULL,
        LastAttemptAt DATETIME2(3) NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_CampaignPosts_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_CampaignPosts_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_CampaignPosts_Campaign FOREIGN KEY (CampaignId) REFERENCES dbo.Campaigns(CampaignId),
        CONSTRAINT UQ_CampaignPosts_Campaign_Channel UNIQUE (CampaignId, BufferChannelId),
        CONSTRAINT CK_CampaignPosts_Status CHECK
            (PostStatus IN (N'DRAFT', N'SCHEDULED', N'QUEUED', N'PUBLISHED', N'FAILED')),
        CONSTRAINT CK_CampaignPosts_ErrorSource CHECK (ErrorSource IS NULL OR ErrorSource = N'BUFFER')
    );
END;
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_CampaignPosts_BufferPostId'
      AND object_id = OBJECT_ID(N'dbo.CampaignPosts')
)
    CREATE INDEX IX_CampaignPosts_BufferPostId
        ON dbo.CampaignPosts (BufferPostId)
        WHERE BufferPostId IS NOT NULL;
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_CampaignPosts_Status_ScheduledAt'
      AND object_id = OBJECT_ID(N'dbo.CampaignPosts')
)
    CREATE INDEX IX_CampaignPosts_Status_ScheduledAt
        ON dbo.CampaignPosts (PostStatus, ScheduledAt);
GO

CREATE OR ALTER PROCEDURE dbo.Campaign_Save
    @CampaignId BIGINT = NULL,
    @Name NVARCHAR(255),
    @Platform NVARCHAR(100),
    @Audience NVARCHAR(MAX),
    @Message NVARCHAR(MAX),
    @Budget DECIMAL(19,4) = 0,
    @Mode NVARCHAR(32) = N'draft',
    @CreatedByAi BIT = 0,
    @CampaignObjective NVARCHAR(2000) = NULL,
    @PostText NVARCHAR(MAX) = NULL,
    @MediaType NVARCHAR(16) = NULL,
    @MediaUrl NVARCHAR(2048) = NULL,
    @PublishDateTime DATETIME2(3) = NULL,
    @HighIntentKeywords NVARCHAR(2000) = NULL,
    @AIReplyEnabled BIT = 0,
    @TargetSocialChannelsJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @Mode = N'production' AND
       (@CampaignId IS NULL OR NOT EXISTS
          (SELECT 1 FROM dbo.Campaigns WHERE CampaignId = @CampaignId AND Mode = N'production'))
        THROW 51001, 'Use a campaign production gate to enter production mode.', 1;
    IF @MediaType IS NOT NULL AND @MediaType NOT IN (N'image', N'video')
        THROW 51201, 'Campaign media type must be image or video.', 1;
    IF (@MediaType IS NULL AND @MediaUrl IS NOT NULL) OR (@MediaType IS NOT NULL AND @MediaUrl IS NULL)
        THROW 51202, 'Campaign media type and URL must be stored together.', 1;

    IF @CampaignId IS NULL
    BEGIN
        INSERT dbo.Campaigns
            (Name, Platform, Audience, Message, Budget, Mode, CreatedByAi,
             CampaignObjective, PostText, MediaType, MediaUrl, PublishDateTime,
             HighIntentKeywords, AIReplyEnabled, TargetSocialChannelsJson)
        VALUES
            (@Name, @Platform, @Audience, @Message, @Budget, @Mode, @CreatedByAi,
             @CampaignObjective, @PostText, @MediaType, @MediaUrl, @PublishDateTime,
             @HighIntentKeywords, @AIReplyEnabled, @TargetSocialChannelsJson);
        SET @CampaignId = SCOPE_IDENTITY();
    END
    ELSE
        UPDATE dbo.Campaigns
        SET Name = @Name,
            Platform = @Platform,
            Audience = @Audience,
            Message = @Message,
            Budget = @Budget,
            Mode = @Mode,
            CreatedByAi = @CreatedByAi,
            CampaignObjective = @CampaignObjective,
            PostText = @PostText,
            MediaType = @MediaType,
            MediaUrl = @MediaUrl,
            PublishDateTime = @PublishDateTime,
            HighIntentKeywords = @HighIntentKeywords,
            AIReplyEnabled = @AIReplyEnabled,
            TargetSocialChannelsJson = @TargetSocialChannelsJson,
            UpdatedAt = SYSUTCDATETIME()
        WHERE CampaignId = @CampaignId;

    SELECT * FROM dbo.Campaigns WHERE CampaignId = @CampaignId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.BufferCampaignPost_Create
    @CampaignId BIGINT,
    @Platform NVARCHAR(64),
    @BufferChannelId NVARCHAR(255),
    @ScheduledAt DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    INSERT dbo.CampaignPosts
        (CampaignId, Platform, BufferChannelId, ScheduledAt, PostStatus)
    VALUES
        (@CampaignId, @Platform, @BufferChannelId, @ScheduledAt, N'DRAFT');
    SELECT * FROM dbo.CampaignPosts WHERE CampaignPostId = SCOPE_IDENTITY();
END;
GO

CREATE OR ALTER PROCEDURE dbo.BufferCampaignPost_ApplyStatus
    @CampaignPostId BIGINT,
    @BufferPostId NVARCHAR(255),
    @ScheduledAt DATETIME2(3) = NULL,
    @PublishedAt DATETIME2(3) = NULL,
    @PostStatus NVARCHAR(16),
    @ExternalPostId NVARCHAR(255) = NULL,
    @PostUrl NVARCHAR(2048) = NULL,
    @ErrorMessage NVARCHAR(1000) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @PostStatus NOT IN (N'DRAFT', N'SCHEDULED', N'QUEUED', N'PUBLISHED', N'FAILED')
        THROW 51203, 'Unsupported campaign post status.', 1;

    UPDATE dbo.CampaignPosts
    SET BufferPostId = COALESCE(@BufferPostId, BufferPostId),
        ScheduledAt = COALESCE(@ScheduledAt, ScheduledAt),
        PublishedAt = COALESCE(@PublishedAt, PublishedAt),
        PostStatus = @PostStatus,
        ExternalPostId = COALESCE(@ExternalPostId, ExternalPostId),
        PostUrl = COALESCE(@PostUrl, PostUrl),
        LastCheckedAt = SYSUTCDATETIME(),
        LastAttemptAt = SYSUTCDATETIME(),
        ErrorSource = CASE WHEN @PostStatus = N'FAILED' THEN N'BUFFER' ELSE NULL END,
        ErrorMessage = CASE WHEN @PostStatus = N'FAILED' THEN @ErrorMessage ELSE NULL END,
        UpdatedAt = SYSUTCDATETIME()
    WHERE CampaignPostId = @CampaignPostId;

    SELECT * FROM dbo.CampaignPosts WHERE CampaignPostId = @CampaignPostId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.BufferCampaignPost_Fail
    @CampaignPostId BIGINT,
    @ErrorMessage NVARCHAR(1000)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.CampaignPosts
    SET PostStatus = N'FAILED',
        ErrorSource = N'BUFFER',
        ErrorMessage = @ErrorMessage,
        LastCheckedAt = SYSUTCDATETIME(),
        LastAttemptAt = SYSUTCDATETIME(),
        UpdatedAt = SYSUTCDATETIME()
    WHERE CampaignPostId = @CampaignPostId;
    SELECT * FROM dbo.CampaignPosts WHERE CampaignPostId = @CampaignPostId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.BufferCampaignPost_RecordAttemptError
    @CampaignPostId BIGINT,
    @ErrorMessage NVARCHAR(1000)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.CampaignPosts
    SET ErrorSource = N'BUFFER',
        ErrorMessage = @ErrorMessage,
        LastCheckedAt = SYSUTCDATETIME(),
        LastAttemptAt = SYSUTCDATETIME(),
        UpdatedAt = SYSUTCDATETIME()
    WHERE CampaignPostId = @CampaignPostId;
    SELECT * FROM dbo.CampaignPosts WHERE CampaignPostId = @CampaignPostId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.BufferCampaignPost_Get
    @CampaignId BIGINT = NULL,
    @SyncableOnly BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SELECT *
    FROM dbo.CampaignPosts
    WHERE (@CampaignId IS NULL OR CampaignId = @CampaignId)
      AND (@SyncableOnly = 0 OR (BufferPostId IS NOT NULL AND PostStatus <> N'PUBLISHED'))
    ORDER BY CreatedAt DESC, CampaignPostId DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.BufferCampaign_SetMode
    @CampaignId BIGINT,
    @Mode NVARCHAR(32)
AS
BEGIN
    SET NOCOUNT ON;
    IF @Mode NOT IN (N'draft', N'test', N'production', N'paused', N'archived')
        THROW 51204, 'Unsupported campaign mode.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.Campaigns WHERE CampaignId = @CampaignId)
        RETURN;
    IF @Mode = N'production' AND
       (NOT EXISTS (SELECT 1 FROM dbo.CampaignPosts WHERE CampaignId = @CampaignId)
        OR EXISTS
        (
            SELECT 1 FROM dbo.CampaignPosts
            WHERE CampaignId = @CampaignId
              AND PostStatus NOT IN (N'SCHEDULED', N'QUEUED', N'PUBLISHED')
        ))
        THROW 51205, 'Every Buffer campaign post must be scheduled before production mode.', 1;

    UPDATE dbo.Campaigns
    SET Mode = @Mode,
        LastReadinessCheckAt = SYSUTCDATETIME(),
        LastReadinessError = NULL,
        UpdatedAt = SYSUTCDATETIME()
    WHERE CampaignId = @CampaignId;
    SELECT * FROM dbo.Campaigns WHERE CampaignId = @CampaignId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CRMContent_GetAll
AS
BEGIN
    SET NOCOUNT ON;
    SELECT c.CampaignId, c.Name, c.Platform, c.Audience, c.Message, c.Budget, c.Mode, c.CreatedByAi,
           c.CampaignObjective, c.PostText, c.MediaType, c.MediaUrl, c.PublishDateTime,
           c.HighIntentKeywords, c.AIReplyEnabled, c.TargetSocialChannelsJson,
           c.LastReadinessCheckAt, c.LastReadinessError, c.CreatedAt, c.UpdatedAt,
           automation.SourceType, automation.ExternalCampaignId, automation.AdvertisementId, automation.LeadFormId,
           automation.ContentReference, automation.AutomationStatus, automation.AutomationEnabled, automation.Schedule,
           automation.CadenceMinutes, automation.LastRunAt, automation.NextRunAt, automation.LastError,
           automation.RetryCount, automation.MaxRetries, automation.CurrentMetricsJson, automation.LastProcessed,
           (
               SELECT p.CampaignPostId, p.CampaignId, p.Platform, p.BufferChannelId, p.BufferPostId,
                      p.ScheduledAt, p.PublishedAt, p.PostStatus, p.ExternalPostId, p.PostUrl,
                      p.LastCheckedAt, p.ErrorSource, p.ErrorMessage, p.LastAttemptAt, p.CreatedAt, p.UpdatedAt
               FROM dbo.CampaignPosts p
               WHERE p.CampaignId = c.CampaignId
               ORDER BY p.CampaignPostId
               FOR JSON PATH
           ) AS CampaignPostsJson
    FROM dbo.Campaigns c
    OUTER APPLY
    (
        SELECT TOP (1) sc.SourceType, sc.ExternalCampaignId, sc.AdvertisementId, sc.LeadFormId, sc.ContentReference,
            sc.AutomationStatus, sc.AutomationEnabled, sc.Schedule, sc.CadenceMinutes, sc.LastRunAt, sc.NextRunAt,
            sc.LastError, sc.RetryCount, sc.MaxRetries, sc.CurrentMetricsJson, sc.LastProcessed
        FROM dbo.SocialCampaigns sc WHERE sc.CampaignId = c.CampaignId ORDER BY sc.SocialCampaignId
    ) automation
    ORDER BY c.CreatedAt DESC;

    SELECT LandingPageId, CampaignId, Title, Slug, Headline, Teaser, WebinarUrl,
           PaymentUrl, Status, Registrations, CreatedByAi, CreatedAt, UpdatedAt
    FROM dbo.LandingPages ORDER BY CreatedAt DESC;

    SELECT WebinarId, CampaignId, LandingPageId, Title, Description, ScheduledAt,
           WebinarUrl, Status, CreatedByAi, CreatedAt, UpdatedAt
    FROM dbo.Webinars ORDER BY CreatedAt DESC;
END;
GO
