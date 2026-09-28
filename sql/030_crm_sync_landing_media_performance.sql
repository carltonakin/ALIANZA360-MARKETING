SET XACT_ABORT ON;
GO

-- Keep the dashboard lead feed bounded to the fields the UI needs. SQL Server's
-- NVARCHAR(MAX) result streaming made the previous 142-row read take tens of
-- seconds even though the underlying table is small.
CREATE OR ALTER PROCEDURE dbo.SocialLead_GetRecent
    @Limit INT = 500
AS
BEGIN
    SET NOCOUNT ON;
    SET @Limit = CASE WHEN @Limit < 1 THEN 1 WHEN @Limit > 500 THEN 500 ELSE @Limit END;

    SELECT TOP (@Limit)
        l.LeadId, l.Name, l.FirstName, l.LastName, l.DisplayName, l.Company,
        l.Email, l.Phone, l.Country, l.StateRegion, l.City,
        l.SocialUsername, l.Facebook, l.Instagram, l.[X],
        COALESCE(NULLIF(l.[Source], N''), N'Manual') SourceChannel,
        l.Status, l.EstimatedValue Value, l.LeadScore, l.LeadTemperature, l.ScoreBand,
        l.IntentScore, l.EngagementScore, l.FitScore, l.RecencyScore, l.SourceScore,
        l.ScoreReason, l.LastScoredAt, l.LastIntent, CONVERT(NVARCHAR(4000), l.CrmNotes) CrmNotes,
        l.ProductServiceInterest, CONVERT(NVARCHAR(4000), l.QualificationJson) QualificationJson,
        l.Budget, l.PurchaseTimeline, l.PreferredContactMethod, l.AssignedSalesperson,
        l.ConsentStatus, l.ConvertedCustomer, l.LostReason, l.FirstContactAt, l.LastContactAt,
        l.LastInteractionAt, l.LastInteractionType,
        CONVERT(NVARCHAR(4000), l.LastInteractionText) LastInteractionText,
        l.LastResponseAt, l.LastResponseType,
        CONVERT(NVARCHAR(4000), l.LastResponseText) LastResponseText,
        l.CreatedAt, l.UpdatedAt
    FROM dbo.Leads l
    ORDER BY l.CreatedAt DESC, l.LeadId DESC;
END;
GO

-- Resolve latest interactions once with ranked sets. The previous correlated
-- OUTER APPLY plan was repeatedly expanded by aggregate reports and timed out.
CREATE OR ALTER FUNCTION dbo.CRMReport_LeadBase()
RETURNS TABLE
AS
RETURN
(
    WITH AccountNames AS
    (
        SELECT sa.LeadId,
            MAX(CASE WHEN sp.Code = N'instagram' THEN NULLIF(sa.Username, N'') END) InstagramUsername,
            MAX(CASE WHEN sp.Code = N'facebook' THEN NULLIF(sa.Username, N'') END) FacebookUsername,
            MAX(CASE WHEN sp.Code = N'x' THEN NULLIF(sa.Username, N'') END) XUsername
        FROM dbo.SocialAccounts sa
        JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId = sa.SocialPlatformId
        WHERE sa.LeadId IS NOT NULL
        GROUP BY sa.LeadId
    ),
    InteractionTotals AS
    (
        SELECT si.LeadId,
            SUM(CASE WHEN UPPER(si.Direction) = N'INBOUND' THEN 1 ELSE 0 END) InboundInteractionCount,
            SUM(CASE WHEN UPPER(si.Direction) = N'OUTBOUND' THEN 1 ELSE 0 END) OutboundInteractionCount,
            SUM(CASE WHEN UPPER(si.InteractionType) IN (N'COMMENT', N'REPLY', N'MENTION', N'STORY_MENTION') THEN 1 ELSE 0 END) CommentCount,
            SUM(CASE WHEN UPPER(si.InteractionType) IN (N'DM', N'DIRECT_MESSAGE', N'STORY_REPLY') THEN 1 ELSE 0 END) DMCount
        FROM dbo.SocialInteractions si
        WHERE si.LeadId IS NOT NULL
        GROUP BY si.LeadId
    ),
    RankedInbound AS
    (
        SELECT si.LeadId, si.Intent,
            ROW_NUMBER() OVER (PARTITION BY si.LeadId ORDER BY si.OccurredAt DESC, si.SocialInteractionId DESC) RowNumber
        FROM dbo.SocialInteractions si
        WHERE si.LeadId IS NOT NULL AND UPPER(si.Direction) = N'INBOUND'
    ),
    RankedLatest AS
    (
        SELECT si.LeadId, si.InteractionType, CONVERT(NVARCHAR(4000), si.MessageText) MessageText,
            si.OccurredAt, sp.Code Platform, cp.CampaignId,
            COALESCE(c.Name, NULLIF(si.CampaignName, N''), NULLIF(si.CampaignExternalId, N'')) Campaign,
            ROW_NUMBER() OVER (PARTITION BY si.LeadId ORDER BY si.OccurredAt DESC, si.SocialInteractionId DESC) RowNumber
        FROM dbo.SocialInteractions si
        LEFT JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId = si.SocialPlatformId
        LEFT JOIN dbo.CampaignPosts cp ON cp.CampaignPostId = si.CampaignPostId
        LEFT JOIN dbo.Campaigns c ON c.CampaignId = cp.CampaignId
        WHERE si.LeadId IS NOT NULL
    )
    SELECT l.LeadId,
        COALESCE(NULLIF(l.DisplayName, N''), NULLIF(l.Name, N''), NULLIF(l.Email, N''), CONCAT(N'Lead #', l.LeadId)) LeadName,
        COALESCE(a.InstagramUsername, NULLIF(l.Instagram, N'')) InstagramUsername,
        COALESCE(a.FacebookUsername, NULLIF(l.Facebook, N'')) FacebookUsername,
        COALESCE(a.XUsername, NULLIF(l.[X], N'')) XUsername,
        CASE
            WHEN NULLIF(l.SocialUsername, N'') IS NOT NULL
             AND l.SocialUsername NOT IN (COALESCE(a.InstagramUsername, l.Instagram, N''), COALESCE(a.FacebookUsername, l.Facebook, N''), COALESCE(a.XUsername, l.[X], N''))
            THEN l.SocialUsername
        END OtherSocialUsernames,
        COALESCE(l.LeadScore, 0) LeadScore,
        COALESCE(NULLIF(l.LastIntent, N''), inboundInteraction.Intent, N'OTHER') Intent,
        COALESCE(NULLIF(l.ScoreBand, N''), NULLIF(l.LeadTemperature, N''), N'COLD') ScoreBand,
        COALESCE(NULLIF(l.LastInteractionType, N''), latestInteraction.InteractionType) LastInteraction,
        COALESCE(l.LastInteractionAt, latestInteraction.OccurredAt) LastInteractionDate,
        COALESCE(NULLIF(CONVERT(NVARCHAR(4000), l.LastInteractionText), N''), latestInteraction.MessageText, N'') LatestMessage,
        COALESCE(NULLIF(l.[Source], N''), N'Manual') Source,
        latestInteraction.Platform,
        latestInteraction.CampaignId,
        latestInteraction.Campaign,
        COALESCE(t.InboundInteractionCount, 0) InboundInteractionCount,
        COALESCE(t.OutboundInteractionCount, 0) OutboundInteractionCount,
        COALESCE(t.CommentCount, 0) CommentCount,
        COALESCE(t.DMCount, 0) DMCount
    FROM dbo.Leads l
    LEFT JOIN AccountNames a ON a.LeadId = l.LeadId
    LEFT JOIN InteractionTotals t ON t.LeadId = l.LeadId
    LEFT JOIN RankedInbound inboundInteraction ON inboundInteraction.LeadId = l.LeadId AND inboundInteraction.RowNumber = 1
    LEFT JOIN RankedLatest latestInteraction ON latestInteraction.LeadId = l.LeadId AND latestInteraction.RowNumber = 1
);
GO
