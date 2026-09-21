IF COL_LENGTH(N'dbo.AICampaignConfigurations', N'SourceContentType') IS NULL
    ALTER TABLE dbo.AICampaignConfigurations ADD SourceContentType NVARCHAR(40) NOT NULL CONSTRAINT DF_AICampaignConfigurations_SourceContentType DEFAULT N'OBJECTIVE_ONLY';
IF COL_LENGTH(N'dbo.AICampaignConfigurations', N'SourceContent') IS NULL
    ALTER TABLE dbo.AICampaignConfigurations ADD SourceContent NVARCHAR(MAX) NULL;
IF COL_LENGTH(N'dbo.AICampaignConfigurations', N'MediaStrategy') IS NULL
    ALTER TABLE dbo.AICampaignConfigurations ADD MediaStrategy NVARCHAR(64) NOT NULL CONSTRAINT DF_AICampaignConfigurations_MediaStrategy DEFAULT N'TEXT_ONLY';
IF COL_LENGTH(N'dbo.AICampaignConfigurations', N'StoredMediaAssetIdsJson') IS NULL
    ALTER TABLE dbo.AICampaignConfigurations ADD StoredMediaAssetIdsJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_AICampaignConfigurations_StoredMediaAssetIds DEFAULT N'[]';
IF COL_LENGTH(N'dbo.AICampaignConfigurations', N'ImageProviderConfigurationId') IS NULL
    ALTER TABLE dbo.AICampaignConfigurations ADD ImageProviderConfigurationId BIGINT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_AICampaignConfigurations_ImageProvider')
    ALTER TABLE dbo.AICampaignConfigurations ADD CONSTRAINT FK_AICampaignConfigurations_ImageProvider
        FOREIGN KEY (ImageProviderConfigurationId) REFERENCES dbo.AIProviderConfigurations(AIProviderConfigurationId);
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_AICampaignConfigurations_StoredMediaJson')
    ALTER TABLE dbo.AICampaignConfigurations ADD CONSTRAINT CK_AICampaignConfigurations_StoredMediaJson
        CHECK (ISJSON(StoredMediaAssetIdsJson) = 1);
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_AICampaignConfigurations_SourceContentType')
    ALTER TABLE dbo.AICampaignConfigurations ADD CONSTRAINT CK_AICampaignConfigurations_SourceContentType
        CHECK (SourceContentType IN (N'OBJECTIVE_ONLY', N'TRANSCRIPT', N'SCRIPT', N'TRANSCRIPT_PLUS_OBJECTIVE', N'SCRIPT_PLUS_OBJECTIVE', N'OBJECTIVE_PLUS_NOTES'));
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = N'CK_AICampaignConfigurations_MediaStrategy')
    ALTER TABLE dbo.AICampaignConfigurations ADD CONSTRAINT CK_AICampaignConfigurations_MediaStrategy
        CHECK (MediaStrategy IN (N'TEXT_ONLY', N'AI_IMAGE_ONLY', N'STORED_IMAGE_ONLY', N'MIXED_IMAGE', N'STORED_VIDEO_ONLY', N'AI_VISUAL_CONCEPTS_WITH_STORED_MEDIA', N'IMAGE_AND_VIDEO_MIXED'));
GO

CREATE OR ALTER PROCEDURE dbo.AICampaignConfiguration_Save
    @AICampaignConfigurationId BIGINT = NULL,
    @CampaignName NVARCHAR(255),
    @CampaignObjective NVARCHAR(2000),
    @StartDate DATE,
    @EndDate DATE,
    @PostsPerDay INT,
    @ContentTypesJson NVARCHAR(2000),
    @AIProviderConfigurationId BIGINT,
    @AIModel NVARCHAR(255) = NULL,
    @FallbackProviderConfigurationId BIGINT = NULL,
    @SelectedBufferChannelIdsJson NVARCHAR(MAX),
    @CTA NVARCHAR(500) = NULL,
    @DestinationUrl NVARCHAR(2048) = NULL,
    @PublishingMode NVARCHAR(16),
    @Status NVARCHAR(16) = N'DRAFT',
    @SourceContentType NVARCHAR(40) = N'OBJECTIVE_ONLY',
    @SourceContent NVARCHAR(MAX) = NULL,
    @MediaStrategy NVARCHAR(64) = N'TEXT_ONLY',
    @StoredMediaAssetIdsJson NVARCHAR(MAX) = N'[]',
    @ImageProviderConfigurationId BIGINT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @StartDate > @EndDate THROW 52404, 'AI campaign start date must be on or before end date.', 1;
    IF @PostsPerDay NOT BETWEEN 1 AND 10 THROW 52405, 'AI campaign posts per day must be between 1 and 10.', 1;
    IF ISJSON(@ContentTypesJson) <> 1 OR ISJSON(@SelectedBufferChannelIdsJson) <> 1 OR ISJSON(@StoredMediaAssetIdsJson) <> 1
        THROW 52406, 'AI campaign lists must be valid JSON.', 1;
    IF NOT EXISTS (SELECT 1 FROM OPENJSON(@SelectedBufferChannelIdsJson))
        THROW 52407, 'Select at least one Buffer channel.', 1;
    IF @FallbackProviderConfigurationId = @AIProviderConfigurationId
        THROW 52408, 'Fallback provider must differ from the primary provider.', 1;

    IF @AICampaignConfigurationId IS NULL
    BEGIN
        INSERT dbo.AICampaignConfigurations
            (CampaignName, CampaignObjective, StartDate, EndDate, PostsPerDay, ContentTypesJson,
             AIProviderConfigurationId, AIModel, FallbackProviderConfigurationId,
             SelectedBufferChannelIdsJson, CTA, DestinationUrl, PublishingMode, Status,
             SourceContentType, SourceContent, MediaStrategy, StoredMediaAssetIdsJson, ImageProviderConfigurationId)
        VALUES
            (@CampaignName, @CampaignObjective, @StartDate, @EndDate, @PostsPerDay, @ContentTypesJson,
             @AIProviderConfigurationId, @AIModel, @FallbackProviderConfigurationId,
             @SelectedBufferChannelIdsJson, @CTA, @DestinationUrl, @PublishingMode, @Status,
             @SourceContentType, @SourceContent, @MediaStrategy, @StoredMediaAssetIdsJson, @ImageProviderConfigurationId);
        SET @AICampaignConfigurationId = SCOPE_IDENTITY();
    END
    ELSE
        UPDATE dbo.AICampaignConfigurations
        SET CampaignName = @CampaignName, CampaignObjective = @CampaignObjective,
            StartDate = @StartDate, EndDate = @EndDate, PostsPerDay = @PostsPerDay,
            ContentTypesJson = @ContentTypesJson, AIProviderConfigurationId = @AIProviderConfigurationId,
            AIModel = @AIModel, FallbackProviderConfigurationId = @FallbackProviderConfigurationId,
            SelectedBufferChannelIdsJson = @SelectedBufferChannelIdsJson, CTA = @CTA,
            DestinationUrl = @DestinationUrl, PublishingMode = @PublishingMode, Status = @Status,
            SourceContentType = @SourceContentType, SourceContent = @SourceContent,
            MediaStrategy = @MediaStrategy, StoredMediaAssetIdsJson = @StoredMediaAssetIdsJson,
            ImageProviderConfigurationId = @ImageProviderConfigurationId,
            UpdatedAt = SYSUTCDATETIME()
        WHERE AICampaignConfigurationId = @AICampaignConfigurationId;

    SELECT * FROM dbo.AICampaignConfigurations WHERE AICampaignConfigurationId = @AICampaignConfigurationId;
END;
GO
