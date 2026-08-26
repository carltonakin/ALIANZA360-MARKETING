IF COL_LENGTH(N'dbo.Campaigns', N'MediaId') IS NULL
    ALTER TABLE dbo.Campaigns ADD MediaId NVARCHAR(255) NULL;
ELSE
    ALTER TABLE dbo.Campaigns ALTER COLUMN MediaId NVARCHAR(255) NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'CloudinaryAssetId') IS NULL
    ALTER TABLE dbo.Campaigns ADD CloudinaryAssetId NVARCHAR(255) NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'CloudinaryPublicId') IS NULL
    ALTER TABLE dbo.Campaigns ADD CloudinaryPublicId NVARCHAR(512) NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'CloudinaryResourceType') IS NULL
    ALTER TABLE dbo.Campaigns ADD CloudinaryResourceType NVARCHAR(16) NULL;
GO
IF COL_LENGTH(N'dbo.Campaigns', N'CloudinaryFormat') IS NULL
    ALTER TABLE dbo.Campaigns ADD CloudinaryFormat NVARCHAR(32) NULL;
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
    @MediaId NVARCHAR(255) = NULL,
    @CloudinaryAssetId NVARCHAR(255) = NULL,
    @CloudinaryPublicId NVARCHAR(512) = NULL,
    @CloudinaryResourceType NVARCHAR(16) = NULL,
    @CloudinaryFormat NVARCHAR(32) = NULL,
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
    IF @MediaUrl IS NOT NULL AND
       (@MediaId IS NULL OR @CloudinaryAssetId IS NULL OR @CloudinaryPublicId IS NULL OR
        @CloudinaryResourceType IS NULL OR @CloudinaryFormat IS NULL)
        THROW 51501, 'Cloudinary campaign media identifiers are required with MediaUrl.', 1;
    IF @MediaUrl IS NULL AND
       (@MediaId IS NOT NULL OR @CloudinaryAssetId IS NOT NULL OR @CloudinaryPublicId IS NOT NULL OR
        @CloudinaryResourceType IS NOT NULL OR @CloudinaryFormat IS NOT NULL)
        THROW 51502, 'Cloudinary campaign media identifiers require MediaUrl.', 1;
    IF @CloudinaryResourceType IS NOT NULL AND @CloudinaryResourceType <> @MediaType
        THROW 51503, 'Cloudinary resource type must match campaign media type.', 1;
    IF @MediaId IS NOT NULL AND @MediaId <> @CloudinaryAssetId
        THROW 51504, 'Campaign MediaId must match Cloudinary asset_id.', 1;
    IF @MediaSizeBytes IS NOT NULL AND (@MediaSizeBytes < 1 OR @MediaSizeBytes > 314572800)
        THROW 51401, 'Campaign media size must be between 1 byte and 300 MB.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;
        IF @CampaignId IS NULL
        BEGIN
            INSERT dbo.Campaigns
                (Name, Platform, Audience, Message, Budget, Mode, CreatedByAi,
                 CampaignObjective, PostText, PostType, MediaId, CloudinaryAssetId,
                 CloudinaryPublicId, CloudinaryResourceType, CloudinaryFormat, MediaType, MediaUrl,
                 MediaOriginalName, MediaMimeType, MediaSizeBytes, MediaWidth, MediaHeight,
                 MediaDurationSeconds, MediaFrameRate, MediaVideoCodec, MediaAudioCodec,
                 MediaAudioSampleRate, MediaVideoBitrate, MediaAudioBitrate, PublishDateTime,
                 HighIntentKeywords, AIReplyEnabled, TargetSocialChannelsJson)
            VALUES
                (@Name, @Platform, @Audience, @Message, @Budget, @Mode, @CreatedByAi,
                 @CampaignObjective, @PostText, @PostType, @MediaId, @CloudinaryAssetId,
                 @CloudinaryPublicId, @CloudinaryResourceType, @CloudinaryFormat, @MediaType, @MediaUrl,
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
                CloudinaryAssetId = @CloudinaryAssetId,
                CloudinaryPublicId = @CloudinaryPublicId,
                CloudinaryResourceType = @CloudinaryResourceType,
                CloudinaryFormat = @CloudinaryFormat,
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
           c.CampaignObjective, c.PostText, c.PostType, c.MediaId, c.CloudinaryAssetId,
           c.CloudinaryPublicId, c.CloudinaryResourceType, c.CloudinaryFormat, c.MediaType, c.MediaUrl,
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
