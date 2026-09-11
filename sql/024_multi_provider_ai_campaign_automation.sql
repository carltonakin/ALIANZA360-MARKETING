IF OBJECT_ID(N'dbo.CompanyProfiles', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CompanyProfiles
    (
        CompanyProfileId INT NOT NULL CONSTRAINT PK_CompanyProfiles PRIMARY KEY,
        CompanyName NVARCHAR(255) NOT NULL,
        CompanyDescription NVARCHAR(MAX) NULL,
        ProductsServices NVARCHAR(MAX) NULL,
        TargetAudience NVARCHAR(MAX) NULL,
        BrandVoice NVARCHAR(2000) NULL,
        Offers NVARCHAR(MAX) NULL,
        Website NVARCHAR(2048) NULL,
        PreferredCTA NVARCHAR(500) NULL,
        Industry NVARCHAR(255) NULL,
        BusinessGoals NVARCHAR(MAX) NULL,
        OtherProfileContext NVARCHAR(MAX) NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_CompanyProfiles_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_CompanyProfiles_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_CompanyProfiles_Singleton CHECK (CompanyProfileId = 1)
    );
END;
GO

IF OBJECT_ID(N'dbo.AIProviderConfigurations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AIProviderConfigurations
    (
        AIProviderConfigurationId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AIProviderConfigurations PRIMARY KEY,
        ProviderCode NVARCHAR(64) NOT NULL,
        ProviderName NVARCHAR(255) NOT NULL,
        Model NVARCHAR(255) NOT NULL,
        Enabled BIT NOT NULL CONSTRAINT DF_AIProviderConfigurations_Enabled DEFAULT 0,
        IsDefault BIT NOT NULL CONSTRAINT DF_AIProviderConfigurations_IsDefault DEFAULT 0,
        CapabilitiesJson NVARCHAR(2000) NOT NULL,
        SecretCiphertext NVARCHAR(MAX) NULL,
        SecretIv NVARCHAR(255) NULL,
        SecretAuthTag NVARCHAR(255) NULL,
        SecretFields NVARCHAR(1000) NULL,
        KeyVersion NVARCHAR(32) NULL,
        ConnectionStatus NVARCHAR(32) NOT NULL CONSTRAINT DF_AIProviderConfigurations_Status DEFAULT N'NOT_TESTED',
        LastTestedAt DATETIME2(3) NULL,
        LastSuccessAt DATETIME2(3) NULL,
        LastErrorAt DATETIME2(3) NULL,
        LastError NVARCHAR(1000) NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIProviderConfigurations_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIProviderConfigurations_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_AIProviderConfigurations_Code UNIQUE (ProviderCode),
        CONSTRAINT CK_AIProviderConfigurations_CapabilitiesJson CHECK (ISJSON(CapabilitiesJson) = 1),
        CONSTRAINT CK_AIProviderConfigurations_Status CHECK
            (ConnectionStatus IN (N'NOT_TESTED', N'CONNECTED', N'FAILED', N'MISSING_SECRET'))
    );
END;
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.AIProviderConfigurations')
      AND name = N'UX_AIProviderConfigurations_Default'
)
    CREATE UNIQUE INDEX UX_AIProviderConfigurations_Default
        ON dbo.AIProviderConfigurations (IsDefault)
        WHERE IsDefault = 1;
GO

MERGE dbo.AIProviderConfigurations AS target
USING
(
    VALUES
        (N'OPENAI', N'OpenAI', N'gpt-5.6', 1),
        (N'ANTHROPIC', N'Anthropic Claude', N'claude-sonnet-4-5', 0),
        (N'GOOGLE_GEMINI', N'Google Gemini', N'gemini-2.5-flash', 0)
) AS source (ProviderCode, ProviderName, Model, IsDefault)
ON target.ProviderCode = source.ProviderCode
WHEN NOT MATCHED THEN
    INSERT (ProviderCode, ProviderName, Model, Enabled, IsDefault, CapabilitiesJson)
    VALUES
    (
        source.ProviderCode,
        source.ProviderName,
        source.Model,
        0,
        CASE WHEN source.IsDefault = 1
             AND NOT EXISTS (SELECT 1 FROM dbo.AIProviderConfigurations WHERE IsDefault = 1)
             THEN 1 ELSE 0 END,
        N'["TEXT_GENERATION","STRUCTURED_OUTPUT"]'
    );
GO

IF OBJECT_ID(N'dbo.AICampaignConfigurations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AICampaignConfigurations
    (
        AICampaignConfigurationId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AICampaignConfigurations PRIMARY KEY,
        CampaignName NVARCHAR(255) NOT NULL,
        CampaignObjective NVARCHAR(2000) NOT NULL,
        StartDate DATE NOT NULL,
        EndDate DATE NOT NULL,
        PostsPerDay INT NOT NULL,
        ContentTypesJson NVARCHAR(2000) NOT NULL,
        AIProviderConfigurationId BIGINT NOT NULL,
        AIModel NVARCHAR(255) NULL,
        FallbackProviderConfigurationId BIGINT NULL,
        SelectedBufferChannelIdsJson NVARCHAR(MAX) NOT NULL,
        CTA NVARCHAR(500) NULL,
        DestinationUrl NVARCHAR(2048) NULL,
        PublishingMode NVARCHAR(16) NOT NULL CONSTRAINT DF_AICampaignConfigurations_PublishingMode DEFAULT N'DRAFT',
        Status NVARCHAR(16) NOT NULL CONSTRAINT DF_AICampaignConfigurations_Status DEFAULT N'DRAFT',
        LastGenerationDate DATE NULL,
        LastError NVARCHAR(1000) NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AICampaignConfigurations_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AICampaignConfigurations_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_AICampaignConfigurations_Provider FOREIGN KEY (AIProviderConfigurationId)
            REFERENCES dbo.AIProviderConfigurations(AIProviderConfigurationId),
        CONSTRAINT FK_AICampaignConfigurations_FallbackProvider FOREIGN KEY (FallbackProviderConfigurationId)
            REFERENCES dbo.AIProviderConfigurations(AIProviderConfigurationId),
        CONSTRAINT CK_AICampaignConfigurations_Dates CHECK (StartDate <= EndDate),
        CONSTRAINT CK_AICampaignConfigurations_PostsPerDay CHECK (PostsPerDay BETWEEN 1 AND 10),
        CONSTRAINT CK_AICampaignConfigurations_ContentTypesJson CHECK (ISJSON(ContentTypesJson) = 1),
        CONSTRAINT CK_AICampaignConfigurations_BufferJson CHECK (ISJSON(SelectedBufferChannelIdsJson) = 1),
        CONSTRAINT CK_AICampaignConfigurations_PublishingMode CHECK (PublishingMode IN (N'DRAFT', N'PRODUCTION')),
        CONSTRAINT CK_AICampaignConfigurations_Status CHECK
            (Status IN (N'DRAFT', N'ACTIVE', N'PAUSED', N'COMPLETED', N'STOPPED', N'FAILED')),
        CONSTRAINT CK_AICampaignConfigurations_DifferentFallback CHECK
            (FallbackProviderConfigurationId IS NULL OR FallbackProviderConfigurationId <> AIProviderConfigurationId)
    );
END;
GO

IF OBJECT_ID(N'dbo.AICampaignGenerationRuns', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AICampaignGenerationRuns
    (
        AICampaignGenerationRunId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AICampaignGenerationRuns PRIMARY KEY,
        AICampaignConfigurationId BIGINT NOT NULL,
        GenerationDate DATE NOT NULL,
        RunSlot INT NOT NULL,
        BufferChannelId NVARCHAR(255) NOT NULL,
        RegenerationSequence INT NOT NULL CONSTRAINT DF_AICampaignGenerationRuns_RegenerationSequence DEFAULT 0,
        GenerationStatus NVARCHAR(16) NOT NULL CONSTRAINT DF_AICampaignGenerationRuns_Status DEFAULT N'CLAIMED',
        AIProviderConfigurationId BIGINT NULL,
        ProviderCode NVARCHAR(64) NULL,
        Model NVARCHAR(255) NULL,
        CampaignId BIGINT NULL,
        CampaignPostId BIGINT NULL,
        RegeneratedFlag BIT NOT NULL CONSTRAINT DF_AICampaignGenerationRuns_Regenerated DEFAULT 0,
        FallbackUsed BIT NOT NULL CONSTRAINT DF_AICampaignGenerationRuns_Fallback DEFAULT 0,
        AttemptCount INT NOT NULL CONSTRAINT DF_AICampaignGenerationRuns_AttemptCount DEFAULT 0,
        InputContextJson NVARCHAR(MAX) NULL,
        NormalizedOutputJson NVARCHAR(MAX) NULL,
        ErrorMessage NVARCHAR(1000) NULL,
        StartedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AICampaignGenerationRuns_StartedAt DEFAULT SYSUTCDATETIME(),
        CompletedAt DATETIME2(3) NULL,
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AICampaignGenerationRuns_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_AICampaignGenerationRuns_Configuration FOREIGN KEY (AICampaignConfigurationId)
            REFERENCES dbo.AICampaignConfigurations(AICampaignConfigurationId),
        CONSTRAINT FK_AICampaignGenerationRuns_Provider FOREIGN KEY (AIProviderConfigurationId)
            REFERENCES dbo.AIProviderConfigurations(AIProviderConfigurationId),
        CONSTRAINT FK_AICampaignGenerationRuns_Campaign FOREIGN KEY (CampaignId) REFERENCES dbo.Campaigns(CampaignId),
        CONSTRAINT FK_AICampaignGenerationRuns_CampaignPost FOREIGN KEY (CampaignPostId) REFERENCES dbo.CampaignPosts(CampaignPostId),
        CONSTRAINT UQ_AICampaignGenerationRuns_Identity UNIQUE
            (AICampaignConfigurationId, GenerationDate, RunSlot, BufferChannelId, RegenerationSequence),
        CONSTRAINT CK_AICampaignGenerationRuns_Slot CHECK (RunSlot BETWEEN 1 AND 10),
        CONSTRAINT CK_AICampaignGenerationRuns_Regeneration CHECK (RegenerationSequence >= 0),
        CONSTRAINT CK_AICampaignGenerationRuns_Status CHECK
            (GenerationStatus IN (N'CLAIMED', N'GENERATING', N'SUCCEEDED', N'FAILED')),
        CONSTRAINT CK_AICampaignGenerationRuns_InputJson CHECK (InputContextJson IS NULL OR ISJSON(InputContextJson) = 1),
        CONSTRAINT CK_AICampaignGenerationRuns_OutputJson CHECK (NormalizedOutputJson IS NULL OR ISJSON(NormalizedOutputJson) = 1)
    );
END;
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.AICampaignGenerationRuns')
      AND name = N'IX_AICampaignGenerationRuns_History'
)
    CREATE INDEX IX_AICampaignGenerationRuns_History
        ON dbo.AICampaignGenerationRuns (AICampaignConfigurationId, GenerationDate DESC, RunSlot, BufferChannelId);
GO

CREATE OR ALTER PROCEDURE dbo.CompanyProfile_Get
AS
BEGIN
    SET NOCOUNT ON;
    SELECT * FROM dbo.CompanyProfiles WHERE CompanyProfileId = 1;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CompanyProfile_Upsert
    @CompanyName NVARCHAR(255),
    @CompanyDescription NVARCHAR(MAX) = NULL,
    @ProductsServices NVARCHAR(MAX) = NULL,
    @TargetAudience NVARCHAR(MAX) = NULL,
    @BrandVoice NVARCHAR(2000) = NULL,
    @Offers NVARCHAR(MAX) = NULL,
    @Website NVARCHAR(2048) = NULL,
    @PreferredCTA NVARCHAR(500) = NULL,
    @Industry NVARCHAR(255) = NULL,
    @BusinessGoals NVARCHAR(MAX) = NULL,
    @OtherProfileContext NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF NULLIF(LTRIM(RTRIM(@CompanyName)), N'') IS NULL
        THROW 52401, 'Company name is required.', 1;

    UPDATE dbo.CompanyProfiles
    SET CompanyName = @CompanyName,
        CompanyDescription = @CompanyDescription,
        ProductsServices = @ProductsServices,
        TargetAudience = @TargetAudience,
        BrandVoice = @BrandVoice,
        Offers = @Offers,
        Website = @Website,
        PreferredCTA = @PreferredCTA,
        Industry = @Industry,
        BusinessGoals = @BusinessGoals,
        OtherProfileContext = @OtherProfileContext,
        UpdatedAt = SYSUTCDATETIME()
    WHERE CompanyProfileId = 1;

    IF @@ROWCOUNT = 0
        INSERT dbo.CompanyProfiles
            (CompanyProfileId, CompanyName, CompanyDescription, ProductsServices, TargetAudience,
             BrandVoice, Offers, Website, PreferredCTA, Industry, BusinessGoals, OtherProfileContext)
        VALUES
            (1, @CompanyName, @CompanyDescription, @ProductsServices, @TargetAudience,
             @BrandVoice, @Offers, @Website, @PreferredCTA, @Industry, @BusinessGoals, @OtherProfileContext);

    SELECT * FROM dbo.CompanyProfiles WHERE CompanyProfileId = 1;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AIProviderConfiguration_Get
    @AIProviderConfigurationId BIGINT = NULL,
    @EnabledOnly BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SELECT *
    FROM dbo.AIProviderConfigurations
    WHERE (@AIProviderConfigurationId IS NULL OR AIProviderConfigurationId = @AIProviderConfigurationId)
      AND (@EnabledOnly = 0 OR Enabled = 1)
    ORDER BY IsDefault DESC, ProviderName;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AIProviderConfiguration_Upsert
    @AIProviderConfigurationId BIGINT,
    @ProviderName NVARCHAR(255),
    @Model NVARCHAR(255),
    @Enabled BIT,
    @IsDefault BIT,
    @CapabilitiesJson NVARCHAR(2000),
    @ReplaceSecret BIT = 0,
    @SecretCiphertext NVARCHAR(MAX) = NULL,
    @SecretIv NVARCHAR(255) = NULL,
    @SecretAuthTag NVARCHAR(255) = NULL,
    @SecretFields NVARCHAR(1000) = NULL,
    @KeyVersion NVARCHAR(32) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF ISJSON(@CapabilitiesJson) <> 1 THROW 52402, 'Provider capabilities must be valid JSON.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.AIProviderConfigurations WHERE AIProviderConfigurationId = @AIProviderConfigurationId)
        THROW 52403, 'AI provider configuration was not found.', 1;

    BEGIN TRANSACTION;
    IF @IsDefault = 1
        UPDATE dbo.AIProviderConfigurations
        SET IsDefault = 0, UpdatedAt = SYSUTCDATETIME()
        WHERE IsDefault = 1 AND AIProviderConfigurationId <> @AIProviderConfigurationId;

    UPDATE dbo.AIProviderConfigurations
    SET ProviderName = @ProviderName,
        Model = @Model,
        Enabled = @Enabled,
        IsDefault = @IsDefault,
        CapabilitiesJson = @CapabilitiesJson,
        SecretCiphertext = CASE WHEN @ReplaceSecret = 1 THEN @SecretCiphertext ELSE SecretCiphertext END,
        SecretIv = CASE WHEN @ReplaceSecret = 1 THEN @SecretIv ELSE SecretIv END,
        SecretAuthTag = CASE WHEN @ReplaceSecret = 1 THEN @SecretAuthTag ELSE SecretAuthTag END,
        SecretFields = CASE WHEN @ReplaceSecret = 1 THEN @SecretFields ELSE SecretFields END,
        KeyVersion = CASE WHEN @ReplaceSecret = 1 THEN @KeyVersion ELSE KeyVersion END,
        ConnectionStatus = CASE WHEN @ReplaceSecret = 1 THEN N'NOT_TESTED' ELSE ConnectionStatus END,
        LastError = CASE WHEN @ReplaceSecret = 1 THEN NULL ELSE LastError END,
        UpdatedAt = SYSUTCDATETIME()
    WHERE AIProviderConfigurationId = @AIProviderConfigurationId;
    COMMIT;

    SELECT * FROM dbo.AIProviderConfigurations WHERE AIProviderConfigurationId = @AIProviderConfigurationId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AIProviderConfiguration_SetTestResult
    @AIProviderConfigurationId BIGINT,
    @Succeeded BIT,
    @ErrorMessage NVARCHAR(1000) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.AIProviderConfigurations
    SET ConnectionStatus = CASE WHEN @Succeeded = 1 THEN N'CONNECTED' ELSE N'FAILED' END,
        LastTestedAt = SYSUTCDATETIME(),
        LastSuccessAt = CASE WHEN @Succeeded = 1 THEN SYSUTCDATETIME() ELSE LastSuccessAt END,
        LastErrorAt = CASE WHEN @Succeeded = 0 THEN SYSUTCDATETIME() ELSE LastErrorAt END,
        LastError = CASE WHEN @Succeeded = 1 THEN NULL ELSE @ErrorMessage END,
        UpdatedAt = SYSUTCDATETIME()
    WHERE AIProviderConfigurationId = @AIProviderConfigurationId;
    SELECT * FROM dbo.AIProviderConfigurations WHERE AIProviderConfigurationId = @AIProviderConfigurationId;
END;
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
    @Status NVARCHAR(16) = N'DRAFT'
AS
BEGIN
    SET NOCOUNT ON;
    IF @StartDate > @EndDate THROW 52404, 'AI campaign start date must be on or before end date.', 1;
    IF @PostsPerDay NOT BETWEEN 1 AND 10 THROW 52405, 'AI campaign posts per day must be between 1 and 10.', 1;
    IF ISJSON(@ContentTypesJson) <> 1 OR ISJSON(@SelectedBufferChannelIdsJson) <> 1
        THROW 52406, 'AI campaign content types and Buffer channels must be valid JSON.', 1;
    IF NOT EXISTS (SELECT 1 FROM OPENJSON(@SelectedBufferChannelIdsJson))
        THROW 52407, 'Select at least one Buffer channel.', 1;
    IF @FallbackProviderConfigurationId = @AIProviderConfigurationId
        THROW 52408, 'Fallback provider must differ from the primary provider.', 1;

    IF @AICampaignConfigurationId IS NULL
    BEGIN
        INSERT dbo.AICampaignConfigurations
            (CampaignName, CampaignObjective, StartDate, EndDate, PostsPerDay, ContentTypesJson,
             AIProviderConfigurationId, AIModel, FallbackProviderConfigurationId,
             SelectedBufferChannelIdsJson, CTA, DestinationUrl, PublishingMode, Status)
        VALUES
            (@CampaignName, @CampaignObjective, @StartDate, @EndDate, @PostsPerDay, @ContentTypesJson,
             @AIProviderConfigurationId, @AIModel, @FallbackProviderConfigurationId,
             @SelectedBufferChannelIdsJson, @CTA, @DestinationUrl, @PublishingMode, @Status);
        SET @AICampaignConfigurationId = SCOPE_IDENTITY();
    END
    ELSE
        UPDATE dbo.AICampaignConfigurations
        SET CampaignName = @CampaignName,
            CampaignObjective = @CampaignObjective,
            StartDate = @StartDate,
            EndDate = @EndDate,
            PostsPerDay = @PostsPerDay,
            ContentTypesJson = @ContentTypesJson,
            AIProviderConfigurationId = @AIProviderConfigurationId,
            AIModel = @AIModel,
            FallbackProviderConfigurationId = @FallbackProviderConfigurationId,
            SelectedBufferChannelIdsJson = @SelectedBufferChannelIdsJson,
            CTA = @CTA,
            DestinationUrl = @DestinationUrl,
            PublishingMode = @PublishingMode,
            Status = @Status,
            UpdatedAt = SYSUTCDATETIME()
        WHERE AICampaignConfigurationId = @AICampaignConfigurationId;

    SELECT * FROM dbo.AICampaignConfigurations WHERE AICampaignConfigurationId = @AICampaignConfigurationId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AICampaignConfiguration_Get
    @AICampaignConfigurationId BIGINT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT configuration.*,
           provider.ProviderCode, provider.ProviderName, provider.Model AS ProviderDefaultModel,
           fallback.ProviderCode AS FallbackProviderCode, fallback.ProviderName AS FallbackProviderName,
           (SELECT COUNT_BIG(1) FROM dbo.AICampaignGenerationRuns run
            WHERE run.AICampaignConfigurationId = configuration.AICampaignConfigurationId
              AND run.GenerationStatus = N'SUCCEEDED') AS SuccessfulGenerationCount,
           (SELECT MAX(run.CompletedAt) FROM dbo.AICampaignGenerationRuns run
            WHERE run.AICampaignConfigurationId = configuration.AICampaignConfigurationId) AS LastGenerationAt
    FROM dbo.AICampaignConfigurations configuration
    JOIN dbo.AIProviderConfigurations provider
      ON provider.AIProviderConfigurationId = configuration.AIProviderConfigurationId
    LEFT JOIN dbo.AIProviderConfigurations fallback
      ON fallback.AIProviderConfigurationId = configuration.FallbackProviderConfigurationId
    WHERE @AICampaignConfigurationId IS NULL
       OR configuration.AICampaignConfigurationId = @AICampaignConfigurationId
    ORDER BY configuration.CreatedAt DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AICampaignConfiguration_SetStatus
    @AICampaignConfigurationId BIGINT,
    @Status NVARCHAR(16),
    @ErrorMessage NVARCHAR(1000) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @Status NOT IN (N'DRAFT', N'ACTIVE', N'PAUSED', N'COMPLETED', N'STOPPED', N'FAILED')
        THROW 52409, 'Unsupported AI campaign status.', 1;
    UPDATE dbo.AICampaignConfigurations
    SET Status = @Status,
        LastError = @ErrorMessage,
        UpdatedAt = SYSUTCDATETIME()
    WHERE AICampaignConfigurationId = @AICampaignConfigurationId;
    SELECT * FROM dbo.AICampaignConfigurations WHERE AICampaignConfigurationId = @AICampaignConfigurationId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AICampaignConfiguration_GetDue
    @CurrentDate DATE
AS
BEGIN
    SET NOCOUNT ON;
    SELECT configuration.*,
           provider.ProviderCode, provider.ProviderName, provider.Model AS ProviderDefaultModel,
           fallback.ProviderCode AS FallbackProviderCode, fallback.ProviderName AS FallbackProviderName
    FROM dbo.AICampaignConfigurations configuration
    JOIN dbo.AIProviderConfigurations provider
      ON provider.AIProviderConfigurationId = configuration.AIProviderConfigurationId
    LEFT JOIN dbo.AIProviderConfigurations fallback
      ON fallback.AIProviderConfigurationId = configuration.FallbackProviderConfigurationId
    WHERE configuration.Status = N'ACTIVE'
      AND configuration.StartDate <= @CurrentDate
      AND configuration.EndDate >= @CurrentDate
    ORDER BY configuration.AICampaignConfigurationId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AICampaignConfiguration_CompleteExpired
    @CurrentDate DATE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.AICampaignConfigurations
    SET Status = N'COMPLETED', UpdatedAt = SYSUTCDATETIME()
    WHERE Status = N'ACTIVE' AND EndDate < @CurrentDate;
    SELECT @@ROWCOUNT AS CompletedCount;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AICampaignGenerationRun_Claim
    @AICampaignConfigurationId BIGINT,
    @GenerationDate DATE,
    @RunSlot INT,
    @BufferChannelId NVARCHAR(255),
    @RegeneratedFlag BIT = 0,
    @RetryFailed BIT = 0,
    @InputContextJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
    DECLARE @RegenerationSequence INT = 0;
    DECLARE @RunId BIGINT;
    DECLARE @ExistingStatus NVARCHAR(16);

    BEGIN TRANSACTION;
    IF @RegeneratedFlag = 1
        SELECT @RegenerationSequence = ISNULL(MAX(RegenerationSequence), 0) + 1
        FROM dbo.AICampaignGenerationRuns WITH (UPDLOCK, HOLDLOCK)
        WHERE AICampaignConfigurationId = @AICampaignConfigurationId
          AND GenerationDate = @GenerationDate
          AND RunSlot = @RunSlot
          AND BufferChannelId = @BufferChannelId;
    ELSE
        SELECT @RunId = AICampaignGenerationRunId, @ExistingStatus = GenerationStatus
        FROM dbo.AICampaignGenerationRuns WITH (UPDLOCK, HOLDLOCK)
        WHERE AICampaignConfigurationId = @AICampaignConfigurationId
          AND GenerationDate = @GenerationDate
          AND RunSlot = @RunSlot
          AND BufferChannelId = @BufferChannelId
          AND RegenerationSequence = 0;

    IF @RegeneratedFlag = 0 AND @RunId IS NOT NULL AND @RetryFailed = 1 AND @ExistingStatus = N'FAILED'
    BEGIN
        UPDATE dbo.AICampaignGenerationRuns
        SET GenerationStatus = N'CLAIMED',
            AIProviderConfigurationId = NULL,
            ProviderCode = NULL,
            Model = NULL,
            FallbackUsed = 0,
            AttemptCount = 0,
            ErrorMessage = NULL,
            StartedAt = SYSUTCDATETIME(),
            CompletedAt = NULL,
            UpdatedAt = SYSUTCDATETIME()
        WHERE AICampaignGenerationRunId = @RunId;
        COMMIT;
        SELECT * FROM dbo.AICampaignGenerationRuns WHERE AICampaignGenerationRunId = @RunId;
        RETURN;
    END;

    IF @RegeneratedFlag = 0 AND @RunId IS NOT NULL
    BEGIN
        COMMIT;
        RETURN;
    END;

    INSERT dbo.AICampaignGenerationRuns
        (AICampaignConfigurationId, GenerationDate, RunSlot, BufferChannelId,
         RegenerationSequence, GenerationStatus, RegeneratedFlag, InputContextJson)
    VALUES
        (@AICampaignConfigurationId, @GenerationDate, @RunSlot, @BufferChannelId,
         @RegenerationSequence, N'CLAIMED', @RegeneratedFlag, @InputContextJson);
    SET @RunId = SCOPE_IDENTITY();
    COMMIT;
    SELECT * FROM dbo.AICampaignGenerationRuns WHERE AICampaignGenerationRunId = @RunId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AICampaignGenerationRun_Succeed
    @AICampaignGenerationRunId BIGINT,
    @AIProviderConfigurationId BIGINT,
    @ProviderCode NVARCHAR(64),
    @Model NVARCHAR(255),
    @CampaignId BIGINT,
    @CampaignPostId BIGINT,
    @FallbackUsed BIT,
    @AttemptCount INT,
    @NormalizedOutputJson NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.AICampaignGenerationRuns
    SET GenerationStatus = N'SUCCEEDED',
        AIProviderConfigurationId = @AIProviderConfigurationId,
        ProviderCode = @ProviderCode,
        Model = @Model,
        CampaignId = @CampaignId,
        CampaignPostId = @CampaignPostId,
        FallbackUsed = @FallbackUsed,
        AttemptCount = @AttemptCount,
        NormalizedOutputJson = @NormalizedOutputJson,
        ErrorMessage = NULL,
        CompletedAt = SYSUTCDATETIME(),
        UpdatedAt = SYSUTCDATETIME()
    WHERE AICampaignGenerationRunId = @AICampaignGenerationRunId;

    UPDATE configuration
    SET LastGenerationDate = run.GenerationDate,
        LastError = NULL,
        UpdatedAt = SYSUTCDATETIME()
    FROM dbo.AICampaignConfigurations configuration
    JOIN dbo.AICampaignGenerationRuns run
      ON run.AICampaignConfigurationId = configuration.AICampaignConfigurationId
    WHERE run.AICampaignGenerationRunId = @AICampaignGenerationRunId;

    SELECT * FROM dbo.AICampaignGenerationRuns WHERE AICampaignGenerationRunId = @AICampaignGenerationRunId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AICampaignGenerationRun_Fail
    @AICampaignGenerationRunId BIGINT,
    @AIProviderConfigurationId BIGINT = NULL,
    @ProviderCode NVARCHAR(64) = NULL,
    @Model NVARCHAR(255) = NULL,
    @FallbackUsed BIT = 0,
    @AttemptCount INT = 0,
    @ErrorMessage NVARCHAR(1000)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.AICampaignGenerationRuns
    SET GenerationStatus = N'FAILED',
        AIProviderConfigurationId = @AIProviderConfigurationId,
        ProviderCode = @ProviderCode,
        Model = @Model,
        FallbackUsed = @FallbackUsed,
        AttemptCount = @AttemptCount,
        ErrorMessage = @ErrorMessage,
        CompletedAt = SYSUTCDATETIME(),
        UpdatedAt = SYSUTCDATETIME()
    WHERE AICampaignGenerationRunId = @AICampaignGenerationRunId;

    UPDATE configuration
    SET LastError = @ErrorMessage, UpdatedAt = SYSUTCDATETIME()
    FROM dbo.AICampaignConfigurations configuration
    JOIN dbo.AICampaignGenerationRuns run
      ON run.AICampaignConfigurationId = configuration.AICampaignConfigurationId
    WHERE run.AICampaignGenerationRunId = @AICampaignGenerationRunId;

    SELECT * FROM dbo.AICampaignGenerationRuns WHERE AICampaignGenerationRunId = @AICampaignGenerationRunId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AICampaignGenerationHistory_Get
    @AICampaignConfigurationId BIGINT = NULL,
    @AICampaignGenerationRunId BIGINT = NULL,
    @CampaignPostId BIGINT = NULL,
    @Limit INT = 100
AS
BEGIN
    SET NOCOUNT ON;
    SET @Limit = CASE WHEN @Limit BETWEEN 1 AND 500 THEN @Limit ELSE 100 END;
    SELECT TOP (@Limit) run.*, configuration.CampaignName, configuration.CampaignObjective,
           campaign.Name AS GeneratedCampaignName, post.PostStatus, post.ScheduledAt, post.PublishedAt,
           post.BufferPostId, post.PostUrl
    FROM dbo.AICampaignGenerationRuns run
    JOIN dbo.AICampaignConfigurations configuration
      ON configuration.AICampaignConfigurationId = run.AICampaignConfigurationId
    LEFT JOIN dbo.Campaigns campaign ON campaign.CampaignId = run.CampaignId
    LEFT JOIN dbo.CampaignPosts post ON post.CampaignPostId = run.CampaignPostId
    WHERE (@AICampaignConfigurationId IS NULL OR run.AICampaignConfigurationId = @AICampaignConfigurationId)
      AND (@AICampaignGenerationRunId IS NULL OR run.AICampaignGenerationRunId = @AICampaignGenerationRunId)
      AND (@CampaignPostId IS NULL OR run.CampaignPostId = @CampaignPostId)
    ORDER BY run.StartedAt DESC, run.AICampaignGenerationRunId DESC;
END;
GO
