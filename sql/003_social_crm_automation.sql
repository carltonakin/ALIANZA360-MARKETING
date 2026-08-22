SET XACT_ABORT ON;
GO

IF COL_LENGTH(N'dbo.Leads', N'FirstName') IS NULL ALTER TABLE dbo.Leads ADD FirstName NVARCHAR(120) NULL;
IF COL_LENGTH(N'dbo.Leads', N'LastName') IS NULL ALTER TABLE dbo.Leads ADD LastName NVARCHAR(120) NULL;
IF COL_LENGTH(N'dbo.Leads', N'DisplayName') IS NULL ALTER TABLE dbo.Leads ADD DisplayName NVARCHAR(255) NULL;
IF COL_LENGTH(N'dbo.Leads', N'Company') IS NULL ALTER TABLE dbo.Leads ADD Company NVARCHAR(255) NULL;
IF COL_LENGTH(N'dbo.Leads', N'Country') IS NULL ALTER TABLE dbo.Leads ADD Country NVARCHAR(120) NULL;
IF COL_LENGTH(N'dbo.Leads', N'StateRegion') IS NULL ALTER TABLE dbo.Leads ADD StateRegion NVARCHAR(120) NULL;
IF COL_LENGTH(N'dbo.Leads', N'City') IS NULL ALTER TABLE dbo.Leads ADD City NVARCHAR(120) NULL;
IF COL_LENGTH(N'dbo.Leads', N'LeadScore') IS NULL ALTER TABLE dbo.Leads ADD LeadScore INT NOT NULL CONSTRAINT DF_Leads_LeadScore DEFAULT 0 WITH VALUES;
IF COL_LENGTH(N'dbo.Leads', N'LeadTemperature') IS NULL ALTER TABLE dbo.Leads ADD LeadTemperature NVARCHAR(20) NOT NULL CONSTRAINT DF_Leads_LeadTemperature DEFAULT N'COLD' WITH VALUES;
IF COL_LENGTH(N'dbo.Leads', N'LastIntent') IS NULL ALTER TABLE dbo.Leads ADD LastIntent NVARCHAR(64) NULL;
IF COL_LENGTH(N'dbo.Leads', N'ProductServiceInterest') IS NULL ALTER TABLE dbo.Leads ADD ProductServiceInterest NVARCHAR(500) NULL;
IF COL_LENGTH(N'dbo.Leads', N'QualificationJson') IS NULL ALTER TABLE dbo.Leads ADD QualificationJson NVARCHAR(MAX) NULL;
IF COL_LENGTH(N'dbo.Leads', N'Budget') IS NULL ALTER TABLE dbo.Leads ADD Budget DECIMAL(19,4) NULL;
IF COL_LENGTH(N'dbo.Leads', N'PurchaseTimeline') IS NULL ALTER TABLE dbo.Leads ADD PurchaseTimeline NVARCHAR(255) NULL;
IF COL_LENGTH(N'dbo.Leads', N'PreferredContactMethod') IS NULL ALTER TABLE dbo.Leads ADD PreferredContactMethod NVARCHAR(50) NULL;
IF COL_LENGTH(N'dbo.Leads', N'AssignedSalesperson') IS NULL ALTER TABLE dbo.Leads ADD AssignedSalesperson NVARCHAR(255) NULL;
IF COL_LENGTH(N'dbo.Leads', N'ConsentStatus') IS NULL ALTER TABLE dbo.Leads ADD ConsentStatus NVARCHAR(50) NULL;
IF COL_LENGTH(N'dbo.Leads', N'CrmNotes') IS NULL ALTER TABLE dbo.Leads ADD CrmNotes NVARCHAR(MAX) NULL;
IF COL_LENGTH(N'dbo.Leads', N'ConvertedCustomer') IS NULL ALTER TABLE dbo.Leads ADD ConvertedCustomer BIT NOT NULL CONSTRAINT DF_Leads_ConvertedCustomer DEFAULT 0 WITH VALUES;
IF COL_LENGTH(N'dbo.Leads', N'LostReason') IS NULL ALTER TABLE dbo.Leads ADD LostReason NVARCHAR(500) NULL;
IF COL_LENGTH(N'dbo.Leads', N'FirstContactAt') IS NULL ALTER TABLE dbo.Leads ADD FirstContactAt DATETIME2(3) NULL;
IF COL_LENGTH(N'dbo.Leads', N'LastContactAt') IS NULL ALTER TABLE dbo.Leads ADD LastContactAt DATETIME2(3) NULL;
GO

IF OBJECT_ID(N'dbo.SocialPlatforms', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SocialPlatforms
    (
        SocialPlatformId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SocialPlatforms PRIMARY KEY,
        Code NVARCHAR(32) NOT NULL CONSTRAINT UQ_SocialPlatforms_Code UNIQUE,
        DisplayName NVARCHAR(100) NOT NULL,
        IsEnabled BIT NOT NULL CONSTRAINT DF_SocialPlatforms_IsEnabled DEFAULT 1,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SocialPlatforms_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SocialPlatforms_UpdatedAt DEFAULT SYSUTCDATETIME()
    );
END;
GO
MERGE dbo.SocialPlatforms AS target
USING (VALUES
    (N'facebook', N'Facebook'), (N'instagram', N'Instagram'), (N'x', N'X'), (N'multi', N'Multi-channel')
) AS source(Code, DisplayName)
ON target.Code = source.Code
WHEN MATCHED THEN UPDATE SET DisplayName = source.DisplayName, IsEnabled = 1, UpdatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (Code, DisplayName) VALUES (source.Code, source.DisplayName);
GO

IF OBJECT_ID(N'dbo.Customers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Customers
    (
        CustomerId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Customers PRIMARY KEY,
        LeadId BIGINT NULL CONSTRAINT UQ_Customers_Lead UNIQUE,
        DisplayName NVARCHAR(255) NOT NULL,
        Email NVARCHAR(320) NULL,
        Phone NVARCHAR(80) NULL,
        Status NVARCHAR(32) NOT NULL CONSTRAINT DF_Customers_Status DEFAULT N'active',
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_Customers_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_Customers_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_Customers_Lead FOREIGN KEY (LeadId) REFERENCES dbo.Leads(LeadId)
    );
END;
GO

IF OBJECT_ID(N'dbo.SocialAccounts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SocialAccounts
    (
        SocialAccountId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SocialAccounts PRIMARY KEY,
        LeadId BIGINT NULL,
        CustomerId BIGINT NULL,
        SocialPlatformId INT NOT NULL,
        PlatformUserId NVARCHAR(255) NOT NULL,
        Username NVARCHAR(255) NULL,
        DisplayName NVARCHAR(255) NULL,
        ProfileUrl NVARCHAR(2048) NULL,
        LastVerifiedAt DATETIME2(3) NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SocialAccounts_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SocialAccounts_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_SocialAccounts_Platform_User UNIQUE (SocialPlatformId, PlatformUserId),
        CONSTRAINT FK_SocialAccounts_Lead FOREIGN KEY (LeadId) REFERENCES dbo.Leads(LeadId),
        CONSTRAINT FK_SocialAccounts_Customer FOREIGN KEY (CustomerId) REFERENCES dbo.Customers(CustomerId),
        CONSTRAINT FK_SocialAccounts_Platform FOREIGN KEY (SocialPlatformId) REFERENCES dbo.SocialPlatforms(SocialPlatformId)
    );
END;
GO

IF OBJECT_ID(N'dbo.SocialCampaigns', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SocialCampaigns
    (
        SocialCampaignId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SocialCampaigns PRIMARY KEY,
        CampaignId BIGINT NOT NULL,
        SocialPlatformId INT NOT NULL,
        SourceType NVARCHAR(16) NOT NULL CONSTRAINT DF_SocialCampaigns_SourceType DEFAULT N'ORGANIC',
        ExternalCampaignId NVARCHAR(255) NULL,
        AdvertisementId NVARCHAR(255) NULL,
        LeadFormId NVARCHAR(255) NULL,
        ContentReference NVARCHAR(2048) NULL,
        AutomationStatus NVARCHAR(20) NOT NULL CONSTRAINT DF_SocialCampaigns_Status DEFAULT N'DRAFT',
        AutomationEnabled BIT NOT NULL CONSTRAINT DF_SocialCampaigns_Enabled DEFAULT 0,
        Schedule NVARCHAR(255) NOT NULL CONSTRAINT DF_SocialCampaigns_Schedule DEFAULT N'continuous',
        CadenceMinutes INT NOT NULL CONSTRAINT DF_SocialCampaigns_Cadence DEFAULT 60,
        LastRunAt DATETIME2(3) NULL,
        NextRunAt DATETIME2(3) NULL,
        LastError NVARCHAR(1000) NULL,
        RetryCount INT NOT NULL CONSTRAINT DF_SocialCampaigns_RetryCount DEFAULT 0,
        MaxRetries INT NOT NULL CONSTRAINT DF_SocialCampaigns_MaxRetries DEFAULT 3,
        LockToken UNIQUEIDENTIFIER NULL,
        LockedAt DATETIME2(3) NULL,
        CurrentMetricsJson NVARCHAR(MAX) NULL,
        LastProcessed INT NOT NULL CONSTRAINT DF_SocialCampaigns_LastProcessed DEFAULT 0,
        LastMetricsRefreshAt DATETIME2(3) NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SocialCampaigns_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SocialCampaigns_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_SocialCampaigns_Campaign_Platform UNIQUE (CampaignId, SocialPlatformId),
        CONSTRAINT FK_SocialCampaigns_Campaign FOREIGN KEY (CampaignId) REFERENCES dbo.Campaigns(CampaignId),
        CONSTRAINT FK_SocialCampaigns_Platform FOREIGN KEY (SocialPlatformId) REFERENCES dbo.SocialPlatforms(SocialPlatformId),
        CONSTRAINT CK_SocialCampaigns_SourceType CHECK (SourceType IN (N'PAID', N'ORGANIC')),
        CONSTRAINT CK_SocialCampaigns_Status CHECK (AutomationStatus IN (N'DRAFT', N'RUNNING', N'PAUSED', N'STOPPED', N'ERROR', N'COMPLETED')),
        CONSTRAINT CK_SocialCampaigns_Cadence CHECK (CadenceMinutes BETWEEN 1 AND 10080),
        CONSTRAINT CK_SocialCampaigns_MetricsJson CHECK (CurrentMetricsJson IS NULL OR ISJSON(CurrentMetricsJson) = 1)
    );
END;
GO

IF OBJECT_ID(N'dbo.SocialConversations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SocialConversations
    (
        SocialConversationId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SocialConversations PRIMARY KEY,
        LeadId BIGINT NULL,
        SocialPlatformId INT NOT NULL,
        PlatformConversationId NVARCHAR(255) NOT NULL,
        LastMessageAt DATETIME2(3) NOT NULL,
        Direction NVARCHAR(16) NOT NULL CONSTRAINT DF_SocialConversations_Direction DEFAULT N'INBOUND',
        ImportantMessage NVARCHAR(MAX) NULL,
        Status NVARCHAR(32) NOT NULL CONSTRAINT DF_SocialConversations_Status DEFAULT N'OPEN',
        AssignedCrmUser NVARCHAR(255) NULL,
        ReferenceUrl NVARCHAR(2048) NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SocialConversations_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SocialConversations_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_SocialConversations_Platform_Id UNIQUE (SocialPlatformId, PlatformConversationId),
        CONSTRAINT FK_SocialConversations_Lead FOREIGN KEY (LeadId) REFERENCES dbo.Leads(LeadId),
        CONSTRAINT FK_SocialConversations_Platform FOREIGN KEY (SocialPlatformId) REFERENCES dbo.SocialPlatforms(SocialPlatformId)
    );
END;
GO

IF OBJECT_ID(N'dbo.SocialInteractions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SocialInteractions
    (
        SocialInteractionId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SocialInteractions PRIMARY KEY,
        SocialEventId BIGINT NOT NULL CONSTRAINT UQ_SocialInteractions_Event UNIQUE,
        LeadId BIGINT NULL,
        SocialPlatformId INT NOT NULL,
        PlatformUserId NVARCHAR(255) NULL,
        PlatformPostId NVARCHAR(255) NULL,
        PlatformConversationId NVARCHAR(255) NULL,
        InteractionType NVARCHAR(64) NOT NULL,
        MessageText NVARCHAR(MAX) NULL,
        OccurredAt DATETIME2(3) NOT NULL,
        Direction NVARCHAR(16) NOT NULL,
        Intent NVARCHAR(64) NOT NULL,
        Sentiment NVARCHAR(20) NULL,
        ProductService NVARCHAR(500) NULL,
        CampaignExternalId NVARCHAR(255) NULL,
        CampaignName NVARCHAR(255) NULL,
        AdvertisementId NVARCHAR(255) NULL,
        LeadFormId NVARCHAR(255) NULL,
        SourceType NVARCHAR(16) NOT NULL,
        CrmUserAgent NVARCHAR(255) NULL,
        ResponseStatus NVARCHAR(32) NOT NULL CONSTRAINT DF_SocialInteractions_Response DEFAULT N'PENDING',
        RequiresReview BIT NOT NULL CONSTRAINT DF_SocialInteractions_Review DEFAULT 0,
        QualificationJson NVARCHAR(MAX) NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SocialInteractions_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_SocialInteractions_Event FOREIGN KEY (SocialEventId) REFERENCES dbo.SocialEvents(SocialEventId),
        CONSTRAINT FK_SocialInteractions_Lead FOREIGN KEY (LeadId) REFERENCES dbo.Leads(LeadId),
        CONSTRAINT FK_SocialInteractions_Platform FOREIGN KEY (SocialPlatformId) REFERENCES dbo.SocialPlatforms(SocialPlatformId),
        CONSTRAINT CK_SocialInteractions_Qualification CHECK (QualificationJson IS NULL OR ISJSON(QualificationJson) = 1)
    );
END;
GO

IF OBJECT_ID(N'dbo.LeadActivities', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.LeadActivities
    (
        LeadActivityId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_LeadActivities PRIMARY KEY,
        LeadId BIGINT NOT NULL,
        ActivityType NVARCHAR(64) NOT NULL,
        Summary NVARCHAR(2000) NULL,
        SourceReference NVARCHAR(2048) NULL,
        CampaignExternalId NVARCHAR(255) NULL,
        OccurredAt DATETIME2(3) NOT NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_LeadActivities_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_LeadActivities_Lead FOREIGN KEY (LeadId) REFERENCES dbo.Leads(LeadId)
    );
END;
GO

IF OBJECT_ID(N'dbo.Opportunities', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Opportunities
    (
        OpportunityId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Opportunities PRIMARY KEY,
        LeadId BIGINT NOT NULL,
        CampaignId BIGINT NULL,
        Name NVARCHAR(255) NOT NULL,
        Stage NVARCHAR(64) NOT NULL CONSTRAINT DF_Opportunities_Stage DEFAULT N'New',
        EstimatedValue DECIMAL(19,4) NOT NULL CONSTRAINT DF_Opportunities_Value DEFAULT 0,
        Status NVARCHAR(32) NOT NULL CONSTRAINT DF_Opportunities_Status DEFAULT N'open',
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_Opportunities_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_Opportunities_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_Opportunities_Lead FOREIGN KEY (LeadId) REFERENCES dbo.Leads(LeadId),
        CONSTRAINT FK_Opportunities_Campaign FOREIGN KEY (CampaignId) REFERENCES dbo.Campaigns(CampaignId)
    );
END;
GO

IF OBJECT_ID(N'dbo.SalesActivities', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SalesActivities
    (
        SalesActivityId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SalesActivities PRIMARY KEY,
        LeadId BIGINT NOT NULL,
        OpportunityId BIGINT NULL,
        ActivityType NVARCHAR(64) NOT NULL,
        Summary NVARCHAR(2000) NULL,
        AssignedCrmUser NVARCHAR(255) NULL,
        OccurredAt DATETIME2(3) NOT NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_SalesActivities_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_SalesActivities_Lead FOREIGN KEY (LeadId) REFERENCES dbo.Leads(LeadId),
        CONSTRAINT FK_SalesActivities_Opportunity FOREIGN KEY (OpportunityId) REFERENCES dbo.Opportunities(OpportunityId)
    );
END;
GO

IF OBJECT_ID(N'dbo.Quotes', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Quotes
    (
        QuoteId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Quotes PRIMARY KEY,
        LeadId BIGINT NOT NULL,
        OpportunityId BIGINT NULL,
        Amount DECIMAL(19,4) NOT NULL,
        Status NVARCHAR(32) NOT NULL CONSTRAINT DF_Quotes_Status DEFAULT N'draft',
        IssuedAt DATETIME2(3) NOT NULL CONSTRAINT DF_Quotes_IssuedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_Quotes_Lead FOREIGN KEY (LeadId) REFERENCES dbo.Leads(LeadId),
        CONSTRAINT FK_Quotes_Opportunity FOREIGN KEY (OpportunityId) REFERENCES dbo.Opportunities(OpportunityId)
    );
END;
GO

IF OBJECT_ID(N'dbo.Appointments', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Appointments
    (
        AppointmentId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Appointments PRIMARY KEY,
        LeadId BIGINT NOT NULL,
        ScheduledAt DATETIME2(3) NOT NULL,
        Status NVARCHAR(32) NOT NULL CONSTRAINT DF_Appointments_Status DEFAULT N'scheduled',
        AssignedCrmUser NVARCHAR(255) NULL,
        Notes NVARCHAR(2000) NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_Appointments_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_Appointments_Lead FOREIGN KEY (LeadId) REFERENCES dbo.Leads(LeadId)
    );
END;
GO

IF OBJECT_ID(N'dbo.CustomerConversions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.CustomerConversions
    (
        CustomerConversionId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CustomerConversions PRIMARY KEY,
        LeadId BIGINT NOT NULL,
        CustomerId BIGINT NULL,
        CampaignId BIGINT NULL,
        ConversionType NVARCHAR(64) NOT NULL,
        Value DECIMAL(19,4) NULL,
        ConvertedAt DATETIME2(3) NOT NULL,
        CONSTRAINT FK_CustomerConversions_Lead FOREIGN KEY (LeadId) REFERENCES dbo.Leads(LeadId),
        CONSTRAINT FK_CustomerConversions_Customer FOREIGN KEY (CustomerId) REFERENCES dbo.Customers(CustomerId),
        CONSTRAINT FK_CustomerConversions_Campaign FOREIGN KEY (CampaignId) REFERENCES dbo.Campaigns(CampaignId)
    );
END;
GO

IF OBJECT_ID(N'dbo.LeadScoringRules', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.LeadScoringRules
    (
        RuleKey NVARCHAR(100) NOT NULL CONSTRAINT PK_LeadScoringRules PRIMARY KEY,
        ScoreValue INT NOT NULL,
        IsEnabled BIT NOT NULL CONSTRAINT DF_LeadScoringRules_Enabled DEFAULT 1,
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_LeadScoringRules_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_LeadScoringRules_Value CHECK (ScoreValue BETWEEN 0 AND 1000)
    );
END;
GO
MERGE dbo.LeadScoringRules AS target
USING (VALUES
    (N'COMMENT_ON_ADVERTISEMENT',10),(N'DIRECT_MESSAGE',15),(N'PRICE_REQUEST',20),
    (N'QUOTE_REQUEST',30),(N'PHONE_NUMBER_PROVIDED',25),(N'EMAIL_PROVIDED',20),
    (N'APPOINTMENT_REQUEST',25),(N'DEMO_REQUEST',30),(N'PURCHASE_INTEREST_CONFIRMED',40)
) AS source(RuleKey, ScoreValue)
ON target.RuleKey = source.RuleKey
WHEN NOT MATCHED THEN INSERT (RuleKey, ScoreValue) VALUES (source.RuleKey, source.ScoreValue);
GO

IF OBJECT_ID(N'dbo.LeadTemperatureThresholds', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.LeadTemperatureThresholds
    (
        Temperature NVARCHAR(20) NOT NULL CONSTRAINT PK_LeadTemperatureThresholds PRIMARY KEY,
        MinimumScore INT NOT NULL,
        SortOrder INT NOT NULL,
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_LeadTemperatureThresholds_UpdatedAt DEFAULT SYSUTCDATETIME()
    );
END;
GO
MERGE dbo.LeadTemperatureThresholds AS target
USING (VALUES (N'COLD',0,1),(N'WARM',20,2),(N'HOT',50,3),(N'VERY_HOT',80,4)) AS source(Temperature, MinimumScore, SortOrder)
ON target.Temperature = source.Temperature
WHEN NOT MATCHED THEN INSERT (Temperature, MinimumScore, SortOrder) VALUES (source.Temperature, source.MinimumScore, source.SortOrder);
GO

IF COL_LENGTH(N'dbo.SocialEvents', N'LeadFormId') IS NULL ALTER TABLE dbo.SocialEvents ADD LeadFormId NVARCHAR(255) NULL;
IF COL_LENGTH(N'dbo.SocialEvents', N'CampaignName') IS NULL ALTER TABLE dbo.SocialEvents ADD CampaignName NVARCHAR(255) NULL;
IF COL_LENGTH(N'dbo.SocialEvents', N'ConversationId') IS NULL ALTER TABLE dbo.SocialEvents ADD ConversationId NVARCHAR(255) NULL;
IF COL_LENGTH(N'dbo.SocialEvents', N'SourceType') IS NULL ALTER TABLE dbo.SocialEvents ADD SourceType NVARCHAR(16) NULL;
IF COL_LENGTH(N'dbo.SocialEvents', N'AttemptCount') IS NULL ALTER TABLE dbo.SocialEvents ADD AttemptCount INT NOT NULL CONSTRAINT DF_SocialEvents_AttemptCount DEFAULT 1 WITH VALUES;
IF COL_LENGTH(N'dbo.SocialEvents', N'LastError') IS NULL ALTER TABLE dbo.SocialEvents ADD LastError NVARCHAR(1000) NULL;
IF COL_LENGTH(N'dbo.SocialEvents', N'NextRetryAt') IS NULL ALTER TABLE dbo.SocialEvents ADD NextRetryAt DATETIME2(3) NULL;
IF COL_LENGTH(N'dbo.SocialEvents', N'RawPayloadExpiresAt') IS NULL ALTER TABLE dbo.SocialEvents ADD RawPayloadExpiresAt DATETIME2(3) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_Leads_Phone' AND object_id=OBJECT_ID(N'dbo.Leads')) CREATE INDEX IX_Leads_Phone ON dbo.Leads(Phone) WHERE Phone IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_Leads_Score_Temperature' AND object_id=OBJECT_ID(N'dbo.Leads')) CREATE INDEX IX_Leads_Score_Temperature ON dbo.Leads(LeadTemperature, LeadScore DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_SocialAccounts_Lead' AND object_id=OBJECT_ID(N'dbo.SocialAccounts')) CREATE INDEX IX_SocialAccounts_Lead ON dbo.SocialAccounts(LeadId, SocialPlatformId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_SocialCampaigns_Due' AND object_id=OBJECT_ID(N'dbo.SocialCampaigns')) CREATE INDEX IX_SocialCampaigns_Due ON dbo.SocialCampaigns(AutomationStatus, AutomationEnabled, NextRunAt) INCLUDE (LockToken, LockedAt);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_SocialCampaigns_External' AND object_id=OBJECT_ID(N'dbo.SocialCampaigns')) CREATE INDEX IX_SocialCampaigns_External ON dbo.SocialCampaigns(ExternalCampaignId, AdvertisementId, LeadFormId);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_SocialConversations_Lead_Date' AND object_id=OBJECT_ID(N'dbo.SocialConversations')) CREATE INDEX IX_SocialConversations_Lead_Date ON dbo.SocialConversations(LeadId, LastMessageAt DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_SocialInteractions_Lead_Date' AND object_id=OBJECT_ID(N'dbo.SocialInteractions')) CREATE INDEX IX_SocialInteractions_Lead_Date ON dbo.SocialInteractions(LeadId, OccurredAt DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_SocialInteractions_Campaign' AND object_id=OBJECT_ID(N'dbo.SocialInteractions')) CREATE INDEX IX_SocialInteractions_Campaign ON dbo.SocialInteractions(CampaignExternalId, OccurredAt DESC);
GO

CREATE OR ALTER PROCEDURE dbo.LeadScoringConfiguration_Get
AS
BEGIN
    SET NOCOUNT ON;
    SELECT RuleKey, ScoreValue, IsEnabled FROM dbo.LeadScoringRules ORDER BY RuleKey;
    SELECT Temperature, MinimumScore, SortOrder FROM dbo.LeadTemperatureThresholds ORDER BY SortOrder;
END;
GO

CREATE OR ALTER PROCEDURE dbo.LeadScoringRule_Upsert @RuleKey NVARCHAR(100), @ScoreValue INT, @IsEnabled BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    IF @ScoreValue < 0 OR @ScoreValue > 1000 THROW 51101, 'Score value must be between 0 and 1000.', 1;
    UPDATE dbo.LeadScoringRules SET ScoreValue=@ScoreValue, IsEnabled=@IsEnabled, UpdatedAt=SYSUTCDATETIME() WHERE RuleKey=@RuleKey;
    IF @@ROWCOUNT=0 INSERT dbo.LeadScoringRules(RuleKey,ScoreValue,IsEnabled) VALUES(@RuleKey,@ScoreValue,@IsEnabled);
END;
GO

CREATE OR ALTER PROCEDURE dbo.LeadTemperatureThreshold_Upsert @Temperature NVARCHAR(20), @MinimumScore INT, @SortOrder INT
AS
BEGIN
    SET NOCOUNT ON;
    IF @Temperature NOT IN (N'COLD',N'WARM',N'HOT',N'VERY_HOT') OR @MinimumScore < 0 THROW 51102, 'Invalid temperature threshold.', 1;
    UPDATE dbo.LeadTemperatureThresholds SET MinimumScore=@MinimumScore,SortOrder=@SortOrder,UpdatedAt=SYSUTCDATETIME() WHERE Temperature=@Temperature;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialCampaign_Save
    @CampaignId BIGINT,
    @Platform NVARCHAR(32),
    @SourceType NVARCHAR(16),
    @ExternalCampaignId NVARCHAR(255)=NULL,
    @AdvertisementId NVARCHAR(255)=NULL,
    @LeadFormId NVARCHAR(255)=NULL,
    @ContentReference NVARCHAR(2048)=NULL,
    @Schedule NVARCHAR(255)=N'continuous',
    @CadenceMinutes INT=60,
    @AutomationEnabled BIT=0,
    @MaxRetries INT=3,
    @NextRunAt DATETIME2(3)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @PlatformCode NVARCHAR(32)=LOWER(@Platform), @SocialPlatformId INT;
    IF @PlatformCode LIKE N'%instagram%' SET @PlatformCode=N'instagram';
    ELSE IF @PlatformCode LIKE N'%facebook%' SET @PlatformCode=N'facebook';
    ELSE IF @PlatformCode=N'x' OR @PlatformCode LIKE N'%twitter%' SET @PlatformCode=N'x';
    ELSE IF @PlatformCode LIKE N'%multi%' SET @PlatformCode=N'multi';
    SELECT @SocialPlatformId=SocialPlatformId FROM dbo.SocialPlatforms WHERE Code=@PlatformCode;
    IF @SocialPlatformId IS NULL THROW 51103, 'Unsupported social campaign platform.', 1;
    IF @SourceType NOT IN (N'PAID',N'ORGANIC') THROW 51104, 'Source type must be PAID or ORGANIC.', 1;
    IF @CadenceMinutes NOT BETWEEN 1 AND 10080 THROW 51105, 'Campaign cadence must be between 1 and 10080 minutes.', 1;

    UPDATE dbo.SocialCampaigns
    SET SourceType=@SourceType,ExternalCampaignId=@ExternalCampaignId,AdvertisementId=@AdvertisementId,
        LeadFormId=@LeadFormId,ContentReference=@ContentReference,Schedule=@Schedule,CadenceMinutes=@CadenceMinutes,
        AutomationEnabled=@AutomationEnabled,MaxRetries=@MaxRetries,
        NextRunAt=COALESCE(@NextRunAt,NextRunAt),UpdatedAt=SYSUTCDATETIME()
    WHERE CampaignId=@CampaignId AND SocialPlatformId=@SocialPlatformId;
    IF @@ROWCOUNT=0
        INSERT dbo.SocialCampaigns(CampaignId,SocialPlatformId,SourceType,ExternalCampaignId,AdvertisementId,LeadFormId,
            ContentReference,Schedule,CadenceMinutes,AutomationEnabled,MaxRetries,NextRunAt)
        VALUES(@CampaignId,@SocialPlatformId,@SourceType,@ExternalCampaignId,@AdvertisementId,@LeadFormId,
            @ContentReference,@Schedule,@CadenceMinutes,@AutomationEnabled,@MaxRetries,@NextRunAt);
    EXEC dbo.SocialCampaign_GetAll @CampaignId=@CampaignId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialCampaign_GetAll @CampaignId BIGINT=NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT sc.SocialCampaignId,sc.CampaignId,c.Name,sp.Code AS Platform,sp.DisplayName AS PlatformName,
           sc.SourceType,sc.ExternalCampaignId,sc.AdvertisementId,sc.LeadFormId,sc.ContentReference,
           sc.AutomationStatus,sc.AutomationEnabled,sc.Schedule,sc.CadenceMinutes,sc.LastRunAt,sc.NextRunAt,
           sc.LastError,sc.RetryCount,sc.MaxRetries,sc.CurrentMetricsJson,sc.LastProcessed,
           sc.LastMetricsRefreshAt,sc.CreatedAt,sc.UpdatedAt
    FROM dbo.SocialCampaigns sc
    JOIN dbo.Campaigns c ON c.CampaignId=sc.CampaignId
    JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId=sc.SocialPlatformId
    WHERE @CampaignId IS NULL OR sc.CampaignId=@CampaignId
    ORDER BY sc.UpdatedAt DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialCampaign_SetStatus @CampaignId BIGINT,@Action NVARCHAR(16),@Now DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    IF @Action NOT IN (N'start',N'pause',N'resume',N'stop') THROW 51106, 'Unsupported campaign automation action.', 1;
    UPDATE dbo.SocialCampaigns
    SET AutomationStatus=CASE @Action WHEN N'start' THEN N'RUNNING' WHEN N'resume' THEN N'RUNNING' WHEN N'pause' THEN N'PAUSED' ELSE N'STOPPED' END,
        AutomationEnabled=CASE WHEN @Action IN (N'start',N'resume') THEN 1 ELSE 0 END,
        NextRunAt=CASE WHEN @Action IN (N'start',N'resume') THEN @Now ELSE NULL END,
        LockToken=NULL,LockedAt=NULL,
        LastError=CASE WHEN @Action IN (N'start',N'resume') THEN NULL ELSE LastError END,
        UpdatedAt=@Now
    WHERE CampaignId=@CampaignId;
    IF @@ROWCOUNT=0 THROW 51107, 'Campaign automation configuration not found.', 1;
    EXEC dbo.SocialCampaign_GetAll @CampaignId=@CampaignId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialCampaign_ClaimDue @Now DATETIME2(3),@Limit INT,@LockToken UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @Claimed TABLE
    (
        SocialCampaignId BIGINT NOT NULL,
        CampaignId BIGINT NOT NULL,
        SocialPlatformId INT NOT NULL,
        SourceType NVARCHAR(16) NOT NULL,
        ExternalCampaignId NVARCHAR(255) NULL,
        AdvertisementId NVARCHAR(255) NULL,
        LeadFormId NVARCHAR(255) NULL,
        ContentReference NVARCHAR(2048) NULL,
        Schedule NVARCHAR(255) NULL,
        CadenceMinutes INT NOT NULL,
        RetryCount INT NOT NULL,
        MaxRetries INT NOT NULL,
        NextRunAt DATETIME2(3) NULL,
        LockToken UNIQUEIDENTIFIER NULL
    );
    BEGIN TRANSACTION;
    ;WITH due AS
    (
        SELECT TOP (@Limit) sc.SocialCampaignId
        FROM dbo.SocialCampaigns sc WITH (UPDLOCK,READPAST,ROWLOCK)
        WHERE sc.AutomationEnabled=1 AND sc.AutomationStatus=N'RUNNING'
          AND (sc.NextRunAt IS NULL OR sc.NextRunAt<=@Now)
          AND (sc.LockToken IS NULL OR sc.LockedAt<DATEADD(MINUTE,-15,@Now))
        ORDER BY COALESCE(sc.NextRunAt,sc.CreatedAt),sc.SocialCampaignId
    )
    UPDATE sc SET LockToken=@LockToken,LockedAt=@Now,UpdatedAt=@Now
    OUTPUT inserted.SocialCampaignId,inserted.CampaignId,inserted.SocialPlatformId,inserted.SourceType,
           inserted.ExternalCampaignId,inserted.AdvertisementId,inserted.LeadFormId,inserted.ContentReference,
           inserted.Schedule,inserted.CadenceMinutes,inserted.RetryCount,inserted.MaxRetries,
           inserted.NextRunAt,inserted.LockToken
    INTO @Claimed
    FROM dbo.SocialCampaigns sc
    JOIN due ON due.SocialCampaignId=sc.SocialCampaignId;
    COMMIT TRANSACTION;

    SELECT claimed.SocialCampaignId,claimed.CampaignId,sp.Code AS Platform,claimed.SourceType,
           claimed.ExternalCampaignId,claimed.AdvertisementId,claimed.LeadFormId,claimed.ContentReference,
           claimed.Schedule,claimed.CadenceMinutes,claimed.RetryCount,claimed.MaxRetries,
           claimed.NextRunAt,claimed.LockToken
    FROM @Claimed claimed
    JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId=claimed.SocialPlatformId
    ORDER BY claimed.SocialCampaignId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialCampaign_CompleteRun
    @SocialCampaignId BIGINT,@LockToken UNIQUEIDENTIFIER,@Succeeded BIT,@LastRunAt DATETIME2(3),
    @NextRunAt DATETIME2(3)=NULL,@RetryCount INT=0,@Retryable BIT=0,@LastError NVARCHAR(1000)=NULL,
    @CurrentMetricsJson NVARCHAR(MAX)=NULL,@LastProcessed INT=0
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.SocialCampaigns
    SET AutomationStatus=CASE WHEN @Succeeded=1 OR @Retryable=1 THEN N'RUNNING' ELSE N'ERROR' END,
        AutomationEnabled=CASE WHEN @Succeeded=1 OR @Retryable=1 THEN 1 ELSE 0 END,
        LastRunAt=@LastRunAt,NextRunAt=@NextRunAt,RetryCount=CASE WHEN @Succeeded=1 THEN 0 ELSE @RetryCount END,
        LastError=CASE WHEN @Succeeded=1 THEN NULL ELSE @LastError END,
        CurrentMetricsJson=COALESCE(@CurrentMetricsJson,CurrentMetricsJson),
        LastMetricsRefreshAt=CASE WHEN @CurrentMetricsJson IS NOT NULL THEN @LastRunAt ELSE LastMetricsRefreshAt END,
        LastProcessed=@LastProcessed,LockToken=NULL,LockedAt=NULL,UpdatedAt=@LastRunAt
    WHERE SocialCampaignId=@SocialCampaignId AND LockToken=@LockToken;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CRMContent_GetAll
AS
BEGIN
    SET NOCOUNT ON;
    SELECT c.CampaignId,c.Name,c.Platform,c.Audience,c.Message,c.Budget,c.Mode,c.CreatedByAi,
           c.LastReadinessCheckAt,c.LastReadinessError,c.CreatedAt,c.UpdatedAt,
           automation.SourceType,automation.ExternalCampaignId,automation.AdvertisementId,automation.LeadFormId,
           automation.ContentReference,automation.AutomationStatus,automation.AutomationEnabled,automation.Schedule,
           automation.CadenceMinutes,automation.LastRunAt,automation.NextRunAt,automation.LastError,
           automation.RetryCount,automation.MaxRetries,automation.CurrentMetricsJson,automation.LastProcessed
    FROM dbo.Campaigns c
    OUTER APPLY
    (
        SELECT TOP (1) sc.SourceType,sc.ExternalCampaignId,sc.AdvertisementId,sc.LeadFormId,sc.ContentReference,
            sc.AutomationStatus,sc.AutomationEnabled,sc.Schedule,sc.CadenceMinutes,sc.LastRunAt,sc.NextRunAt,
            sc.LastError,sc.RetryCount,sc.MaxRetries,sc.CurrentMetricsJson,sc.LastProcessed
        FROM dbo.SocialCampaigns sc WHERE sc.CampaignId=c.CampaignId ORDER BY sc.SocialCampaignId
    ) automation
    ORDER BY c.CreatedAt DESC;
    SELECT LandingPageId,CampaignId,Title,Slug,Headline,Teaser,WebinarUrl,PaymentUrl,Status,Registrations,CreatedByAi,CreatedAt,UpdatedAt FROM dbo.LandingPages ORDER BY CreatedAt DESC;
    SELECT WebinarId,CampaignId,LandingPageId,Title,Description,ScheduledAt,WebinarUrl,Status,CreatedByAi,CreatedAt,UpdatedAt FROM dbo.Webinars ORDER BY CreatedAt DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialEvent_Process
    @Channel NVARCHAR(32),@ExternalEventId NVARCHAR(255),@EventType NVARCHAR(100),
    @ExternalUserId NVARCHAR(255)=NULL,@Username NVARCHAR(255)=NULL,@DisplayName NVARCHAR(255)=NULL,
    @Email NVARCHAR(320)=NULL,@Phone NVARCHAR(80)=NULL,@Message NVARCHAR(MAX)=NULL,@PostId NVARCHAR(255)=NULL,
    @CampaignId NVARCHAR(255)=NULL,@AdId NVARCHAR(255)=NULL,@LeadFormId NVARCHAR(255)=NULL,
    @CampaignName NVARCHAR(255)=NULL,@ConversationId NVARCHAR(255)=NULL,@Direction NVARCHAR(16)=N'INBOUND',
    @SourceUrl NVARCHAR(2048)=NULL,@OccurredAt DATETIME2(3),@RawPayload NVARCHAR(MAX),@Qualified BIT,
    @LeadName NVARCHAR(255)=NULL,@InteractionType NVARCHAR(64)=N'POST_INTERACTION',@Intent NVARCHAR(64)=N'OTHER',
    @Sentiment NVARCHAR(20)=N'NEUTRAL',@QualificationJson NVARCHAR(MAX)=NULL,@ScoreDelta INT=0,
    @SourceType NVARCHAR(16)=N'ORGANIC',@RawRetentionDays INT=7
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @SocialEventId BIGINT,@LeadId BIGINT,@SocialPlatformId INT,@LeadCreated BIT=0,@LeadUpdated BIT=0;
    DECLARE @NextScore INT=0,@Temperature NVARCHAR(20)=N'COLD';
    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT @SocialEventId=SocialEventId FROM dbo.SocialEvents WITH(UPDLOCK,HOLDLOCK)
        WHERE Channel=@Channel AND ExternalEventId=@ExternalEventId;
        IF @SocialEventId IS NOT NULL
        BEGIN
            COMMIT TRANSACTION;
            SELECT CAST(1 AS BIT) Duplicate,CAST(0 AS BIT) LeadCreated,CAST(0 AS BIT) LeadUpdated,
                   CAST(NULL AS BIGINT) LeadId,@SocialEventId SocialEventId;
            RETURN;
        END;
        SELECT @SocialPlatformId=SocialPlatformId FROM dbo.SocialPlatforms WHERE Code=@Channel;
        IF @SocialPlatformId IS NULL THROW 51108, 'Unsupported social platform.', 1;

        INSERT dbo.SocialEvents(Channel,ExternalEventId,EventType,ExternalUserId,Username,DisplayName,Email,Phone,Message,
            PostId,CampaignId,AdId,SourceUrl,OccurredAt,RawPayload,LeadFormId,CampaignName,ConversationId,SourceType,RawPayloadExpiresAt)
        VALUES(@Channel,@ExternalEventId,@EventType,@ExternalUserId,@Username,@DisplayName,@Email,@Phone,@Message,
            @PostId,@CampaignId,@AdId,@SourceUrl,@OccurredAt,@RawPayload,@LeadFormId,@CampaignName,@ConversationId,@SourceType,
            DATEADD(DAY,CASE WHEN @RawRetentionDays BETWEEN 1 AND 90 THEN @RawRetentionDays ELSE 7 END,@OccurredAt));
        SET @SocialEventId=SCOPE_IDENTITY();

        IF @Qualified=1
        BEGIN
            SELECT TOP(1) @LeadId=sa.LeadId FROM dbo.SocialAccounts sa WITH(UPDLOCK,HOLDLOCK)
            WHERE sa.SocialPlatformId=@SocialPlatformId AND @ExternalUserId IS NOT NULL AND sa.PlatformUserId=@ExternalUserId;
            IF @LeadId IS NULL
                SELECT TOP(1) @LeadId=LeadId FROM dbo.Leads WITH(UPDLOCK,HOLDLOCK)
                WHERE (@Email IS NOT NULL AND Email=@Email) OR (@Phone IS NOT NULL AND Phone=@Phone) ORDER BY LeadId;

            IF @LeadId IS NULL
            BEGIN
                SET @NextScore=CASE WHEN @ScoreDelta<0 THEN 0 ELSE @ScoreDelta END;
                SELECT TOP(1) @Temperature=Temperature FROM dbo.LeadTemperatureThresholds
                WHERE MinimumScore<=@NextScore ORDER BY MinimumScore DESC;
                INSERT dbo.Leads(Name,DisplayName,Email,Phone,SocialUsername,Facebook,Instagram,[X],[Source],Status,
                    LeadScore,LeadTemperature,LastIntent,ProductServiceInterest,QualificationJson,Budget,PurchaseTimeline,
                    FirstContactAt,LastContactAt)
                VALUES(COALESCE(NULLIF(@LeadName,N''),NULLIF(@DisplayName,N''),NULLIF(@Username,N''),N'Social prospect'),
                    @DisplayName,@Email,@Phone,@Username,
                    CASE WHEN @Channel=N'facebook' THEN @Username END,CASE WHEN @Channel=N'instagram' THEN @Username END,
                    CASE WHEN @Channel=N'x' THEN @Username END,@Channel,N'New',@NextScore,@Temperature,@Intent,
                    JSON_VALUE(@QualificationJson,'$.productService'),@QualificationJson,
                    TRY_CONVERT(DECIMAL(19,4),JSON_VALUE(@QualificationJson,'$.budget')),
                    JSON_VALUE(@QualificationJson,'$.purchaseTimeline'),@OccurredAt,@OccurredAt);
                SET @LeadId=SCOPE_IDENTITY();SET @LeadCreated=1;
            END
            ELSE
            BEGIN
                SELECT @NextScore=CASE WHEN LeadScore+@ScoreDelta<0 THEN 0 ELSE LeadScore+@ScoreDelta END FROM dbo.Leads WHERE LeadId=@LeadId;
                SELECT TOP(1) @Temperature=Temperature FROM dbo.LeadTemperatureThresholds WHERE MinimumScore<=@NextScore ORDER BY MinimumScore DESC;
                UPDATE dbo.Leads SET
                    Name=COALESCE(NULLIF(@LeadName,N''),Name),DisplayName=COALESCE(NULLIF(@DisplayName,N''),DisplayName),
                    Email=COALESCE(NULLIF(@Email,N''),Email),Phone=COALESCE(NULLIF(@Phone,N''),Phone),
                    SocialUsername=COALESCE(NULLIF(@Username,N''),SocialUsername),
                    Facebook=CASE WHEN @Channel=N'facebook' THEN COALESCE(NULLIF(@Username,N''),Facebook) ELSE Facebook END,
                    Instagram=CASE WHEN @Channel=N'instagram' THEN COALESCE(NULLIF(@Username,N''),Instagram) ELSE Instagram END,
                    [X]=CASE WHEN @Channel=N'x' THEN COALESCE(NULLIF(@Username,N''),[X]) ELSE [X] END,
                    [Source]=COALESCE(NULLIF([Source],N''),@Channel),LeadScore=@NextScore,LeadTemperature=@Temperature,
                    LastIntent=@Intent,ProductServiceInterest=COALESCE(ProductServiceInterest,JSON_VALUE(@QualificationJson,'$.productService')),
                    QualificationJson=CASE WHEN @QualificationJson IS NOT NULL THEN @QualificationJson ELSE QualificationJson END,
                    Budget=COALESCE(Budget,TRY_CONVERT(DECIMAL(19,4),JSON_VALUE(@QualificationJson,'$.budget'))),
                    PurchaseTimeline=COALESCE(PurchaseTimeline,JSON_VALUE(@QualificationJson,'$.purchaseTimeline')),
                    FirstContactAt=COALESCE(FirstContactAt,@OccurredAt),LastContactAt=@OccurredAt,UpdatedAt=SYSUTCDATETIME()
                WHERE LeadId=@LeadId;SET @LeadUpdated=1;
            END;

            IF @ExternalUserId IS NOT NULL
            BEGIN
                UPDATE dbo.SocialAccounts SET LeadId=@LeadId,Username=COALESCE(@Username,Username),
                    DisplayName=COALESCE(@DisplayName,DisplayName),ProfileUrl=COALESCE(@SourceUrl,ProfileUrl),
                    LastVerifiedAt=@OccurredAt,UpdatedAt=SYSUTCDATETIME()
                WHERE SocialPlatformId=@SocialPlatformId AND PlatformUserId=@ExternalUserId;
                IF @@ROWCOUNT=0 INSERT dbo.SocialAccounts(LeadId,SocialPlatformId,PlatformUserId,Username,DisplayName,ProfileUrl,LastVerifiedAt)
                    VALUES(@LeadId,@SocialPlatformId,@ExternalUserId,@Username,@DisplayName,@SourceUrl,@OccurredAt);
            END;
            INSERT dbo.LeadSourceAttribution(LeadId,SocialEventId,SourceChannel,ExternalUserId,SocialUsername,CampaignId,AdId,PostId,ExternalEventId,FirstTouchAt,LastInteractionAt)
            VALUES(@LeadId,@SocialEventId,@Channel,@ExternalUserId,@Username,@CampaignId,@AdId,@PostId,@ExternalEventId,@OccurredAt,@OccurredAt);
        END;

        INSERT dbo.SocialInteractions(SocialEventId,LeadId,SocialPlatformId,PlatformUserId,PlatformPostId,PlatformConversationId,
            InteractionType,MessageText,OccurredAt,Direction,Intent,Sentiment,ProductService,CampaignExternalId,CampaignName,
            AdvertisementId,LeadFormId,SourceType,RequiresReview,QualificationJson)
        VALUES(@SocialEventId,@LeadId,@SocialPlatformId,@ExternalUserId,@PostId,@ConversationId,@InteractionType,@Message,@OccurredAt,
            @Direction,@Intent,@Sentiment,JSON_VALUE(@QualificationJson,'$.productService'),@CampaignId,@CampaignName,@AdId,@LeadFormId,
            @SourceType,CASE WHEN @Qualified=0 AND @Intent<>N'OTHER' THEN 1 ELSE 0 END,@QualificationJson);

        IF @ConversationId IS NOT NULL
        BEGIN
            UPDATE dbo.SocialConversations SET LeadId=COALESCE(@LeadId,LeadId),LastMessageAt=@OccurredAt,Direction=@Direction,
                ImportantMessage=@Message,ReferenceUrl=COALESCE(@SourceUrl,ReferenceUrl),UpdatedAt=SYSUTCDATETIME()
            WHERE SocialPlatformId=@SocialPlatformId AND PlatformConversationId=@ConversationId;
            IF @@ROWCOUNT=0 INSERT dbo.SocialConversations(LeadId,SocialPlatformId,PlatformConversationId,LastMessageAt,Direction,ImportantMessage,ReferenceUrl)
                VALUES(@LeadId,@SocialPlatformId,@ConversationId,@OccurredAt,@Direction,@Message,@SourceUrl);
        END;
        IF @LeadId IS NOT NULL INSERT dbo.LeadActivities(LeadId,ActivityType,Summary,SourceReference,CampaignExternalId,OccurredAt)
            VALUES(@LeadId,@InteractionType,COALESCE(@Message,@Intent),@SourceUrl,@CampaignId,@OccurredAt);

        UPDATE dbo.SocialListenerStatus SET LastReceivedEvent=@OccurredAt,EventsProcessed=EventsProcessed+1,
            LeadsGenerated=LeadsGenerated+CASE WHEN @LeadCreated=1 THEN 1 ELSE 0 END,UpdatedAt=SYSUTCDATETIME() WHERE Channel=@Channel;
        IF @@ROWCOUNT=0 INSERT dbo.SocialListenerStatus(Channel,Status,LastReceivedEvent,EventsProcessed,LeadsGenerated)
            VALUES(@Channel,N'disconnected',@OccurredAt,1,CASE WHEN @LeadCreated=1 THEN 1 ELSE 0 END);
        COMMIT TRANSACTION;
        SELECT CAST(0 AS BIT) Duplicate,@LeadCreated LeadCreated,@LeadUpdated LeadUpdated,@LeadId LeadId,
               @SocialEventId SocialEventId,@NextScore LeadScore,@Temperature LeadTemperature;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialLead_GetRecent @Limit INT=100
AS
BEGIN
    SET NOCOUNT ON;
    SET @Limit=CASE WHEN @Limit<1 THEN 1 WHEN @Limit>500 THEN 500 ELSE @Limit END;
    SELECT TOP(@Limit) l.LeadId,l.Name,l.FirstName,l.LastName,l.DisplayName,l.Company,l.Email,l.Phone,
        l.SocialUsername,l.Facebook,l.Instagram,l.[X],COALESCE(NULLIF(l.[Source],N''),N'Manual') SourceChannel,
        l.Status,l.EstimatedValue Value,l.LeadScore,l.LeadTemperature,l.LastIntent,l.ProductServiceInterest,
        l.QualificationJson,l.Budget,l.PurchaseTimeline,l.PreferredContactMethod,l.AssignedSalesperson,l.ConsentStatus,
        l.ConvertedCustomer,l.LostReason,l.FirstContactAt,l.LastContactAt,l.CreatedAt,l.UpdatedAt
    FROM dbo.Leads l ORDER BY l.UpdatedAt DESC,l.LeadId DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialLead_GetUnified @LeadId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT LeadId,Name,FirstName,LastName,DisplayName,Company,Email,Phone,Country,StateRegion,City,
        [Source] SourceChannel,Status,EstimatedValue Value,LeadScore,LeadTemperature,LastIntent,ProductServiceInterest,
        QualificationJson,Budget,PurchaseTimeline,PreferredContactMethod,AssignedSalesperson,ConsentStatus,CrmNotes,
        ConvertedCustomer,LostReason,FirstContactAt,LastContactAt,CreatedAt,UpdatedAt
    FROM dbo.Leads WHERE LeadId=@LeadId;
    SELECT sa.SocialAccountId,sp.Code Platform,sa.PlatformUserId,sa.Username,sa.DisplayName,sa.ProfileUrl,sa.LastVerifiedAt
    FROM dbo.SocialAccounts sa JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId=sa.SocialPlatformId WHERE sa.LeadId=@LeadId;
    SELECT si.SocialInteractionId,sp.Code Platform,si.PlatformUserId,si.PlatformPostId,si.PlatformConversationId,
        si.InteractionType,si.MessageText,si.OccurredAt,si.Direction,si.Intent,si.Sentiment,si.ProductService,
        si.CampaignExternalId,si.CampaignName,si.AdvertisementId,si.LeadFormId,si.SourceType,si.ResponseStatus,si.QualificationJson
    FROM dbo.SocialInteractions si JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId=si.SocialPlatformId
    WHERE si.LeadId=@LeadId ORDER BY si.OccurredAt DESC;
    SELECT sc.SocialConversationId,sp.Code Platform,sc.PlatformConversationId,sc.LastMessageAt,sc.Direction,
        sc.ImportantMessage,sc.Status,sc.AssignedCrmUser,sc.ReferenceUrl
    FROM dbo.SocialConversations sc JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId=sc.SocialPlatformId
    WHERE sc.LeadId=@LeadId ORDER BY sc.LastMessageAt DESC;
    SELECT LeadActivityId,ActivityType,Summary,SourceReference,CampaignExternalId,OccurredAt FROM dbo.LeadActivities WHERE LeadId=@LeadId ORDER BY OccurredAt DESC;
    SELECT OpportunityId,CampaignId,Name,Stage,EstimatedValue,Status,CreatedAt,UpdatedAt FROM dbo.Opportunities WHERE LeadId=@LeadId ORDER BY UpdatedAt DESC;
    SELECT QuoteId,OpportunityId,Amount,Status,IssuedAt FROM dbo.Quotes WHERE LeadId=@LeadId ORDER BY IssuedAt DESC;
    SELECT AppointmentId,ScheduledAt,Status,AssignedCrmUser,Notes,CreatedAt FROM dbo.Appointments WHERE LeadId=@LeadId ORDER BY ScheduledAt DESC;
    SELECT CustomerConversionId,CustomerId,CampaignId,ConversionType,Value,ConvertedAt FROM dbo.CustomerConversions WHERE LeadId=@LeadId ORDER BY ConvertedAt DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialRawPayload_PurgeExpired
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.SocialEvents SET RawPayload=N'{}' WHERE RawPayloadExpiresAt<SYSUTCDATETIME() AND RawPayload<>N'{}';
    SELECT @@ROWCOUNT Purged;
END;
GO
