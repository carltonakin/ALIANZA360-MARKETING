SET XACT_ABORT ON;
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
            DECLARE @IncomingBlocks TABLE (BlockKey NVARCHAR(100) PRIMARY KEY, BlockType NVARCHAR(32), SortOrder INT, IsEnabled BIT, ConfigurationJson NVARCHAR(MAX));
            INSERT @IncomingBlocks (BlockKey, BlockType, SortOrder, IsEnabled, ConfigurationJson)
            SELECT parsed.BlockKey, parsed.BlockType, CONVERT(INT, source.[key]), parsed.IsEnabled, parsed.ConfigurationJson
            FROM OPENJSON(@BlocksJson) source
            CROSS APPLY OPENJSON(source.value) WITH
                (BlockKey NVARCHAR(100) '$.id', BlockType NVARCHAR(32) '$.type',
                 IsEnabled BIT '$.enabled', ConfigurationJson NVARCHAR(MAX) '$.config' AS JSON) parsed;

            DELETE existing FROM dbo.LandingPageBlocks existing
            WHERE existing.LandingPageId = @LandingPageId
              AND NOT EXISTS (SELECT 1 FROM @IncomingBlocks incoming WHERE incoming.BlockKey = existing.BlockKey);
            UPDATE dbo.LandingPageBlocks SET SortOrder = -SortOrder - 1 WHERE LandingPageId = @LandingPageId;
            UPDATE existing SET BlockType = incoming.BlockType, SortOrder = incoming.SortOrder,
                IsEnabled = incoming.IsEnabled, ConfigurationJson = incoming.ConfigurationJson,
                UpdatedAt = SYSUTCDATETIME()
            FROM dbo.LandingPageBlocks existing JOIN @IncomingBlocks incoming ON incoming.BlockKey = existing.BlockKey
            WHERE existing.LandingPageId = @LandingPageId;
            INSERT dbo.LandingPageBlocks (LandingPageId, BlockKey, BlockType, SortOrder, IsEnabled, ConfigurationJson)
            SELECT @LandingPageId, incoming.BlockKey, incoming.BlockType, incoming.SortOrder,
                incoming.IsEnabled, incoming.ConfigurationJson
            FROM @IncomingBlocks incoming
            WHERE NOT EXISTS (SELECT 1 FROM dbo.LandingPageBlocks existing
                              WHERE existing.LandingPageId = @LandingPageId AND existing.BlockKey = incoming.BlockKey);
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
    FROM dbo.Leads l ORDER BY l.CreatedAt DESC, l.LeadId DESC;
END;
GO

