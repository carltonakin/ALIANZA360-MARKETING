SET XACT_ABORT ON;
GO

/*
Move one-time legacy video links into the dedicated landing-page video fields.
The marker prevents a deliberately removed video from being restored by a later
rerun of the idempotent migration.
*/
IF COL_LENGTH(N'dbo.LandingPages', N'LegacyVideoMigratedAt') IS NULL
    ALTER TABLE dbo.LandingPages ADD LegacyVideoMigratedAt DATETIME2(3) NULL;
GO

UPDATE dbo.LandingPages
SET VideoSourceType = N'EXTERNAL_URL',
    VideoProvider = CASE
        WHEN WebinarUrl LIKE N'%youtu.be/%' OR WebinarUrl LIKE N'%youtube.com/%' THEN N'YOUTUBE'
        WHEN WebinarUrl LIKE N'%vimeo.com/%' THEN N'VIMEO'
        WHEN WebinarUrl LIKE N'%canva.com/design/%' THEN N'CANVA'
    END,
    VideoUrl = LTRIM(RTRIM(WebinarUrl)),
    VideoAutoplay = 1,
    VideoMuted = 1,
    VideoShowControls = 1,
    LegacyVideoMigratedAt = SYSUTCDATETIME(),
    UpdatedAt = SYSUTCDATETIME()
WHERE LegacyVideoMigratedAt IS NULL
  AND VideoSourceType = N'NONE'
  AND NULLIF(LTRIM(RTRIM(VideoUrl)), N'') IS NULL
  AND (
      WebinarUrl LIKE N'%youtu.be/%' OR WebinarUrl LIKE N'%youtube.com/%'
      OR WebinarUrl LIKE N'%vimeo.com/%' OR WebinarUrl LIKE N'%canva.com/design/%'
  );

UPDATE dbo.LandingPages
SET LegacyVideoMigratedAt = SYSUTCDATETIME()
WHERE LegacyVideoMigratedAt IS NULL;
GO

IF EXISTS
(
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.LandingPages')
      AND name = N'LegacyVideoMigratedAt' AND is_nullable = 1
)
    ALTER TABLE dbo.LandingPages ALTER COLUMN LegacyVideoMigratedAt DATETIME2(3) NOT NULL;
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.default_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.LandingPages')
      AND name = N'DF_LandingPages_LegacyVideoMigratedAt'
)
    ALTER TABLE dbo.LandingPages ADD CONSTRAINT DF_LandingPages_LegacyVideoMigratedAt
        DEFAULT SYSUTCDATETIME() FOR LegacyVideoMigratedAt;
GO

/*
Repair registrations created before the landing form entered the authoritative
SocialEvent_Process/LeadScore_Recalculate path. The same platform + external ID
key used by live requests makes this backfill safe to rerun.
*/
BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @MultiPlatformId INT;
    SELECT @MultiPlatformId = SocialPlatformId
    FROM dbo.SocialPlatforms WITH (UPDLOCK, HOLDLOCK)
    WHERE Code = N'multi';
    IF @MultiPlatformId IS NULL THROW 51130, 'The multi-platform CRM source is required for landing registrations.', 1;

    INSERT dbo.SocialEvents
    (
        Channel, ExternalEventId, EventType, DisplayName, Email, Phone, Message,
        CampaignId, OccurredAt, RawPayload, LeadFormId, CampaignName, SourceType,
        RawPayloadExpiresAt
    )
    SELECT
        N'multi', re.ExternalEventId, N'lead_form_submission', COALESCE(l.DisplayName, l.Name),
        l.Email, l.Phone, N'Landing page registration', CONVERT(NVARCHAR(255), re.CampaignId),
        re.OccurredAt,
        CONCAT(N'{"routine":"landing_page_registration","landingPageId":',
            COALESCE(CONVERT(NVARCHAR(20), re.LandingPageId), N'null'), N'}'),
        CONCAT(N'landing_page:', COALESCE(CONVERT(NVARCHAR(20), re.LandingPageId), N'unknown')),
        c.Name, N'ORGANIC', DATEADD(DAY, 7, re.OccurredAt)
    FROM dbo.LeadRoutineEvents re
    JOIN dbo.Leads l ON l.LeadId = re.LeadId
    LEFT JOIN dbo.Campaigns c ON c.CampaignId = re.CampaignId
    WHERE re.Routine = N'landing_page_registration'
      AND NOT EXISTS
      (
          SELECT 1 FROM dbo.SocialEvents se WITH (UPDLOCK, HOLDLOCK)
          WHERE se.Channel = N'multi' AND se.ExternalEventId = re.ExternalEventId
      );

    INSERT dbo.LeadSourceAttribution
    (
        LeadId, SocialEventId, SourceChannel, CampaignId, ExternalEventId,
        FirstTouchAt, LastInteractionAt
    )
    SELECT re.LeadId, se.SocialEventId, N'multi', CONVERT(NVARCHAR(255), re.CampaignId),
        re.ExternalEventId, re.OccurredAt, re.OccurredAt
    FROM dbo.LeadRoutineEvents re
    JOIN dbo.SocialEvents se ON se.Channel = N'multi' AND se.ExternalEventId = re.ExternalEventId
    WHERE re.Routine = N'landing_page_registration'
      AND NOT EXISTS
      (
          SELECT 1 FROM dbo.LeadSourceAttribution attribution WITH (UPDLOCK, HOLDLOCK)
          WHERE attribution.SocialEventId = se.SocialEventId
      );

    DECLARE @InsertedInteractions TABLE
    (
        SocialInteractionId BIGINT NOT NULL,
        LeadId BIGINT NOT NULL,
        SocialEventId BIGINT NOT NULL
    );

    INSERT dbo.SocialInteractions
    (
        SocialEventId, LeadId, SocialPlatformId, ExternalInteractionId,
        InteractionType, MessageText, OccurredAt, Direction, Intent, Sentiment,
        CampaignExternalId, CampaignName, LeadFormId, SourceType, ResponseStatus,
        RequiresReview, QualificationJson, ProcessedAt
    )
    OUTPUT inserted.SocialInteractionId, inserted.LeadId, inserted.SocialEventId
        INTO @InsertedInteractions(SocialInteractionId, LeadId, SocialEventId)
    SELECT
        se.SocialEventId, re.LeadId, @MultiPlatformId, re.ExternalEventId,
        N'LEAD_FORM_SUBMISSION', N'Landing page registration', re.OccurredAt,
        N'INBOUND', N'PURCHASE_INTENT', N'NEUTRAL',
        CONVERT(NVARCHAR(255), re.CampaignId), c.Name,
        CONCAT(N'landing_page:', COALESCE(CONVERT(NVARCHAR(20), re.LandingPageId), N'unknown')),
        N'ORGANIC', N'PENDING', 0, N'{}', SYSUTCDATETIME()
    FROM dbo.LeadRoutineEvents re
    JOIN dbo.SocialEvents se ON se.Channel = N'multi' AND se.ExternalEventId = re.ExternalEventId
    LEFT JOIN dbo.Campaigns c ON c.CampaignId = re.CampaignId
    WHERE re.Routine = N'landing_page_registration'
      AND NOT EXISTS
      (
          SELECT 1 FROM dbo.SocialInteractions si WITH (UPDLOCK, HOLDLOCK)
          WHERE si.SocialPlatformId = @MultiPlatformId
            AND si.ExternalInteractionId = re.ExternalEventId
      );

    INSERT dbo.LeadActivities
        (LeadId, ActivityType, Summary, SourceReference, CampaignExternalId, OccurredAt)
    SELECT inserted.LeadId, N'LEAD_FORM_SUBMISSION', N'Landing page registration',
        CONCAT(N'landing_page:', COALESCE(CONVERT(NVARCHAR(20), re.LandingPageId), N'unknown')),
        CONVERT(NVARCHAR(255), re.CampaignId), re.OccurredAt
    FROM @InsertedInteractions inserted
    JOIN dbo.LeadRoutineEvents re ON re.LeadId = inserted.LeadId
    JOIN dbo.SocialEvents se ON se.SocialEventId = inserted.SocialEventId
        AND se.ExternalEventId = re.ExternalEventId
    WHERE re.Routine = N'landing_page_registration';

    DECLARE @LeadId BIGINT;
    DECLARE landing_score_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT DISTINCT re.LeadId
        FROM dbo.LeadRoutineEvents re
        JOIN dbo.SocialInteractions si ON si.LeadId = re.LeadId
            AND si.ExternalInteractionId = re.ExternalEventId
            AND si.SocialPlatformId = @MultiPlatformId
        WHERE re.Routine = N'landing_page_registration';

    OPEN landing_score_cursor;
    FETCH NEXT FROM landing_score_cursor INTO @LeadId;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        EXEC dbo.LeadScore_Recalculate @LeadId = @LeadId, @ScoredAt = NULL, @ReturnResult = 0;
        FETCH NEXT FROM landing_score_cursor INTO @LeadId;
    END;
    CLOSE landing_score_cursor;
    DEALLOCATE landing_score_cursor;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF CURSOR_STATUS(N'local', N'landing_score_cursor') >= 0 CLOSE landing_score_cursor;
    IF CURSOR_STATUS(N'local', N'landing_score_cursor') >= -1 DEALLOCATE landing_score_cursor;
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
