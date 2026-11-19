IF COL_LENGTH(N'dbo.AIAcquisitionContactAttempts', N'EmailPayloadJson') IS NULL
    ALTER TABLE dbo.AIAcquisitionContactAttempts ADD EmailPayloadJson NVARCHAR(MAX) NULL;
GO
IF COL_LENGTH(N'dbo.AIAcquisitionContactAttempts', N'ProviderStatus') IS NULL
    ALTER TABLE dbo.AIAcquisitionContactAttempts ADD ProviderStatus NVARCHAR(64) NULL;
GO
IF COL_LENGTH(N'dbo.AIAcquisitionContactAttempts', N'ProviderStatusAt') IS NULL
    ALTER TABLE dbo.AIAcquisitionContactAttempts ADD ProviderStatusAt DATETIME2(3) NULL;
GO
IF COL_LENGTH(N'dbo.AIAcquisitionContactAttempts', N'DeliveredAt') IS NULL
    ALTER TABLE dbo.AIAcquisitionContactAttempts ADD DeliveredAt DATETIME2(3) NULL;
GO
IF COL_LENGTH(N'dbo.AIAcquisitionProspectContacts', N'SuppressedAt') IS NULL
    ALTER TABLE dbo.AIAcquisitionProspectContacts ADD SuppressedAt DATETIME2(3) NULL;
GO
IF COL_LENGTH(N'dbo.AIAcquisitionProspectContacts', N'SuppressionReason') IS NULL
    ALTER TABLE dbo.AIAcquisitionProspectContacts ADD SuppressionReason NVARCHAR(1000) NULL;
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id=OBJECT_ID(N'dbo.AIAcquisitionContactAttempts')
      AND name=N'CK_AIAcquisitionContactAttempts_EmailPayloadJson'
)
    ALTER TABLE dbo.AIAcquisitionContactAttempts ADD CONSTRAINT CK_AIAcquisitionContactAttempts_EmailPayloadJson
        CHECK (EmailPayloadJson IS NULL OR ISJSON(EmailPayloadJson)=1);
GO

IF OBJECT_ID(N'dbo.AIAcquisitionEmailEvents', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AIAcquisitionEmailEvents
    (
        AIAcquisitionEmailEventId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AIAcquisitionEmailEvents PRIMARY KEY,
        WebhookEventId NVARCHAR(255) NOT NULL,
        AIAcquisitionContactAttemptId BIGINT NOT NULL,
        ExternalMessageId NVARCHAR(255) NOT NULL,
        EventType NVARCHAR(64) NOT NULL,
        EventAt DATETIME2(3) NOT NULL,
        FailureReason NVARCHAR(1000) NULL,
        PayloadJson NVARCHAR(MAX) NOT NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AIAcquisitionEmailEvents_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_AIAcquisitionEmailEvents_Webhook UNIQUE (WebhookEventId),
        CONSTRAINT FK_AIAcquisitionEmailEvents_Attempt FOREIGN KEY (AIAcquisitionContactAttemptId)
            REFERENCES dbo.AIAcquisitionContactAttempts(AIAcquisitionContactAttemptId),
        CONSTRAINT CK_AIAcquisitionEmailEvents_PayloadJson CHECK (ISJSON(PayloadJson)=1)
    );
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.AIAcquisitionEmailEvents') AND name=N'IX_AIAcquisitionEmailEvents_ExternalMessage')
    CREATE INDEX IX_AIAcquisitionEmailEvents_ExternalMessage
        ON dbo.AIAcquisitionEmailEvents(ExternalMessageId,EventAt DESC);
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionProspect_Get
    @AIAcquisitionProspectId BIGINT=NULL, @AIAcquisitionConfigurationId BIGINT=NULL,
    @Status NVARCHAR(32)=NULL, @Limit INT=250
AS
BEGIN
    SET NOCOUNT ON;
    SET @Limit=CASE WHEN @Limit<1 THEN 1 WHEN @Limit>1000 THEN 1000 ELSE @Limit END;
    SELECT TOP (@Limit) prospect.*,
        (SELECT ContactType [type], ContactValue [value], SourceName [source], SourceUrl [sourceUrl], Verified [verified],
                SuppressedAt [suppressedAt], SuppressionReason [suppressionReason]
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
        (SELECT ContactType [type], ContactValue [value], SourceName [source], SourceUrl [sourceUrl], Verified [verified],
                SuppressedAt [suppressedAt], SuppressionReason [suppressionReason]
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

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionContactAttempt_Create
    @AIAcquisitionConfigurationId BIGINT, @AIAcquisitionProspectId BIGINT, @Channel NVARCHAR(64),
    @ContactValue NVARCHAR(2048), @Message NVARCHAR(MAX), @OriginAIOrHuman NVARCHAR(32),
    @IsReply BIT=0, @IdempotencyKey NVARCHAR(255), @Status NVARCHAR(32)=N'QUEUED',
    @EmailPayloadJson NVARCHAR(MAX)=NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @EmailPayloadJson IS NOT NULL AND ISJSON(@EmailPayloadJson)<>1
        THROW 52615, 'Acquisition email payload JSON is invalid.', 1;
    DECLARE @AttemptId BIGINT;
    BEGIN TRANSACTION;
    BEGIN TRY
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
                (AIAcquisitionConfigurationId,AIAcquisitionProspectId,Channel,ContactValue,Message,OriginAIOrHuman,
                 IsReply,IdempotencyKey,[Status],EmailPayloadJson)
            VALUES(@AIAcquisitionConfigurationId,@AIAcquisitionProspectId,@Channel,@ContactValue,@Message,@OriginAIOrHuman,
                   @IsReply,@IdempotencyKey,@Status,@EmailPayloadJson);
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
    @Limit INT=10, @LockToken UNIQUEIDENTIFIER, @Channel NVARCHAR(64)=NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    SET @Limit=CASE WHEN @Limit<1 THEN 1 WHEN @Limit>100 THEN 100 ELSE @Limit END;
    ;WITH due AS
    (
        SELECT TOP (@Limit) attempt.* FROM dbo.AIAcquisitionContactAttempts attempt WITH (UPDLOCK,READPAST,ROWLOCK)
        WHERE attempt.Channel<>N'MANUAL_HUMAN_FOLLOW_UP' AND
              (@Channel IS NULL OR attempt.Channel=@Channel) AND
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
                                       contact.SuppressedAt IS NULL AND
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

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionContactAttempt_EmailPayloadFreeze
    @AIAcquisitionContactAttemptId BIGINT, @LockToken UNIQUEIDENTIFIER, @EmailPayloadJson NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF ISJSON(@EmailPayloadJson)<>1 THROW 52615, 'Acquisition email payload JSON is invalid.', 1;
    UPDATE dbo.AIAcquisitionContactAttempts SET
        EmailPayloadJson=COALESCE(EmailPayloadJson,@EmailPayloadJson),UpdatedAt=SYSUTCDATETIME()
    WHERE AIAcquisitionContactAttemptId=@AIAcquisitionContactAttemptId AND Channel=N'EMAIL' AND
          [Status]=N'PROCESSING' AND LockToken=@LockToken;
    IF @@ROWCOUNT=0 THROW 52606, 'The acquisition email attempt is not claimed by this worker.', 1;
    SELECT * FROM dbo.AIAcquisitionContactAttempts WHERE AIAcquisitionContactAttemptId=@AIAcquisitionContactAttemptId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionContactAttempt_Complete
    @AIAcquisitionContactAttemptId BIGINT, @LockToken UNIQUEIDENTIFIER, @Succeeded BIT,
    @ExternalMessageId NVARCHAR(255)=NULL, @LastError NVARCHAR(1000)=NULL,
    @Retryable BIT=0, @NextAttemptAt DATETIME2(3)=NULL, @ProviderStatus NVARCHAR(64)=NULL
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
            ExternalMessageId=COALESCE(@ExternalMessageId,ExternalMessageId),LastError=@LastError,
            ProviderStatus=COALESCE(NULLIF(@ProviderStatus,N''),CASE WHEN @Succeeded=1 THEN N'ACCEPTED' WHEN @Retryable=1 THEN N'RETRY_SCHEDULED' ELSE N'REJECTED' END),
            ProviderStatusAt=SYSUTCDATETIME(),
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

CREATE OR ALTER PROCEDURE dbo.AIAcquisitionEmailEvent_Apply
    @WebhookEventId NVARCHAR(255), @ExternalMessageId NVARCHAR(255), @EventType NVARCHAR(64),
    @EventAt DATETIME2(3), @FailureReason NVARCHAR(1000)=NULL, @PayloadJson NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF ISJSON(@PayloadJson)<>1 THROW 52616, 'Acquisition email event payload JSON is invalid.', 1;
    DECLARE @AttemptId BIGINT,@ProspectId BIGINT,@ProviderStatus NVARCHAR(64),@Duplicate BIT=0;
    SET @ProviderStatus=UPPER(REPLACE(REPLACE(@EventType,N'email.',N''),N'.',N'_'));
    BEGIN TRANSACTION;
    BEGIN TRY
        SELECT @AttemptId=AIAcquisitionContactAttemptId,@ProspectId=AIAcquisitionProspectId
        FROM dbo.AIAcquisitionContactAttempts WITH (UPDLOCK,HOLDLOCK)
        WHERE Channel=N'EMAIL' AND ExternalMessageId=@ExternalMessageId;
        IF @AttemptId IS NULL
        BEGIN
            ROLLBACK TRANSACTION;
            SELECT CAST(0 AS BIT) Matched,CAST(0 AS BIT) Duplicate,CAST(NULL AS BIGINT) AIAcquisitionContactAttemptId,
                CAST(NULL AS NVARCHAR(64)) ProviderStatus;
            RETURN;
        END;
        IF EXISTS (SELECT 1 FROM dbo.AIAcquisitionEmailEvents WITH (UPDLOCK,HOLDLOCK) WHERE WebhookEventId=@WebhookEventId)
            SET @Duplicate=1;
        ELSE
            INSERT dbo.AIAcquisitionEmailEvents
                (WebhookEventId,AIAcquisitionContactAttemptId,ExternalMessageId,EventType,EventAt,FailureReason,PayloadJson)
            VALUES(@WebhookEventId,@AttemptId,@ExternalMessageId,@EventType,@EventAt,@FailureReason,@PayloadJson);
        IF @Duplicate=0
        BEGIN
            UPDATE dbo.AIAcquisitionContactAttempts SET
                ProviderStatus=CASE WHEN ProviderStatusAt IS NULL OR @EventAt>=ProviderStatusAt THEN @ProviderStatus ELSE ProviderStatus END,
                ProviderStatusAt=CASE WHEN ProviderStatusAt IS NULL OR @EventAt>=ProviderStatusAt THEN @EventAt ELSE ProviderStatusAt END,
                DeliveredAt=CASE WHEN @EventType=N'email.delivered' THEN COALESCE(DeliveredAt,@EventAt) ELSE DeliveredAt END,
                LastError=CASE WHEN @EventType IN (N'email.bounced',N'email.complained',N'email.failed',N'email.suppressed')
                    THEN COALESCE(NULLIF(@FailureReason,N''),@ProviderStatus) ELSE LastError END,
                UpdatedAt=SYSUTCDATETIME()
            WHERE AIAcquisitionContactAttemptId=@AttemptId;
            UPDATE dbo.AIAcquisitionConversations SET
                DeliveryStatus=CASE WHEN @EventAt>=OccurredAt THEN @ProviderStatus ELSE DeliveryStatus END
            WHERE Channel=N'EMAIL' AND ExternalMessageId=@ExternalMessageId;
            IF @EventType IN (N'email.bounced',N'email.complained',N'email.suppressed')
                UPDATE dbo.AIAcquisitionProspectContacts SET SuppressedAt=COALESCE(SuppressedAt,@EventAt),
                    SuppressionReason=COALESCE(NULLIF(@FailureReason,N''),@ProviderStatus),UpdatedAt=SYSUTCDATETIME()
                WHERE AIAcquisitionProspectId=@ProspectId AND ContactType=N'EMAIL' AND ContactValue=
                    (SELECT ContactValue FROM dbo.AIAcquisitionContactAttempts WHERE AIAcquisitionContactAttemptId=@AttemptId);
            IF @EventType=N'email.complained'
            BEGIN
                UPDATE dbo.AIAcquisitionProspects SET OptedOut=1,[Status]=N'DO_NOT_CONTACT',UpdatedAt=SYSUTCDATETIME()
                WHERE AIAcquisitionProspectId=@ProspectId;
                UPDATE dbo.AIAcquisitionContactAttempts SET [Status]=N'CANCELLED',LockToken=NULL,LockedAt=NULL,
                    LastError=N'Cancelled after an email complaint.',UpdatedAt=SYSUTCDATETIME()
                WHERE AIAcquisitionProspectId=@ProspectId AND AIAcquisitionContactAttemptId<>@AttemptId AND
                      [Status] IN (N'QUEUED',N'RETRY');
            END;
        END;
        COMMIT TRANSACTION;
        SELECT CAST(1 AS BIT) Matched,@Duplicate Duplicate,@AttemptId AIAcquisitionContactAttemptId,
            ProviderStatus FROM dbo.AIAcquisitionContactAttempts WHERE AIAcquisitionContactAttemptId=@AttemptId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO
