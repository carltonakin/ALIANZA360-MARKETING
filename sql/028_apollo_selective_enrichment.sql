/*
  Apollo decision-maker discovery and selective enrichment.
  This migration adds provider-specific audit/state tables only. It does not
  replace Prospects, Leads, LeadScore, communication policy, or conversion.
*/

IF OBJECT_ID(N'dbo.AIAcquisitionApolloProfiles', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AIAcquisitionApolloProfiles
    (
        AIAcquisitionApolloProfileId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AIAcquisitionApolloProfiles PRIMARY KEY,
        AIAcquisitionProspectId BIGINT NOT NULL,
        AIAcquisitionConfigurationId BIGINT NOT NULL,
        ApolloPersonId NVARCHAR(255) NOT NULL,
        ApolloOrganizationId NVARCHAR(255) NULL,
        FirstName NVARCHAR(255) NULL,
        LastName NVARCHAR(255) NULL,
        FullName NVARCHAR(255) NULL,
        JobTitle NVARCHAR(500) NULL,
        Seniority NVARCHAR(100) NULL,
        CompanyDomain NVARCHAR(500) NULL,
        LinkedInUrl NVARCHAR(2048) NULL,
        Email NVARCHAR(320) NULL,
        EmailStatus NVARCHAR(64) NULL,
        EmailSource NVARCHAR(255) NULL,
        EmailEnrichedAt DATETIME2(3) NULL,
        Phone NVARCHAR(80) NULL,
        PhoneType NVARCHAR(64) NULL,
        PhoneStatus NVARCHAR(64) NULL,
        PhoneSource NVARCHAR(255) NULL,
        PhoneEnrichedAt DATETIME2(3) NULL,
        MatchConfidence NVARCHAR(32) NULL,
        EnrichmentStatus NVARCHAR(32) NOT NULL CONSTRAINT DF_AIAcquisitionApolloProfiles_Status DEFAULT N'NOT_REQUESTED',
        StandardEnrichmentUsed BIT NOT NULL CONSTRAINT DF_AIAcquisitionApolloProfiles_Standard DEFAULT 0,
        WaterfallEmailUsed BIT NOT NULL CONSTRAINT DF_AIAcquisitionApolloProfiles_WaterfallEmail DEFAULT 0,
        PhoneEnrichmentUsed BIT NOT NULL CONSTRAINT DF_AIAcquisitionApolloProfiles_Phone DEFAULT 0,
        WaterfallPhoneUsed BIT NOT NULL CONSTRAINT DF_AIAcquisitionApolloProfiles_WaterfallPhone DEFAULT 0,
        EnrichmentSource NVARCHAR(255) NULL,
        PendingRequestKind NVARCHAR(32) NULL,
        ApolloRequestId NVARCHAR(64) NULL,
        PendingUsageKey NVARCHAR(255) NULL,
        NextPollAt DATETIME2(3) NULL,
        LastError NVARCHAR(1000) NULL,
        LastEnrichmentAt DATETIME2(3) NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionApolloProfiles_Created DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionApolloProfiles_Updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_AIAcquisitionApolloProfiles_Prospect FOREIGN KEY (AIAcquisitionProspectId) REFERENCES dbo.AIAcquisitionProspects(AIAcquisitionProspectId),
        CONSTRAINT FK_AIAcquisitionApolloProfiles_Configuration FOREIGN KEY (AIAcquisitionConfigurationId) REFERENCES dbo.AIAcquisitionConfigurations(AIAcquisitionConfigurationId),
        CONSTRAINT UQ_AIAcquisitionApolloProfiles_Prospect UNIQUE (AIAcquisitionProspectId),
        CONSTRAINT UQ_AIAcquisitionApolloProfiles_Person UNIQUE (AIAcquisitionConfigurationId, ApolloPersonId),
        CONSTRAINT CK_AIAcquisitionApolloProfiles_Status CHECK (EnrichmentStatus IN
          (N'NOT_REQUESTED',N'PENDING',N'STANDARD_COMPLETED',N'WATERFALL_PENDING',N'WATERFALL_COMPLETED',N'NO_DATA',N'FAILED',N'RATE_LIMITED',N'BUDGET_LIMIT_REACHED'))
    );
END
GO

IF COL_LENGTH(N'dbo.AIAcquisitionApolloProfiles', N'PendingUsageKey') IS NULL
    ALTER TABLE dbo.AIAcquisitionApolloProfiles ADD PendingUsageKey NVARCHAR(255) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.AIAcquisitionApolloProfiles') AND name=N'IX_AIAcquisitionApolloProfiles_Work')
    CREATE INDEX IX_AIAcquisitionApolloProfiles_Work
      ON dbo.AIAcquisitionApolloProfiles(AIAcquisitionConfigurationId,EnrichmentStatus,NextPollAt)
      INCLUDE (AIAcquisitionProspectId,ApolloPersonId,StandardEnrichmentUsed,WaterfallEmailUsed,PhoneEnrichmentUsed,WaterfallPhoneUsed);
GO

IF OBJECT_ID(N'dbo.AIAcquisitionApolloUsage', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AIAcquisitionApolloUsage
    (
        AIAcquisitionApolloUsageId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AIAcquisitionApolloUsage PRIMARY KEY,
        AIAcquisitionConfigurationId BIGINT NOT NULL,
        RequestKey NVARCHAR(255) NOT NULL,
        RequestKind NVARCHAR(32) NOT NULL,
        ApolloRequestId NVARCHAR(64) NULL,
        RequestedCount INT NOT NULL CONSTRAINT DF_AIAcquisitionApolloUsage_Requested DEFAULT 0,
        SuccessCount INT NOT NULL CONSTRAINT DF_AIAcquisitionApolloUsage_Success DEFAULT 0,
        CreditsConsumed DECIMAL(18,4) NOT NULL CONSTRAINT DF_AIAcquisitionApolloUsage_Credits DEFAULT 0,
        EstimatedCredits DECIMAL(18,4) NOT NULL CONSTRAINT DF_AIAcquisitionApolloUsage_Estimated DEFAULT 0,
        [Status] NVARCHAR(32) NOT NULL,
        ErrorCode NVARCHAR(255) NULL,
        ErrorMessage NVARCHAR(1000) NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionApolloUsage_Created DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionApolloUsage_Updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_AIAcquisitionApolloUsage_Configuration FOREIGN KEY (AIAcquisitionConfigurationId) REFERENCES dbo.AIAcquisitionConfigurations(AIAcquisitionConfigurationId),
        CONSTRAINT UQ_AIAcquisitionApolloUsage_RequestKey UNIQUE (RequestKey),
        CONSTRAINT CK_AIAcquisitionApolloUsage_Counts CHECK (RequestedCount>=0 AND SuccessCount>=0),
        CONSTRAINT CK_AIAcquisitionApolloUsage_Credits CHECK (CreditsConsumed>=0 AND EstimatedCredits>=0)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.AIAcquisitionApolloUsage') AND name=N'IX_AIAcquisitionApolloUsage_Configuration_CreatedAt')
    CREATE INDEX IX_AIAcquisitionApolloUsage_Configuration_CreatedAt
      ON dbo.AIAcquisitionApolloUsage(AIAcquisitionConfigurationId,CreatedAt DESC)
      INCLUDE (RequestKind,RequestedCount,SuccessCount,CreditsConsumed,EstimatedCredits,[Status]);
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionApolloProfile_UpsertDiscovery
    @AIAcquisitionProspectId BIGINT,
    @AIAcquisitionConfigurationId BIGINT,
    @ApolloPersonId NVARCHAR(255),
    @ApolloOrganizationId NVARCHAR(255)=NULL,
    @FirstName NVARCHAR(255)=NULL,
    @LastName NVARCHAR(255)=NULL,
    @FullName NVARCHAR(255)=NULL,
    @JobTitle NVARCHAR(500)=NULL,
    @Seniority NVARCHAR(100)=NULL,
    @CompanyDomain NVARCHAR(500)=NULL,
    @LinkedInUrl NVARCHAR(2048)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;
    DECLARE @ExistingProspectId BIGINT;
    SELECT @ExistingProspectId=AIAcquisitionProspectId
    FROM dbo.AIAcquisitionApolloProfiles WITH (UPDLOCK,HOLDLOCK)
    WHERE AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId AND ApolloPersonId=@ApolloPersonId;

    IF @ExistingProspectId IS NULL
        INSERT dbo.AIAcquisitionApolloProfiles
          (AIAcquisitionProspectId,AIAcquisitionConfigurationId,ApolloPersonId,ApolloOrganizationId,FirstName,LastName,FullName,JobTitle,Seniority,CompanyDomain,LinkedInUrl)
        VALUES
          (@AIAcquisitionProspectId,@AIAcquisitionConfigurationId,@ApolloPersonId,@ApolloOrganizationId,@FirstName,@LastName,@FullName,@JobTitle,@Seniority,@CompanyDomain,@LinkedInUrl);
    ELSE
        UPDATE dbo.AIAcquisitionApolloProfiles SET
          ApolloOrganizationId=COALESCE(@ApolloOrganizationId,ApolloOrganizationId),
          FirstName=COALESCE(@FirstName,FirstName), LastName=COALESCE(@LastName,LastName), FullName=COALESCE(@FullName,FullName),
          JobTitle=COALESCE(@JobTitle,JobTitle), Seniority=COALESCE(@Seniority,Seniority),
          CompanyDomain=COALESCE(@CompanyDomain,CompanyDomain), LinkedInUrl=COALESCE(@LinkedInUrl,LinkedInUrl), UpdatedAt=SYSUTCDATETIME()
        WHERE AIAcquisitionProspectId=@ExistingProspectId;
    SET @ExistingProspectId=COALESCE(@ExistingProspectId,@AIAcquisitionProspectId);
    UPDATE dbo.AIAcquisitionProspects SET
      ContactName=CASE WHEN NULLIF(ContactName,N'') IS NULL THEN @FullName ELSE ContactName END,
      Website=CASE WHEN NULLIF(Website,N'') IS NULL AND NULLIF(@CompanyDomain,N'') IS NOT NULL THEN CONCAT(N'https://',@CompanyDomain) ELSE Website END,
      SourceUrl=CASE WHEN NULLIF(SourceUrl,N'') IS NULL THEN @LinkedInUrl ELSE SourceUrl END,
      UpdatedAt=SYSUTCDATETIME()
    WHERE AIAcquisitionProspectId=@ExistingProspectId;
    COMMIT TRANSACTION;
    SELECT * FROM dbo.AIAcquisitionApolloProfiles
    WHERE AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId AND ApolloPersonId=@ApolloPersonId;
END
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionApolloProfile_Get
    @AIAcquisitionConfigurationId BIGINT=NULL,
    @AIAcquisitionProspectId BIGINT=NULL,
    @PendingOnly BIT=0,
    @Limit INT=100
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (@Limit) profile.*, prospect.CompanyName,prospect.ContactName,prospect.Website,
      prospect.Email ProspectEmail,prospect.Phone ProspectPhone,prospect.WhatsAppNumber,
      prospect.FitScore,prospect.[Status] ProspectStatus,prospect.OptedOut,prospect.ConsentStatus,
      prospect.Source ProspectSource
    FROM dbo.AIAcquisitionApolloProfiles profile
    JOIN dbo.AIAcquisitionProspects prospect ON prospect.AIAcquisitionProspectId=profile.AIAcquisitionProspectId
    WHERE (@AIAcquisitionConfigurationId IS NULL OR profile.AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId)
      AND (@AIAcquisitionProspectId IS NULL OR profile.AIAcquisitionProspectId=@AIAcquisitionProspectId)
      AND (@PendingOnly=0 OR (profile.ApolloRequestId IS NOT NULL AND profile.PendingRequestKind IS NOT NULL
        AND (profile.NextPollAt IS NULL OR profile.NextPollAt<=SYSUTCDATETIME())))
    ORDER BY profile.UpdatedAt,profile.AIAcquisitionApolloProfileId;
END
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionApolloProfile_Update
    @AIAcquisitionProspectId BIGINT,
    @FirstName NVARCHAR(255)=NULL,
    @LastName NVARCHAR(255)=NULL,
    @FullName NVARCHAR(255)=NULL,
    @JobTitle NVARCHAR(500)=NULL,
    @Seniority NVARCHAR(100)=NULL,
    @CompanyDomain NVARCHAR(500)=NULL,
    @LinkedInUrl NVARCHAR(2048)=NULL,
    @Email NVARCHAR(320)=NULL,
    @EmailStatus NVARCHAR(64)=NULL,
    @PersistEmail BIT=0,
    @Phone NVARCHAR(80)=NULL,
    @PhoneType NVARCHAR(64)=NULL,
    @PhoneStatus NVARCHAR(64)=NULL,
    @PersistPhone BIT=0,
    @MatchConfidence NVARCHAR(32)=NULL,
    @EnrichmentStatus NVARCHAR(32),
    @PendingRequestKind NVARCHAR(32)=NULL,
    @ApolloRequestId NVARCHAR(64)=NULL,
    @PendingUsageKey NVARCHAR(255)=NULL,
    @NextPollAt DATETIME2(3)=NULL,
    @LastError NVARCHAR(1000)=NULL,
    @StandardEnrichmentUsed BIT=NULL,
    @WaterfallEmailUsed BIT=NULL,
    @PhoneEnrichmentUsed BIT=NULL,
    @WaterfallPhoneUsed BIT=NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;
    UPDATE dbo.AIAcquisitionApolloProfiles SET
      FirstName=COALESCE(@FirstName,FirstName),LastName=COALESCE(@LastName,LastName),FullName=COALESCE(@FullName,FullName),
      JobTitle=COALESCE(@JobTitle,JobTitle),Seniority=COALESCE(@Seniority,Seniority),CompanyDomain=COALESCE(@CompanyDomain,CompanyDomain),
      LinkedInUrl=COALESCE(@LinkedInUrl,LinkedInUrl),Email=COALESCE(@Email,Email),EmailStatus=COALESCE(@EmailStatus,EmailStatus),
      EmailSource=CASE WHEN @Email IS NOT NULL THEN N'APOLLO_IO' ELSE EmailSource END,
      EmailEnrichedAt=CASE WHEN @Email IS NOT NULL THEN SYSUTCDATETIME() ELSE EmailEnrichedAt END,
      Phone=COALESCE(@Phone,Phone),PhoneType=COALESCE(@PhoneType,PhoneType),PhoneStatus=COALESCE(@PhoneStatus,PhoneStatus),
      PhoneSource=CASE WHEN @Phone IS NOT NULL THEN N'APOLLO_IO' ELSE PhoneSource END,
      PhoneEnrichedAt=CASE WHEN @Phone IS NOT NULL THEN SYSUTCDATETIME() ELSE PhoneEnrichedAt END,
      MatchConfidence=COALESCE(@MatchConfidence,MatchConfidence),EnrichmentStatus=@EnrichmentStatus,
      PendingRequestKind=@PendingRequestKind,ApolloRequestId=@ApolloRequestId,PendingUsageKey=@PendingUsageKey,
      NextPollAt=@NextPollAt,LastError=@LastError,
      StandardEnrichmentUsed=COALESCE(@StandardEnrichmentUsed,StandardEnrichmentUsed),
      WaterfallEmailUsed=COALESCE(@WaterfallEmailUsed,WaterfallEmailUsed),PhoneEnrichmentUsed=COALESCE(@PhoneEnrichmentUsed,PhoneEnrichmentUsed),
      WaterfallPhoneUsed=COALESCE(@WaterfallPhoneUsed,WaterfallPhoneUsed),
      LastEnrichmentAt=CASE WHEN @EnrichmentStatus NOT IN (N'PENDING',N'WATERFALL_PENDING') THEN SYSUTCDATETIME() ELSE LastEnrichmentAt END,
      UpdatedAt=SYSUTCDATETIME()
    WHERE AIAcquisitionProspectId=@AIAcquisitionProspectId;

    IF @PersistEmail=1 AND NULLIF(@Email,N'') IS NOT NULL
    BEGIN
      UPDATE dbo.AIAcquisitionProspects SET Email=@Email,
        [Status]=CASE WHEN [Status] IN (N'DISCOVERED',N'ENRICHING') THEN N'CONTACTABLE' ELSE [Status] END,
        UpdatedAt=SYSUTCDATETIME()
      WHERE AIAcquisitionProspectId=@AIAcquisitionProspectId AND OptedOut=0 AND [Status]<>N'DO_NOT_CONTACT';
      MERGE dbo.AIAcquisitionProspectContacts AS target
      USING (SELECT @AIAcquisitionProspectId ProspectId,@Email ContactValue) AS source
      ON target.AIAcquisitionProspectId=source.ProspectId AND target.ContactType=N'EMAIL' AND target.ContactValue=source.ContactValue
      WHEN MATCHED THEN UPDATE SET SourceName=N'APOLLO_IO',Verified=CASE WHEN LOWER(COALESCE(@EmailStatus,N''))=N'verified' THEN 1 ELSE target.Verified END,UpdatedAt=SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (AIAcquisitionProspectId,ContactType,ContactValue,SourceName,Verified)
        VALUES(source.ProspectId,N'EMAIL',source.ContactValue,N'APOLLO_IO',CASE WHEN LOWER(COALESCE(@EmailStatus,N''))=N'verified' THEN 1 ELSE 0 END);
    END

    IF @PersistPhone=1 AND NULLIF(@Phone,N'') IS NOT NULL
    BEGIN
      UPDATE dbo.AIAcquisitionProspects SET Phone=@Phone,
        [Status]=CASE WHEN [Status] IN (N'DISCOVERED',N'ENRICHING') THEN N'CONTACTABLE' ELSE [Status] END,
        UpdatedAt=SYSUTCDATETIME()
      WHERE AIAcquisitionProspectId=@AIAcquisitionProspectId AND OptedOut=0 AND [Status]<>N'DO_NOT_CONTACT';
      MERGE dbo.AIAcquisitionProspectContacts AS target
      USING (SELECT @AIAcquisitionProspectId ProspectId,@Phone ContactValue) AS source
      ON target.AIAcquisitionProspectId=source.ProspectId AND target.ContactType=N'PHONE' AND target.ContactValue=source.ContactValue
      WHEN MATCHED THEN UPDATE SET SourceName=N'APOLLO_IO',UpdatedAt=SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (AIAcquisitionProspectId,ContactType,ContactValue,SourceName,Verified)
        VALUES(source.ProspectId,N'PHONE',source.ContactValue,N'APOLLO_IO',0);
    END
    COMMIT TRANSACTION;
    EXEC dbo.AIAcquisitionApolloProfile_Get @AIAcquisitionProspectId=@AIAcquisitionProspectId,@Limit=1;
END
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionApolloUsage_Save
    @AIAcquisitionConfigurationId BIGINT,
    @RequestKey NVARCHAR(255),
    @RequestKind NVARCHAR(32),
    @ApolloRequestId NVARCHAR(64)=NULL,
    @RequestedCount INT=0,
    @SuccessCount INT=0,
    @CreditsConsumed DECIMAL(18,4)=0,
    @EstimatedCredits DECIMAL(18,4)=0,
    @Status NVARCHAR(32),
    @ErrorCode NVARCHAR(255)=NULL,
    @ErrorMessage NVARCHAR(1000)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    MERGE dbo.AIAcquisitionApolloUsage WITH (HOLDLOCK) AS target
    USING (SELECT @RequestKey RequestKey) AS source ON target.RequestKey=source.RequestKey
    WHEN MATCHED THEN UPDATE SET ApolloRequestId=COALESCE(@ApolloRequestId,target.ApolloRequestId),
      SuccessCount=@SuccessCount,CreditsConsumed=@CreditsConsumed,EstimatedCredits=@EstimatedCredits,[Status]=@Status,
      ErrorCode=@ErrorCode,ErrorMessage=@ErrorMessage,UpdatedAt=SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT
      (AIAcquisitionConfigurationId,RequestKey,RequestKind,ApolloRequestId,RequestedCount,SuccessCount,CreditsConsumed,EstimatedCredits,[Status],ErrorCode,ErrorMessage)
      VALUES(@AIAcquisitionConfigurationId,@RequestKey,@RequestKind,@ApolloRequestId,@RequestedCount,@SuccessCount,@CreditsConsumed,@EstimatedCredits,@Status,@ErrorCode,@ErrorMessage);
    SELECT * FROM dbo.AIAcquisitionApolloUsage WHERE RequestKey=@RequestKey;
END
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionApolloUsage_Reserve
    @AIAcquisitionConfigurationId BIGINT,
    @RequestKey NVARCHAR(255),
    @RequestKind NVARCHAR(32),
    @RequestedCount INT,
    @EstimatedCredits DECIMAL(18,4),
    @DailyCreditLimit DECIMAL(18,4),
    @MonthlyCreditLimit DECIMAL(18,4)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;
    DECLARE @DailyUsed DECIMAL(18,4)=0,@MonthlyUsed DECIMAL(18,4)=0,@Allowed BIT=0;
    SELECT
      @DailyUsed=COALESCE(SUM(CASE WHEN CreatedAt>=CONVERT(date,SYSUTCDATETIME()) THEN CreditsConsumed+EstimatedCredits ELSE 0 END),0),
      @MonthlyUsed=COALESCE(SUM(CASE WHEN CreatedAt>=CONVERT(date,DATEFROMPARTS(YEAR(SYSUTCDATETIME()),MONTH(SYSUTCDATETIME()),1)) THEN CreditsConsumed+EstimatedCredits ELSE 0 END),0)
    FROM dbo.AIAcquisitionApolloUsage WITH (UPDLOCK,HOLDLOCK)
    WHERE AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId;
    IF @DailyCreditLimit>0 AND @MonthlyCreditLimit>0 AND
       @DailyUsed+@EstimatedCredits<=@DailyCreditLimit AND @MonthlyUsed+@EstimatedCredits<=@MonthlyCreditLimit
    BEGIN
      INSERT dbo.AIAcquisitionApolloUsage
        (AIAcquisitionConfigurationId,RequestKey,RequestKind,RequestedCount,EstimatedCredits,[Status])
      VALUES(@AIAcquisitionConfigurationId,@RequestKey,@RequestKind,@RequestedCount,@EstimatedCredits,N'REQUESTED');
      SET @Allowed=1;
    END
    COMMIT TRANSACTION;
    SELECT @Allowed Allowed,@DailyUsed DailyCreditsReservedOrConsumed,@MonthlyUsed MonthlyCreditsReservedOrConsumed;
END
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionApolloUsage_Get
    @AIAcquisitionConfigurationId BIGINT,
    @Limit INT=100
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
      COALESCE(SUM(CASE WHEN CreatedAt>=CONVERT(date,SYSUTCDATETIME()) THEN CreditsConsumed ELSE 0 END),0) DailyCreditsConsumed,
      COALESCE(SUM(CASE WHEN CreatedAt>=CONVERT(date,DATEFROMPARTS(YEAR(SYSUTCDATETIME()),MONTH(SYSUTCDATETIME()),1)) THEN CreditsConsumed ELSE 0 END),0) MonthlyCreditsConsumed,
      COALESCE(SUM(CASE WHEN CreatedAt>=CONVERT(date,SYSUTCDATETIME()) THEN EstimatedCredits ELSE 0 END),0) DailyEstimatedCredits,
      COALESCE(SUM(CASE WHEN CreatedAt>=CONVERT(date,DATEFROMPARTS(YEAR(SYSUTCDATETIME()),MONTH(SYSUTCDATETIME()),1)) THEN EstimatedCredits ELSE 0 END),0) MonthlyEstimatedCredits,
      COUNT_BIG(*) RequestCount,
      COALESCE(SUM(RequestedCount),0) RequestedCount,
      COALESCE(SUM(SuccessCount),0) SuccessCount,
      COALESCE(SUM(CASE WHEN [Status]=N'FAILED' THEN 1 ELSE 0 END),0) FailedRequests,
      COALESCE(SUM(CASE WHEN [Status]=N'RATE_LIMITED' THEN 1 ELSE 0 END),0) RateLimitedRequests
    FROM dbo.AIAcquisitionApolloUsage WHERE AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId;
    SELECT TOP (@Limit) * FROM dbo.AIAcquisitionApolloUsage
    WHERE AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId
    ORDER BY CreatedAt DESC,AIAcquisitionApolloUsageId DESC;
END
GO
