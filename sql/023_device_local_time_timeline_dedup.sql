SET XACT_ABORT ON;
GO

/*
UTC remains authoritative. Device-local formatting is a browser concern and
does not require a second database row. SocialEvent_Process intentionally writes
both a SocialInteraction and a matching LeadActivity; the unified projection
emits that source event once while preserving standalone CRM activities.
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

    ;WITH CandidatePairs AS
    (
        SELECT a.LeadActivityId, si.SocialInteractionId,
            COUNT_BIG(*) OVER (PARTITION BY a.LeadActivityId) MatchesPerActivity,
            COUNT_BIG(*) OVER (PARTITION BY si.SocialInteractionId) MatchesPerInteraction
        FROM dbo.LeadActivities a
        JOIN dbo.SocialInteractions si
          ON si.LeadId = a.LeadId
         AND si.InteractionType = a.ActivityType
         AND si.OccurredAt = a.OccurredAt
         AND ISNULL(COALESCE(si.MessageText, si.Intent), N'') = ISNULL(a.Summary, N'')
         AND ISNULL(si.CampaignExternalId, N'') = ISNULL(a.CampaignExternalId, N'')
        WHERE a.LeadId = @LeadId
    ),
    ConfirmedMirrors AS
    (
        SELECT LeadActivityId
        FROM CandidatePairs
        WHERE MatchesPerActivity = 1 AND MatchesPerInteraction = 1
    )
    SELECT a.LeadActivityId, a.ActivityType, a.Summary, a.SourceReference, a.CampaignExternalId, a.OccurredAt
    FROM dbo.LeadActivities a
    LEFT JOIN ConfirmedMirrors mirror ON mirror.LeadActivityId = a.LeadActivityId
    WHERE a.LeadId = @LeadId AND mirror.LeadActivityId IS NULL
    ORDER BY a.OccurredAt DESC, a.LeadActivityId DESC;

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
