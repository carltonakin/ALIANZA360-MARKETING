IF COL_LENGTH(N'dbo.Campaigns', N'MediaId') IS NULL
    ALTER TABLE dbo.Campaigns ADD MediaId NVARCHAR(100) NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'MediaWidth') IS NULL
    ALTER TABLE dbo.Campaigns ADD MediaWidth INT NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'MediaHeight') IS NULL
    ALTER TABLE dbo.Campaigns ADD MediaHeight INT NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'MediaDurationSeconds') IS NULL
    ALTER TABLE dbo.Campaigns ADD MediaDurationSeconds DECIMAL(12,3) NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'MediaFrameRate') IS NULL
    ALTER TABLE dbo.Campaigns ADD MediaFrameRate DECIMAL(8,3) NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'MediaVideoCodec') IS NULL
    ALTER TABLE dbo.Campaigns ADD MediaVideoCodec NVARCHAR(64) NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'MediaAudioCodec') IS NULL
    ALTER TABLE dbo.Campaigns ADD MediaAudioCodec NVARCHAR(64) NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'MediaAudioSampleRate') IS NULL
    ALTER TABLE dbo.Campaigns ADD MediaAudioSampleRate INT NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'MediaVideoBitrate') IS NULL
    ALTER TABLE dbo.Campaigns ADD MediaVideoBitrate BIGINT NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'MediaAudioBitrate') IS NULL
    ALTER TABLE dbo.Campaigns ADD MediaAudioBitrate BIGINT NULL;
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
    @MediaId NVARCHAR(100) = NULL,
    @MediaType NVARCHAR(16) = NULL,
    @MediaUrl NVARCHAR(2048) = NULL,
    @MediaOriginalName NVARCHAR(255) = NULL,
    @MediaMimeType NVARCHAR(127) = NULL,
    @MediaSizeBytes BIGINT = NULL,
    @MediaWidth INT = NULL,
    @MediaHeight INT = NULL,
    @MediaDurationSeconds DECIMAL(12,3) = NULL,
    @MediaFrameRate DECIMAL(8,3) = NULL,
    @MediaVideoCodec NVARCHAR(64) = NULL,
    @MediaAudioCodec NVARCHAR(64) = NULL,
    @MediaAudioSampleRate INT = NULL,
    @MediaVideoBitrate BIGINT = NULL,
    @MediaAudioBitrate BIGINT = NULL,
    @PublishDateTime DATETIME2(3) = NULL,
    @HighIntentKeywords NVARCHAR(2000) = NULL,
    @AIReplyEnabled BIT = 0,
    @TargetSocialChannelsJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
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
    IF @MediaSizeBytes IS NOT NULL AND (@MediaSizeBytes < 1 OR @MediaSizeBytes > 314572800)
        THROW 51401, 'Campaign media size must be between 1 byte and 300 MB.', 1;
    BEGIN TRY
        BEGIN TRANSACTION;
        IF @CampaignId IS NULL
        BEGIN
            INSERT dbo.Campaigns
                (Name, Platform, Audience, Message, Budget, Mode, CreatedByAi,
                 CampaignObjective, PostText, PostType, MediaId, MediaType, MediaUrl,
                 MediaOriginalName, MediaMimeType, MediaSizeBytes, MediaWidth, MediaHeight,
                 MediaDurationSeconds, MediaFrameRate, MediaVideoCodec, MediaAudioCodec,
                 MediaAudioSampleRate, MediaVideoBitrate, MediaAudioBitrate, PublishDateTime,
                 HighIntentKeywords, AIReplyEnabled, TargetSocialChannelsJson)
            VALUES
                (@Name, @Platform, @Audience, @Message, @Budget, @Mode, @CreatedByAi,
                 @CampaignObjective, @PostText, @PostType, @MediaId, @MediaType, @MediaUrl,
                 @MediaOriginalName, @MediaMimeType, @MediaSizeBytes, @MediaWidth, @MediaHeight,
                 @MediaDurationSeconds, @MediaFrameRate, @MediaVideoCodec, @MediaAudioCodec,
                 @MediaAudioSampleRate, @MediaVideoBitrate, @MediaAudioBitrate, @PublishDateTime,
                 @HighIntentKeywords, @AIReplyEnabled, @TargetSocialChannelsJson);
            SET @CampaignId = SCOPE_IDENTITY();
        END
        ELSE
        BEGIN
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
                MediaId = @MediaId,
                MediaType = @MediaType,
                MediaUrl = @MediaUrl,
                MediaOriginalName = @MediaOriginalName,
                MediaMimeType = @MediaMimeType,
                MediaSizeBytes = @MediaSizeBytes,
                MediaWidth = @MediaWidth,
                MediaHeight = @MediaHeight,
                MediaDurationSeconds = @MediaDurationSeconds,
                MediaFrameRate = @MediaFrameRate,
                MediaVideoCodec = @MediaVideoCodec,
                MediaAudioCodec = @MediaAudioCodec,
                MediaAudioSampleRate = @MediaAudioSampleRate,
                MediaVideoBitrate = @MediaVideoBitrate,
                MediaAudioBitrate = @MediaAudioBitrate,
                PublishDateTime = @PublishDateTime,
                HighIntentKeywords = @HighIntentKeywords,
                AIReplyEnabled = @AIReplyEnabled,
                TargetSocialChannelsJson = @TargetSocialChannelsJson,
                UpdatedAt = SYSUTCDATETIME()
            WHERE CampaignId = @CampaignId;
            IF @@ROWCOUNT = 0
                THROW 51403, 'Campaign was not found.', 1;
        END;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT * FROM dbo.Campaigns WHERE CampaignId = @CampaignId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CRMContent_GetAll
AS
BEGIN
    SET NOCOUNT ON;
    SELECT c.CampaignId, c.Name, c.Platform, c.Audience, c.Message, c.Budget, c.Mode, c.CreatedByAi,
           c.CampaignObjective, c.PostText, c.PostType, c.MediaId, c.MediaType, c.MediaUrl,
           c.MediaOriginalName, c.MediaMimeType, c.MediaSizeBytes, c.MediaWidth, c.MediaHeight,
           c.MediaDurationSeconds, c.MediaFrameRate, c.MediaVideoCodec, c.MediaAudioCodec,
           c.MediaAudioSampleRate, c.MediaVideoBitrate, c.MediaAudioBitrate, c.PublishDateTime,
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
