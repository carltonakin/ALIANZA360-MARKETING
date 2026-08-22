SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'dbo.Leads', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Leads
    (
        LeadId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Leads PRIMARY KEY,
        Name NVARCHAR(255) NOT NULL,
        Email NVARCHAR(320) NULL,
        Phone NVARCHAR(80) NULL,
        SocialUsername NVARCHAR(255) NULL,
        Facebook NVARCHAR(500) NULL,
        Instagram NVARCHAR(500) NULL,
        [X] NVARCHAR(500) NULL,
        [Source] NVARCHAR(100) NULL,
        EstimatedValue DECIMAL(19,4) NOT NULL CONSTRAINT DF_Leads_EstimatedValue DEFAULT 0,
        Status NVARCHAR(50) NOT NULL CONSTRAINT DF_Leads_Status DEFAULT N'New',
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_Leads_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_Leads_UpdatedAt DEFAULT SYSUTCDATETIME()
    );
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialChannelConfiguration_GetAll
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Channel, Enabled, Environment, AccountId, PageId, BusinessId, AppId, ClientId,
           WebhookUrl, CallbackUrl, Scopes, ApiVersion, SecretCiphertext, SecretIv,
           SecretAuthTag, SecretFields, KeyVersion, Status, LastTestedAt, LastSuccessAt,
           LastErrorAt, LastError, CreatedAt, UpdatedAt
    FROM dbo.SocialChannelConfigurations
    ORDER BY CASE Channel WHEN N'instagram' THEN 1 WHEN N'facebook' THEN 2 ELSE 3 END;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialChannelConfiguration_Upsert
    @Channel NVARCHAR(32),
    @Enabled BIT,
    @Environment NVARCHAR(32),
    @AccountId NVARCHAR(255) = NULL,
    @PageId NVARCHAR(255) = NULL,
    @BusinessId NVARCHAR(255) = NULL,
    @AppId NVARCHAR(255) = NULL,
    @ClientId NVARCHAR(255) = NULL,
    @WebhookUrl NVARCHAR(2048) = NULL,
    @CallbackUrl NVARCHAR(2048) = NULL,
    @Scopes NVARCHAR(2000) = NULL,
    @ApiVersion NVARCHAR(64) = NULL,
    @ReplaceSecrets BIT = 0,
    @SecretCiphertext NVARCHAR(MAX) = NULL,
    @SecretIv NVARCHAR(255) = NULL,
    @SecretAuthTag NVARCHAR(255) = NULL,
    @SecretFields NVARCHAR(2000) = NULL,
    @KeyVersion NVARCHAR(32) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.SocialChannelConfigurations
    SET Enabled = @Enabled,
        Environment = @Environment,
        AccountId = @AccountId,
        PageId = @PageId,
        BusinessId = @BusinessId,
        AppId = @AppId,
        ClientId = @ClientId,
        WebhookUrl = @WebhookUrl,
        CallbackUrl = @CallbackUrl,
        Scopes = @Scopes,
        ApiVersion = @ApiVersion,
        SecretCiphertext = CASE WHEN @ReplaceSecrets = 1 THEN @SecretCiphertext ELSE SecretCiphertext END,
        SecretIv = CASE WHEN @ReplaceSecrets = 1 THEN @SecretIv ELSE SecretIv END,
        SecretAuthTag = CASE WHEN @ReplaceSecrets = 1 THEN @SecretAuthTag ELSE SecretAuthTag END,
        SecretFields = CASE WHEN @ReplaceSecrets = 1 THEN @SecretFields ELSE SecretFields END,
        KeyVersion = CASE WHEN @ReplaceSecrets = 1 THEN @KeyVersion ELSE KeyVersion END,
        Status = N'disconnected',
        LastError = NULL,
        UpdatedAt = SYSUTCDATETIME()
    WHERE Channel = @Channel;

    IF @@ROWCOUNT = 0
        INSERT dbo.SocialChannelConfigurations
            (Channel, Enabled, Environment, AccountId, PageId, BusinessId, AppId, ClientId,
             WebhookUrl, CallbackUrl, Scopes, ApiVersion, SecretCiphertext, SecretIv,
             SecretAuthTag, SecretFields, KeyVersion, Status)
        VALUES
            (@Channel, @Enabled, @Environment, @AccountId, @PageId, @BusinessId, @AppId, @ClientId,
             @WebhookUrl, @CallbackUrl, @Scopes, @ApiVersion, @SecretCiphertext, @SecretIv,
             @SecretAuthTag, @SecretFields, @KeyVersion, N'disconnected');

    EXEC dbo.SocialChannelConfiguration_GetAll;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialChannelConfiguration_Delete
    @Channel NVARCHAR(32)
AS
BEGIN
    SET NOCOUNT ON;
    DELETE dbo.SocialChannelConfigurations WHERE Channel = @Channel;
    DELETE dbo.SocialChannelConnections WHERE Channel = @Channel;
    DELETE dbo.SocialListenerStatus WHERE Channel = @Channel;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CRMContent_GetAll
AS
BEGIN
    SET NOCOUNT ON;
    SELECT CampaignId, Name, Platform, Audience, Message, Budget, Mode, CreatedByAi,
           LastReadinessCheckAt, LastReadinessError, CreatedAt, UpdatedAt
    FROM dbo.Campaigns ORDER BY CreatedAt DESC;
    SELECT LandingPageId, CampaignId, Title, Slug, Headline, Teaser, WebinarUrl,
           PaymentUrl, Status, Registrations, CreatedByAi, CreatedAt, UpdatedAt
    FROM dbo.LandingPages ORDER BY CreatedAt DESC;
    SELECT WebinarId, CampaignId, LandingPageId, Title, Description, ScheduledAt,
           WebinarUrl, Status, CreatedByAi, CreatedAt, UpdatedAt
    FROM dbo.Webinars ORDER BY CreatedAt DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.Campaign_Save
    @CampaignId BIGINT = NULL,
    @Name NVARCHAR(255),
    @Platform NVARCHAR(100),
    @Audience NVARCHAR(MAX),
    @Message NVARCHAR(MAX),
    @Budget DECIMAL(19,4) = 0,
    @Mode NVARCHAR(32) = N'draft',
    @CreatedByAi BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    IF @Mode = N'production' AND
       (@CampaignId IS NULL OR NOT EXISTS
          (SELECT 1 FROM dbo.Campaigns WHERE CampaignId = @CampaignId AND Mode = N'production'))
        THROW 51001, 'Use Campaign_SetMode to enter production mode.', 1;
    IF @CampaignId IS NULL
    BEGIN
        INSERT dbo.Campaigns (Name, Platform, Audience, Message, Budget, Mode, CreatedByAi)
        VALUES (@Name, @Platform, @Audience, @Message, @Budget, @Mode, @CreatedByAi);
        SET @CampaignId = SCOPE_IDENTITY();
    END
    ELSE
        UPDATE dbo.Campaigns
        SET Name = @Name, Platform = @Platform, Audience = @Audience, Message = @Message,
            Budget = @Budget, Mode = @Mode, CreatedByAi = @CreatedByAi,
            UpdatedAt = SYSUTCDATETIME()
        WHERE CampaignId = @CampaignId;
    SELECT * FROM dbo.Campaigns WHERE CampaignId = @CampaignId;
END;
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
    @Status NVARCHAR(32) = N'draft',
    @CreatedByAi BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    IF @LandingPageId IS NULL
    BEGIN
        INSERT dbo.LandingPages
            (CampaignId, Title, Slug, Headline, Teaser, WebinarUrl, PaymentUrl, Status, CreatedByAi)
        VALUES
            (@CampaignId, @Title, @Slug, @Headline, @Teaser, @WebinarUrl, @PaymentUrl, @Status, @CreatedByAi);
        SET @LandingPageId = SCOPE_IDENTITY();
    END
    ELSE
        UPDATE dbo.LandingPages
        SET CampaignId = @CampaignId, Title = @Title, Slug = @Slug, Headline = @Headline,
            Teaser = @Teaser, WebinarUrl = @WebinarUrl, PaymentUrl = @PaymentUrl,
            Status = @Status, CreatedByAi = @CreatedByAi, UpdatedAt = SYSUTCDATETIME()
        WHERE LandingPageId = @LandingPageId;
    SELECT * FROM dbo.LandingPages WHERE LandingPageId = @LandingPageId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.Webinar_Save
    @WebinarId BIGINT = NULL,
    @CampaignId BIGINT = NULL,
    @LandingPageId BIGINT = NULL,
    @Title NVARCHAR(255),
    @Description NVARCHAR(MAX) = NULL,
    @ScheduledAt DATETIME2(3) = NULL,
    @WebinarUrl NVARCHAR(2048) = NULL,
    @Status NVARCHAR(32) = N'draft',
    @CreatedByAi BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    IF @WebinarId IS NULL
    BEGIN
        INSERT dbo.Webinars
            (CampaignId, LandingPageId, Title, Description, ScheduledAt, WebinarUrl, Status, CreatedByAi)
        VALUES
            (@CampaignId, @LandingPageId, @Title, @Description, @ScheduledAt, @WebinarUrl, @Status, @CreatedByAi);
        SET @WebinarId = SCOPE_IDENTITY();
    END
    ELSE
        UPDATE dbo.Webinars
        SET CampaignId = @CampaignId, LandingPageId = @LandingPageId, Title = @Title,
            Description = @Description, ScheduledAt = @ScheduledAt, WebinarUrl = @WebinarUrl,
            Status = @Status, CreatedByAi = @CreatedByAi, UpdatedAt = SYSUTCDATETIME()
        WHERE WebinarId = @WebinarId;
    SELECT * FROM dbo.Webinars WHERE WebinarId = @WebinarId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.Campaign_SetMode
    @CampaignId BIGINT,
    @Mode NVARCHAR(32)
AS
BEGIN
    SET NOCOUNT ON;
    IF @Mode NOT IN (N'draft', N'test', N'production', N'paused', N'archived')
        THROW 51002, 'Unsupported campaign mode.', 1;

    IF @Mode = N'production'
    BEGIN
        DECLARE @Platform NVARCHAR(100), @Error NVARCHAR(1000) = NULL;
        SELECT @Platform = LOWER(Platform) FROM dbo.Campaigns WHERE CampaignId = @CampaignId;
        IF @Platform IS NULL SET @Error = N'Campaign not found.';
        ELSE IF NOT EXISTS
        (
            SELECT 1 FROM dbo.SocialChannelConfigurations c
            WHERE c.Enabled = 1 AND c.Status = N'connected' AND c.LastSuccessAt IS NOT NULL
              AND (@Platform LIKE N'%multi%' OR @Platform LIKE N'%' + c.Channel + N'%'
                   OR (@Platform LIKE N'%twitter%' AND c.Channel = N'x'))
        ) SET @Error = N'No selected channel has a successful persisted provider identity test.';
        ELSE IF EXISTS
        (
            SELECT 1 FROM dbo.Campaigns
            WHERE CampaignId = @CampaignId
              AND (NULLIF(LTRIM(RTRIM(Audience)), N'') IS NULL OR NULLIF(LTRIM(RTRIM(Message)), N'') IS NULL)
        ) SET @Error = N'Campaign audience and message must pass content validation.';
        ELSE IF NOT EXISTS (SELECT 1 FROM dbo.LandingPages WHERE CampaignId = @CampaignId)
             AND NOT EXISTS (SELECT 1 FROM dbo.Webinars WHERE CampaignId = @CampaignId)
            SET @Error = N'Attach a landing page or webinar before entering production mode.';
        ELSE IF OBJECT_ID(N'dbo.CRMLead_UpsertFromRoutine', N'P') IS NULL
            SET @Error = N'The SQL lead capture route is not installed.';

        UPDATE dbo.Campaigns
        SET LastReadinessCheckAt = SYSUTCDATETIME(), LastReadinessError = @Error,
            UpdatedAt = SYSUTCDATETIME()
        WHERE CampaignId = @CampaignId;
        IF @Error IS NOT NULL THROW 51003, @Error, 1;
    END;

    UPDATE dbo.Campaigns SET Mode = @Mode, UpdatedAt = SYSUTCDATETIME()
    WHERE CampaignId = @CampaignId;
    SELECT * FROM dbo.Campaigns WHERE CampaignId = @CampaignId;
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
            IF @LeadId IS NULL
            BEGIN
                INSERT dbo.Leads
                    (Name, Email, Phone, Facebook, Instagram, [X], [Source], Status)
                VALUES
                    (@Name, @Email, @Phone, @Facebook, @Instagram, @X, @Source,
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

IF COL_LENGTH(N'dbo.Leads', N'Facebook') IS NULL
    ALTER TABLE dbo.Leads ADD Facebook NVARCHAR(500) NULL;
GO
IF COL_LENGTH(N'dbo.Leads', N'Instagram') IS NULL
    ALTER TABLE dbo.Leads ADD Instagram NVARCHAR(500) NULL;
GO
IF COL_LENGTH(N'dbo.Leads', N'X') IS NULL
    ALTER TABLE dbo.Leads ADD [X] NVARCHAR(500) NULL;
GO
IF COL_LENGTH(N'dbo.Leads', N'Source') IS NULL
    ALTER TABLE dbo.Leads ADD [Source] NVARCHAR(100) NULL;
GO
IF COL_LENGTH(N'dbo.Leads', N'EstimatedValue') IS NULL
    ALTER TABLE dbo.Leads ADD EstimatedValue DECIMAL(19,4) NOT NULL
        CONSTRAINT DF_Leads_EstimatedValue DEFAULT 0 WITH VALUES;
GO

IF OBJECT_ID(N'dbo.SocialChannelConnections', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SocialChannelConnections
    (
        ConnectionId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SocialChannelConnections PRIMARY KEY,
        Channel NVARCHAR(32) NOT NULL,
        IsConfigured BIT NOT NULL CONSTRAINT DF_SocialChannelConnections_IsConfigured DEFAULT 0,
        Status NVARCHAR(32) NOT NULL CONSTRAINT DF_SocialChannelConnections_Status DEFAULT N'disconnected',
        ExternalAccountId NVARCHAR(255) NULL,
        DisplayName NVARCHAR(255) NULL,
        LastValidatedAt DATETIME2(3) NULL,
        LastSuccessfulCheck DATETIME2(3) NULL,
        LastError NVARCHAR(1000) NULL,
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SocialChannelConnections_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_SocialChannelConnections_Channel UNIQUE (Channel),
        CONSTRAINT CK_SocialChannelConnections_Status CHECK
            (Status IN (N'connected', N'disconnected', N'missing_configuration', N'invalid_credentials', N'rate_limited', N'degraded', N'error'))
    );
END;
GO

IF OBJECT_ID(N'dbo.SocialEvents', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SocialEvents
    (
        SocialEventId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SocialEvents PRIMARY KEY,
        Channel NVARCHAR(32) NOT NULL,
        ExternalEventId NVARCHAR(255) NOT NULL,
        EventType NVARCHAR(100) NOT NULL,
        ExternalUserId NVARCHAR(255) NULL,
        Username NVARCHAR(255) NULL,
        DisplayName NVARCHAR(255) NULL,
        Email NVARCHAR(320) NULL,
        Phone NVARCHAR(80) NULL,
        Message NVARCHAR(MAX) NULL,
        PostId NVARCHAR(255) NULL,
        CampaignId NVARCHAR(255) NULL,
        AdId NVARCHAR(255) NULL,
        SourceUrl NVARCHAR(2048) NULL,
        OccurredAt DATETIME2(3) NOT NULL,
        RawPayload NVARCHAR(MAX) NOT NULL,
        ProcessingStatus NVARCHAR(32) NOT NULL CONSTRAINT DF_SocialEvents_ProcessingStatus DEFAULT N'processed',
        ProcessedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SocialEvents_ProcessedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_SocialEvents_Channel_ExternalEvent UNIQUE (Channel, ExternalEventId),
        CONSTRAINT CK_SocialEvents_RawPayloadJson CHECK (ISJSON(RawPayload) = 1)
    );
END;
GO

IF OBJECT_ID(N'dbo.SocialListenerStatus', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SocialListenerStatus
    (
        Channel NVARCHAR(32) NOT NULL CONSTRAINT PK_SocialListenerStatus PRIMARY KEY,
        Status NVARCHAR(32) NOT NULL CONSTRAINT DF_SocialListenerStatus_Status DEFAULT N'disconnected',
        LastSuccessfulCheck DATETIME2(3) NULL,
        LastReceivedEvent DATETIME2(3) NULL,
        LastMetricAt DATETIME2(3) NULL,
        LastError NVARCHAR(1000) NULL,
        EventsProcessed BIGINT NOT NULL CONSTRAINT DF_SocialListenerStatus_Events DEFAULT 0,
        LeadsGenerated BIGINT NOT NULL CONSTRAINT DF_SocialListenerStatus_Leads DEFAULT 0,
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SocialListenerStatus_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_SocialListenerStatus_Status CHECK
            (Status IN (N'connected', N'disconnected', N'missing_configuration', N'invalid_credentials', N'rate_limited', N'degraded', N'error'))
    );
END;
GO

IF OBJECT_ID(N'dbo.SocialListenerErrors', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SocialListenerErrors
    (
        ErrorId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SocialListenerErrors PRIMARY KEY,
        Channel NVARCHAR(32) NOT NULL,
        Operation NVARCHAR(100) NOT NULL,
        ErrorCode NVARCHAR(100) NULL,
        SafeMessage NVARCHAR(1000) NOT NULL,
        IsTransient BIT NOT NULL CONSTRAINT DF_SocialListenerErrors_IsTransient DEFAULT 0,
        OccurredAt DATETIME2(3) NOT NULL CONSTRAINT DF_SocialListenerErrors_OccurredAt DEFAULT SYSUTCDATETIME()
    );
END;
GO

IF OBJECT_ID(N'dbo.LeadSourceAttribution', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.LeadSourceAttribution
    (
        AttributionId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LeadSourceAttribution PRIMARY KEY,
        LeadId BIGINT NOT NULL,
        SocialEventId BIGINT NOT NULL,
        SourceChannel NVARCHAR(32) NOT NULL,
        ExternalUserId NVARCHAR(255) NULL,
        SocialUsername NVARCHAR(255) NULL,
        CampaignId NVARCHAR(255) NULL,
        AdId NVARCHAR(255) NULL,
        PostId NVARCHAR(255) NULL,
        ExternalEventId NVARCHAR(255) NOT NULL,
        FirstTouchAt DATETIME2(3) NOT NULL,
        LastInteractionAt DATETIME2(3) NOT NULL,
        CONSTRAINT FK_LeadSourceAttribution_Lead FOREIGN KEY (LeadId) REFERENCES dbo.Leads(LeadId),
        CONSTRAINT FK_LeadSourceAttribution_Event FOREIGN KEY (SocialEventId) REFERENCES dbo.SocialEvents(SocialEventId),
        CONSTRAINT UQ_LeadSourceAttribution_Event UNIQUE (SocialEventId)
    );
END;
GO

IF OBJECT_ID(N'dbo.SocialMetrics', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SocialMetrics
    (
        SocialMetricId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SocialMetrics PRIMARY KEY,
        Channel NVARCHAR(32) NOT NULL,
        MetricName NVARCHAR(255) NOT NULL,
        MetricValue DECIMAL(19,4) NULL,
        MetricPayload NVARCHAR(MAX) NULL,
        MeasuredAt DATETIME2(3) NOT NULL,
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SocialMetrics_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_SocialMetrics_PayloadJson CHECK (MetricPayload IS NULL OR ISJSON(MetricPayload) = 1)
    );
END;
GO

IF OBJECT_ID(N'dbo.SocialChannelConfigurations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SocialChannelConfigurations
    (
        Channel NVARCHAR(32) NOT NULL CONSTRAINT PK_SocialChannelConfigurations PRIMARY KEY,
        Enabled BIT NOT NULL CONSTRAINT DF_SocialChannelConfigurations_Enabled DEFAULT 1,
        Environment NVARCHAR(32) NOT NULL CONSTRAINT DF_SocialChannelConfigurations_Environment DEFAULT N'production',
        AccountId NVARCHAR(255) NULL,
        PageId NVARCHAR(255) NULL,
        BusinessId NVARCHAR(255) NULL,
        AppId NVARCHAR(255) NULL,
        ClientId NVARCHAR(255) NULL,
        WebhookUrl NVARCHAR(2048) NULL,
        CallbackUrl NVARCHAR(2048) NULL,
        Scopes NVARCHAR(2000) NULL,
        ApiVersion NVARCHAR(64) NULL,
        SecretCiphertext NVARCHAR(MAX) NULL,
        SecretIv NVARCHAR(255) NULL,
        SecretAuthTag NVARCHAR(255) NULL,
        SecretFields NVARCHAR(2000) NULL,
        KeyVersion NVARCHAR(32) NULL,
        Status NVARCHAR(32) NOT NULL CONSTRAINT DF_SocialChannelConfigurations_Status DEFAULT N'missing_configuration',
        LastTestedAt DATETIME2(3) NULL,
        LastSuccessAt DATETIME2(3) NULL,
        LastErrorAt DATETIME2(3) NULL,
        LastError NVARCHAR(1000) NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SocialChannelConfigurations_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SocialChannelConfigurations_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_SocialChannelConfigurations_Channel CHECK (Channel IN (N'instagram', N'facebook', N'x')),
        CONSTRAINT CK_SocialChannelConfigurations_Environment CHECK (Environment IN (N'sandbox', N'test', N'production')),
        CONSTRAINT CK_SocialChannelConfigurations_Status CHECK
            (Status IN (N'connected', N'disconnected', N'missing_configuration', N'invalid_credentials', N'rate_limited', N'degraded', N'error')),
        CONSTRAINT CK_SocialChannelConfigurations_Secrets CHECK
            ((SecretCiphertext IS NULL AND SecretIv IS NULL AND SecretAuthTag IS NULL) OR
             (SecretCiphertext IS NOT NULL AND SecretIv IS NOT NULL AND SecretAuthTag IS NOT NULL))
    );
END;
GO

IF OBJECT_ID(N'dbo.Campaigns', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Campaigns
    (
        CampaignId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Campaigns PRIMARY KEY,
        Name NVARCHAR(255) NOT NULL,
        Platform NVARCHAR(100) NOT NULL,
        Audience NVARCHAR(MAX) NOT NULL,
        Message NVARCHAR(MAX) NOT NULL,
        Budget DECIMAL(19,4) NOT NULL CONSTRAINT DF_Campaigns_Budget DEFAULT 0,
        Mode NVARCHAR(32) NOT NULL CONSTRAINT DF_Campaigns_Mode DEFAULT N'draft',
        CreatedByAi BIT NOT NULL CONSTRAINT DF_Campaigns_CreatedByAi DEFAULT 0,
        LastReadinessCheckAt DATETIME2(3) NULL,
        LastReadinessError NVARCHAR(1000) NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_Campaigns_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_Campaigns_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_Campaigns_Mode CHECK (Mode IN (N'draft', N'test', N'production', N'paused', N'archived'))
    );
END;
GO

IF OBJECT_ID(N'dbo.LandingPages', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.LandingPages
    (
        LandingPageId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LandingPages PRIMARY KEY,
        CampaignId BIGINT NULL,
        Title NVARCHAR(255) NOT NULL,
        Slug NVARCHAR(255) NOT NULL,
        Headline NVARCHAR(500) NOT NULL,
        Teaser NVARCHAR(MAX) NULL,
        WebinarUrl NVARCHAR(2048) NULL,
        PaymentUrl NVARCHAR(2048) NULL,
        Status NVARCHAR(32) NOT NULL CONSTRAINT DF_LandingPages_Status DEFAULT N'draft',
        Registrations BIGINT NOT NULL CONSTRAINT DF_LandingPages_Registrations DEFAULT 0,
        CreatedByAi BIT NOT NULL CONSTRAINT DF_LandingPages_CreatedByAi DEFAULT 0,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_LandingPages_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_LandingPages_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_LandingPages_Slug UNIQUE (Slug),
        CONSTRAINT FK_LandingPages_Campaign FOREIGN KEY (CampaignId) REFERENCES dbo.Campaigns(CampaignId)
    );
END;
GO

IF OBJECT_ID(N'dbo.Webinars', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Webinars
    (
        WebinarId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Webinars PRIMARY KEY,
        CampaignId BIGINT NULL,
        LandingPageId BIGINT NULL,
        Title NVARCHAR(255) NOT NULL,
        Description NVARCHAR(MAX) NULL,
        ScheduledAt DATETIME2(3) NULL,
        WebinarUrl NVARCHAR(2048) NULL,
        Status NVARCHAR(32) NOT NULL CONSTRAINT DF_Webinars_Status DEFAULT N'draft',
        CreatedByAi BIT NOT NULL CONSTRAINT DF_Webinars_CreatedByAi DEFAULT 0,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_Webinars_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_Webinars_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_Webinars_Campaign FOREIGN KEY (CampaignId) REFERENCES dbo.Campaigns(CampaignId),
        CONSTRAINT FK_Webinars_LandingPage FOREIGN KEY (LandingPageId) REFERENCES dbo.LandingPages(LandingPageId)
    );
END;
GO

IF OBJECT_ID(N'dbo.LeadRoutineEvents', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.LeadRoutineEvents
    (
        LeadRoutineEventId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LeadRoutineEvents PRIMARY KEY,
        Routine NVARCHAR(64) NOT NULL,
        ExternalEventId NVARCHAR(255) NOT NULL,
        LeadId BIGINT NOT NULL,
        CampaignId BIGINT NULL,
        LandingPageId BIGINT NULL,
        WebinarId BIGINT NULL,
        SourceDetail NVARCHAR(1000) NULL,
        OccurredAt DATETIME2(3) NOT NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_LeadRoutineEvents_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_LeadRoutineEvents_Routine_Event UNIQUE (Routine, ExternalEventId),
        CONSTRAINT FK_LeadRoutineEvents_Lead FOREIGN KEY (LeadId) REFERENCES dbo.Leads(LeadId),
        CONSTRAINT FK_LeadRoutineEvents_Campaign FOREIGN KEY (CampaignId) REFERENCES dbo.Campaigns(CampaignId),
        CONSTRAINT FK_LeadRoutineEvents_LandingPage FOREIGN KEY (LandingPageId) REFERENCES dbo.LandingPages(LandingPageId),
        CONSTRAINT FK_LeadRoutineEvents_Webinar FOREIGN KEY (WebinarId) REFERENCES dbo.Webinars(WebinarId)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_SocialEvents_OccurredAt' AND object_id = OBJECT_ID(N'dbo.SocialEvents'))
    CREATE INDEX IX_SocialEvents_OccurredAt ON dbo.SocialEvents (OccurredAt DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_SocialEvents_Channel_ProcessedAt' AND object_id = OBJECT_ID(N'dbo.SocialEvents'))
    CREATE INDEX IX_SocialEvents_Channel_ProcessedAt ON dbo.SocialEvents (Channel, ProcessedAt DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LeadSourceAttribution_Lead' AND object_id = OBJECT_ID(N'dbo.LeadSourceAttribution'))
    CREATE INDEX IX_LeadSourceAttribution_Lead ON dbo.LeadSourceAttribution (LeadId, LastInteractionAt DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_SocialListenerErrors_Channel_OccurredAt' AND object_id = OBJECT_ID(N'dbo.SocialListenerErrors'))
    CREATE INDEX IX_SocialListenerErrors_Channel_OccurredAt ON dbo.SocialListenerErrors (Channel, OccurredAt DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_SocialMetrics_Channel_MeasuredAt' AND object_id = OBJECT_ID(N'dbo.SocialMetrics'))
    CREATE INDEX IX_SocialMetrics_Channel_MeasuredAt ON dbo.SocialMetrics (Channel, MeasuredAt DESC);
GO

CREATE OR ALTER PROCEDURE dbo.SocialListenerStatus_Upsert
    @Channel NVARCHAR(32),
    @IsConfigured BIT,
    @Status NVARCHAR(32),
    @ExternalAccountId NVARCHAR(255) = NULL,
    @DisplayName NVARCHAR(255) = NULL,
    @CheckedAt DATETIME2(3),
    @LastError NVARCHAR(1000) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.SocialChannelConnections
    SET IsConfigured = @IsConfigured,
        Status = @Status,
        ExternalAccountId = @ExternalAccountId,
        DisplayName = @DisplayName,
        LastValidatedAt = @CheckedAt,
        LastSuccessfulCheck = CASE WHEN @Status = N'connected' THEN @CheckedAt ELSE LastSuccessfulCheck END,
        LastError = @LastError,
        UpdatedAt = SYSUTCDATETIME()
    WHERE Channel = @Channel;

    IF @@ROWCOUNT = 0
        INSERT dbo.SocialChannelConnections
            (Channel, IsConfigured, Status, ExternalAccountId, DisplayName, LastValidatedAt, LastSuccessfulCheck, LastError)
        VALUES
            (@Channel, @IsConfigured, @Status, @ExternalAccountId, @DisplayName, @CheckedAt,
             CASE WHEN @Status = N'connected' THEN @CheckedAt END, @LastError);

    UPDATE dbo.SocialListenerStatus
    SET Status = @Status,
        LastSuccessfulCheck = CASE WHEN @Status = N'connected' THEN @CheckedAt ELSE LastSuccessfulCheck END,
        LastError = @LastError,
        UpdatedAt = SYSUTCDATETIME()
    WHERE Channel = @Channel;

    IF @@ROWCOUNT = 0
        INSERT dbo.SocialListenerStatus (Channel, Status, LastSuccessfulCheck, LastError)
        VALUES (@Channel, @Status, CASE WHEN @Status = N'connected' THEN @CheckedAt END, @LastError);

    UPDATE dbo.SocialChannelConfigurations
    SET Status = @Status,
        LastTestedAt = @CheckedAt,
        LastSuccessAt = CASE WHEN @Status = N'connected' THEN @CheckedAt ELSE LastSuccessAt END,
        LastErrorAt = CASE WHEN @Status = N'connected' THEN NULL ELSE @CheckedAt END,
        LastError = @LastError,
        UpdatedAt = SYSUTCDATETIME()
    WHERE Channel = @Channel;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialListenerError_Insert
    @Channel NVARCHAR(32),
    @Operation NVARCHAR(100),
    @ErrorCode NVARCHAR(100) = NULL,
    @SafeMessage NVARCHAR(1000),
    @IsTransient BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    INSERT dbo.SocialListenerErrors (Channel, Operation, ErrorCode, SafeMessage, IsTransient)
    VALUES (@Channel, @Operation, @ErrorCode, @SafeMessage, @IsTransient);
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialMetric_Upsert
    @Channel NVARCHAR(32),
    @MetricName NVARCHAR(255),
    @MetricValue DECIMAL(19,4) = NULL,
    @MetricPayload NVARCHAR(MAX) = NULL,
    @MeasuredAt DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    INSERT dbo.SocialMetrics (Channel, MetricName, MetricValue, MetricPayload, MeasuredAt)
    VALUES (@Channel, @MetricName, @MetricValue, @MetricPayload, @MeasuredAt);

    UPDATE dbo.SocialListenerStatus
    SET LastMetricAt = @MeasuredAt, UpdatedAt = SYSUTCDATETIME()
    WHERE Channel = @Channel;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialListenerStatus_GetAll
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Channel, Status, LastSuccessfulCheck, LastReceivedEvent, LastMetricAt,
           LastError, EventsProcessed, LeadsGenerated, UpdatedAt
    FROM dbo.SocialListenerStatus
    ORDER BY Channel;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialLead_Create
    @Name NVARCHAR(255),
    @Email NVARCHAR(320),
    @Phone NVARCHAR(80) = NULL,
    @Facebook NVARCHAR(500) = NULL,
    @Instagram NVARCHAR(500) = NULL,
    @X NVARCHAR(500) = NULL,
    @Source NVARCHAR(100) = N'Manual',
    @EstimatedValue DECIMAL(19,4) = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @LeadId BIGINT;

    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT TOP (1) @LeadId = LeadId
        FROM dbo.Leads WITH (UPDLOCK, HOLDLOCK)
        WHERE Email = @Email
        ORDER BY LeadId;

        IF @LeadId IS NULL
        BEGIN
            INSERT dbo.Leads
                (Name, Email, Phone, SocialUsername, Facebook, Instagram, [X], [Source], EstimatedValue, Status)
            VALUES
                (@Name, @Email, @Phone, COALESCE(@Instagram, @Facebook, @X),
                 @Facebook, @Instagram, @X, @Source, @EstimatedValue, N'New');
            SET @LeadId = SCOPE_IDENTITY();
        END
        ELSE
        BEGIN
            UPDATE dbo.Leads
            SET Name = @Name,
                Phone = @Phone,
                SocialUsername = COALESCE(@Instagram, @Facebook, @X),
                Facebook = @Facebook,
                Instagram = @Instagram,
                [X] = @X,
                [Source] = @Source,
                EstimatedValue = @EstimatedValue,
                UpdatedAt = SYSUTCDATETIME()
            WHERE LeadId = @LeadId;
        END;
        COMMIT TRANSACTION;

        SELECT LeadId, Name, Email, Phone, SocialUsername, Facebook, Instagram, [X],
               COALESCE(NULLIF([Source], N''), N'Manual') AS SourceChannel,
               Status, EstimatedValue AS Value, CreatedAt
        FROM dbo.Leads WHERE LeadId = @LeadId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialLead_Update
    @LeadId BIGINT,
    @Name NVARCHAR(255),
    @Email NVARCHAR(320),
    @Phone NVARCHAR(80) = NULL,
    @Facebook NVARCHAR(500) = NULL,
    @Instagram NVARCHAR(500) = NULL,
    @X NVARCHAR(500) = NULL,
    @Source NVARCHAR(100) = N'Manual',
    @EstimatedValue DECIMAL(19,4) = 0
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.Leads
    SET Name = @Name,
        Email = @Email,
        Phone = @Phone,
        SocialUsername = COALESCE(@Instagram, @Facebook, @X),
        Facebook = @Facebook,
        Instagram = @Instagram,
        [X] = @X,
        [Source] = @Source,
        EstimatedValue = @EstimatedValue,
        UpdatedAt = SYSUTCDATETIME()
    WHERE LeadId = @LeadId;

    IF @@ROWCOUNT > 0
        SELECT LeadId, Name, Email, Phone, SocialUsername, Facebook, Instagram, [X],
               COALESCE(NULLIF([Source], N''), N'Manual') AS SourceChannel,
               Status, EstimatedValue AS Value, CreatedAt
        FROM dbo.Leads WHERE LeadId = @LeadId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialLead_GetRecent
    @Limit INT = 100
AS
BEGIN
    SET NOCOUNT ON;
    SET @Limit = CASE WHEN @Limit < 1 THEN 1 WHEN @Limit > 500 THEN 500 ELSE @Limit END;

    SELECT TOP (@Limit)
        l.LeadId,
        l.Name,
        l.Email,
        l.Phone,
        COALESCE(l.SocialUsername, l.Instagram, l.Facebook, l.[X], source.SocialUsername) AS SocialUsername,
        l.Facebook,
        l.Instagram,
        l.[X],
        COALESCE(NULLIF(l.[Source], N''), source.SourceChannel,
                 CASE WHEN l.Instagram IS NOT NULL THEN N'instagram'
                      WHEN l.Facebook IS NOT NULL THEN N'facebook'
                      WHEN l.[X] IS NOT NULL THEN N'x'
                      ELSE N'Manual' END) AS SourceChannel,
        l.Status,
        l.EstimatedValue AS Value,
        l.CreatedAt
    FROM dbo.Leads l
    OUTER APPLY
    (
        SELECT TOP (1) a.SourceChannel, a.SocialUsername
        FROM dbo.LeadSourceAttribution a
        WHERE a.LeadId = l.LeadId
        ORDER BY a.LastInteractionAt DESC, a.AttributionId DESC
    ) source
    ORDER BY l.UpdatedAt DESC, l.LeadId DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialLead_UpdateStatus
    @LeadId BIGINT,
    @Status NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;
    IF @Status NOT IN (N'New', N'Engaged', N'Hot', N'Registered', N'Customer')
        THROW 50001, 'Unsupported lead status.', 1;

    UPDATE dbo.Leads
    SET Status = @Status, UpdatedAt = SYSUTCDATETIME()
    WHERE LeadId = @LeadId;

    IF @@ROWCOUNT > 0
        SELECT LeadId, Status, UpdatedAt FROM dbo.Leads WHERE LeadId = @LeadId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialEvent_Process
    @Channel NVARCHAR(32),
    @ExternalEventId NVARCHAR(255),
    @EventType NVARCHAR(100),
    @ExternalUserId NVARCHAR(255) = NULL,
    @Username NVARCHAR(255) = NULL,
    @DisplayName NVARCHAR(255) = NULL,
    @Email NVARCHAR(320) = NULL,
    @Phone NVARCHAR(80) = NULL,
    @Message NVARCHAR(MAX) = NULL,
    @PostId NVARCHAR(255) = NULL,
    @CampaignId NVARCHAR(255) = NULL,
    @AdId NVARCHAR(255) = NULL,
    @SourceUrl NVARCHAR(2048) = NULL,
    @OccurredAt DATETIME2(3),
    @RawPayload NVARCHAR(MAX),
    @Qualified BIT,
    @LeadName NVARCHAR(255) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @SocialEventId BIGINT;
    DECLARE @LeadId BIGINT;
    DECLARE @LeadCreated BIT = 0;
    DECLARE @LeadUpdated BIT = 0;

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @SocialEventId = SocialEventId
        FROM dbo.SocialEvents WITH (UPDLOCK, HOLDLOCK)
        WHERE Channel = @Channel AND ExternalEventId = @ExternalEventId;

        IF @SocialEventId IS NOT NULL
        BEGIN
            COMMIT TRANSACTION;
            SELECT CAST(1 AS BIT) AS Duplicate, CAST(0 AS BIT) AS LeadCreated,
                   CAST(0 AS BIT) AS LeadUpdated, CAST(NULL AS BIGINT) AS LeadId,
                   @SocialEventId AS SocialEventId;
            RETURN;
        END;

        INSERT dbo.SocialEvents
            (Channel, ExternalEventId, EventType, ExternalUserId, Username, DisplayName,
             Email, Phone, Message, PostId, CampaignId, AdId, SourceUrl, OccurredAt, RawPayload)
        VALUES
            (@Channel, @ExternalEventId, @EventType, @ExternalUserId, @Username, @DisplayName,
             @Email, @Phone, @Message, @PostId, @CampaignId, @AdId, @SourceUrl, @OccurredAt, @RawPayload);

        SET @SocialEventId = SCOPE_IDENTITY();

        IF @Qualified = 1
        BEGIN
            SELECT TOP (1) @LeadId = LeadId
            FROM dbo.Leads WITH (UPDLOCK, HOLDLOCK)
            WHERE (@Email IS NOT NULL AND Email = @Email)
               OR (@Phone IS NOT NULL AND Phone = @Phone)
               OR EXISTS
                  (SELECT 1 FROM dbo.LeadSourceAttribution a
                   WHERE a.LeadId = dbo.Leads.LeadId
                     AND a.SourceChannel = @Channel
                     AND @ExternalUserId IS NOT NULL
                     AND a.ExternalUserId = @ExternalUserId)
            ORDER BY LeadId;

            IF @LeadId IS NULL
            BEGIN
                INSERT dbo.Leads
                    (Name, Email, Phone, SocialUsername, Facebook, Instagram, [X], [Source], Status)
                VALUES
                    (COALESCE(NULLIF(@LeadName, N''), NULLIF(@DisplayName, N''), NULLIF(@Username, N''), N'Social prospect'),
                     @Email, @Phone, @Username,
                     CASE WHEN @Channel = N'facebook' THEN @Username END,
                     CASE WHEN @Channel = N'instagram' THEN @Username END,
                     CASE WHEN @Channel = N'x' THEN @Username END,
                     @Channel, N'New');
                SET @LeadId = SCOPE_IDENTITY();
                SET @LeadCreated = 1;
            END
            ELSE
            BEGIN
                UPDATE dbo.Leads
                SET Name = COALESCE(NULLIF(@LeadName, N''), Name),
                    Email = COALESCE(NULLIF(@Email, N''), Email),
                    Phone = COALESCE(NULLIF(@Phone, N''), Phone),
                    SocialUsername = COALESCE(NULLIF(@Username, N''), SocialUsername),
                    Facebook = CASE WHEN @Channel = N'facebook' THEN COALESCE(NULLIF(@Username, N''), Facebook) ELSE Facebook END,
                    Instagram = CASE WHEN @Channel = N'instagram' THEN COALESCE(NULLIF(@Username, N''), Instagram) ELSE Instagram END,
                    [X] = CASE WHEN @Channel = N'x' THEN COALESCE(NULLIF(@Username, N''), [X]) ELSE [X] END,
                    [Source] = COALESCE(NULLIF([Source], N''), @Channel),
                    UpdatedAt = SYSUTCDATETIME()
                WHERE LeadId = @LeadId;
                SET @LeadUpdated = 1;
            END;

            INSERT dbo.LeadSourceAttribution
                (LeadId, SocialEventId, SourceChannel, ExternalUserId, SocialUsername,
                 CampaignId, AdId, PostId, ExternalEventId, FirstTouchAt, LastInteractionAt)
            VALUES
                (@LeadId, @SocialEventId, @Channel, @ExternalUserId, @Username,
                 @CampaignId, @AdId, @PostId, @ExternalEventId, @OccurredAt, @OccurredAt);
        END;

        UPDATE dbo.SocialListenerStatus
        SET LastReceivedEvent = @OccurredAt,
            EventsProcessed = EventsProcessed + 1,
            LeadsGenerated = LeadsGenerated + CASE WHEN @LeadCreated = 1 THEN 1 ELSE 0 END,
            UpdatedAt = SYSUTCDATETIME()
        WHERE Channel = @Channel;

        IF @@ROWCOUNT = 0
            INSERT dbo.SocialListenerStatus
                (Channel, Status, LastReceivedEvent, EventsProcessed, LeadsGenerated)
            VALUES
                (@Channel, N'disconnected', @OccurredAt, 1, CASE WHEN @LeadCreated = 1 THEN 1 ELSE 0 END);

        COMMIT TRANSACTION;
        SELECT CAST(0 AS BIT) AS Duplicate, @LeadCreated AS LeadCreated,
               @LeadUpdated AS LeadUpdated, @LeadId AS LeadId, @SocialEventId AS SocialEventId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO
