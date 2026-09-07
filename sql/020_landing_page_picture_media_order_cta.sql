SET XACT_ABORT ON;
GO

IF COL_LENGTH(N'dbo.LandingPages', N'MediaMode') IS NULL
    ALTER TABLE dbo.LandingPages ADD MediaMode NVARCHAR(32) NULL;
IF COL_LENGTH(N'dbo.LandingPages', N'MediaOrder') IS NULL
    ALTER TABLE dbo.LandingPages ADD MediaOrder NVARCHAR(32) NULL;
IF COL_LENGTH(N'dbo.LandingPages', N'PictureUrl') IS NULL
    ALTER TABLE dbo.LandingPages ADD PictureUrl NVARCHAR(2048) NULL;
IF COL_LENGTH(N'dbo.LandingPages', N'PictureCloudinaryAssetId') IS NULL
    ALTER TABLE dbo.LandingPages ADD PictureCloudinaryAssetId NVARCHAR(255) NULL;
IF COL_LENGTH(N'dbo.LandingPages', N'PictureCloudinaryPublicId') IS NULL
    ALTER TABLE dbo.LandingPages ADD PictureCloudinaryPublicId NVARCHAR(500) NULL;
IF COL_LENGTH(N'dbo.LandingPages', N'PictureCloudinaryResourceType') IS NULL
    ALTER TABLE dbo.LandingPages ADD PictureCloudinaryResourceType NVARCHAR(32) NULL;
IF COL_LENGTH(N'dbo.LandingPages', N'PreVideoCtaEnabled') IS NULL
    ALTER TABLE dbo.LandingPages ADD PreVideoCtaEnabled BIT NULL;
GO

UPDATE dbo.LandingPages
SET MediaMode = CASE
        WHEN VideoSourceType <> N'NONE' AND NULLIF(LTRIM(RTRIM(VideoUrl)), N'') IS NOT NULL THEN N'VIDEO_ONLY'
        ELSE N'NONE'
    END
WHERE MediaMode IS NULL;

UPDATE dbo.LandingPages SET MediaOrder = N'VIDEO_FIRST' WHERE MediaOrder IS NULL;

UPDATE dbo.LandingPages
SET PreVideoCtaEnabled = CASE
        WHEN NULLIF(LTRIM(RTRIM(PreVideoCtaText)), N'') IS NOT NULL
         AND NULLIF(LTRIM(RTRIM(PreVideoCtaUrl)), N'') IS NOT NULL THEN 1
        ELSE 0
    END
WHERE PreVideoCtaEnabled IS NULL;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.LandingPages') AND name = N'MediaMode' AND is_nullable = 1)
    ALTER TABLE dbo.LandingPages ALTER COLUMN MediaMode NVARCHAR(32) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.LandingPages') AND name = N'MediaOrder' AND is_nullable = 1)
    ALTER TABLE dbo.LandingPages ALTER COLUMN MediaOrder NVARCHAR(32) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.LandingPages') AND name = N'PreVideoCtaEnabled' AND is_nullable = 1)
    ALTER TABLE dbo.LandingPages ALTER COLUMN PreVideoCtaEnabled BIT NOT NULL;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID(N'dbo.LandingPages') AND c.name = N'MediaMode'
)
    ALTER TABLE dbo.LandingPages ADD CONSTRAINT DF_LandingPages_MediaMode DEFAULT N'NONE' FOR MediaMode;
IF NOT EXISTS (
    SELECT 1 FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID(N'dbo.LandingPages') AND c.name = N'MediaOrder'
)
    ALTER TABLE dbo.LandingPages ADD CONSTRAINT DF_LandingPages_MediaOrder DEFAULT N'VIDEO_FIRST' FOR MediaOrder;
IF NOT EXISTS (
    SELECT 1 FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID(N'dbo.LandingPages') AND c.name = N'PreVideoCtaEnabled'
)
    ALTER TABLE dbo.LandingPages ADD CONSTRAINT DF_LandingPages_PreVideoCtaEnabled DEFAULT 0 FOR PreVideoCtaEnabled;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_LandingPages_MediaMode')
    ALTER TABLE dbo.LandingPages ADD CONSTRAINT CK_LandingPages_MediaMode
        CHECK (MediaMode IN (N'NONE', N'VIDEO_ONLY', N'PICTURE_ONLY', N'VIDEO_AND_PICTURE'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_LandingPages_MediaOrder')
    ALTER TABLE dbo.LandingPages ADD CONSTRAINT CK_LandingPages_MediaOrder
        CHECK (MediaOrder IN (N'VIDEO_FIRST', N'PICTURE_FIRST'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_LandingPages_PictureCloudinaryResourceType')
    ALTER TABLE dbo.LandingPages ADD CONSTRAINT CK_LandingPages_PictureCloudinaryResourceType
        CHECK (PictureCloudinaryResourceType IS NULL OR PictureCloudinaryResourceType = N'image');
GO

CREATE OR ALTER PROCEDURE dbo.LandingPage_Save
    @LandingPageId BIGINT = NULL,
    @CampaignId BIGINT = NULL,
    @Title NVARCHAR(255),
    @Slug NVARCHAR(255),
    @Headline NVARCHAR(500),
    @Teaser NVARCHAR(MAX) = NULL,
    @WebinarUrl NVARCHAR(2048) = NULL,
    @PaymentUrl NVARCHAR(2048) = NULL,
    @VideoSourceType NVARCHAR(20) = N'NONE',
    @VideoUrl NVARCHAR(2048) = NULL,
    @VideoProvider NVARCHAR(32) = NULL,
    @CloudinaryAssetId NVARCHAR(255) = NULL,
    @CloudinaryPublicId NVARCHAR(500) = NULL,
    @CloudinaryResourceType NVARCHAR(32) = NULL,
    @VideoAutoplay BIT = 1,
    @VideoMuted BIT = 1,
    @VideoShowControls BIT = 1,
    @PreVideoCtaText NVARCHAR(255) = NULL,
    @PreVideoCtaUrl NVARCHAR(2048) = NULL,
    @SubmitButtonText NVARCHAR(255) = N'Register Now for an Interview',
    @Status NVARCHAR(32) = N'draft',
    @CreatedByAi BIT = 0,
    @MediaMode NVARCHAR(32) = NULL,
    @MediaOrder NVARCHAR(32) = NULL,
    @PictureUrl NVARCHAR(2048) = NULL,
    @PictureCloudinaryAssetId NVARCHAR(255) = NULL,
    @PictureCloudinaryPublicId NVARCHAR(500) = NULL,
    @PictureCloudinaryResourceType NVARCHAR(32) = NULL,
    @PreVideoCtaEnabled BIT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @VideoSourceType = COALESCE(NULLIF(@VideoSourceType, N''), N'NONE');
    SET @MediaMode = COALESCE(NULLIF(@MediaMode, N''), CASE
        WHEN @VideoSourceType <> N'NONE' AND NULLIF(LTRIM(RTRIM(@VideoUrl)), N'') IS NOT NULL
             AND NULLIF(LTRIM(RTRIM(@PictureUrl)), N'') IS NOT NULL THEN N'VIDEO_AND_PICTURE'
        WHEN @VideoSourceType <> N'NONE' AND NULLIF(LTRIM(RTRIM(@VideoUrl)), N'') IS NOT NULL THEN N'VIDEO_ONLY'
        WHEN NULLIF(LTRIM(RTRIM(@PictureUrl)), N'') IS NOT NULL THEN N'PICTURE_ONLY'
        ELSE N'NONE'
    END);
    SET @MediaOrder = COALESCE(NULLIF(@MediaOrder, N''), N'VIDEO_FIRST');
    SET @PreVideoCtaEnabled = COALESCE(@PreVideoCtaEnabled, CASE
        WHEN NULLIF(LTRIM(RTRIM(@PreVideoCtaText)), N'') IS NOT NULL
         AND NULLIF(LTRIM(RTRIM(@PreVideoCtaUrl)), N'') IS NOT NULL THEN 1
        ELSE 0
    END);
    SET @SubmitButtonText = COALESCE(NULLIF(LTRIM(RTRIM(@SubmitButtonText)), N''), N'Register Now for an Interview');

    IF @MediaMode NOT IN (N'NONE', N'VIDEO_ONLY', N'PICTURE_ONLY', N'VIDEO_AND_PICTURE')
        THROW 51131, 'Unsupported landing-page teaser media selection.', 1;
    IF @MediaOrder NOT IN (N'VIDEO_FIRST', N'PICTURE_FIRST')
        THROW 51132, 'Unsupported landing-page teaser media order.', 1;

    IF @MediaMode NOT IN (N'VIDEO_ONLY', N'VIDEO_AND_PICTURE')
    BEGIN
        SET @VideoSourceType = N'NONE';
        SET @VideoUrl = NULL;
        SET @VideoProvider = NULL;
        SET @CloudinaryAssetId = NULL;
        SET @CloudinaryPublicId = NULL;
        SET @CloudinaryResourceType = NULL;
    END
    ELSE IF @VideoSourceType = N'NONE' OR NULLIF(LTRIM(RTRIM(@VideoUrl)), N'') IS NULL OR @VideoProvider IS NULL
        THROW 51133, 'The selected teaser media requires a complete video.', 1;

    IF @MediaMode NOT IN (N'PICTURE_ONLY', N'VIDEO_AND_PICTURE')
    BEGIN
        SET @PictureUrl = NULL;
        SET @PictureCloudinaryAssetId = NULL;
        SET @PictureCloudinaryPublicId = NULL;
        SET @PictureCloudinaryResourceType = NULL;
    END
    ELSE IF NULLIF(LTRIM(RTRIM(@PictureUrl)), N'') IS NULL
         OR NULLIF(LTRIM(RTRIM(@PictureCloudinaryAssetId)), N'') IS NULL
         OR NULLIF(LTRIM(RTRIM(@PictureCloudinaryPublicId)), N'') IS NULL
         OR COALESCE(@PictureCloudinaryResourceType, N'') <> N'image'
        THROW 51134, 'The selected teaser media requires a complete Cloudinary picture.', 1;

    IF @PreVideoCtaEnabled = 1 AND
       (NULLIF(LTRIM(RTRIM(@PreVideoCtaText)), N'') IS NULL OR NULLIF(LTRIM(RTRIM(@PreVideoCtaUrl)), N'') IS NULL)
        THROW 51135, 'An enabled landing-page CTA requires both text and a destination URL.', 1;

    IF @LandingPageId IS NULL
    BEGIN
        INSERT dbo.LandingPages
            (CampaignId, Title, Slug, Headline, Teaser, WebinarUrl, PaymentUrl,
             VideoSourceType, VideoUrl, VideoProvider, CloudinaryAssetId, CloudinaryPublicId,
             CloudinaryResourceType, VideoAutoplay, VideoMuted, VideoShowControls,
             MediaMode, MediaOrder, PictureUrl, PictureCloudinaryAssetId,
             PictureCloudinaryPublicId, PictureCloudinaryResourceType, PreVideoCtaEnabled,
             PreVideoCtaText, PreVideoCtaUrl, SubmitButtonText, Status, CreatedByAi)
        VALUES
            (@CampaignId, @Title, @Slug, @Headline, @Teaser, @WebinarUrl, @PaymentUrl,
             @VideoSourceType, @VideoUrl, @VideoProvider, @CloudinaryAssetId, @CloudinaryPublicId,
             @CloudinaryResourceType, @VideoAutoplay, @VideoMuted, @VideoShowControls,
             @MediaMode, @MediaOrder, @PictureUrl, @PictureCloudinaryAssetId,
             @PictureCloudinaryPublicId, @PictureCloudinaryResourceType, @PreVideoCtaEnabled,
             @PreVideoCtaText, @PreVideoCtaUrl, @SubmitButtonText, @Status, @CreatedByAi);
        SET @LandingPageId = SCOPE_IDENTITY();
    END
    ELSE
        UPDATE dbo.LandingPages
        SET CampaignId = @CampaignId, Title = @Title, Slug = @Slug, Headline = @Headline,
            Teaser = @Teaser, WebinarUrl = @WebinarUrl, PaymentUrl = @PaymentUrl,
            VideoSourceType = @VideoSourceType, VideoUrl = @VideoUrl, VideoProvider = @VideoProvider,
            CloudinaryAssetId = @CloudinaryAssetId, CloudinaryPublicId = @CloudinaryPublicId,
            CloudinaryResourceType = @CloudinaryResourceType, VideoAutoplay = @VideoAutoplay,
            VideoMuted = @VideoMuted, VideoShowControls = @VideoShowControls,
            MediaMode = @MediaMode, MediaOrder = @MediaOrder, PictureUrl = @PictureUrl,
            PictureCloudinaryAssetId = @PictureCloudinaryAssetId,
            PictureCloudinaryPublicId = @PictureCloudinaryPublicId,
            PictureCloudinaryResourceType = @PictureCloudinaryResourceType,
            PreVideoCtaEnabled = @PreVideoCtaEnabled, PreVideoCtaText = @PreVideoCtaText,
            PreVideoCtaUrl = @PreVideoCtaUrl, SubmitButtonText = @SubmitButtonText,
            Status = @Status, CreatedByAi = @CreatedByAi, UpdatedAt = SYSUTCDATETIME()
        WHERE LandingPageId = @LandingPageId;

    SELECT * FROM dbo.LandingPages WHERE LandingPageId = @LandingPageId;
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

    SELECT LandingPageId, CampaignId, Title, Slug, Headline, Teaser, WebinarUrl, PaymentUrl,
           VideoSourceType, VideoUrl, VideoProvider, CloudinaryAssetId, CloudinaryPublicId,
           CloudinaryResourceType, VideoAutoplay, VideoMuted, VideoShowControls,
           MediaMode, MediaOrder, PictureUrl, PictureCloudinaryAssetId,
           PictureCloudinaryPublicId, PictureCloudinaryResourceType, PreVideoCtaEnabled,
           PreVideoCtaText, PreVideoCtaUrl, SubmitButtonText,
           Status, Registrations, CreatedByAi, CreatedAt, UpdatedAt
    FROM dbo.LandingPages ORDER BY CreatedAt DESC;

    SELECT WebinarId, CampaignId, LandingPageId, Title, Description, ScheduledAt,
           WebinarUrl, Status, CreatedByAi, CreatedAt, UpdatedAt
    FROM dbo.Webinars ORDER BY CreatedAt DESC;
END;
GO
