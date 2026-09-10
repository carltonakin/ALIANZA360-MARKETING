SET NOCOUNT ON;

/*
Read-only duplicate audit. This script does not update or delete data.
Run it before any cleanup decision and review every non-zero duplicate group.
*/
SELECT N'LeadRoutineEvents' Entity, Routine BusinessScope, ExternalEventId BusinessId, COUNT_BIG(*) DuplicateCount
FROM dbo.LeadRoutineEvents
GROUP BY Routine, ExternalEventId
HAVING COUNT_BIG(*) > 1
UNION ALL
SELECT N'SocialEvents', Channel, ExternalEventId, COUNT_BIG(*)
FROM dbo.SocialEvents
GROUP BY Channel, ExternalEventId
HAVING COUNT_BIG(*) > 1
UNION ALL
SELECT N'SocialInteractions', CONVERT(NVARCHAR(32), SocialPlatformId), ExternalInteractionId, COUNT_BIG(*)
FROM dbo.SocialInteractions
WHERE ExternalInteractionId IS NOT NULL
GROUP BY SocialPlatformId, ExternalInteractionId
HAVING COUNT_BIG(*) > 1;

/*
These are projection mirrors, not duplicate database rows. Each pair represents
one source event stored in both the interaction log and the CRM activity log.
Only exact, unambiguous one-to-one pairs are suppressed by the unified query.
*/
;WITH CandidatePairs AS
(
    SELECT a.LeadActivityId, si.SocialInteractionId, si.LeadId, si.InteractionType,
        si.ExternalInteractionId, si.OccurredAt,
        COUNT_BIG(*) OVER (PARTITION BY a.LeadActivityId) MatchesPerActivity,
        COUNT_BIG(*) OVER (PARTITION BY si.SocialInteractionId) MatchesPerInteraction
    FROM dbo.LeadActivities a
    JOIN dbo.SocialInteractions si
      ON si.LeadId = a.LeadId
     AND si.InteractionType = a.ActivityType
     AND si.OccurredAt = a.OccurredAt
     AND ISNULL(COALESCE(si.MessageText, si.Intent), N'') = ISNULL(a.Summary, N'')
     AND ISNULL(si.CampaignExternalId, N'') = ISNULL(a.CampaignExternalId, N'')
)
SELECT LeadActivityId, SocialInteractionId, LeadId, InteractionType,
    ExternalInteractionId, OccurredAt EventTimestampUtc,
    CASE WHEN MatchesPerActivity = 1 AND MatchesPerInteraction = 1
        THEN N'CONFIRMED_PROJECTION_MIRROR' ELSE N'AMBIGUOUS_KEEP_VISIBLE' END Classification
FROM CandidatePairs
ORDER BY OccurredAt DESC, SocialInteractionId DESC;
