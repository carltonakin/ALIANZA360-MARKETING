SET XACT_ABORT ON;
GO

/*
UTC remains the only persisted time basis. Landing registrations receive their
authoritative occurrence time inside MSSQL; duplicate submissions retain the
original event time. Existing historical timestamps are not rewritten.
*/
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
    @OccurredAt DATETIME2(3) = NULL
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

    IF @Routine = N'landing_page_registration'
        SET @OccurredAt = SYSUTCDATETIME();
    ELSE
        SET @OccurredAt = COALESCE(@OccurredAt, SYSUTCDATETIME());

    BEGIN TRANSACTION;
    BEGIN TRY
        DECLARE @LeadId BIGINT, @Duplicate BIT = 0, @PersistedOccurredAt DATETIME2(3);
        SELECT @LeadId = LeadId, @PersistedOccurredAt = OccurredAt
        FROM dbo.LeadRoutineEvents WITH (UPDLOCK, HOLDLOCK)
        WHERE Routine = @Routine AND ExternalEventId = @ExternalEventId;
        IF @LeadId IS NOT NULL
        BEGIN
            SET @Duplicate = 1;
            SET @OccurredAt = @PersistedOccurredAt;
        END
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
        SELECT @LeadId AS LeadId, @Duplicate AS Duplicate, @OccurredAt AS OccurredAt;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

/*
Every result set is newest-first with an ID tie-breaker. Application code merges
interactions and activities using their normalized UTC event timestamp.
*/
CREATE OR ALTER PROCEDURE dbo.SocialLead_GetUnified @LeadId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT LeadId, Name, FirstName, LastName, DisplayName, Company, Email, Phone, Country, StateRegion, City,
        [Source] SourceChannel, Status, EstimatedValue Value, LeadScore, LeadTemperature, ScoreBand,
        IntentScore, EngagementScore, FitScore, RecencyScore, SourceScore, ScoreReason, LastScoredAt,
        LastIntent, ProductServiceInterest, QualificationJson, Budget, PurchaseTimeline, PreferredContactMethod,
        AssignedSalesperson, ConsentStatus, CrmNotes, ConvertedCustomer, LostReason, FirstContactAt, LastContactAt,
        LastInteractionAt, LastInteractionType, LastInteractionText, LastResponseAt, LastResponseType,
        LastResponseText, CreatedAt, UpdatedAt
    FROM dbo.Leads WHERE LeadId = @LeadId;
    SELECT sa.SocialAccountId, sp.Code Platform, sa.PlatformUserId, sa.Username, sa.DisplayName, sa.ProfileUrl, sa.LastVerifiedAt
    FROM dbo.SocialAccounts sa JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId = sa.SocialPlatformId
    WHERE sa.LeadId = @LeadId ORDER BY sa.SocialAccountId DESC;
    SELECT si.SocialInteractionId, sp.Code Platform, si.ExternalInteractionId, si.ExternalReplyId,
        si.PlatformUserId, si.PlatformPostId, si.PlatformPostId ExternalPostId, si.PlatformConversationId,
        si.InReplyToInteractionId,
        CASE WHEN si.InteractionType IN (N'DIRECT_MESSAGE', N'STORY_REPLY') THEN N'DM' ELSE si.InteractionType END InteractionType,
        si.MessageText, si.OccurredAt, si.Direction, si.Intent, si.IntentConfidence, si.Sentiment, si.ProductService,
        si.CampaignExternalId, si.CampaignPostId, si.CampaignName, si.AdvertisementId, si.LeadFormId, si.SourceType,
        COALESCE(si.ResponseMode, CASE WHEN UPPER(si.Direction) = N'OUTBOUND' THEN N'AI_AUTOMATIC' END) ResponseMode,
        si.SentByUserId, u.Username SentByUsername, si.ResponseStatus,
        COALESCE(si.SentAt, CASE WHEN UPPER(si.Direction) = N'OUTBOUND' AND si.ResponseStatus = N'SENT' THEN si.OccurredAt END) SentAt,
        si.DeliveryError, si.QualificationJson, si.ProcessedAt
    FROM dbo.SocialInteractions si
    JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId = si.SocialPlatformId
    LEFT JOIN dbo.AppUsers u ON u.UserId = si.SentByUserId
    WHERE si.LeadId = @LeadId
    ORDER BY COALESCE(si.SentAt, si.OccurredAt) DESC, si.SocialInteractionId DESC;
    SELECT sc.SocialConversationId, sp.Code Platform, sc.PlatformConversationId, sc.LastMessageAt, sc.Direction,
        sc.ImportantMessage, sc.Status, sc.AssignedCrmUser, sc.ReferenceUrl
    FROM dbo.SocialConversations sc JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId = sc.SocialPlatformId
    WHERE sc.LeadId = @LeadId ORDER BY sc.LastMessageAt DESC, sc.SocialConversationId DESC;
    SELECT LeadActivityId, ActivityType, Summary, SourceReference, CampaignExternalId, OccurredAt
    FROM dbo.LeadActivities WHERE LeadId = @LeadId ORDER BY OccurredAt DESC, LeadActivityId DESC;
    SELECT OpportunityId, CampaignId, Name, Stage, EstimatedValue, Status, CreatedAt, UpdatedAt
    FROM dbo.Opportunities WHERE LeadId = @LeadId ORDER BY UpdatedAt DESC, OpportunityId DESC;
    SELECT QuoteId, OpportunityId, Amount, Status, IssuedAt
    FROM dbo.Quotes WHERE LeadId = @LeadId ORDER BY IssuedAt DESC, QuoteId DESC;
    SELECT AppointmentId, ScheduledAt, Status, AssignedCrmUser, Notes, CreatedAt
    FROM dbo.Appointments WHERE LeadId = @LeadId ORDER BY ScheduledAt DESC, AppointmentId DESC;
    SELECT CustomerConversionId, CustomerId, CampaignId, ConversionType, Value, ConvertedAt
    FROM dbo.CustomerConversions WHERE LeadId = @LeadId ORDER BY ConvertedAt DESC, CustomerConversionId DESC;
END;
GO
