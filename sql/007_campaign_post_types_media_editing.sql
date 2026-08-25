IF COL_LENGTH(N'dbo.Campaigns', N'PostType') IS NULL
    ALTER TABLE dbo.Campaigns ADD PostType NVARCHAR(16) NOT NULL
        CONSTRAINT DF_Campaigns_PostType DEFAULT N'POST';
GO
IF COL_LENGTH(N'dbo.Campaigns', N'MediaOriginalName') IS NULL
    ALTER TABLE dbo.Campaigns ADD MediaOriginalName NVARCHAR(255) NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'MediaMimeType') IS NULL
    ALTER TABLE dbo.Campaigns ADD MediaMimeType NVARCHAR(127) NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'MediaSizeBytes') IS NULL
    ALTER TABLE dbo.Campaigns ADD MediaSizeBytes BIGINT NULL;
GO
IF COL_LENGTH(N'dbo.CampaignPosts', N'IsActive') IS NULL
    ALTER TABLE dbo.CampaignPosts ADD IsActive BIT NOT NULL
        CONSTRAINT DF_CampaignPosts_IsActive DEFAULT 1;
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_Campaigns_PostType'
      AND parent_object_id = OBJECT_ID(N'dbo.Campaigns')
)
    ALTER TABLE dbo.Campaigns ADD CONSTRAINT CK_Campaigns_PostType
        CHECK (PostType IN (N'POST', N'REEL', N'STORY'));
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
    @PostType NVARCHAR(16) = N'POST',
    @MediaType NVARCHAR(16) = NULL,
    @MediaUrl NVARCHAR(2048) = NULL,
    @MediaOriginalName NVARCHAR(255) = NULL,
    @MediaMimeType NVARCHAR(127) = NULL,
    @MediaSizeBytes BIGINT = NULL,
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
    IF @PostType NOT IN (N'POST', N'REEL', N'STORY')
        THROW 51301, 'Campaign post type must be POST, REEL, or STORY.', 1;
    IF @MediaType IS NOT NULL AND @MediaType NOT IN (N'image', N'video')
        THROW 51201, 'Campaign media type must be image or video.', 1;
    IF (@MediaType IS NULL AND @MediaUrl IS NOT NULL) OR (@MediaType IS NOT NULL AND @MediaUrl IS NULL)
        THROW 51202, 'Campaign media type and URL must be stored together.', 1;
    IF @MediaSizeBytes IS NOT NULL AND @MediaSizeBytes < 1
        THROW 51302, 'Campaign media size must be positive.', 1;

    IF @CampaignId IS NULL
    BEGIN
        INSERT dbo.Campaigns
            (Name, Platform, Audience, Message, Budget, Mode, CreatedByAi,
             CampaignObjective, PostText, PostType, MediaType, MediaUrl,
             MediaOriginalName, MediaMimeType, MediaSizeBytes, PublishDateTime,
             HighIntentKeywords, AIReplyEnabled, TargetSocialChannelsJson)
        VALUES
            (@Name, @Platform, @Audience, @Message, @Budget, @Mode, @CreatedByAi,
             @CampaignObjective, @PostText, @PostType, @MediaType, @MediaUrl,
             @MediaOriginalName, @MediaMimeType, @MediaSizeBytes, @PublishDateTime,
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
            PostType = @PostType,
            MediaType = @MediaType,
            MediaUrl = @MediaUrl,
            MediaOriginalName = @MediaOriginalName,
            MediaMimeType = @MediaMimeType,
            MediaSizeBytes = @MediaSizeBytes,
            PublishDateTime = @PublishDateTime,
            HighIntentKeywords = @HighIntentKeywords,
            AIReplyEnabled = @AIReplyEnabled,
            TargetSocialChannelsJson = @TargetSocialChannelsJson,
            UpdatedAt = SYSUTCDATETIME()
        WHERE CampaignId = @CampaignId;

    SELECT * FROM dbo.Campaigns WHERE CampaignId = @CampaignId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.BufferCampaignPost_Upsert
    @CampaignId BIGINT,
    @Platform NVARCHAR(64),
    @BufferChannelId NVARCHAR(255),
    @ScheduledAt DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @CampaignPostId BIGINT;
    SELECT @CampaignPostId = CampaignPostId
    FROM dbo.CampaignPosts
    WHERE CampaignId = @CampaignId AND BufferChannelId = @BufferChannelId;

    IF @CampaignPostId IS NULL
    BEGIN
        INSERT dbo.CampaignPosts
            (CampaignId, Platform, BufferChannelId, ScheduledAt, PostStatus, IsActive)
        VALUES
            (@CampaignId, @Platform, @BufferChannelId, @ScheduledAt, N'DRAFT', 1);
        SET @CampaignPostId = SCOPE_IDENTITY();
    END
    ELSE
        UPDATE dbo.CampaignPosts
        SET Platform = @Platform,
            ScheduledAt = @ScheduledAt,
            IsActive = 1,
            UpdatedAt = SYSUTCDATETIME()
        WHERE CampaignPostId = @CampaignPostId;

    SELECT * FROM dbo.CampaignPosts WHERE CampaignPostId = @CampaignPostId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.BufferCampaignPost_DeactivateMissingDrafts
    @CampaignId BIGINT,
    @SelectedChannelIdsJson NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    IF ISJSON(@SelectedChannelIdsJson) <> 1
        THROW 51303, 'Selected Buffer channel IDs must be valid JSON.', 1;

    UPDATE post
    SET IsActive = 0,
        UpdatedAt = SYSUTCDATETIME()
    FROM dbo.CampaignPosts post
    WHERE post.CampaignId = @CampaignId
      AND post.BufferPostId IS NULL
      AND NOT EXISTS
      (
          SELECT 1
          FROM OPENJSON(@SelectedChannelIdsJson) selected
          WHERE CONVERT(NVARCHAR(255), selected.[value]) = post.BufferChannelId
      );

    SELECT * FROM dbo.CampaignPosts WHERE CampaignId = @CampaignId ORDER BY CampaignPostId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.BufferCampaignPost_Get
    @CampaignId BIGINT = NULL,
    @SyncableOnly BIT = 0,
    @ActiveOnly BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SELECT *
    FROM dbo.CampaignPosts
    WHERE (@CampaignId IS NULL OR CampaignId = @CampaignId)
      AND (@ActiveOnly = 0 OR IsActive = 1)
      AND (@SyncableOnly = 0 OR (IsActive = 1 AND BufferPostId IS NOT NULL AND PostStatus <> N'PUBLISHED'))
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
       (NOT EXISTS (SELECT 1 FROM dbo.CampaignPosts WHERE CampaignId = @CampaignId AND IsActive = 1)
        OR EXISTS
        (
            SELECT 1 FROM dbo.CampaignPosts
            WHERE CampaignId = @CampaignId
              AND IsActive = 1
              AND PostStatus NOT IN (N'SCHEDULED', N'QUEUED', N'PUBLISHED')
        ))
        THROW 51205, 'Every active Buffer campaign post must be scheduled before production mode.', 1;

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
           c.CampaignObjective, c.PostText, c.PostType, c.MediaType, c.MediaUrl,
           c.MediaOriginalName, c.MediaMimeType, c.MediaSizeBytes, c.PublishDateTime,
           c.HighIntentKeywords, c.AIReplyEnabled, c.TargetSocialChannelsJson,
           c.LastReadinessCheckAt, c.LastReadinessError, c.CreatedAt, c.UpdatedAt,
           automation.SourceType, automation.ExternalCampaignId, automation.AdvertisementId, automation.LeadFormId,
           automation.ContentReference, automation.AutomationStatus, automation.AutomationEnabled, automation.Schedule,
           automation.CadenceMinutes, automation.LastRunAt, automation.NextRunAt, automation.LastError,
           automation.RetryCount, automation.MaxRetries, automation.CurrentMetricsJson, automation.LastProcessed,
           (
               SELECT p.CampaignPostId, p.CampaignId, p.Platform, p.BufferChannelId, p.BufferPostId,
                      p.ScheduledAt, p.PublishedAt, p.PostStatus, p.ExternalPostId, p.PostUrl,
                      p.LastCheckedAt, p.ErrorSource, p.ErrorMessage, p.LastAttemptAt, p.IsActive,
                      p.CreatedAt, p.UpdatedAt
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
