SET XACT_ABORT ON;
GO

IF COL_LENGTH(N'dbo.LandingPages', N'VideoSourceType') IS NULL
    ALTER TABLE dbo.LandingPages ADD VideoSourceType NVARCHAR(20) NOT NULL
        CONSTRAINT DF_LandingPages_VideoSourceType DEFAULT N'NONE' WITH VALUES;
GO
IF COL_LENGTH(N'dbo.LandingPages', N'VideoUrl') IS NULL ALTER TABLE dbo.LandingPages ADD VideoUrl NVARCHAR(2048) NULL;
GO
IF COL_LENGTH(N'dbo.LandingPages', N'VideoProvider') IS NULL ALTER TABLE dbo.LandingPages ADD VideoProvider NVARCHAR(32) NULL;
GO
IF COL_LENGTH(N'dbo.LandingPages', N'CloudinaryAssetId') IS NULL ALTER TABLE dbo.LandingPages ADD CloudinaryAssetId NVARCHAR(255) NULL;
GO
IF COL_LENGTH(N'dbo.LandingPages', N'CloudinaryPublicId') IS NULL ALTER TABLE dbo.LandingPages ADD CloudinaryPublicId NVARCHAR(500) NULL;
GO
IF COL_LENGTH(N'dbo.LandingPages', N'CloudinaryResourceType') IS NULL ALTER TABLE dbo.LandingPages ADD CloudinaryResourceType NVARCHAR(32) NULL;
GO
IF COL_LENGTH(N'dbo.LandingPages', N'VideoAutoplay') IS NULL
    ALTER TABLE dbo.LandingPages ADD VideoAutoplay BIT NOT NULL CONSTRAINT DF_LandingPages_VideoAutoplay DEFAULT 1 WITH VALUES;
GO
IF COL_LENGTH(N'dbo.LandingPages', N'VideoMuted') IS NULL
    ALTER TABLE dbo.LandingPages ADD VideoMuted BIT NOT NULL CONSTRAINT DF_LandingPages_VideoMuted DEFAULT 1 WITH VALUES;
GO
IF COL_LENGTH(N'dbo.LandingPages', N'VideoShowControls') IS NULL
    ALTER TABLE dbo.LandingPages ADD VideoShowControls BIT NOT NULL CONSTRAINT DF_LandingPages_VideoShowControls DEFAULT 1 WITH VALUES;
GO
IF COL_LENGTH(N'dbo.LandingPages', N'PreVideoCtaText') IS NULL ALTER TABLE dbo.LandingPages ADD PreVideoCtaText NVARCHAR(255) NULL;
GO
IF COL_LENGTH(N'dbo.LandingPages', N'PreVideoCtaUrl') IS NULL ALTER TABLE dbo.LandingPages ADD PreVideoCtaUrl NVARCHAR(2048) NULL;
GO
IF COL_LENGTH(N'dbo.LandingPages', N'SubmitButtonText') IS NULL
    ALTER TABLE dbo.LandingPages ADD SubmitButtonText NVARCHAR(255) NOT NULL
        CONSTRAINT DF_LandingPages_SubmitButtonText DEFAULT N'Register Now for an Interview' WITH VALUES;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_LandingPages_VideoSourceType')
    ALTER TABLE dbo.LandingPages ADD CONSTRAINT CK_LandingPages_VideoSourceType
        CHECK (VideoSourceType IN (N'NONE', N'UPLOAD', N'EXTERNAL_URL'));
GO
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_LandingPages_VideoProvider')
    ALTER TABLE dbo.LandingPages ADD CONSTRAINT CK_LandingPages_VideoProvider
        CHECK (VideoProvider IS NULL OR VideoProvider IN (N'CLOUDINARY', N'YOUTUBE', N'VIMEO', N'CANVA'));
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
    @CreatedByAi BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET @VideoSourceType = COALESCE(NULLIF(@VideoSourceType, N''), N'NONE');
    SET @SubmitButtonText = COALESCE(NULLIF(LTRIM(RTRIM(@SubmitButtonText)), N''), N'Register Now for an Interview');
    IF @VideoSourceType = N'NONE'
    BEGIN
        SET @VideoUrl = NULL;
        SET @VideoProvider = NULL;
        SET @CloudinaryAssetId = NULL;
        SET @CloudinaryPublicId = NULL;
        SET @CloudinaryResourceType = NULL;
    END;

    IF @LandingPageId IS NULL
    BEGIN
        INSERT dbo.LandingPages
            (CampaignId, Title, Slug, Headline, Teaser, WebinarUrl, PaymentUrl, VideoSourceType,
             VideoUrl, VideoProvider, CloudinaryAssetId, CloudinaryPublicId, CloudinaryResourceType,
             VideoAutoplay, VideoMuted, VideoShowControls, PreVideoCtaText, PreVideoCtaUrl,
             SubmitButtonText, Status, CreatedByAi)
        VALUES
            (@CampaignId, @Title, @Slug, @Headline, @Teaser, @WebinarUrl, @PaymentUrl, @VideoSourceType,
             @VideoUrl, @VideoProvider, @CloudinaryAssetId, @CloudinaryPublicId, @CloudinaryResourceType,
             @VideoAutoplay, @VideoMuted, @VideoShowControls, @PreVideoCtaText, @PreVideoCtaUrl,
             @SubmitButtonText, @Status, @CreatedByAi);
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
            PreVideoCtaText = @PreVideoCtaText, PreVideoCtaUrl = @PreVideoCtaUrl,
            SubmitButtonText = @SubmitButtonText, Status = @Status, CreatedByAi = @CreatedByAi,
            UpdatedAt = SYSUTCDATETIME()
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
           PreVideoCtaText, PreVideoCtaUrl, SubmitButtonText,
           Status, Registrations, CreatedByAi, CreatedAt, UpdatedAt
    FROM dbo.LandingPages ORDER BY CreatedAt DESC;

    SELECT WebinarId, CampaignId, LandingPageId, Title, Description, ScheduledAt,
           WebinarUrl, Status, CreatedByAi, CreatedAt, UpdatedAt
    FROM dbo.Webinars ORDER BY CreatedAt DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CRMLead_UpsertFromRoutine
    @Routine NVARCHAR(64),
    @ExternalEventId NVARCHAR(255),
    @Name NVARCHAR(255),
    @Email NVARCHAR(320) = NULL,
    @Phone NVARCHAR(80) = NULL,
    @Facebook NVARCHAR(500) = NULL,
    @Instagram NVARCHAR(500) = NULL,
    @X NVARCHAR(500) = NULL,
    @Source NVARCHAR(100),
    @CampaignId BIGINT = NULL,
    @LandingPageId BIGINT = NULL,
    @WebinarId BIGINT = NULL,
    @SourceDetail NVARCHAR(1000) = NULL,
    @OccurredAt DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @Facebook = NULLIF(LTRIM(RTRIM(@Facebook)), N'');
    SET @Instagram = NULLIF(LTRIM(RTRIM(@Instagram)), N'');
    SET @X = NULLIF(LTRIM(RTRIM(@X)), N'');
    IF LEFT(@Facebook, 1) = N'@' SET @Facebook = NULLIF(STUFF(@Facebook, 1, 1, N''), N'');
    IF LEFT(@Instagram, 1) = N'@' SET @Instagram = NULLIF(STUFF(@Instagram, 1, 1, N''), N'');
    IF LEFT(@X, 1) = N'@' SET @X = NULLIF(STUFF(@X, 1, 1, N''), N'');
    IF @CampaignId IS NULL AND @LandingPageId IS NOT NULL
        SELECT @CampaignId = CampaignId FROM dbo.LandingPages WHERE LandingPageId = @LandingPageId;

    BEGIN TRANSACTION;
    BEGIN TRY
        DECLARE @LeadId BIGINT, @Duplicate BIT = 0;
        SELECT @LeadId = LeadId FROM dbo.LeadRoutineEvents WITH (UPDLOCK, HOLDLOCK)
        WHERE Routine = @Routine AND ExternalEventId = @ExternalEventId;
        IF @LeadId IS NOT NULL SET @Duplicate = 1;
        ELSE
        BEGIN
            SELECT TOP (1) @LeadId = LeadId FROM dbo.Leads WITH (UPDLOCK, HOLDLOCK)
            WHERE (@Email IS NOT NULL AND Email = @Email) OR (@Phone IS NOT NULL AND Phone = @Phone)
            ORDER BY LeadId;

            IF @LeadId IS NULL AND (@Facebook IS NOT NULL OR @Instagram IS NOT NULL OR @X IS NOT NULL)
                SELECT TOP (1) @LeadId = sa.LeadId
                FROM dbo.SocialAccounts sa WITH (UPDLOCK, HOLDLOCK)
                JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId = sa.SocialPlatformId
                WHERE sa.LeadId IS NOT NULL AND
                    ((sp.Code = N'facebook' AND @Facebook IS NOT NULL AND
                        LOWER(CASE WHEN LEFT(sa.Username, 1) = N'@' THEN STUFF(sa.Username, 1, 1, N'') ELSE sa.Username END) = LOWER(@Facebook)) OR
                     (sp.Code = N'instagram' AND @Instagram IS NOT NULL AND
                        LOWER(CASE WHEN LEFT(sa.Username, 1) = N'@' THEN STUFF(sa.Username, 1, 1, N'') ELSE sa.Username END) = LOWER(@Instagram)) OR
                     (sp.Code = N'x' AND @X IS NOT NULL AND
                        LOWER(CASE WHEN LEFT(sa.Username, 1) = N'@' THEN STUFF(sa.Username, 1, 1, N'') ELSE sa.Username END) = LOWER(@X)))
                ORDER BY sa.SocialAccountId;

            IF @LeadId IS NULL
                SELECT TOP (1) @LeadId = LeadId FROM dbo.Leads WITH (UPDLOCK, HOLDLOCK)
                WHERE (@Facebook IS NOT NULL AND LOWER(CASE WHEN LEFT(Facebook, 1) = N'@' THEN STUFF(Facebook, 1, 1, N'') ELSE Facebook END) = LOWER(@Facebook)) OR
                      (@Instagram IS NOT NULL AND LOWER(CASE WHEN LEFT(Instagram, 1) = N'@' THEN STUFF(Instagram, 1, 1, N'') ELSE Instagram END) = LOWER(@Instagram)) OR
                      (@X IS NOT NULL AND LOWER(CASE WHEN LEFT([X], 1) = N'@' THEN STUFF([X], 1, 1, N'') ELSE [X] END) = LOWER(@X))
                ORDER BY LeadId;

            IF @LeadId IS NULL
            BEGIN
                INSERT dbo.Leads (Name, Email, Phone, Facebook, Instagram, [X], [Source], Status)
                VALUES (@Name, @Email, @Phone, @Facebook, @Instagram, @X, @Source,
                    CASE WHEN @Routine IN (N'landing_page_registration', N'webinar_registration') THEN N'Registered' ELSE N'New' END);
                SET @LeadId = SCOPE_IDENTITY();
            END
            ELSE
                UPDATE dbo.Leads
                SET Name = COALESCE(NULLIF(@Name, N''), Name), Email = COALESCE(@Email, Email),
                    Phone = COALESCE(@Phone, Phone), Facebook = COALESCE(@Facebook, Facebook),
                    Instagram = COALESCE(@Instagram, Instagram), [X] = COALESCE(@X, [X]),
                    [Source] = @Source, UpdatedAt = SYSUTCDATETIME()
                WHERE LeadId = @LeadId;

            DECLARE @Identities TABLE (Code NVARCHAR(32) NOT NULL, Username NVARCHAR(255) NOT NULL);
            IF @Facebook IS NOT NULL INSERT @Identities VALUES (N'facebook', LEFT(@Facebook, 255));
            IF @Instagram IS NOT NULL INSERT @Identities VALUES (N'instagram', LEFT(@Instagram, 255));
            IF @X IS NOT NULL INSERT @Identities VALUES (N'x', LEFT(@X, 255));

            UPDATE sa SET LeadId = COALESCE(sa.LeadId, @LeadId), UpdatedAt = SYSUTCDATETIME()
            FROM dbo.SocialAccounts sa
            JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId = sa.SocialPlatformId
            JOIN @Identities i ON i.Code = sp.Code AND
                LOWER(CASE WHEN LEFT(sa.Username, 1) = N'@' THEN STUFF(sa.Username, 1, 1, N'') ELSE sa.Username END) = LOWER(i.Username)
            WHERE sa.LeadId IS NULL OR sa.LeadId = @LeadId;

            INSERT dbo.SocialAccounts (LeadId, SocialPlatformId, PlatformUserId, Username)
            SELECT @LeadId, sp.SocialPlatformId, CONCAT(N'handle:', LOWER(i.Username)), i.Username
            FROM @Identities i
            JOIN dbo.SocialPlatforms sp ON sp.Code = i.Code
            WHERE NOT EXISTS
            (
                SELECT 1 FROM dbo.SocialAccounts existing
                WHERE existing.SocialPlatformId = sp.SocialPlatformId AND
                    (LOWER(CASE WHEN LEFT(existing.Username, 1) = N'@' THEN STUFF(existing.Username, 1, 1, N'') ELSE existing.Username END) = LOWER(i.Username)
                     OR existing.PlatformUserId = CONCAT(N'handle:', LOWER(i.Username)))
            );

            INSERT dbo.LeadRoutineEvents
                (Routine, ExternalEventId, LeadId, CampaignId, LandingPageId, WebinarId, SourceDetail, OccurredAt)
            VALUES
                (@Routine, @ExternalEventId, @LeadId, @CampaignId, @LandingPageId, @WebinarId, @SourceDetail, @OccurredAt);
            IF @Routine = N'landing_page_registration' AND @LandingPageId IS NOT NULL
                UPDATE dbo.LandingPages SET Registrations = Registrations + 1, UpdatedAt = SYSUTCDATETIME()
                WHERE LandingPageId = @LandingPageId;
        END;
        COMMIT TRANSACTION;
        SELECT @LeadId AS LeadId, @Duplicate AS Duplicate;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO
