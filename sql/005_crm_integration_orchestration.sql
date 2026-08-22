SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.IntegrationEvents', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.IntegrationEvents
    (
        IntegrationEventId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_IntegrationEvents PRIMARY KEY,
        Provider NVARCHAR(64) NOT NULL,
        Channel NVARCHAR(32) NULL,
        Direction NVARCHAR(16) NOT NULL,
        EventType NVARCHAR(100) NOT NULL,
        IdempotencyKey NVARCHAR(255) NOT NULL,
        ExternalId NVARCHAR(255) NULL,
        ExternalStatus NVARCHAR(100) NULL,
        Status NVARCHAR(32) NOT NULL CONSTRAINT DF_IntegrationEvents_Status DEFAULT N'PENDING',
        AttemptCount INT NOT NULL CONSTRAINT DF_IntegrationEvents_AttemptCount DEFAULT 0,
        MaxAttempts INT NOT NULL CONSTRAINT DF_IntegrationEvents_MaxAttempts DEFAULT 4,
        NextAttemptAt DATETIME2(3) NULL,
        LastAttemptAt DATETIME2(3) NULL,
        ProcessedAt DATETIME2(3) NULL,
        LockToken UNIQUEIDENTIFIER NULL,
        LockedAt DATETIME2(3) NULL,
        CampaignId BIGINT NULL,
        LeadId BIGINT NULL,
        SocialInteractionId BIGINT NULL,
        RequestJson NVARCHAR(MAX) NULL,
        ResponseJson NVARCHAR(MAX) NULL,
        LastError NVARCHAR(1000) NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_IntegrationEvents_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_IntegrationEvents_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_IntegrationEvents_ProviderDirectionKey UNIQUE (Provider, Direction, IdempotencyKey),
        CONSTRAINT CK_IntegrationEvents_Direction CHECK (Direction IN (N'INBOUND', N'OUTBOUND')),
        CONSTRAINT CK_IntegrationEvents_Status CHECK (Status IN (N'PENDING', N'PROCESSING', N'SUCCEEDED', N'RETRY_SCHEDULED', N'FAILED')),
        CONSTRAINT CK_IntegrationEvents_Attempts CHECK (AttemptCount >= 0 AND MaxAttempts BETWEEN 1 AND 10),
        CONSTRAINT CK_IntegrationEvents_RequestJson CHECK (RequestJson IS NULL OR ISJSON(RequestJson) = 1),
        CONSTRAINT CK_IntegrationEvents_ResponseJson CHECK (ResponseJson IS NULL OR ISJSON(ResponseJson) = 1),
        CONSTRAINT FK_IntegrationEvents_Campaigns FOREIGN KEY (CampaignId) REFERENCES dbo.Campaigns(CampaignId),
        CONSTRAINT FK_IntegrationEvents_Leads FOREIGN KEY (LeadId) REFERENCES dbo.Leads(LeadId),
        CONSTRAINT FK_IntegrationEvents_SocialInteractions FOREIGN KEY (SocialInteractionId) REFERENCES dbo.SocialInteractions(SocialInteractionId)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.IntegrationEvents') AND name = N'IX_IntegrationEvents_Due')
    CREATE INDEX IX_IntegrationEvents_Due ON dbo.IntegrationEvents(Status, NextAttemptAt, CreatedAt) INCLUDE (Provider, EventType, AttemptCount, MaxAttempts);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.IntegrationEvents') AND name = N'IX_IntegrationEvents_Campaign')
    CREATE INDEX IX_IntegrationEvents_Campaign ON dbo.IntegrationEvents(CampaignId, CreatedAt DESC) WHERE CampaignId IS NOT NULL;
GO

IF OBJECT_ID(N'dbo.WorkflowRuns', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.WorkflowRuns
    (
        WorkflowRunId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WorkflowRuns PRIMARY KEY,
        WorkflowType NVARCHAR(100) NOT NULL,
        TriggerType NVARCHAR(100) NOT NULL,
        TriggerRecordId NVARCHAR(255) NULL,
        IntegrationEventId BIGINT NULL,
        State NVARCHAR(32) NOT NULL CONSTRAINT DF_WorkflowRuns_State DEFAULT N'RUNNING',
        CurrentStep NVARCHAR(100) NULL,
        ContextJson NVARCHAR(MAX) NULL,
        LastError NVARCHAR(1000) NULL,
        StartedAt DATETIME2(3) NOT NULL CONSTRAINT DF_WorkflowRuns_StartedAt DEFAULT SYSUTCDATETIME(),
        CompletedAt DATETIME2(3) NULL,
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_WorkflowRuns_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_WorkflowRuns_State CHECK (State IN (N'RUNNING', N'SUCCEEDED', N'RETRY_SCHEDULED', N'FAILED')),
        CONSTRAINT CK_WorkflowRuns_ContextJson CHECK (ContextJson IS NULL OR ISJSON(ContextJson) = 1),
        CONSTRAINT FK_WorkflowRuns_IntegrationEvents FOREIGN KEY (IntegrationEventId) REFERENCES dbo.IntegrationEvents(IntegrationEventId)
    );
END;
GO

IF OBJECT_ID(N'dbo.AuditLogs', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AuditLogs
    (
        AuditLogId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AuditLogs PRIMARY KEY,
        EntityType NVARCHAR(100) NOT NULL,
        EntityId NVARCHAR(255) NULL,
        Action NVARCHAR(100) NOT NULL,
        ActorType NVARCHAR(50) NOT NULL,
        ActorId NVARCHAR(255) NULL,
        CorrelationId NVARCHAR(255) NULL,
        DetailsJson NVARCHAR(MAX) NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AuditLogs_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT CK_AuditLogs_DetailsJson CHECK (DetailsJson IS NULL OR ISJSON(DetailsJson) = 1)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.AuditLogs') AND name = N'IX_AuditLogs_Entity')
    CREATE INDEX IX_AuditLogs_Entity ON dbo.AuditLogs(EntityType, EntityId, CreatedAt DESC);
GO

CREATE OR ALTER PROCEDURE dbo.CRMIntegrationEvent_Create
    @Provider NVARCHAR(64),
    @Channel NVARCHAR(32) = NULL,
    @Direction NVARCHAR(16),
    @EventType NVARCHAR(100),
    @IdempotencyKey NVARCHAR(255),
    @CampaignId BIGINT = NULL,
    @LeadId BIGINT = NULL,
    @RequestJson NVARCHAR(MAX) = NULL,
    @MaxAttempts INT = 4
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
    BEGIN TRANSACTION;
    DECLARE @IntegrationEventId BIGINT;
    SELECT @IntegrationEventId = IntegrationEventId
    FROM dbo.IntegrationEvents WITH (UPDLOCK, HOLDLOCK)
    WHERE Provider = @Provider AND Direction = @Direction AND IdempotencyKey = @IdempotencyKey;

    IF @IntegrationEventId IS NULL
    BEGIN
        INSERT dbo.IntegrationEvents
            (Provider, Channel, Direction, EventType, IdempotencyKey, CampaignId, LeadId, RequestJson, MaxAttempts, NextAttemptAt)
        VALUES
            (@Provider, @Channel, @Direction, @EventType, @IdempotencyKey, @CampaignId, @LeadId, @RequestJson,
             CASE WHEN @MaxAttempts < 1 THEN 1 WHEN @MaxAttempts > 10 THEN 10 ELSE @MaxAttempts END, NULL);
        SET @IntegrationEventId = SCOPE_IDENTITY();
        COMMIT TRANSACTION;
        SELECT *, CAST(0 AS BIT) AS Duplicate FROM dbo.IntegrationEvents WHERE IntegrationEventId = @IntegrationEventId;
        RETURN;
    END;

    COMMIT TRANSACTION;
    SELECT *, CAST(1 AS BIT) AS Duplicate FROM dbo.IntegrationEvents WHERE IntegrationEventId = @IntegrationEventId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CRMIntegrationEvent_RecordInbound
    @Provider NVARCHAR(64),
    @Channel NVARCHAR(32) = NULL,
    @EventType NVARCHAR(100),
    @IdempotencyKey NVARCHAR(255),
    @ExternalId NVARCHAR(255) = NULL,
    @RequestJson NVARCHAR(MAX) = NULL,
    @Succeeded BIT = 1,
    @LastError NVARCHAR(1000) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
    BEGIN TRANSACTION;
    DECLARE @IntegrationEventId BIGINT;
    SELECT @IntegrationEventId = IntegrationEventId
    FROM dbo.IntegrationEvents WITH (UPDLOCK, HOLDLOCK)
    WHERE Provider = @Provider AND Direction = N'INBOUND' AND IdempotencyKey = @IdempotencyKey;

    IF @IntegrationEventId IS NULL
    BEGIN
        INSERT dbo.IntegrationEvents
            (Provider, Channel, Direction, EventType, IdempotencyKey, ExternalId, ExternalStatus, Status,
             AttemptCount, MaxAttempts, ProcessedAt, RequestJson, NextAttemptAt)
        VALUES
            (@Provider, @Channel, N'INBOUND', @EventType, @IdempotencyKey, @ExternalId,
             CASE WHEN @Succeeded = 1 THEN N'RECEIVED' ELSE N'PROCESSING_FAILED' END,
             CASE WHEN @Succeeded = 1 THEN N'SUCCEEDED' ELSE N'FAILED' END,
             1, 1, SYSUTCDATETIME(), @RequestJson, NULL);
        SET @IntegrationEventId = SCOPE_IDENTITY();
        UPDATE dbo.IntegrationEvents SET LastError = @LastError WHERE IntegrationEventId = @IntegrationEventId;
        COMMIT TRANSACTION;
        SELECT *, CAST(0 AS BIT) AS Duplicate FROM dbo.IntegrationEvents WHERE IntegrationEventId = @IntegrationEventId;
        RETURN;
    END;

    IF @Succeeded = 1
        UPDATE dbo.IntegrationEvents
           SET Status = N'SUCCEEDED', ExternalStatus = N'RECEIVED', LastError = NULL,
               ProcessedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
         WHERE IntegrationEventId = @IntegrationEventId AND Status = N'FAILED';
    COMMIT TRANSACTION;
    SELECT *, CAST(1 AS BIT) AS Duplicate FROM dbo.IntegrationEvents WHERE IntegrationEventId = @IntegrationEventId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CRMIntegrationEvent_ClaimDue
    @Now DATETIME2(3),
    @Limit INT,
    @LockToken UNIQUEIDENTIFIER,
    @IntegrationEventId BIGINT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    ;WITH Due AS
    (
        SELECT TOP (CASE WHEN @Limit < 1 THEN 1 WHEN @Limit > 100 THEN 100 ELSE @Limit END) IntegrationEventId
        FROM dbo.IntegrationEvents WITH (UPDLOCK, READPAST, ROWLOCK)
        WHERE Direction = N'OUTBOUND'
          AND Status IN (N'PENDING', N'RETRY_SCHEDULED')
          AND (NextAttemptAt IS NULL OR NextAttemptAt <= @Now)
          AND (@IntegrationEventId IS NULL OR IntegrationEventId = @IntegrationEventId)
        ORDER BY CreatedAt, IntegrationEventId
    )
    UPDATE target
       SET Status = N'PROCESSING',
           AttemptCount = AttemptCount + 1,
           LastAttemptAt = @Now,
           LockToken = @LockToken,
           LockedAt = @Now,
           UpdatedAt = @Now
    OUTPUT inserted.*
    FROM dbo.IntegrationEvents target
    INNER JOIN Due ON Due.IntegrationEventId = target.IntegrationEventId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CRMIntegrationEvent_Complete
    @IntegrationEventId BIGINT,
    @LockToken UNIQUEIDENTIFIER,
    @Succeeded BIT,
    @ExternalId NVARCHAR(255) = NULL,
    @ExternalStatus NVARCHAR(100) = NULL,
    @ResponseJson NVARCHAR(MAX) = NULL,
    @LastError NVARCHAR(1000) = NULL,
    @Retryable BIT = 0,
    @NextAttemptAt DATETIME2(3) = NULL,
    @ProcessedAt DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.IntegrationEvents
       SET Status = CASE
             WHEN @Succeeded = 1 THEN N'SUCCEEDED'
             WHEN @Retryable = 1 AND AttemptCount < MaxAttempts AND @NextAttemptAt IS NOT NULL THEN N'RETRY_SCHEDULED'
             ELSE N'FAILED'
           END,
           ExternalId = COALESCE(@ExternalId, ExternalId),
           ExternalStatus = COALESCE(@ExternalStatus, ExternalStatus),
           ResponseJson = COALESCE(@ResponseJson, ResponseJson),
           LastError = CASE WHEN @Succeeded = 1 THEN NULL ELSE @LastError END,
           NextAttemptAt = CASE
             WHEN @Succeeded = 0 AND @Retryable = 1 AND AttemptCount < MaxAttempts THEN @NextAttemptAt
             ELSE NULL
           END,
           ProcessedAt = CASE
             WHEN @Succeeded = 1 OR @Retryable = 0 OR AttemptCount >= MaxAttempts THEN @ProcessedAt
             ELSE ProcessedAt
           END,
           LockToken = NULL,
           LockedAt = NULL,
           UpdatedAt = @ProcessedAt
     WHERE IntegrationEventId = @IntegrationEventId
       AND Status = N'PROCESSING'
       AND LockToken = @LockToken;

    SELECT * FROM dbo.IntegrationEvents WHERE IntegrationEventId = @IntegrationEventId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CRMIntegrationEvent_GetRecent
    @Limit INT = 100,
    @CampaignId BIGINT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (CASE WHEN @Limit < 1 THEN 1 WHEN @Limit > 500 THEN 500 ELSE @Limit END) *
    FROM dbo.IntegrationEvents
    WHERE @CampaignId IS NULL OR CampaignId = @CampaignId
    ORDER BY CreatedAt DESC, IntegrationEventId DESC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CRMWorkflowRun_Start
    @WorkflowType NVARCHAR(100),
    @TriggerType NVARCHAR(100),
    @TriggerRecordId NVARCHAR(255) = NULL,
    @IntegrationEventId BIGINT = NULL,
    @ContextJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    INSERT dbo.WorkflowRuns (WorkflowType, TriggerType, TriggerRecordId, IntegrationEventId, State, CurrentStep, ContextJson)
    VALUES (@WorkflowType, @TriggerType, @TriggerRecordId, @IntegrationEventId, N'RUNNING', N'STARTED', @ContextJson);
    SELECT * FROM dbo.WorkflowRuns WHERE WorkflowRunId = SCOPE_IDENTITY();
END;
GO

CREATE OR ALTER PROCEDURE dbo.CRMWorkflowRun_Complete
    @WorkflowRunId BIGINT,
    @State NVARCHAR(32),
    @CurrentStep NVARCHAR(100) = NULL,
    @LastError NVARCHAR(1000) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.WorkflowRuns
       SET State = @State,
           CurrentStep = @CurrentStep,
           LastError = @LastError,
           CompletedAt = CASE WHEN @State IN (N'SUCCEEDED', N'FAILED') THEN SYSUTCDATETIME() ELSE NULL END,
           UpdatedAt = SYSUTCDATETIME()
     WHERE WorkflowRunId = @WorkflowRunId;
    SELECT * FROM dbo.WorkflowRuns WHERE WorkflowRunId = @WorkflowRunId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CRMAuditLog_Insert
    @EntityType NVARCHAR(100),
    @EntityId NVARCHAR(255) = NULL,
    @Action NVARCHAR(100),
    @ActorType NVARCHAR(50),
    @ActorId NVARCHAR(255) = NULL,
    @CorrelationId NVARCHAR(255) = NULL,
    @DetailsJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    INSERT dbo.AuditLogs (EntityType, EntityId, Action, ActorType, ActorId, CorrelationId, DetailsJson)
    VALUES (@EntityType, @EntityId, @Action, @ActorType, @ActorId, @CorrelationId, @DetailsJson);
    SELECT * FROM dbo.AuditLogs WHERE AuditLogId = SCOPE_IDENTITY();
END;
GO
