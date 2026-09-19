IF OBJECT_ID(N'dbo.AIAcquisitionConfigurations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AIAcquisitionConfigurations
    (
        AIAcquisitionConfigurationId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AIAcquisitionConfigurations PRIMARY KEY,
        AcquisitionName NVARCHAR(255) NOT NULL,
        Objective NVARCHAR(2000) NOT NULL,
        CompanyProfileId INT NOT NULL CONSTRAINT DF_AIAcquisitionConfigurations_CompanyProfile DEFAULT 1,
        ProductOrService NVARCHAR(1000) NOT NULL,
        TargetIndustry NVARCHAR(500) NULL,
        TargetCustomerType NVARCHAR(500) NULL,
        TargetLocation NVARCHAR(500) NULL,
        Keywords NVARCHAR(2000) NULL,
        BusinessSize NVARCHAR(255) NULL,
        StartDate DATE NULL,
        EndDate DATE NULL,
        DailyProspectLimit INT NOT NULL CONSTRAINT DF_AIAcquisitionConfigurations_DailyLimit DEFAULT 50,
        AutomaticOutreachEnabled BIT NOT NULL CONSTRAINT DF_AIAcquisitionConfigurations_AutoOutreach DEFAULT 0,
        AIProviderConfigurationId BIGINT NOT NULL,
        FallbackProviderConfigurationId BIGINT NULL,
        MinimumProspectFitScore INT NOT NULL CONSTRAINT DF_AIAcquisitionConfigurations_MinFit DEFAULT 50,
        QualificationQuestionsJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_AIAcquisitionConfigurations_Questions DEFAULT N'[]',
        LandingPageOrCTA NVARCHAR(2048) NULL,
        HumanHandoffRulesJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_AIAcquisitionConfigurations_Handoff DEFAULT N'{}',
        FollowUpRulesJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_AIAcquisitionConfigurations_FollowUp DEFAULT N'{}',
        ConversionCriteriaJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_AIAcquisitionConfigurations_Conversion DEFAULT N'{"requireEngagement":true,"allowLandingRegistration":true,"minimumFitScore":0}',
        Status NVARCHAR(32) NOT NULL CONSTRAINT DF_AIAcquisitionConfigurations_Status DEFAULT N'DRAFT',
        LastError NVARCHAR(1000) NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionConfigurations_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionConfigurations_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_AIAcquisitionConfigurations_CompanyProfile FOREIGN KEY (CompanyProfileId) REFERENCES dbo.CompanyProfiles(CompanyProfileId),
        CONSTRAINT FK_AIAcquisitionConfigurations_AIProvider FOREIGN KEY (AIProviderConfigurationId) REFERENCES dbo.AIProviderConfigurations(AIProviderConfigurationId),
        CONSTRAINT FK_AIAcquisitionConfigurations_FallbackProvider FOREIGN KEY (FallbackProviderConfigurationId) REFERENCES dbo.AIProviderConfigurations(AIProviderConfigurationId),
        CONSTRAINT CK_AIAcquisitionConfigurations_Status CHECK (Status IN (N'DRAFT', N'ACTIVE', N'PAUSED', N'COMPLETED', N'STOPPED', N'FAILED')),
        CONSTRAINT CK_AIAcquisitionConfigurations_DailyLimit CHECK (DailyProspectLimit BETWEEN 1 AND 10000),
        CONSTRAINT CK_AIAcquisitionConfigurations_MinFit CHECK (MinimumProspectFitScore BETWEEN 0 AND 100),
        CONSTRAINT CK_AIAcquisitionConfigurations_Dates CHECK (EndDate IS NULL OR StartDate IS NULL OR EndDate >= StartDate),
        CONSTRAINT CK_AIAcquisitionConfigurations_QuestionsJson CHECK (ISJSON(QualificationQuestionsJson) = 1),
        CONSTRAINT CK_AIAcquisitionConfigurations_HandoffJson CHECK (ISJSON(HumanHandoffRulesJson) = 1),
        CONSTRAINT CK_AIAcquisitionConfigurations_FollowUpJson CHECK (ISJSON(FollowUpRulesJson) = 1),
        CONSTRAINT CK_AIAcquisitionConfigurations_ConversionJson CHECK (ISJSON(ConversionCriteriaJson) = 1)
    );
END;
GO

IF OBJECT_ID(N'dbo.AIAcquisitionSearchSources', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AIAcquisitionSearchSources
    (
        AIAcquisitionSearchSourceId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AIAcquisitionSearchSources PRIMARY KEY,
        AIAcquisitionConfigurationId BIGINT NOT NULL,
        SourceCode NVARCHAR(64) NOT NULL,
        Enabled BIT NOT NULL CONSTRAINT DF_AIAcquisitionSearchSources_Enabled DEFAULT 0,
        Priority INT NOT NULL,
        SettingsJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_AIAcquisitionSearchSources_Settings DEFAULT N'{}',
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionSearchSources_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionSearchSources_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_AIAcquisitionSearchSources_Configuration FOREIGN KEY (AIAcquisitionConfigurationId) REFERENCES dbo.AIAcquisitionConfigurations(AIAcquisitionConfigurationId),
        CONSTRAINT UQ_AIAcquisitionSearchSources_Configuration_Source UNIQUE (AIAcquisitionConfigurationId, SourceCode),
        CONSTRAINT CK_AIAcquisitionSearchSources_SettingsJson CHECK (ISJSON(SettingsJson) = 1)
    );
END;
GO

IF OBJECT_ID(N'dbo.AIAcquisitionCommunicationMethods', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AIAcquisitionCommunicationMethods
    (
        AIAcquisitionCommunicationMethodId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AIAcquisitionCommunicationMethods PRIMARY KEY,
        AIAcquisitionConfigurationId BIGINT NOT NULL,
        Channel NVARCHAR(64) NOT NULL,
        Enabled BIT NOT NULL CONSTRAINT DF_AIAcquisitionCommunicationMethods_Enabled DEFAULT 0,
        Priority INT NOT NULL,
        MaximumAttempts INT NOT NULL CONSTRAINT DF_AIAcquisitionCommunicationMethods_MaxAttempts DEFAULT 3,
        RetryDelayMinutes INT NOT NULL CONSTRAINT DF_AIAcquisitionCommunicationMethods_Retry DEFAULT 1440,
        DelayBeforeNextChannelMinutes INT NOT NULL CONSTRAINT DF_AIAcquisitionCommunicationMethods_Delay DEFAULT 1440,
        StopOnResponse BIT NOT NULL CONSTRAINT DF_AIAcquisitionCommunicationMethods_Stop DEFAULT 1,
        AllowSimultaneous BIT NOT NULL CONSTRAINT DF_AIAcquisitionCommunicationMethods_Simultaneous DEFAULT 0,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionCommunicationMethods_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionCommunicationMethods_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_AIAcquisitionCommunicationMethods_Configuration FOREIGN KEY (AIAcquisitionConfigurationId) REFERENCES dbo.AIAcquisitionConfigurations(AIAcquisitionConfigurationId),
        CONSTRAINT UQ_AIAcquisitionCommunicationMethods_Configuration_Channel UNIQUE (AIAcquisitionConfigurationId, Channel),
        CONSTRAINT CK_AIAcquisitionCommunicationMethods_Channel CHECK (Channel IN (N'EMAIL', N'WHATSAPP_BUSINESS', N'INSTAGRAM', N'FACEBOOK', N'SMS', N'MANUAL_HUMAN_FOLLOW_UP')),
        CONSTRAINT CK_AIAcquisitionCommunicationMethods_MaxAttempts CHECK (MaximumAttempts BETWEEN 1 AND 20)
    );
END;
GO

IF OBJECT_ID(N'dbo.AIAcquisitionProspects', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AIAcquisitionProspects
    (
        AIAcquisitionProspectId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AIAcquisitionProspects PRIMARY KEY,
        AIAcquisitionConfigurationId BIGINT NOT NULL,
        IdentityKey CHAR(64) NOT NULL,
        CompanyName NVARCHAR(255) NOT NULL,
        ContactName NVARCHAR(255) NULL,
        Industry NVARCHAR(500) NULL,
        Location NVARCHAR(500) NULL,
        Website NVARCHAR(2048) NULL,
        Email NVARCHAR(320) NULL,
        Phone NVARCHAR(80) NULL,
        WhatsAppNumber NVARCHAR(80) NULL,
        Instagram NVARCHAR(500) NULL,
        Facebook NVARCHAR(500) NULL,
        [X] NVARCHAR(500) NULL,
        [Source] NVARCHAR(64) NOT NULL,
        ExternalSourceId NVARCHAR(255) NULL,
        SourceUrl NVARCHAR(2048) NULL,
        FitScore INT NOT NULL CONSTRAINT DF_AIAcquisitionProspects_Fit DEFAULT 0,
        FitReason NVARCHAR(1000) NULL,
        [Status] NVARCHAR(32) NOT NULL CONSTRAINT DF_AIAcquisitionProspects_Status DEFAULT N'DISCOVERED',
        QualificationJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_AIAcquisitionProspects_Qualification DEFAULT N'{}',
        MetadataJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_AIAcquisitionProspects_Metadata DEFAULT N'{}',
        ConsentStatus NVARCHAR(32) NULL,
        OptedOut BIT NOT NULL CONSTRAINT DF_AIAcquisitionProspects_OptedOut DEFAULT 0,
        Responded BIT NOT NULL CONSTRAINT DF_AIAcquisitionProspects_Responded DEFAULT 0,
        DiscoveredAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionProspects_DiscoveredAt DEFAULT SYSUTCDATETIME(),
        LastContactAt DATETIME2(3) NULL,
        LastResponseAt DATETIME2(3) NULL,
        NextContactAt DATETIME2(3) NULL,
        ConvertedLeadId BIGINT NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionProspects_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionProspects_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_AIAcquisitionProspects_Configuration FOREIGN KEY (AIAcquisitionConfigurationId) REFERENCES dbo.AIAcquisitionConfigurations(AIAcquisitionConfigurationId),
        CONSTRAINT FK_AIAcquisitionProspects_Lead FOREIGN KEY (ConvertedLeadId) REFERENCES dbo.Leads(LeadId),
        CONSTRAINT UQ_AIAcquisitionProspects_Configuration_Identity UNIQUE (AIAcquisitionConfigurationId, IdentityKey),
        CONSTRAINT CK_AIAcquisitionProspects_Fit CHECK (FitScore BETWEEN 0 AND 100),
        CONSTRAINT CK_AIAcquisitionProspects_Status CHECK ([Status] IN (N'DISCOVERED', N'ENRICHING', N'CONTACTABLE', N'CONTACTING', N'CONTACTED', N'ENGAGED', N'QUALIFYING', N'QUALIFIED', N'CONVERSION_READY', N'HUMAN_HANDOFF', N'CONVERTED_TO_LEAD', N'NOT_INTERESTED', N'LOST', N'DO_NOT_CONTACT', N'FAILED')),
        CONSTRAINT CK_AIAcquisitionProspects_QualificationJson CHECK (ISJSON(QualificationJson) = 1),
        CONSTRAINT CK_AIAcquisitionProspects_MetadataJson CHECK (ISJSON(MetadataJson) = 1)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.AIAcquisitionProspects') AND name = N'IX_AIAcquisitionProspects_Status_DiscoveredAt')
    CREATE INDEX IX_AIAcquisitionProspects_Status_DiscoveredAt ON dbo.AIAcquisitionProspects(AIAcquisitionConfigurationId, [Status], DiscoveredAt DESC)
        INCLUDE (CompanyName, [Source], FitScore, ConvertedLeadId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.AIAcquisitionProspects') AND name = N'UX_AIAcquisitionProspects_SourceExternalId')
    CREATE UNIQUE INDEX UX_AIAcquisitionProspects_SourceExternalId ON dbo.AIAcquisitionProspects(AIAcquisitionConfigurationId, [Source], ExternalSourceId)
        WHERE ExternalSourceId IS NOT NULL;
GO

IF OBJECT_ID(N'dbo.AIAcquisitionProspectContacts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AIAcquisitionProspectContacts
    (
        AIAcquisitionProspectContactId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AIAcquisitionProspectContacts PRIMARY KEY,
        AIAcquisitionProspectId BIGINT NOT NULL,
        ContactType NVARCHAR(64) NOT NULL,
        ContactValue NVARCHAR(2048) NOT NULL,
        SourceName NVARCHAR(255) NOT NULL,
        SourceUrl NVARCHAR(2048) NULL,
        Verified BIT NOT NULL CONSTRAINT DF_AIAcquisitionProspectContacts_Verified DEFAULT 0,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionProspectContacts_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionProspectContacts_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_AIAcquisitionProspectContacts_Prospect FOREIGN KEY (AIAcquisitionProspectId) REFERENCES dbo.AIAcquisitionProspects(AIAcquisitionProspectId),
        CONSTRAINT UQ_AIAcquisitionProspectContacts_Value UNIQUE (AIAcquisitionProspectId, ContactType, ContactValue)
    );
END;
GO

IF OBJECT_ID(N'dbo.AIAcquisitionConversations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AIAcquisitionConversations
    (
        AIAcquisitionConversationId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AIAcquisitionConversations PRIMARY KEY,
        AIAcquisitionConfigurationId BIGINT NOT NULL,
        AIAcquisitionProspectId BIGINT NOT NULL,
        LeadId BIGINT NULL,
        Channel NVARCHAR(64) NOT NULL,
        Direction NVARCHAR(16) NOT NULL,
        Message NVARCHAR(MAX) NOT NULL,
        OriginAIOrHuman NVARCHAR(32) NOT NULL,
        AIProviderConfigurationId BIGINT NULL,
        AIModel NVARCHAR(255) NULL,
        DeliveryStatus NVARCHAR(32) NOT NULL,
        ExternalMessageId NVARCHAR(255) NULL,
        DecisionJson NVARCHAR(MAX) NULL,
        OccurredAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionConversations_OccurredAt DEFAULT SYSUTCDATETIME(),
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionConversations_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_AIAcquisitionConversations_Configuration FOREIGN KEY (AIAcquisitionConfigurationId) REFERENCES dbo.AIAcquisitionConfigurations(AIAcquisitionConfigurationId),
        CONSTRAINT FK_AIAcquisitionConversations_Prospect FOREIGN KEY (AIAcquisitionProspectId) REFERENCES dbo.AIAcquisitionProspects(AIAcquisitionProspectId),
        CONSTRAINT FK_AIAcquisitionConversations_Lead FOREIGN KEY (LeadId) REFERENCES dbo.Leads(LeadId),
        CONSTRAINT FK_AIAcquisitionConversations_AIProvider FOREIGN KEY (AIProviderConfigurationId) REFERENCES dbo.AIProviderConfigurations(AIProviderConfigurationId),
        CONSTRAINT CK_AIAcquisitionConversations_Direction CHECK (Direction IN (N'INBOUND', N'OUTBOUND')),
        CONSTRAINT CK_AIAcquisitionConversations_DecisionJson CHECK (DecisionJson IS NULL OR ISJSON(DecisionJson) = 1)
    );
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.AIAcquisitionConversations') AND name = N'UX_AIAcquisitionConversations_ExternalMessage')
    CREATE UNIQUE INDEX UX_AIAcquisitionConversations_ExternalMessage ON dbo.AIAcquisitionConversations(Channel, ExternalMessageId)
        WHERE ExternalMessageId IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.AIAcquisitionConversations') AND name = N'IX_AIAcquisitionConversations_Prospect_OccurredAt')
    CREATE INDEX IX_AIAcquisitionConversations_Prospect_OccurredAt ON dbo.AIAcquisitionConversations(AIAcquisitionProspectId, OccurredAt DESC);
GO

IF OBJECT_ID(N'dbo.AIAcquisitionContactAttempts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AIAcquisitionContactAttempts
    (
        AIAcquisitionContactAttemptId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AIAcquisitionContactAttempts PRIMARY KEY,
        AIAcquisitionConfigurationId BIGINT NOT NULL,
        AIAcquisitionProspectId BIGINT NOT NULL,
        Channel NVARCHAR(64) NOT NULL,
        ContactValue NVARCHAR(2048) NOT NULL,
        Message NVARCHAR(MAX) NULL,
        OriginAIOrHuman NVARCHAR(32) NOT NULL CONSTRAINT DF_AIAcquisitionContactAttempts_Origin DEFAULT N'HUMAN',
        IsReply BIT NOT NULL CONSTRAINT DF_AIAcquisitionContactAttempts_IsReply DEFAULT 0,
        IdempotencyKey NVARCHAR(255) NOT NULL,
        [Status] NVARCHAR(32) NOT NULL,
        AttemptCount INT NOT NULL CONSTRAINT DF_AIAcquisitionContactAttempts_AttemptCount DEFAULT 0,
        NextAttemptAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionContactAttempts_NextAttempt DEFAULT SYSUTCDATETIME(),
        LockToken UNIQUEIDENTIFIER NULL,
        LockedAt DATETIME2(3) NULL,
        ExternalMessageId NVARCHAR(255) NULL,
        AttemptedAt DATETIME2(3) NULL,
        LastError NVARCHAR(1000) NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionContactAttempts_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionContactAttempts_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_AIAcquisitionContactAttempts_Configuration FOREIGN KEY (AIAcquisitionConfigurationId) REFERENCES dbo.AIAcquisitionConfigurations(AIAcquisitionConfigurationId),
        CONSTRAINT FK_AIAcquisitionContactAttempts_Prospect FOREIGN KEY (AIAcquisitionProspectId) REFERENCES dbo.AIAcquisitionProspects(AIAcquisitionProspectId),
        CONSTRAINT UQ_AIAcquisitionContactAttempts_Idempotency UNIQUE (IdempotencyKey)
    );
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.AIAcquisitionContactAttempts') AND name=N'IX_AIAcquisitionContactAttempts_Due')
    CREATE INDEX IX_AIAcquisitionContactAttempts_Due ON dbo.AIAcquisitionContactAttempts([Status],NextAttemptAt,AIAcquisitionContactAttemptId)
        INCLUDE (AIAcquisitionProspectId,AIAcquisitionConfigurationId,Channel,LockedAt,AttemptCount);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.AIAcquisitionContactAttempts') AND name=N'IX_AIAcquisitionContactAttempts_Prospect')
    CREATE INDEX IX_AIAcquisitionContactAttempts_Prospect ON dbo.AIAcquisitionContactAttempts(AIAcquisitionProspectId,CreatedAt DESC);
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionConfiguration_Save
    @AIAcquisitionConfigurationId BIGINT = NULL,
    @AcquisitionName NVARCHAR(255), @Objective NVARCHAR(2000), @CompanyProfileId INT,
    @ProductOrService NVARCHAR(1000), @TargetIndustry NVARCHAR(500) = NULL,
    @TargetCustomerType NVARCHAR(500) = NULL, @TargetLocation NVARCHAR(500) = NULL,
    @Keywords NVARCHAR(2000) = NULL, @BusinessSize NVARCHAR(255) = NULL,
    @StartDate DATE = NULL, @EndDate DATE = NULL, @DailyProspectLimit INT, @AutomaticOutreachEnabled BIT,
    @AIProviderConfigurationId BIGINT, @FallbackProviderConfigurationId BIGINT = NULL,
    @MinimumProspectFitScore INT, @QualificationQuestionsJson NVARCHAR(MAX),
    @LandingPageOrCTA NVARCHAR(2048) = NULL, @HumanHandoffRulesJson NVARCHAR(MAX),
    @FollowUpRulesJson NVARCHAR(MAX), @ConversionCriteriaJson NVARCHAR(MAX), @Status NVARCHAR(32),
    @SearchSourcesJson NVARCHAR(MAX), @CommunicationMethodsJson NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF ISJSON(@QualificationQuestionsJson) <> 1 OR ISJSON(@HumanHandoffRulesJson) <> 1 OR
       ISJSON(@FollowUpRulesJson) <> 1 OR ISJSON(@ConversionCriteriaJson) <> 1 OR ISJSON(@SearchSourcesJson) <> 1 OR ISJSON(@CommunicationMethodsJson) <> 1
        THROW 52601, 'AI Acquisition configuration JSON is invalid.', 1;
    BEGIN TRANSACTION;
    BEGIN TRY
        IF @AIAcquisitionConfigurationId IS NULL
        BEGIN
            INSERT dbo.AIAcquisitionConfigurations
                (AcquisitionName, Objective, CompanyProfileId, ProductOrService, TargetIndustry, TargetCustomerType,
                 TargetLocation, Keywords, BusinessSize, StartDate, EndDate, DailyProspectLimit, AutomaticOutreachEnabled,
                 AIProviderConfigurationId, FallbackProviderConfigurationId, MinimumProspectFitScore,
                 QualificationQuestionsJson, LandingPageOrCTA, HumanHandoffRulesJson, FollowUpRulesJson, ConversionCriteriaJson, Status)
            VALUES
                (@AcquisitionName, @Objective, @CompanyProfileId, @ProductOrService, @TargetIndustry, @TargetCustomerType,
                 @TargetLocation, @Keywords, @BusinessSize, @StartDate, @EndDate, @DailyProspectLimit, @AutomaticOutreachEnabled,
                 @AIProviderConfigurationId, @FallbackProviderConfigurationId, @MinimumProspectFitScore,
                 @QualificationQuestionsJson, @LandingPageOrCTA, @HumanHandoffRulesJson, @FollowUpRulesJson, @ConversionCriteriaJson, @Status);
            SET @AIAcquisitionConfigurationId = SCOPE_IDENTITY();
        END
        ELSE
        BEGIN
            UPDATE dbo.AIAcquisitionConfigurations SET
                AcquisitionName=@AcquisitionName, Objective=@Objective, CompanyProfileId=@CompanyProfileId,
                ProductOrService=@ProductOrService, TargetIndustry=@TargetIndustry, TargetCustomerType=@TargetCustomerType,
                TargetLocation=@TargetLocation, Keywords=@Keywords, BusinessSize=@BusinessSize, StartDate=@StartDate,
                EndDate=@EndDate, DailyProspectLimit=@DailyProspectLimit, AutomaticOutreachEnabled=@AutomaticOutreachEnabled,
                AIProviderConfigurationId=@AIProviderConfigurationId,
                FallbackProviderConfigurationId=@FallbackProviderConfigurationId, MinimumProspectFitScore=@MinimumProspectFitScore,
                QualificationQuestionsJson=@QualificationQuestionsJson, LandingPageOrCTA=@LandingPageOrCTA,
                HumanHandoffRulesJson=@HumanHandoffRulesJson, FollowUpRulesJson=@FollowUpRulesJson,
                ConversionCriteriaJson=@ConversionCriteriaJson, UpdatedAt=SYSUTCDATETIME()
            WHERE AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId;
            IF @@ROWCOUNT = 0 THROW 52602, 'AI Acquisition configuration was not found.', 1;
        END;

        IF @AutomaticOutreachEnabled=0
            UPDATE dbo.AIAcquisitionContactAttempts SET [Status]=N'CANCELLED',LockToken=NULL,LockedAt=NULL,
                LastError=N'Automatic outreach disabled.',UpdatedAt=SYSUTCDATETIME()
            WHERE AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId AND
                  IdempotencyKey LIKE N'acquisition:auto:%' AND [Status] IN (N'QUEUED',N'RETRY');

        MERGE dbo.AIAcquisitionSearchSources AS target
        USING
        (
            SELECT @AIAcquisitionConfigurationId AIAcquisitionConfigurationId, SourceCode, Enabled, Priority, SettingsJson
            FROM OPENJSON(@SearchSourcesJson) WITH
            (SourceCode NVARCHAR(64) '$.sourceCode', Enabled BIT '$.enabled', Priority INT '$.priority', SettingsJson NVARCHAR(MAX) '$.settings' AS JSON)
        ) AS source
        ON target.AIAcquisitionConfigurationId=source.AIAcquisitionConfigurationId AND target.SourceCode=source.SourceCode
        WHEN MATCHED THEN UPDATE SET Enabled=source.Enabled, Priority=source.Priority,
            SettingsJson=COALESCE(source.SettingsJson,N'{}'), UpdatedAt=SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (AIAcquisitionConfigurationId,SourceCode,Enabled,Priority,SettingsJson)
            VALUES(source.AIAcquisitionConfigurationId,source.SourceCode,source.Enabled,source.Priority,COALESCE(source.SettingsJson,N'{}'))
        WHEN NOT MATCHED BY SOURCE AND target.AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId THEN DELETE;

        MERGE dbo.AIAcquisitionCommunicationMethods AS target
        USING
        (
            SELECT @AIAcquisitionConfigurationId AIAcquisitionConfigurationId, Channel, Enabled, Priority,
                MaximumAttempts, RetryDelayMinutes, DelayBeforeNextChannelMinutes, StopOnResponse, AllowSimultaneous
            FROM OPENJSON(@CommunicationMethodsJson) WITH
            (Channel NVARCHAR(64) '$.channel', Enabled BIT '$.enabled', Priority INT '$.priority',
             MaximumAttempts INT '$.maximumAttempts', RetryDelayMinutes INT '$.retryDelayMinutes',
             DelayBeforeNextChannelMinutes INT '$.delayBeforeNextChannelMinutes', StopOnResponse BIT '$.stopOnResponse',
             AllowSimultaneous BIT '$.allowSimultaneous')
        ) AS source
        ON target.AIAcquisitionConfigurationId=source.AIAcquisitionConfigurationId AND target.Channel=source.Channel
        WHEN MATCHED THEN UPDATE SET Enabled=source.Enabled, Priority=source.Priority, MaximumAttempts=source.MaximumAttempts,
            RetryDelayMinutes=source.RetryDelayMinutes, DelayBeforeNextChannelMinutes=source.DelayBeforeNextChannelMinutes,
            StopOnResponse=source.StopOnResponse, AllowSimultaneous=source.AllowSimultaneous, UpdatedAt=SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (AIAcquisitionConfigurationId,Channel,Enabled,Priority,MaximumAttempts,
            RetryDelayMinutes,DelayBeforeNextChannelMinutes,StopOnResponse,AllowSimultaneous)
            VALUES(source.AIAcquisitionConfigurationId,source.Channel,source.Enabled,source.Priority,source.MaximumAttempts,
            source.RetryDelayMinutes,source.DelayBeforeNextChannelMinutes,source.StopOnResponse,source.AllowSimultaneous)
        WHEN NOT MATCHED BY SOURCE AND target.AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId THEN DELETE;
        COMMIT TRANSACTION;
        SELECT @AIAcquisitionConfigurationId AIAcquisitionConfigurationId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionConfiguration_Get @AIAcquisitionConfigurationId BIGINT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT configuration.*, provider.ProviderCode, provider.ProviderName,
        fallback.ProviderCode FallbackProviderCode, fallback.ProviderName FallbackProviderName
    FROM dbo.AIAcquisitionConfigurations configuration
    JOIN dbo.AIProviderConfigurations provider ON provider.AIProviderConfigurationId=configuration.AIProviderConfigurationId
    LEFT JOIN dbo.AIProviderConfigurations fallback ON fallback.AIProviderConfigurationId=configuration.FallbackProviderConfigurationId
    WHERE @AIAcquisitionConfigurationId IS NULL OR configuration.AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId
    ORDER BY configuration.CreatedAt DESC, configuration.AIAcquisitionConfigurationId DESC;
    SELECT source.* FROM dbo.AIAcquisitionSearchSources source
    WHERE @AIAcquisitionConfigurationId IS NULL OR source.AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId
    ORDER BY source.AIAcquisitionConfigurationId, source.Priority, source.AIAcquisitionSearchSourceId;
    SELECT method.* FROM dbo.AIAcquisitionCommunicationMethods method
    WHERE @AIAcquisitionConfigurationId IS NULL OR method.AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId
    ORDER BY method.AIAcquisitionConfigurationId, method.Priority, method.AIAcquisitionCommunicationMethodId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionConfiguration_SetStatus
    @AIAcquisitionConfigurationId BIGINT, @Status NVARCHAR(32), @LastError NVARCHAR(1000) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.AIAcquisitionConfigurations SET Status=@Status, LastError=@LastError, UpdatedAt=SYSUTCDATETIME()
    WHERE AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId;
    IF @@ROWCOUNT = 0 THROW 52602, 'AI Acquisition configuration was not found.', 1;
    EXEC dbo.AIAcquisitionConfiguration_Get @AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionProspect_Upsert
    @AIAcquisitionConfigurationId BIGINT, @IdentityKey CHAR(64), @CompanyName NVARCHAR(255),
    @ContactName NVARCHAR(255)=NULL, @Industry NVARCHAR(500)=NULL, @Location NVARCHAR(500)=NULL,
    @Website NVARCHAR(2048)=NULL, @Email NVARCHAR(320)=NULL, @Phone NVARCHAR(80)=NULL,
    @WhatsAppNumber NVARCHAR(80)=NULL, @Instagram NVARCHAR(500)=NULL, @Facebook NVARCHAR(500)=NULL,
    @X NVARCHAR(500)=NULL, @Source NVARCHAR(64), @ExternalSourceId NVARCHAR(255)=NULL,
    @SourceUrl NVARCHAR(2048)=NULL, @FitScore INT, @FitReason NVARCHAR(1000)=NULL,
    @Status NVARCHAR(32), @ConsentStatus NVARCHAR(32), @OptedOut BIT,
    @MetadataJson NVARCHAR(MAX), @ContactsJson NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF ISJSON(@MetadataJson) <> 1 OR ISJSON(@ContactsJson) <> 1 THROW 52603, 'Prospect JSON is invalid.', 1;
    DECLARE @ProspectId BIGINT, @Inserted BIT=0;
    BEGIN TRANSACTION;
    BEGIN TRY
        SELECT @ProspectId=AIAcquisitionProspectId FROM dbo.AIAcquisitionProspects WITH (UPDLOCK,HOLDLOCK)
        WHERE AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId AND IdentityKey=@IdentityKey;
        IF @ProspectId IS NULL
        BEGIN
            INSERT dbo.AIAcquisitionProspects
                (AIAcquisitionConfigurationId,IdentityKey,CompanyName,ContactName,Industry,Location,Website,Email,Phone,
                 WhatsAppNumber,Instagram,Facebook,[X],[Source],ExternalSourceId,SourceUrl,FitScore,FitReason,[Status],ConsentStatus,OptedOut,MetadataJson)
            VALUES
                (@AIAcquisitionConfigurationId,@IdentityKey,@CompanyName,@ContactName,@Industry,@Location,@Website,@Email,@Phone,
                 @WhatsAppNumber,@Instagram,@Facebook,@X,@Source,@ExternalSourceId,@SourceUrl,@FitScore,@FitReason,@Status,@ConsentStatus,@OptedOut,@MetadataJson);
            SET @ProspectId=SCOPE_IDENTITY();
            SET @Inserted=1;
        END
        ELSE
            UPDATE dbo.AIAcquisitionProspects SET CompanyName=@CompanyName,
                ContactName=COALESCE(NULLIF(@ContactName,N''),ContactName), Industry=COALESCE(NULLIF(@Industry,N''),Industry),
                Location=COALESCE(NULLIF(@Location,N''),Location), Website=COALESCE(NULLIF(@Website,N''),Website),
                Email=COALESCE(NULLIF(@Email,N''),Email), Phone=COALESCE(NULLIF(@Phone,N''),Phone),
                WhatsAppNumber=COALESCE(NULLIF(@WhatsAppNumber,N''),WhatsAppNumber), Instagram=COALESCE(NULLIF(@Instagram,N''),Instagram),
                Facebook=COALESCE(NULLIF(@Facebook,N''),Facebook), [X]=COALESCE(NULLIF(@X,N''),[X]),
                ExternalSourceId=COALESCE(NULLIF(@ExternalSourceId,N''),ExternalSourceId), SourceUrl=COALESCE(NULLIF(@SourceUrl,N''),SourceUrl),
                FitScore=@FitScore, FitReason=@FitReason, MetadataJson=@MetadataJson,
                ConsentStatus=CASE WHEN ConsentStatus IN (N'DENIED',N'REVOKED',N'OPTED_OUT') THEN ConsentStatus ELSE COALESCE(@ConsentStatus,ConsentStatus) END,
                OptedOut=CASE WHEN @OptedOut=1 THEN 1 ELSE OptedOut END,
                [Status]=CASE WHEN @OptedOut=1 THEN N'DO_NOT_CONTACT'
                    WHEN [Status] IN (N'DISCOVERED',N'ENRICHING',N'CONTACTABLE') THEN @Status ELSE [Status] END,
                UpdatedAt=SYSUTCDATETIME()
            WHERE AIAcquisitionProspectId=@ProspectId;

        MERGE dbo.AIAcquisitionProspectContacts AS target
        USING
        (
            SELECT @ProspectId AIAcquisitionProspectId, ContactType, ContactValue, SourceName, SourceUrl, Verified
            FROM OPENJSON(@ContactsJson) WITH
            (ContactType NVARCHAR(64) '$.type', ContactValue NVARCHAR(2048) '$.value', SourceName NVARCHAR(255) '$.source',
             SourceUrl NVARCHAR(2048) '$.sourceUrl', Verified BIT '$.verified')
        ) AS source
        ON target.AIAcquisitionProspectId=source.AIAcquisitionProspectId AND target.ContactType=source.ContactType AND target.ContactValue=source.ContactValue
        WHEN MATCHED THEN UPDATE SET SourceName=source.SourceName, SourceUrl=source.SourceUrl, Verified=source.Verified, UpdatedAt=SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (AIAcquisitionProspectId,ContactType,ContactValue,SourceName,SourceUrl,Verified)
            VALUES(source.AIAcquisitionProspectId,source.ContactType,source.ContactValue,source.SourceName,source.SourceUrl,source.Verified);
        COMMIT TRANSACTION;
        SELECT *, @Inserted Inserted
        FROM dbo.AIAcquisitionProspects WHERE AIAcquisitionProspectId=@ProspectId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        IF ERROR_NUMBER() IN (2601,2627)
        BEGIN
            SELECT TOP (1) *, CAST(0 AS BIT) Inserted FROM dbo.AIAcquisitionProspects
            WHERE AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId AND
                (IdentityKey=@IdentityKey OR ([Source]=@Source AND ExternalSourceId=@ExternalSourceId));
            RETURN;
        END;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionProspect_Get
    @AIAcquisitionProspectId BIGINT=NULL, @AIAcquisitionConfigurationId BIGINT=NULL,
    @Status NVARCHAR(32)=NULL, @Limit INT=250
AS
BEGIN
    SET NOCOUNT ON;
    SET @Limit=CASE WHEN @Limit<1 THEN 1 WHEN @Limit>1000 THEN 1000 ELSE @Limit END;
    SELECT TOP (@Limit) prospect.*,
        (SELECT ContactType [type], ContactValue [value], SourceName [source], SourceUrl [sourceUrl], Verified [verified]
         FROM dbo.AIAcquisitionProspectContacts contact WHERE contact.AIAcquisitionProspectId=prospect.AIAcquisitionProspectId
         ORDER BY contact.AIAcquisitionProspectContactId FOR JSON PATH) ContactsJson
    FROM dbo.AIAcquisitionProspects prospect
    WHERE (@AIAcquisitionProspectId IS NULL OR prospect.AIAcquisitionProspectId=@AIAcquisitionProspectId) AND
          (@AIAcquisitionConfigurationId IS NULL OR prospect.AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId) AND
          (@Status IS NULL OR prospect.[Status]=@Status)
    ORDER BY prospect.DiscoveredAt DESC, prospect.AIAcquisitionProspectId DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionOutreachCandidates_Get
    @AIAcquisitionConfigurationId BIGINT, @Limit INT=1000
AS
BEGIN
    SET NOCOUNT ON;
    SET @Limit=CASE WHEN @Limit<1 THEN 1 WHEN @Limit>1000 THEN 1000 ELSE @Limit END;
    SELECT TOP (@Limit) prospect.*,
        (SELECT ContactType [type], ContactValue [value], SourceName [source], SourceUrl [sourceUrl], Verified [verified]
         FROM dbo.AIAcquisitionProspectContacts contact WHERE contact.AIAcquisitionProspectId=prospect.AIAcquisitionProspectId
         ORDER BY contact.AIAcquisitionProspectContactId FOR JSON PATH) ContactsJson
    FROM dbo.AIAcquisitionProspects prospect
    WHERE prospect.AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId AND
          prospect.ConsentStatus IN (N'GRANTED',N'OPT_IN') AND prospect.OptedOut=0 AND prospect.Responded=0 AND
          prospect.ConvertedLeadId IS NULL AND
          prospect.[Status] IN (N'DISCOVERED',N'CONTACTABLE',N'CONTACTING',N'CONTACTED') AND
          (prospect.NextContactAt IS NULL OR prospect.NextContactAt<=SYSUTCDATETIME())
    ORDER BY COALESCE(prospect.NextContactAt,prospect.DiscoveredAt),prospect.AIAcquisitionProspectId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionConversation_Save
    @AIAcquisitionConfigurationId BIGINT, @AIAcquisitionProspectId BIGINT, @LeadId BIGINT=NULL,
    @Channel NVARCHAR(64), @Direction NVARCHAR(16), @Message NVARCHAR(MAX), @OriginAIOrHuman NVARCHAR(32),
    @AIProviderConfigurationId BIGINT=NULL, @AIModel NVARCHAR(255)=NULL, @DeliveryStatus NVARCHAR(32),
    @ExternalMessageId NVARCHAR(255)=NULL, @DecisionJson NVARCHAR(MAX)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    IF @DecisionJson IS NOT NULL AND ISJSON(@DecisionJson) <> 1 THROW 52604, 'Conversation decision JSON is invalid.', 1;
    DECLARE @ConversationId BIGINT, @Duplicate BIT=0;
    BEGIN TRANSACTION;
    BEGIN TRY
        SELECT @ConversationId=AIAcquisitionConversationId FROM dbo.AIAcquisitionConversations WITH (UPDLOCK,HOLDLOCK)
        WHERE ExternalMessageId IS NOT NULL AND Channel=@Channel AND ExternalMessageId=@ExternalMessageId;
        IF @ConversationId IS NOT NULL AND NOT EXISTS
            (SELECT 1 FROM dbo.AIAcquisitionConversations WHERE AIAcquisitionConversationId=@ConversationId AND
             AIAcquisitionProspectId=@AIAcquisitionProspectId AND Direction=@Direction)
            THROW 52613, 'External message identity belongs to another acquisition conversation.', 1;
        IF @ConversationId IS NULL
        BEGIN
            INSERT dbo.AIAcquisitionConversations
                (AIAcquisitionConfigurationId,AIAcquisitionProspectId,LeadId,Channel,Direction,Message,OriginAIOrHuman,
                 AIProviderConfigurationId,AIModel,DeliveryStatus,ExternalMessageId,DecisionJson)
            VALUES
                (@AIAcquisitionConfigurationId,@AIAcquisitionProspectId,@LeadId,@Channel,@Direction,@Message,@OriginAIOrHuman,
                 @AIProviderConfigurationId,@AIModel,@DeliveryStatus,@ExternalMessageId,@DecisionJson);
            SET @ConversationId=SCOPE_IDENTITY();
        END
        ELSE SET @Duplicate=1;
        IF @Duplicate=0 AND @Direction=N'INBOUND'
        BEGIN
            UPDATE dbo.AIAcquisitionProspects SET Responded=1,LastResponseAt=SYSUTCDATETIME(),
                [Status]=CASE WHEN [Status] IN (N'DO_NOT_CONTACT',N'CONVERTED_TO_LEAD',N'HUMAN_HANDOFF') THEN [Status] ELSE N'ENGAGED' END,
                UpdatedAt=SYSUTCDATETIME()
            WHERE AIAcquisitionProspectId=@AIAcquisitionProspectId;
            UPDATE dbo.AIAcquisitionContactAttempts SET [Status]=N'CANCELLED',LockToken=NULL,LockedAt=NULL,
                LastError=N'Cancelled after prospect response.',UpdatedAt=SYSUTCDATETIME()
            WHERE AIAcquisitionProspectId=@AIAcquisitionProspectId AND [Status] IN (N'QUEUED',N'RETRY');
        END;
        IF @Duplicate=0 AND @LeadId IS NOT NULL AND @DeliveryStatus IN (N'RECEIVED',N'SENT')
            INSERT dbo.LeadActivities(LeadId,ActivityType,Summary,SourceReference,OccurredAt)
            SELECT @LeadId,N'AI_ACQUISITION_CONVERSATION',
                LEFT(CONCAT(@Direction,N' ',@Channel,N': ',@Message),2000),
                CONCAT(N'acquisition:conversation:',@ConversationId),SYSUTCDATETIME();
        COMMIT TRANSACTION;
        SELECT *, @Duplicate Duplicate FROM dbo.AIAcquisitionConversations WHERE AIAcquisitionConversationId=@ConversationId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionConversation_Get
    @AIAcquisitionProspectId BIGINT=NULL, @AIAcquisitionConfigurationId BIGINT=NULL, @Limit INT=250
AS
BEGIN
    SET NOCOUNT ON;
    SET @Limit=CASE WHEN @Limit<1 THEN 1 WHEN @Limit>1000 THEN 1000 ELSE @Limit END;
    SELECT TOP (@Limit) conversation.*, prospect.CompanyName, prospect.ContactName
    FROM dbo.AIAcquisitionConversations conversation
    JOIN dbo.AIAcquisitionProspects prospect ON prospect.AIAcquisitionProspectId=conversation.AIAcquisitionProspectId
    WHERE (@AIAcquisitionProspectId IS NULL OR conversation.AIAcquisitionProspectId=@AIAcquisitionProspectId) AND
          (@AIAcquisitionConfigurationId IS NULL OR conversation.AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId)
    ORDER BY conversation.OccurredAt DESC, conversation.AIAcquisitionConversationId DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionContactAttempt_Create
    @AIAcquisitionConfigurationId BIGINT, @AIAcquisitionProspectId BIGINT, @Channel NVARCHAR(64),
    @ContactValue NVARCHAR(2048), @Message NVARCHAR(MAX)=NULL, @OriginAIOrHuman NVARCHAR(32)=N'HUMAN',
    @IsReply BIT=0, @IdempotencyKey NVARCHAR(255), @Status NVARCHAR(32)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @AttemptId BIGINT;
    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT @AttemptId=AIAcquisitionContactAttemptId FROM dbo.AIAcquisitionContactAttempts WITH (UPDLOCK,HOLDLOCK)
        WHERE IdempotencyKey=@IdempotencyKey;
        IF @AttemptId IS NOT NULL AND NOT EXISTS
            (SELECT 1 FROM dbo.AIAcquisitionContactAttempts WHERE AIAcquisitionContactAttemptId=@AttemptId AND
             AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId AND AIAcquisitionProspectId=@AIAcquisitionProspectId AND Channel=@Channel)
            THROW 52614, 'Contact idempotency key belongs to another acquisition attempt.', 1;
        IF @AttemptId IS NULL
        BEGIN
            IF @Channel<>N'MANUAL_HUMAN_FOLLOW_UP' AND
               EXISTS (SELECT 1 FROM dbo.AIAcquisitionCommunicationMethods
                       WHERE AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId AND Channel=@Channel AND AllowSimultaneous=0) AND
               EXISTS (SELECT 1 FROM dbo.AIAcquisitionContactAttempts WITH (UPDLOCK,HOLDLOCK)
                       WHERE AIAcquisitionProspectId=@AIAcquisitionProspectId AND [Status] IN (N'QUEUED',N'RETRY',N'PROCESSING'))
                THROW 52610, 'A contact attempt is already pending for this prospect.', 1;
            INSERT dbo.AIAcquisitionContactAttempts
                (AIAcquisitionConfigurationId,AIAcquisitionProspectId,Channel,ContactValue,Message,OriginAIOrHuman,IsReply,IdempotencyKey,[Status])
            VALUES(@AIAcquisitionConfigurationId,@AIAcquisitionProspectId,@Channel,@ContactValue,@Message,@OriginAIOrHuman,@IsReply,@IdempotencyKey,@Status);
            SET @AttemptId=SCOPE_IDENTITY();
            UPDATE dbo.AIAcquisitionProspects SET [Status]=N'CONTACTING', UpdatedAt=SYSUTCDATETIME()
            WHERE AIAcquisitionProspectId=@AIAcquisitionProspectId AND [Status] IN (N'DISCOVERED',N'CONTACTABLE',N'CONTACTED');
        END;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
    SELECT * FROM dbo.AIAcquisitionContactAttempts WHERE AIAcquisitionContactAttemptId=@AttemptId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionContactAttempt_Claim
    @Limit INT=10, @LockToken UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SET @Limit=CASE WHEN @Limit<1 THEN 1 WHEN @Limit>100 THEN 100 ELSE @Limit END;
    ;WITH due AS
    (
        SELECT TOP (@Limit) attempt.* FROM dbo.AIAcquisitionContactAttempts attempt WITH (UPDLOCK,READPAST,ROWLOCK)
        WHERE attempt.Channel<>N'MANUAL_HUMAN_FOLLOW_UP' AND
              ([Status] IN (N'QUEUED',N'RETRY') OR
               ([Status]=N'PROCESSING' AND LockedAt<DATEADD(MINUTE,-10,SYSUTCDATETIME()))) AND
              NextAttemptAt<=SYSUTCDATETIME() AND
              EXISTS
              (
                  SELECT 1 FROM dbo.AIAcquisitionProspects prospect
                  JOIN dbo.AIAcquisitionConfigurations configuration ON configuration.AIAcquisitionConfigurationId=prospect.AIAcquisitionConfigurationId
                  JOIN dbo.AIAcquisitionCommunicationMethods method ON method.AIAcquisitionConfigurationId=configuration.AIAcquisitionConfigurationId AND method.Channel=attempt.Channel
                  WHERE prospect.AIAcquisitionProspectId=attempt.AIAcquisitionProspectId AND
                        configuration.Status=N'ACTIVE' AND method.Enabled=1 AND prospect.OptedOut=0 AND
                        (attempt.IdempotencyKey NOT LIKE N'acquisition:auto:%' OR
                         (configuration.AutomaticOutreachEnabled=1 AND prospect.ConsentStatus IN (N'GRANTED',N'OPT_IN'))) AND
                        (configuration.StartDate IS NULL OR configuration.StartDate<=CONVERT(date,SYSUTCDATETIME())) AND
                        (configuration.EndDate IS NULL OR configuration.EndDate>=CONVERT(date,SYSUTCDATETIME())) AND
                        (prospect.NextContactAt IS NULL OR prospect.NextContactAt<=SYSUTCDATETIME()) AND
                        attempt.AttemptCount<method.MaximumAttempts AND
                        (prospect.ConsentStatus IS NULL OR prospect.ConsentStatus NOT IN (N'DENIED',N'REVOKED',N'OPTED_OUT')) AND
                        (method.Channel=N'MANUAL_HUMAN_FOLLOW_UP' OR attempt.IsReply=1 OR
                         EXISTS (SELECT 1 FROM dbo.AIAcquisitionProspectContacts contact
                                 WHERE contact.AIAcquisitionProspectId=prospect.AIAcquisitionProspectId AND
                                       contact.ContactValue=attempt.ContactValue AND contact.SourceName IS NOT NULL AND
                                       contact.ContactType=CASE method.Channel WHEN N'EMAIL' THEN N'EMAIL' WHEN N'SMS' THEN N'PHONE' ELSE method.Channel END)) AND
                        (method.Channel IN (N'EMAIL',N'MANUAL_HUMAN_FOLLOW_UP') OR attempt.IsReply=1 OR
                         prospect.ConsentStatus IN (N'GRANTED',N'OPT_IN')) AND
                        prospect.[Status] NOT IN (N'DO_NOT_CONTACT',N'CONVERTED_TO_LEAD',N'NOT_INTERESTED',N'LOST') AND
                        (prospect.Responded=0 OR method.Channel=N'MANUAL_HUMAN_FOLLOW_UP' OR
                         (attempt.IsReply=1 AND EXISTS
                            (SELECT 1 FROM dbo.AIAcquisitionConversations incoming
                             WHERE incoming.AIAcquisitionProspectId=prospect.AIAcquisitionProspectId AND
                                   incoming.Channel=attempt.Channel AND incoming.Direction=N'INBOUND')))
              )
        ORDER BY NextAttemptAt,AIAcquisitionContactAttemptId
    )
    UPDATE due SET [Status]=N'PROCESSING',LockToken=@LockToken,LockedAt=SYSUTCDATETIME(),
        AttemptCount=AttemptCount+1,UpdatedAt=SYSUTCDATETIME()
    OUTPUT inserted.*;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionContactAttempt_Complete
    @AIAcquisitionContactAttemptId BIGINT, @LockToken UNIQUEIDENTIFIER, @Succeeded BIT,
    @ExternalMessageId NVARCHAR(255)=NULL, @LastError NVARCHAR(1000)=NULL,
    @Retryable BIT=0, @NextAttemptAt DATETIME2(3)=NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @ProspectId BIGINT,@ConfigurationId BIGINT,@Channel NVARCHAR(64),@Message NVARCHAR(MAX),@Origin NVARCHAR(32),
        @RetryDelayMinutes INT,@NextChannelDelayMinutes INT,@AttemptCount INT,@MaximumAttempts INT,@LeadId BIGINT,@ConversationId BIGINT;
    BEGIN TRANSACTION;
    BEGIN TRY
        SELECT @ProspectId=AIAcquisitionProspectId,@ConfigurationId=AIAcquisitionConfigurationId,
            @Channel=Channel,@Message=Message,@Origin=OriginAIOrHuman,@AttemptCount=AttemptCount
        FROM dbo.AIAcquisitionContactAttempts WITH (UPDLOCK,HOLDLOCK)
        WHERE AIAcquisitionContactAttemptId=@AIAcquisitionContactAttemptId AND LockToken=@LockToken AND [Status]=N'PROCESSING';
        IF @ProspectId IS NULL THROW 52606, 'The acquisition contact attempt is not claimed by this worker.', 1;
        SELECT @RetryDelayMinutes=RetryDelayMinutes,@NextChannelDelayMinutes=DelayBeforeNextChannelMinutes,
            @MaximumAttempts=MaximumAttempts
        FROM dbo.AIAcquisitionCommunicationMethods
        WHERE AIAcquisitionConfigurationId=@ConfigurationId AND Channel=@Channel;
        IF @AttemptCount>=COALESCE(@MaximumAttempts,1) SET @Retryable=0;
        UPDATE dbo.AIAcquisitionContactAttempts SET
            [Status]=CASE WHEN @Succeeded=1 THEN N'SENT' WHEN @Retryable=1 THEN N'RETRY' ELSE N'FAILED' END,
            ExternalMessageId=@ExternalMessageId,LastError=@LastError,
            AttemptedAt=CASE WHEN @Succeeded=1 THEN SYSUTCDATETIME() ELSE AttemptedAt END,
            NextAttemptAt=CASE WHEN @Succeeded=0 AND @Retryable=1
                THEN COALESCE(@NextAttemptAt,DATEADD(MINUTE,COALESCE(@RetryDelayMinutes,1440),SYSUTCDATETIME()))
                ELSE NextAttemptAt END,
            LockToken=NULL,LockedAt=NULL,UpdatedAt=SYSUTCDATETIME()
        WHERE AIAcquisitionContactAttemptId=@AIAcquisitionContactAttemptId;
        IF @Succeeded=1
        BEGIN
            UPDATE dbo.AIAcquisitionProspects SET [Status]=N'CONTACTED',LastContactAt=SYSUTCDATETIME(),
                NextContactAt=DATEADD(MINUTE,COALESCE(@NextChannelDelayMinutes,1440),SYSUTCDATETIME()),UpdatedAt=SYSUTCDATETIME()
            WHERE AIAcquisitionProspectId=@ProspectId AND [Status] NOT IN (N'DO_NOT_CONTACT',N'CONVERTED_TO_LEAD',N'ENGAGED',N'QUALIFYING',N'QUALIFIED',N'HUMAN_HANDOFF');
            SELECT @LeadId=ConvertedLeadId FROM dbo.AIAcquisitionProspects WHERE AIAcquisitionProspectId=@ProspectId;
            IF NULLIF(@Message,N'') IS NOT NULL AND NOT EXISTS
                (SELECT 1 FROM dbo.AIAcquisitionConversations WHERE @ExternalMessageId IS NOT NULL AND Channel=@Channel AND ExternalMessageId=@ExternalMessageId)
            BEGIN
                INSERT dbo.AIAcquisitionConversations
                    (AIAcquisitionConfigurationId,AIAcquisitionProspectId,LeadId,Channel,Direction,Message,OriginAIOrHuman,DeliveryStatus,ExternalMessageId)
                VALUES(@ConfigurationId,@ProspectId,@LeadId,@Channel,N'OUTBOUND',@Message,@Origin,N'SENT',@ExternalMessageId);
                SET @ConversationId=SCOPE_IDENTITY();
                IF @LeadId IS NOT NULL
                    INSERT dbo.LeadActivities(LeadId,ActivityType,Summary,SourceReference,OccurredAt)
                    VALUES(@LeadId,N'AI_ACQUISITION_CONVERSATION',LEFT(CONCAT(N'OUTBOUND ',@Channel,N': ',@Message),2000),
                        CONCAT(N'acquisition:conversation:',@ConversationId),SYSUTCDATETIME());
            END;
        END;
        COMMIT TRANSACTION;
        SELECT * FROM dbo.AIAcquisitionContactAttempts WHERE AIAcquisitionContactAttemptId=@AIAcquisitionContactAttemptId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionManualTask_Get
    @AIAcquisitionConfigurationId BIGINT=NULL, @Limit INT=250
AS
BEGIN
    SET NOCOUNT ON;
    SET @Limit=CASE WHEN @Limit<1 THEN 1 WHEN @Limit>1000 THEN 1000 ELSE @Limit END;
    SELECT TOP (@Limit) attempt.*,prospect.CompanyName,prospect.ContactName
    FROM dbo.AIAcquisitionContactAttempts attempt
    JOIN dbo.AIAcquisitionProspects prospect ON prospect.AIAcquisitionProspectId=attempt.AIAcquisitionProspectId
    WHERE attempt.Channel=N'MANUAL_HUMAN_FOLLOW_UP' AND attempt.[Status]=N'QUEUED' AND
          (@AIAcquisitionConfigurationId IS NULL OR attempt.AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId)
    ORDER BY attempt.CreatedAt,attempt.AIAcquisitionContactAttemptId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionManualTask_Complete @AIAcquisitionContactAttemptId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.AIAcquisitionContactAttempts SET [Status]=N'COMPLETED',AttemptedAt=SYSUTCDATETIME(),UpdatedAt=SYSUTCDATETIME()
    WHERE AIAcquisitionContactAttemptId=@AIAcquisitionContactAttemptId AND
          Channel=N'MANUAL_HUMAN_FOLLOW_UP' AND [Status]=N'QUEUED';
    IF @@ROWCOUNT=0 AND NOT EXISTS
        (SELECT 1 FROM dbo.AIAcquisitionContactAttempts WHERE AIAcquisitionContactAttemptId=@AIAcquisitionContactAttemptId AND
         Channel=N'MANUAL_HUMAN_FOLLOW_UP' AND [Status]=N'COMPLETED')
        THROW 52612, 'Manual acquisition task was not found.', 1;
    SELECT * FROM dbo.AIAcquisitionContactAttempts WHERE AIAcquisitionContactAttemptId=@AIAcquisitionContactAttemptId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionProspect_Convert @AIAcquisitionProspectId BIGINT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @ConfigurationId BIGINT, @LeadId BIGINT, @CompanyName NVARCHAR(255), @ContactName NVARCHAR(255),
        @Email NVARCHAR(320), @Phone NVARCHAR(80), @Facebook NVARCHAR(500), @Instagram NVARCHAR(500), @X NVARCHAR(500),
        @Source NVARCHAR(64), @ExternalSourceId NVARCHAR(255), @QualificationJson NVARCHAR(MAX), @Duplicate BIT=0,
        @Status NVARCHAR(32), @Responded BIT, @OptedOut BIT, @FitScore INT, @ConversionCriteriaJson NVARCHAR(MAX),
        @ConversionEventId NVARCHAR(255), @LeadName NVARCHAR(255), @SourceDetail NVARCHAR(1000), @KnownLeadId BIGINT;
    BEGIN TRY
    BEGIN TRANSACTION;
    SELECT @ConfigurationId=AIAcquisitionConfigurationId, @LeadId=ConvertedLeadId, @CompanyName=CompanyName,
        @ContactName=ContactName, @Email=Email, @Phone=Phone, @Facebook=Facebook, @Instagram=Instagram, @X=[X],
        @Source=[Source], @ExternalSourceId=ExternalSourceId, @QualificationJson=QualificationJson,
        @Status=[Status], @Responded=Responded, @OptedOut=OptedOut, @FitScore=FitScore
    FROM dbo.AIAcquisitionProspects WITH (UPDLOCK,HOLDLOCK) WHERE AIAcquisitionProspectId=@AIAcquisitionProspectId;
    IF @ConfigurationId IS NULL THROW 52605, 'AI Acquisition prospect was not found.', 1;
    IF @LeadId IS NOT NULL SET @Duplicate=1;
    ELSE
    BEGIN
        SELECT @ConversionCriteriaJson=ConversionCriteriaJson FROM dbo.AIAcquisitionConfigurations
        WHERE AIAcquisitionConfigurationId=@ConfigurationId;
        IF @Status=N'DO_NOT_CONTACT' OR @OptedOut=1
            THROW 52607, 'Do-not-contact prospects cannot be converted.', 1;
        IF COALESCE(TRY_CONVERT(BIT,JSON_VALUE(@ConversionCriteriaJson,'$.requireEngagement')),1)=1 AND
           @Responded=0 AND @Status NOT IN (N'ENGAGED',N'QUALIFYING',N'QUALIFIED',N'CONVERSION_READY',N'HUMAN_HANDOFF') AND
           NOT (@Source=N'LANDING_PAGE' AND COALESCE(TRY_CONVERT(BIT,JSON_VALUE(@ConversionCriteriaJson,'$.allowLandingRegistration')),1)=1)
            THROW 52608, 'Prospect does not meet engagement or registration conversion criteria.', 1;
        IF @FitScore<COALESCE(TRY_CONVERT(INT,JSON_VALUE(@ConversionCriteriaJson,'$.minimumFitScore')),0)
            THROW 52609, 'Prospect is below the configured conversion fit score.', 1;
        SET @ConversionEventId=CONCAT(N'acquisition-prospect:',@AIAcquisitionProspectId);
        SET @LeadName=COALESCE(NULLIF(@ContactName,N''),@CompanyName);
        SET @SourceDetail=CONCAT(N'Configuration ',@ConfigurationId,N'; source ',@Source,N'; external ',COALESCE(@ExternalSourceId,N''));
        IF @Source IN (N'EXISTING_CRM',N'INACTIVE_LEADS',N'LANDING_PAGE',N'INSTAGRAM_INBOUND',N'FACEBOOK_INBOUND') AND
           LEFT(@ExternalSourceId,5)=N'lead:'
            SET @KnownLeadId=TRY_CONVERT(BIGINT,SUBSTRING(@ExternalSourceId,6,250));
        IF @KnownLeadId IS NOT NULL AND EXISTS (SELECT 1 FROM dbo.Leads WITH (UPDLOCK,HOLDLOCK) WHERE LeadId=@KnownLeadId)
        BEGIN
            SET @LeadId=@KnownLeadId;
            SET @Duplicate=1;
            IF NOT EXISTS (SELECT 1 FROM dbo.LeadRoutineEvents WITH (UPDLOCK,HOLDLOCK)
                           WHERE Routine=N'ai_acquisition_conversion' AND ExternalEventId=@ConversionEventId)
                INSERT dbo.LeadRoutineEvents(Routine,ExternalEventId,LeadId,SourceDetail,OccurredAt)
                VALUES(N'ai_acquisition_conversion',@ConversionEventId,@LeadId,@SourceDetail,SYSUTCDATETIME());
        END
        ELSE
        BEGIN
            DECLARE @Result TABLE (LeadId BIGINT, Duplicate BIT, OccurredAt DATETIME2(3));
            INSERT @Result EXEC dbo.CRMLead_UpsertFromRoutine
                @Routine=N'ai_acquisition_conversion',
                @ExternalEventId=@ConversionEventId,
                @Name=@LeadName, @Email=@Email, @Phone=@Phone,
                @Facebook=@Facebook, @Instagram=@Instagram, @X=@X, @Source=N'AI Acquisition',
                @CampaignId=NULL, @LandingPageId=NULL, @WebinarId=NULL,
                @SourceDetail=@SourceDetail,
                @OccurredAt=NULL;
            SELECT TOP (1) @LeadId=LeadId, @Duplicate=Duplicate FROM @Result;
        END;
        UPDATE dbo.AIAcquisitionProspects SET ConvertedLeadId=@LeadId, [Status]=N'CONVERTED_TO_LEAD', UpdatedAt=SYSUTCDATETIME()
        WHERE AIAcquisitionProspectId=@AIAcquisitionProspectId;
        UPDATE dbo.AIAcquisitionConversations SET LeadId=@LeadId WHERE AIAcquisitionProspectId=@AIAcquisitionProspectId AND LeadId IS NULL;
        IF NOT EXISTS (SELECT 1 FROM dbo.LeadActivities WITH (UPDLOCK,HOLDLOCK)
                       WHERE ActivityType=N'AI_ACQUISITION_CONVERSION' AND SourceReference=CONCAT(N'acquisition:prospect:',@AIAcquisitionProspectId))
            INSERT dbo.LeadActivities(LeadId,ActivityType,Summary,SourceReference,OccurredAt)
            VALUES(@LeadId,N'AI_ACQUISITION_CONVERSION',CONCAT(N'Converted acquisition prospect: ',@CompanyName),
                CONCAT(N'acquisition:prospect:',@AIAcquisitionProspectId),SYSUTCDATETIME());
        INSERT dbo.LeadActivities(LeadId,ActivityType,Summary,SourceReference,OccurredAt)
        SELECT @LeadId,N'AI_ACQUISITION_CONVERSATION',
            LEFT(CONCAT(conversation.Direction,N' ',conversation.Channel,N': ',conversation.Message),2000),
            CONCAT(N'acquisition:conversation:',conversation.AIAcquisitionConversationId),conversation.OccurredAt
        FROM dbo.AIAcquisitionConversations conversation
        WHERE conversation.AIAcquisitionProspectId=@AIAcquisitionProspectId AND
              conversation.DeliveryStatus IN (N'RECEIVED',N'SENT') AND
              NOT EXISTS (SELECT 1 FROM dbo.LeadActivities activity WITH (UPDLOCK,HOLDLOCK)
                          WHERE activity.ActivityType=N'AI_ACQUISITION_CONVERSATION' AND
                                activity.SourceReference=CONCAT(N'acquisition:conversation:',conversation.AIAcquisitionConversationId));
        EXEC dbo.LeadScore_Recalculate @LeadId=@LeadId, @ScoredAt=NULL, @ReturnResult=0;
    END;
    COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
    SELECT prospect.AIAcquisitionProspectId ProspectId, @LeadId LeadId, @Duplicate Duplicate,
        lead.LeadScore, lead.ScoreBand, prospect.[Status]
    FROM dbo.AIAcquisitionProspects prospect JOIN dbo.Leads lead ON lead.LeadId=@LeadId
    WHERE prospect.AIAcquisitionProspectId=@AIAcquisitionProspectId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionOverview_Get @AIAcquisitionConfigurationId BIGINT=NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
        (SELECT COUNT_BIG(*) FROM dbo.AIAcquisitionConfigurations WHERE Status=N'ACTIVE' AND (@AIAcquisitionConfigurationId IS NULL OR AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId)) ActiveConfigurations,
        COUNT_BIG(*) ProspectsDiscovered,
        SUM(CASE WHEN prospect.OptedOut=0 AND prospect.[Status] NOT IN (N'DO_NOT_CONTACT',N'NOT_INTERESTED',N'LOST') AND
            (NULLIF(prospect.Email,N'') IS NOT NULL OR NULLIF(prospect.Phone,N'') IS NOT NULL OR
             NULLIF(prospect.WhatsAppNumber,N'') IS NOT NULL OR NULLIF(prospect.Instagram,N'') IS NOT NULL OR
             NULLIF(prospect.Facebook,N'') IS NOT NULL) THEN 1 ELSE 0 END) ContactableProspects,
        SUM(CASE WHEN prospect.LastContactAt IS NOT NULL THEN 1 ELSE 0 END) ProspectsContacted,
        (SELECT COUNT_BIG(*) FROM dbo.AIAcquisitionContactAttempts attempt
         WHERE attempt.[Status] IN (N'PROCESSING',N'RETRY',N'SENT',N'FAILED') AND
               (@AIAcquisitionConfigurationId IS NULL OR attempt.AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId)) ContactsAttempted,
        SUM(CASE WHEN prospect.Responded=1 THEN 1 ELSE 0 END) ConversationsStarted,
        CAST(100.0*SUM(CASE WHEN prospect.Responded=1 AND prospect.LastContactAt IS NOT NULL THEN 1 ELSE 0 END)/
             NULLIF(SUM(CASE WHEN prospect.LastContactAt IS NOT NULL THEN 1 ELSE 0 END),0) AS DECIMAL(6,2)) ReplyRatePercent,
        SUM(CASE WHEN prospect.ConvertedLeadId IS NOT NULL THEN 1 ELSE 0 END) LeadsCreated,
        CAST(100.0*SUM(CASE WHEN prospect.ConvertedLeadId IS NOT NULL THEN 1 ELSE 0 END)/
             NULLIF(COUNT_BIG(*),0) AS DECIMAL(6,2)) LeadConversionRatePercent,
        CAST(AVG(CAST(lead.LeadScore AS DECIMAL(10,2))) AS DECIMAL(10,2)) AverageLeadScore,
        SUM(CASE WHEN lead.ScoreBand=N'QUALIFIED' THEN 1 ELSE 0 END) QualifiedLeads,
        SUM(CASE WHEN lead.ScoreBand=N'HOT' THEN 1 ELSE 0 END) HotLeads,
        SUM(CASE WHEN prospect.Status=N'HUMAN_HANDOFF' THEN 1 ELSE 0 END) HumanHandoffs,
        SUM(CASE WHEN lead.ConvertedCustomer=1 THEN 1 ELSE 0 END) Conversions
    FROM dbo.AIAcquisitionProspects prospect
    LEFT JOIN dbo.Leads lead ON lead.LeadId=prospect.ConvertedLeadId
    WHERE @AIAcquisitionConfigurationId IS NULL OR prospect.AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionAnalytics_Get @AIAcquisitionConfigurationId BIGINT=NULL
AS
BEGIN
    SET NOCOUNT ON;
    EXEC dbo.AIAcquisitionOverview_Get @AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId;
    SELECT [Source], COUNT_BIG(*) ProspectsDiscovered,
        SUM(CASE WHEN LastContactAt IS NOT NULL THEN 1 ELSE 0 END) Contacted,
        SUM(CASE WHEN Responded=1 THEN 1 ELSE 0 END) Replies,
        SUM(CASE WHEN ConvertedLeadId IS NOT NULL THEN 1 ELSE 0 END) LeadsCreated,
        CAST(100.0*SUM(CASE WHEN Responded=1 AND LastContactAt IS NOT NULL THEN 1 ELSE 0 END)/
             NULLIF(SUM(CASE WHEN LastContactAt IS NOT NULL THEN 1 ELSE 0 END),0) AS DECIMAL(6,2)) ReplyRatePercent,
        CAST(100.0*SUM(CASE WHEN ConvertedLeadId IS NOT NULL THEN 1 ELSE 0 END)/NULLIF(COUNT_BIG(*),0) AS DECIMAL(6,2)) LeadConversionRatePercent
    FROM dbo.AIAcquisitionProspects
    WHERE @AIAcquisitionConfigurationId IS NULL OR AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId
    GROUP BY [Source] ORDER BY COUNT_BIG(*) DESC;
    SELECT attempt.Channel,
        SUM(CASE WHEN attempt.[Status] IN (N'PROCESSING',N'RETRY',N'SENT',N'FAILED') THEN 1 ELSE 0 END) Attempts,
        SUM(CASE WHEN attempt.[Status]=N'SENT' THEN 1 ELSE 0 END) Sent,
        SUM(CASE WHEN attempt.[Status]=N'FAILED' THEN 1 ELSE 0 END) Failed,
        COUNT_BIG(DISTINCT CASE WHEN prospect.Responded=1 THEN prospect.AIAcquisitionProspectId END) RespondedProspects,
        COUNT_BIG(DISTINCT CASE WHEN prospect.ConvertedLeadId IS NOT NULL THEN prospect.AIAcquisitionProspectId END) LeadsCreated
    FROM dbo.AIAcquisitionContactAttempts attempt
    JOIN dbo.AIAcquisitionProspects prospect ON prospect.AIAcquisitionProspectId=attempt.AIAcquisitionProspectId
    WHERE @AIAcquisitionConfigurationId IS NULL OR attempt.AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId
    GROUP BY attempt.Channel ORDER BY COUNT_BIG(*) DESC;
    SELECT configuration.AIAcquisitionConfigurationId, configuration.AcquisitionName,
        COUNT_BIG(prospect.AIAcquisitionProspectId) ProspectsDiscovered,
        SUM(CASE WHEN prospect.LastContactAt IS NOT NULL THEN 1 ELSE 0 END) Contacted,
        SUM(CASE WHEN prospect.Responded=1 THEN 1 ELSE 0 END) Replies,
        SUM(CASE WHEN prospect.ConvertedLeadId IS NOT NULL THEN 1 ELSE 0 END) LeadsCreated,
        CAST(AVG(CAST(lead.LeadScore AS DECIMAL(10,2))) AS DECIMAL(10,2)) AverageLeadScore,
        CAST(100.0*SUM(CASE WHEN prospect.ConvertedLeadId IS NOT NULL THEN 1 ELSE 0 END)/
             NULLIF(COUNT_BIG(prospect.AIAcquisitionProspectId),0) AS DECIMAL(6,2)) LeadConversionRatePercent
    FROM dbo.AIAcquisitionConfigurations configuration
    LEFT JOIN dbo.AIAcquisitionProspects prospect ON prospect.AIAcquisitionConfigurationId=configuration.AIAcquisitionConfigurationId
    LEFT JOIN dbo.Leads lead ON lead.LeadId=prospect.ConvertedLeadId
    WHERE @AIAcquisitionConfigurationId IS NULL OR configuration.AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId
    GROUP BY configuration.AIAcquisitionConfigurationId,configuration.AcquisitionName
    ORDER BY configuration.AIAcquisitionConfigurationId DESC;
END;
GO
