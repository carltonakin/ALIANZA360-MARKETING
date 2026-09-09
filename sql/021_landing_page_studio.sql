SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'dbo.LandingPageBlocks', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.LandingPageBlocks
    (
        LandingPageBlockId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LandingPageBlocks PRIMARY KEY,
        LandingPageId BIGINT NOT NULL,
        BlockKey NVARCHAR(100) NOT NULL,
        BlockType NVARCHAR(32) NOT NULL,
        SortOrder INT NOT NULL,
        IsEnabled BIT NOT NULL CONSTRAINT DF_LandingPageBlocks_IsEnabled DEFAULT 1,
        ConfigurationJson NVARCHAR(MAX) NOT NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_LandingPageBlocks_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_LandingPageBlocks_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_LandingPageBlocks_Page FOREIGN KEY (LandingPageId) REFERENCES dbo.LandingPages(LandingPageId) ON DELETE CASCADE,
        CONSTRAINT UQ_LandingPageBlocks_Page_Key UNIQUE (LandingPageId, BlockKey),
        CONSTRAINT UQ_LandingPageBlocks_Page_Order UNIQUE (LandingPageId, SortOrder),
        CONSTRAINT CK_LandingPageBlocks_Type CHECK (BlockType IN
            (N'HERO', N'TEXT', N'IMAGE', N'VIDEO', N'CTA_BUTTON', N'REGISTRATION_FORM',
             N'SOCIAL_HANDLES', N'TESTIMONIALS', N'FAQ', N'COUNTDOWN', N'DIVIDER', N'PAYMENT_CTA')),
        CONSTRAINT CK_LandingPageBlocks_ConfigurationJson CHECK (ISJSON(ConfigurationJson) = 1)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LandingPageBlocks_Page_Order' AND object_id = OBJECT_ID(N'dbo.LandingPageBlocks'))
    CREATE INDEX IX_LandingPageBlocks_Page_Order ON dbo.LandingPageBlocks (LandingPageId, SortOrder)
        INCLUDE (BlockKey, BlockType, IsEnabled);
GO

IF OBJECT_ID(N'dbo.LandingPageViews', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.LandingPageViews
    (
        LandingPageViewId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LandingPageViews PRIMARY KEY,
        LandingPageId BIGINT NOT NULL,
        VisitorHash BINARY(32) NOT NULL,
        ViewDate DATE NOT NULL,
        ViewedAt DATETIME2(3) NOT NULL,
        Source NVARCHAR(255) NULL,
        Medium NVARCHAR(255) NULL,
        Campaign NVARCHAR(255) NULL,
        Content NVARCHAR(255) NULL,
        Term NVARCHAR(255) NULL,
        CONSTRAINT FK_LandingPageViews_Page FOREIGN KEY (LandingPageId) REFERENCES dbo.LandingPages(LandingPageId) ON DELETE CASCADE,
        CONSTRAINT UQ_LandingPageViews_Page_Visitor_Date UNIQUE (LandingPageId, VisitorHash, ViewDate)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LandingPageViews_Page_ViewedAt' AND object_id = OBJECT_ID(N'dbo.LandingPageViews'))
    CREATE INDEX IX_LandingPageViews_Page_ViewedAt ON dbo.LandingPageViews (LandingPageId, ViewedAt DESC)
        INCLUDE (Source, Campaign);
GO

/* Convert every legacy page once. Later reruns only fill pages that still have no blocks. */
DECLARE @LegacyPages TABLE (LandingPageId BIGINT PRIMARY KEY);
INSERT @LegacyPages (LandingPageId)
SELECT lp.LandingPageId
FROM dbo.LandingPages lp
WHERE NOT EXISTS (SELECT 1 FROM dbo.LandingPageBlocks b WHERE b.LandingPageId = lp.LandingPageId);

INSERT dbo.LandingPageBlocks (LandingPageId, BlockKey, BlockType, SortOrder, IsEnabled, ConfigurationJson)
SELECT lp.LandingPageId, N'legacy-hero', N'HERO', 0, 1,
       (SELECT N'BUILD A BETTER GROWTH ENGINE' eyebrow, lp.Headline headline, N'' body, N'left' alignment,
               N'' backgroundUrl, N'' backgroundCloudinaryAssetId, N'' backgroundCloudinaryPublicId,
               N'' backgroundCloudinaryResourceType FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
FROM dbo.LandingPages lp JOIN @LegacyPages legacy ON legacy.LandingPageId = lp.LandingPageId;

INSERT dbo.LandingPageBlocks (LandingPageId, BlockKey, BlockType, SortOrder, IsEnabled, ConfigurationJson)
SELECT lp.LandingPageId, N'legacy-text', N'TEXT', 10, 1,
       (SELECT N'' heading, lp.Teaser body, N'left' alignment FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
FROM dbo.LandingPages lp JOIN @LegacyPages legacy ON legacy.LandingPageId = lp.LandingPageId
WHERE NULLIF(LTRIM(RTRIM(lp.Teaser)), N'') IS NOT NULL;

INSERT dbo.LandingPageBlocks (LandingPageId, BlockKey, BlockType, SortOrder, IsEnabled, ConfigurationJson)
SELECT lp.LandingPageId, N'legacy-video', N'VIDEO',
       CASE WHEN lp.MediaOrder = N'PICTURE_FIRST' THEN 30 ELSE 20 END, 1,
       (SELECT lp.VideoSourceType videoSourceType, lp.VideoUrl videoUrl, lp.VideoProvider videoProvider,
               lp.CloudinaryAssetId cloudinaryAssetId, lp.CloudinaryPublicId cloudinaryPublicId,
               lp.CloudinaryResourceType cloudinaryResourceType, lp.VideoAutoplay autoplay,
               lp.VideoMuted muted, lp.VideoShowControls showControls FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
FROM dbo.LandingPages lp JOIN @LegacyPages legacy ON legacy.LandingPageId = lp.LandingPageId
WHERE lp.MediaMode IN (N'VIDEO_ONLY', N'VIDEO_AND_PICTURE') AND NULLIF(LTRIM(RTRIM(lp.VideoUrl)), N'') IS NOT NULL;

INSERT dbo.LandingPageBlocks (LandingPageId, BlockKey, BlockType, SortOrder, IsEnabled, ConfigurationJson)
SELECT lp.LandingPageId, N'legacy-image', N'IMAGE',
       CASE WHEN lp.MediaOrder = N'PICTURE_FIRST' THEN 20 ELSE 30 END, 1,
       (SELECT lp.PictureUrl url, CONCAT(lp.Headline, N' teaser') alt, N'' caption,
               lp.PictureCloudinaryAssetId cloudinaryAssetId, lp.PictureCloudinaryPublicId cloudinaryPublicId,
               lp.PictureCloudinaryResourceType cloudinaryResourceType FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
FROM dbo.LandingPages lp JOIN @LegacyPages legacy ON legacy.LandingPageId = lp.LandingPageId
WHERE lp.MediaMode IN (N'PICTURE_ONLY', N'VIDEO_AND_PICTURE') AND NULLIF(LTRIM(RTRIM(lp.PictureUrl)), N'') IS NOT NULL;

INSERT dbo.LandingPageBlocks (LandingPageId, BlockKey, BlockType, SortOrder, IsEnabled, ConfigurationJson)
SELECT lp.LandingPageId, N'legacy-cta', N'CTA_BUTTON', 40, 1,
       (SELECT lp.PreVideoCtaText [text], lp.PreVideoCtaUrl url, N'primary' style, N'left' alignment,
               CAST(0 AS BIT) openInNewTab FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
FROM dbo.LandingPages lp JOIN @LegacyPages legacy ON legacy.LandingPageId = lp.LandingPageId
WHERE lp.PreVideoCtaEnabled = 1 AND NULLIF(LTRIM(RTRIM(lp.PreVideoCtaText)), N'') IS NOT NULL
  AND NULLIF(LTRIM(RTRIM(lp.PreVideoCtaUrl)), N'') IS NOT NULL;

INSERT dbo.LandingPageBlocks (LandingPageId, BlockKey, BlockType, SortOrder, IsEnabled, ConfigurationJson)
SELECT lp.LandingPageId, N'legacy-registration', N'REGISTRATION_FORM', 90, 1,
       (SELECT N'FREE ON-DEMAND WEBINAR' eyebrow, N'Get instant access' heading,
               N'Tell us where to send your resources.' body, lp.SubmitButtonText submitButtonText,
               COALESCE(lp.WebinarUrl, N'') postSubmitUrl,
               JSON_QUERY(N'{"name":{"enabled":true,"required":true,"label":"Full name"},"email":{"enabled":true,"required":true,"label":"Email address"},"phone":{"enabled":true,"required":false,"label":"Phone number"},"instagram":{"enabled":true,"required":false,"label":"Instagram handle"},"facebook":{"enabled":true,"required":false,"label":"Facebook handle"},"x":{"enabled":true,"required":false,"label":"X handle"},"message":{"enabled":false,"required":false,"label":"How can we help?"}}') fields
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
FROM dbo.LandingPages lp JOIN @LegacyPages legacy ON legacy.LandingPageId = lp.LandingPageId;

INSERT dbo.LandingPageBlocks (LandingPageId, BlockKey, BlockType, SortOrder, IsEnabled, ConfigurationJson)
SELECT lp.LandingPageId, N'legacy-payment', N'PAYMENT_CTA', 100, 1,
       (SELECT N'Ready to continue?' heading, N'Choose the option that works for you.' body,
               N'Choose your subscription' [text], lp.PaymentUrl url, N'center' alignment
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)
FROM dbo.LandingPages lp JOIN @LegacyPages legacy ON legacy.LandingPageId = lp.LandingPageId
WHERE NULLIF(LTRIM(RTRIM(lp.PaymentUrl)), N'') IS NOT NULL;
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
    @MediaMode NVARCHAR(32) = N'NONE',
    @MediaOrder NVARCHAR(32) = N'VIDEO_FIRST',
    @PictureUrl NVARCHAR(2048) = NULL,
    @PictureCloudinaryAssetId NVARCHAR(255) = NULL,
    @PictureCloudinaryPublicId NVARCHAR(500) = NULL,
    @PictureCloudinaryResourceType NVARCHAR(32) = NULL,
    @PreVideoCtaEnabled BIT = 0,
    @BlocksJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @BlocksJson IS NOT NULL AND (ISJSON(@BlocksJson) <> 1 OR LEFT(LTRIM(@BlocksJson), 1) <> N'[')
        THROW 51140, 'Landing-page blocks must be a JSON array.', 1;
    IF @BlocksJson IS NOT NULL AND EXISTS
    (
        SELECT 1 FROM OPENJSON(@BlocksJson) WITH
        (BlockKey NVARCHAR(100) '$.id', BlockType NVARCHAR(32) '$.type', ConfigurationJson NVARCHAR(MAX) '$.config' AS JSON)
        WHERE BlockKey IS NULL OR BlockType NOT IN
            (N'HERO', N'TEXT', N'IMAGE', N'VIDEO', N'CTA_BUTTON', N'REGISTRATION_FORM',
             N'SOCIAL_HANDLES', N'TESTIMONIALS', N'FAQ', N'COUNTDOWN', N'DIVIDER', N'PAYMENT_CTA')
            OR ConfigurationJson IS NULL OR ISJSON(ConfigurationJson) <> 1
    ) THROW 51141, 'Landing-page blocks contain an invalid type or configuration.', 1;
    IF @BlocksJson IS NOT NULL AND (SELECT COUNT(*) FROM OPENJSON(@BlocksJson)) > 100
        THROW 51142, 'Landing pages may contain up to 100 blocks.', 1;

    SET @VideoSourceType = COALESCE(NULLIF(@VideoSourceType, N''), N'NONE');
    SET @MediaMode = COALESCE(NULLIF(@MediaMode, N''), N'NONE');
    SET @MediaOrder = COALESCE(NULLIF(@MediaOrder, N''), N'VIDEO_FIRST');
    SET @SubmitButtonText = COALESCE(NULLIF(LTRIM(RTRIM(@SubmitButtonText)), N''), N'Register Now for an Interview');

    BEGIN TRY
        BEGIN TRANSACTION;
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
        BEGIN
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
            IF @@ROWCOUNT = 0 THROW 51143, 'Landing page not found.', 1;
        END;

        IF @BlocksJson IS NOT NULL
        BEGIN
            DELETE dbo.LandingPageBlocks WHERE LandingPageId = @LandingPageId;
            INSERT dbo.LandingPageBlocks
                (LandingPageId, BlockKey, BlockType, SortOrder, IsEnabled, ConfigurationJson)
            SELECT @LandingPageId, parsed.BlockKey, parsed.BlockType, CONVERT(INT, source.[key]),
                   parsed.IsEnabled, parsed.ConfigurationJson
            FROM OPENJSON(@BlocksJson) source
            CROSS APPLY OPENJSON(source.value) WITH
                (BlockKey NVARCHAR(100) '$.id', BlockType NVARCHAR(32) '$.type',
                 IsEnabled BIT '$.enabled', ConfigurationJson NVARCHAR(MAX) '$.config' AS JSON) parsed;
        END;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT * FROM dbo.LandingPages WHERE LandingPageId = @LandingPageId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CRMContent_GetAll
AS
BEGIN
    SET NOCOUNT ON;
    SELECT c.*, automation.SourceType, automation.ExternalCampaignId, automation.AdvertisementId, automation.LeadFormId,
           automation.ContentReference, automation.AutomationStatus, automation.AutomationEnabled, automation.Schedule,
           automation.CadenceMinutes, automation.LastRunAt, automation.NextRunAt, automation.LastError,
           automation.RetryCount, automation.MaxRetries, automation.CurrentMetricsJson, automation.LastProcessed,
           (SELECT p.* FROM dbo.CampaignPosts p WHERE p.CampaignId = c.CampaignId ORDER BY p.CampaignPostId FOR JSON PATH) CampaignPostsJson
    FROM dbo.Campaigns c
    OUTER APPLY (SELECT TOP (1) sc.* FROM dbo.SocialCampaigns sc WHERE sc.CampaignId = c.CampaignId ORDER BY sc.SocialCampaignId) automation
    ORDER BY c.CreatedAt DESC;

    SELECT * FROM dbo.LandingPages ORDER BY CreatedAt DESC;
    SELECT * FROM dbo.Webinars ORDER BY CreatedAt DESC;
    SELECT LandingPageBlockId, LandingPageId, BlockKey, BlockType, SortOrder, IsEnabled,
           ConfigurationJson, CreatedAt, UpdatedAt
    FROM dbo.LandingPageBlocks ORDER BY LandingPageId, SortOrder;
END;
GO

CREATE OR ALTER PROCEDURE dbo.LandingPage_Duplicate @LandingPageId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @BaseSlug NVARCHAR(230), @Slug NVARCHAR(255), @Suffix INT = 1, @NewId BIGINT;
        SELECT @BaseSlug = LEFT(Slug, 230) FROM dbo.LandingPages WITH (UPDLOCK, HOLDLOCK) WHERE LandingPageId = @LandingPageId;
        IF @BaseSlug IS NULL THROW 51144, 'Landing page not found.', 1;
        SET @Slug = CONCAT(@BaseSlug, N'-copy');
        WHILE EXISTS (SELECT 1 FROM dbo.LandingPages WHERE Slug = @Slug)
        BEGIN
            SET @Suffix += 1;
            SET @Slug = CONCAT(@BaseSlug, N'-copy-', @Suffix);
        END;
        INSERT dbo.LandingPages
            (CampaignId, Title, Slug, Headline, Teaser, WebinarUrl, PaymentUrl, VideoSourceType, VideoUrl,
             VideoProvider, CloudinaryAssetId, CloudinaryPublicId, CloudinaryResourceType, VideoAutoplay,
             VideoMuted, VideoShowControls, MediaMode, MediaOrder, PictureUrl, PictureCloudinaryAssetId,
             PictureCloudinaryPublicId, PictureCloudinaryResourceType, PreVideoCtaEnabled, PreVideoCtaText,
             PreVideoCtaUrl, SubmitButtonText, Status, Registrations, CreatedByAi)
        SELECT CampaignId, CONCAT(Title, N' (Copy)'), @Slug, Headline, Teaser, WebinarUrl, PaymentUrl,
             VideoSourceType, VideoUrl, VideoProvider, CloudinaryAssetId, CloudinaryPublicId,
             CloudinaryResourceType, VideoAutoplay, VideoMuted, VideoShowControls, MediaMode, MediaOrder,
             PictureUrl, PictureCloudinaryAssetId, PictureCloudinaryPublicId, PictureCloudinaryResourceType,
             PreVideoCtaEnabled, PreVideoCtaText, PreVideoCtaUrl, SubmitButtonText, N'draft', 0, 0
        FROM dbo.LandingPages WHERE LandingPageId = @LandingPageId;
        SET @NewId = SCOPE_IDENTITY();
        INSERT dbo.LandingPageBlocks (LandingPageId, BlockKey, BlockType, SortOrder, IsEnabled, ConfigurationJson)
        SELECT @NewId, BlockKey, BlockType, SortOrder, IsEnabled, ConfigurationJson
        FROM dbo.LandingPageBlocks WHERE LandingPageId = @LandingPageId;
        COMMIT TRANSACTION;
        SELECT * FROM dbo.LandingPages WHERE LandingPageId = @NewId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.LandingPageView_Record
    @LandingPageId BIGINT,
    @VisitorHash BINARY(32),
    @ViewedAt DATETIME2(3),
    @Source NVARCHAR(255) = NULL,
    @Medium NVARCHAR(255) = NULL,
    @Campaign NVARCHAR(255) = NULL,
    @Content NVARCHAR(255) = NULL,
    @Term NVARCHAR(255) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.LandingPages WHERE LandingPageId = @LandingPageId AND Status = N'published')
        THROW 51145, 'Published landing page not found.', 1;
    DECLARE @ViewDate DATE = CONVERT(DATE, @ViewedAt);
    BEGIN TRY
        INSERT dbo.LandingPageViews (LandingPageId, VisitorHash, ViewDate, ViewedAt, Source, Medium, Campaign, Content, Term)
        VALUES (@LandingPageId, @VisitorHash, @ViewDate, @ViewedAt, NULLIF(@Source, N''), NULLIF(@Medium, N''),
                NULLIF(@Campaign, N''), NULLIF(@Content, N''), NULLIF(@Term, N''));
        SELECT CAST(1 AS BIT) Inserted;
    END TRY
    BEGIN CATCH
        IF ERROR_NUMBER() IN (2601, 2627) SELECT CAST(0 AS BIT) Inserted;
        ELSE THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.LandingPageAnalytics_GetAll
AS
BEGIN
    SET NOCOUNT ON;
    SELECT lp.LandingPageId,
           COUNT(DISTINCT views.LandingPageViewId) Visitors,
           lp.Registrations,
           CAST(CASE WHEN COUNT(DISTINCT views.LandingPageViewId) = 0 THEN 0
                ELSE (100.0 * lp.Registrations) / COUNT(DISTINCT views.LandingPageViewId) END AS DECIMAL(8,2)) ConversionRate,
           CAST(COALESCE(scores.AverageScore, 0) AS DECIMAL(8,2)) AverageScore,
           COALESCE(scores.Cold, 0) Cold, COALESCE(scores.Warm, 0) Warm,
           COALESCE(scores.Qualified, 0) Qualified, COALESCE(scores.Hot, 0) Hot,
           (SELECT COALESCE(NULLIF(v.Source, N''), N'Direct') [name], COUNT(*) [count]
            FROM dbo.LandingPageViews v WHERE v.LandingPageId = lp.LandingPageId
            GROUP BY COALESCE(NULLIF(v.Source, N''), N'Direct') ORDER BY COUNT(*) DESC FOR JSON PATH) SourcesJson,
           (SELECT COALESCE(NULLIF(v.Campaign, N''), N'Unattributed') [name], COUNT(*) [count]
            FROM dbo.LandingPageViews v WHERE v.LandingPageId = lp.LandingPageId
            GROUP BY COALESCE(NULLIF(v.Campaign, N''), N'Unattributed') ORDER BY COUNT(*) DESC FOR JSON PATH) CampaignsJson
    FROM dbo.LandingPages lp
    LEFT JOIN dbo.LandingPageViews views ON views.LandingPageId = lp.LandingPageId
    OUTER APPLY
    (
        SELECT AVG(CONVERT(DECIMAL(8,2), l.LeadScore)) AverageScore,
               SUM(CASE WHEN l.ScoreBand = N'COLD' THEN 1 ELSE 0 END) Cold,
               SUM(CASE WHEN l.ScoreBand = N'WARM' THEN 1 ELSE 0 END) Warm,
               SUM(CASE WHEN l.ScoreBand = N'QUALIFIED' THEN 1 ELSE 0 END) Qualified,
               SUM(CASE WHEN l.ScoreBand = N'HOT' THEN 1 ELSE 0 END) Hot
        FROM (SELECT DISTINCT LeadId FROM dbo.LeadRoutineEvents
              WHERE Routine = N'landing_page_registration' AND LandingPageId = lp.LandingPageId) registrations
        JOIN dbo.Leads l ON l.LeadId = registrations.LeadId
    ) scores
    GROUP BY lp.LandingPageId, lp.Registrations, scores.AverageScore, scores.Cold, scores.Warm,
             scores.Qualified, scores.Hot
    ORDER BY lp.LandingPageId;
END;
GO
