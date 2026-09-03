SET XACT_ABORT ON;
GO

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
        COALESCE(NULLIF(l.LastIntent, N''), latestInbound.Intent, N'OTHER') Intent,
        COALESCE(NULLIF(l.ScoreBand, N''), NULLIF(l.LeadTemperature, N''), N'COLD') ScoreBand,
        COALESCE(NULLIF(l.LastInteractionType, N''), latest.InteractionType) LastInteraction,
        COALESCE(l.LastInteractionAt, latest.OccurredAt) LastInteractionDate,
        COALESCE(NULLIF(l.LastInteractionText, N''), latest.MessageText, N'') LatestMessage,
        COALESCE(NULLIF(l.[Source], N''), N'Manual') Source,
        latest.Platform,
        latest.CampaignId,
        latest.Campaign,
        COALESCE(t.InboundInteractionCount, 0) InboundInteractionCount,
        COALESCE(t.OutboundInteractionCount, 0) OutboundInteractionCount,
        COALESCE(t.CommentCount, 0) CommentCount,
        COALESCE(t.DMCount, 0) DMCount
    FROM dbo.Leads l
    LEFT JOIN AccountNames a ON a.LeadId = l.LeadId
    LEFT JOIN InteractionTotals t ON t.LeadId = l.LeadId
    OUTER APPLY
    (
        SELECT TOP (1) si.Intent
        FROM dbo.SocialInteractions si
        WHERE si.LeadId = l.LeadId AND UPPER(si.Direction) = N'INBOUND'
        ORDER BY si.OccurredAt DESC, si.SocialInteractionId DESC
    ) latestInbound
    OUTER APPLY
    (
        SELECT TOP (1) si.InteractionType, si.MessageText, si.OccurredAt, sp.Code Platform,
            cp.CampaignId,
            COALESCE(c.Name, NULLIF(si.CampaignName, N''), NULLIF(si.CampaignExternalId, N'')) Campaign
        FROM dbo.SocialInteractions si
        LEFT JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId = si.SocialPlatformId
        LEFT JOIN dbo.CampaignPosts cp ON cp.CampaignPostId = si.CampaignPostId
        LEFT JOIN dbo.Campaigns c ON c.CampaignId = cp.CampaignId
        WHERE si.LeadId = l.LeadId
        ORDER BY si.OccurredAt DESC, si.SocialInteractionId DESC
    ) latest
);
GO

CREATE OR ALTER FUNCTION dbo.CRMReport_FilteredLeads
(
    @ScoreBand NVARCHAR(20), @MinScore INT, @MaxScore INT, @Intent NVARCHAR(64),
    @Platform NVARCHAR(32), @Source NVARCHAR(100), @CampaignId BIGINT,
    @StartDate DATETIME2(3), @EndDate DATETIME2(3), @Search NVARCHAR(255)
)
RETURNS TABLE
AS
RETURN
(
    SELECT b.*
    FROM dbo.CRMReport_LeadBase() b
    WHERE (@ScoreBand IS NULL OR UPPER(b.ScoreBand) = UPPER(@ScoreBand))
      AND (@MinScore IS NULL OR b.LeadScore >= @MinScore)
      AND (@MaxScore IS NULL OR b.LeadScore <= @MaxScore)
      AND (@Intent IS NULL OR UPPER(b.Intent) = UPPER(@Intent))
      AND (@Source IS NULL OR b.Source = @Source)
      AND (@StartDate IS NULL OR b.LastInteractionDate >= @StartDate)
      AND (@EndDate IS NULL OR b.LastInteractionDate <= @EndDate)
      AND (@Search IS NULL OR b.LeadName LIKE N'%' + @Search + N'%' OR b.InstagramUsername LIKE N'%' + @Search + N'%'
           OR b.FacebookUsername LIKE N'%' + @Search + N'%' OR b.XUsername LIKE N'%' + @Search + N'%'
           OR b.OtherSocialUsernames LIKE N'%' + @Search + N'%')
      AND
      (
          @Platform IS NULL
          OR (@Platform = N'instagram' AND b.InstagramUsername IS NOT NULL)
          OR (@Platform = N'facebook' AND b.FacebookUsername IS NOT NULL)
          OR (@Platform = N'x' AND b.XUsername IS NOT NULL)
          OR EXISTS
          (
              SELECT 1 FROM dbo.SocialInteractions si
              JOIN dbo.SocialPlatforms sp ON sp.SocialPlatformId = si.SocialPlatformId
              WHERE si.LeadId = b.LeadId AND sp.Code = @Platform
          )
      )
      AND
      (
          @CampaignId IS NULL
          OR EXISTS
          (
              SELECT 1 FROM dbo.SocialInteractions si
              JOIN dbo.CampaignPosts cp ON cp.CampaignPostId = si.CampaignPostId
              WHERE si.LeadId = b.LeadId AND cp.CampaignId = @CampaignId
          )
      )
);
GO

CREATE OR ALTER PROCEDURE dbo.CRMReport_LeadScoring
    @ScoreBand NVARCHAR(20) = NULL, @MinScore INT = NULL, @MaxScore INT = NULL, @Intent NVARCHAR(64) = NULL,
    @Platform NVARCHAR(32) = NULL, @Source NVARCHAR(100) = NULL, @CampaignId BIGINT = NULL,
    @StartDate DATETIME2(3) = NULL, @EndDate DATETIME2(3) = NULL, @Search NVARCHAR(255) = NULL,
    @Sort NVARCHAR(40) = N'score_desc', @Page INT = 1, @PageSize INT = 25
AS
BEGIN
    SET NOCOUNT ON;
    SET @Page = CASE WHEN @Page < 1 THEN 1 ELSE @Page END;
    SET @PageSize = CASE WHEN @PageSize < 1 THEN 25 WHEN @PageSize > 500 THEN 500 ELSE @PageSize END;
    SELECT f.LeadId, f.LeadName, f.InstagramUsername, f.FacebookUsername, f.XUsername, f.OtherSocialUsernames,
        f.LeadScore, f.Intent, f.ScoreBand Temperature, f.LastInteraction, f.LastInteractionDate, f.Source,
        f.Platform, f.CampaignId, f.Campaign, f.LatestMessage, COUNT_BIG(*) OVER() TotalCount
    FROM dbo.CRMReport_FilteredLeads(@ScoreBand, @MinScore, @MaxScore, @Intent, @Platform, @Source, @CampaignId, @StartDate, @EndDate, @Search) f
    ORDER BY
        CASE WHEN @Sort = N'name_asc' THEN f.LeadName END ASC,
        CASE WHEN @Sort = N'name_desc' THEN f.LeadName END DESC,
        CASE WHEN @Sort = N'score_asc' THEN f.LeadScore END ASC,
        CASE WHEN @Sort = N'last_interaction_asc' THEN f.LastInteractionDate END ASC,
        CASE WHEN @Sort = N'last_interaction_desc' THEN f.LastInteractionDate END DESC,
        CASE WHEN @Sort = N'intent_asc' THEN f.Intent END ASC,
        CASE WHEN @Sort = N'temperature_asc' THEN f.ScoreBand END ASC,
        CASE WHEN @Sort NOT IN (N'name_asc', N'name_desc', N'score_asc', N'last_interaction_asc', N'last_interaction_desc', N'intent_asc', N'temperature_asc') THEN f.LeadScore END DESC,
        f.LeadScore DESC, f.LastInteractionDate DESC, f.LeadId DESC
    OFFSET (@Page - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CRMReport_LeadTemperature
    @ScoreBand NVARCHAR(20) = NULL, @MinScore INT = NULL, @MaxScore INT = NULL, @Intent NVARCHAR(64) = NULL,
    @Platform NVARCHAR(32) = NULL, @Source NVARCHAR(100) = NULL, @CampaignId BIGINT = NULL,
    @StartDate DATETIME2(3) = NULL, @EndDate DATETIME2(3) = NULL, @Search NVARCHAR(255) = NULL,
    @Sort NVARCHAR(40) = N'temperature_asc', @Page INT = 1, @PageSize INT = 25
AS
BEGIN
    SET NOCOUNT ON;
    ;WITH Bands AS
    (
        SELECT Temperature, SortOrder FROM (VALUES (N'COLD', 1), (N'WARM', 2), (N'QUALIFIED', 3), (N'HOT', 4)) valueset(Temperature, SortOrder)
    ),
    Filtered AS
    (
        SELECT * FROM dbo.CRMReport_FilteredLeads(@ScoreBand, @MinScore, @MaxScore, @Intent, @Platform, @Source, @CampaignId, @StartDate, @EndDate, @Search)
    ),
    Total AS (SELECT COUNT_BIG(*) TotalLeads FROM Filtered)
    SELECT b.Temperature, COUNT_BIG(f.LeadId) LeadCount, t.TotalLeads,
        CAST(CASE WHEN t.TotalLeads = 0 THEN 0 ELSE COUNT_BIG(f.LeadId) * 100.0 / t.TotalLeads END AS DECIMAL(6,2)) Percentage
    FROM Bands b CROSS JOIN Total t LEFT JOIN Filtered f ON UPPER(f.ScoreBand) = b.Temperature
    GROUP BY b.Temperature, b.SortOrder, t.TotalLeads
    ORDER BY b.SortOrder;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CRMReport_LeadIntents
    @ScoreBand NVARCHAR(20) = NULL, @MinScore INT = NULL, @MaxScore INT = NULL, @Intent NVARCHAR(64) = NULL,
    @Platform NVARCHAR(32) = NULL, @Source NVARCHAR(100) = NULL, @CampaignId BIGINT = NULL,
    @StartDate DATETIME2(3) = NULL, @EndDate DATETIME2(3) = NULL, @Search NVARCHAR(255) = NULL,
    @Sort NVARCHAR(40) = N'lead_count_desc', @Page INT = 1, @PageSize INT = 25
AS
BEGIN
    SET NOCOUNT ON;
    SELECT f.Intent, COUNT_BIG(*) LeadCount, CAST(AVG(CAST(f.LeadScore AS DECIMAL(10,2))) AS DECIMAL(10,2)) AverageLeadScore,
        SUM(CASE WHEN UPPER(f.ScoreBand) = N'HOT' THEN 1 ELSE 0 END) HotLeadCount,
        SUM(CASE WHEN UPPER(f.ScoreBand) = N'QUALIFIED' THEN 1 ELSE 0 END) QualifiedLeadCount,
        MAX(f.LastInteractionDate) MostRecentInteractionDate
    FROM dbo.CRMReport_FilteredLeads(@ScoreBand, @MinScore, @MaxScore, @Intent, @Platform, @Source, @CampaignId, @StartDate, @EndDate, @Search) f
    GROUP BY f.Intent
    ORDER BY
        CASE WHEN @Sort = N'intent_asc' THEN f.Intent END ASC,
        CASE WHEN @Sort = N'average_score_desc' THEN AVG(CAST(f.LeadScore AS DECIMAL(10,2))) END DESC,
        CASE WHEN @Sort = N'recent_desc' THEN MAX(f.LastInteractionDate) END DESC,
        COUNT_BIG(*) DESC, f.Intent ASC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CRMReport_LeadSources
    @ScoreBand NVARCHAR(20) = NULL, @MinScore INT = NULL, @MaxScore INT = NULL, @Intent NVARCHAR(64) = NULL,
    @Platform NVARCHAR(32) = NULL, @Source NVARCHAR(100) = NULL, @CampaignId BIGINT = NULL,
    @StartDate DATETIME2(3) = NULL, @EndDate DATETIME2(3) = NULL, @Search NVARCHAR(255) = NULL,
    @Sort NVARCHAR(40) = N'lead_count_desc', @Page INT = 1, @PageSize INT = 25
AS
BEGIN
    SET NOCOUNT ON;
    SELECT f.Source, COUNT_BIG(*) LeadCount, CAST(AVG(CAST(f.LeadScore AS DECIMAL(10,2))) AS DECIMAL(10,2)) AverageScore,
        SUM(CASE WHEN UPPER(f.ScoreBand) = N'HOT' THEN 1 ELSE 0 END) HotLeads,
        SUM(CASE WHEN UPPER(f.ScoreBand) = N'QUALIFIED' THEN 1 ELSE 0 END) QualifiedLeads,
        SUM(CASE WHEN UPPER(f.ScoreBand) = N'WARM' THEN 1 ELSE 0 END) WarmLeads,
        SUM(CASE WHEN UPPER(f.ScoreBand) = N'COLD' THEN 1 ELSE 0 END) ColdLeads
    FROM dbo.CRMReport_FilteredLeads(@ScoreBand, @MinScore, @MaxScore, @Intent, @Platform, @Source, @CampaignId, @StartDate, @EndDate, @Search) f
    GROUP BY f.Source
    ORDER BY
        CASE WHEN @Sort = N'source_asc' THEN f.Source END ASC,
        CASE WHEN @Sort = N'average_score_desc' THEN AVG(CAST(f.LeadScore AS DECIMAL(10,2))) END DESC,
        COUNT_BIG(*) DESC, f.Source ASC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CRMReport_CampaignLeadPerformance
    @ScoreBand NVARCHAR(20) = NULL, @MinScore INT = NULL, @MaxScore INT = NULL, @Intent NVARCHAR(64) = NULL,
    @Platform NVARCHAR(32) = NULL, @Source NVARCHAR(100) = NULL, @CampaignId BIGINT = NULL,
    @StartDate DATETIME2(3) = NULL, @EndDate DATETIME2(3) = NULL, @Search NVARCHAR(255) = NULL,
    @Sort NVARCHAR(40) = N'total_leads_desc', @Page INT = 1, @PageSize INT = 25
AS
BEGIN
    SET NOCOUNT ON;
    ;WITH Attribution AS
    (
        SELECT cp.CampaignId, si.SocialInteractionId, si.LeadId, si.Direction, si.OccurredAt
        FROM dbo.SocialInteractions si JOIN dbo.CampaignPosts cp ON cp.CampaignPostId = si.CampaignPostId
        UNION
        SELECT sc.CampaignId, si.SocialInteractionId, si.LeadId, si.Direction, si.OccurredAt
        FROM dbo.SocialInteractions si JOIN dbo.SocialCampaigns sc ON sc.ExternalCampaignId = si.CampaignExternalId
        WHERE si.CampaignExternalId IS NOT NULL
        UNION
        SELECT c.CampaignId, si.SocialInteractionId, si.LeadId, si.Direction, si.OccurredAt
        FROM dbo.SocialInteractions si JOIN dbo.Campaigns c ON c.Name = si.CampaignName
        WHERE si.CampaignName IS NOT NULL
    ),
    FilteredAttribution AS
    (
        SELECT a.* FROM Attribution a
        JOIN dbo.Leads l ON l.LeadId = a.LeadId
        JOIN dbo.Campaigns c ON c.CampaignId = a.CampaignId
        WHERE (@CampaignId IS NULL OR a.CampaignId = @CampaignId)
          AND (@StartDate IS NULL OR a.OccurredAt >= @StartDate) AND (@EndDate IS NULL OR a.OccurredAt <= @EndDate)
          AND (@Platform IS NULL OR LOWER(c.Platform) = @Platform)
          AND (@Source IS NULL OR COALESCE(NULLIF(l.[Source], N''), N'Manual') = @Source)
          AND (@ScoreBand IS NULL OR UPPER(COALESCE(l.ScoreBand, l.LeadTemperature, N'COLD')) = UPPER(@ScoreBand))
          AND (@MinScore IS NULL OR l.LeadScore >= @MinScore) AND (@MaxScore IS NULL OR l.LeadScore <= @MaxScore)
          AND (@Intent IS NULL OR UPPER(COALESCE(l.LastIntent, N'OTHER')) = UPPER(@Intent))
          AND (@Search IS NULL OR c.Name LIKE N'%' + @Search + N'%')
    ),
    LeadSet AS (SELECT DISTINCT CampaignId, LeadId FROM FilteredAttribution WHERE LeadId IS NOT NULL),
    LeadMetrics AS
    (
        SELECT ls.CampaignId, COUNT_BIG(*) TotalLeads, CAST(AVG(CAST(l.LeadScore AS DECIMAL(10,2))) AS DECIMAL(10,2)) AverageLeadScore,
            SUM(CASE WHEN UPPER(COALESCE(l.ScoreBand, l.LeadTemperature)) = N'HOT' THEN 1 ELSE 0 END) HotLeads,
            SUM(CASE WHEN UPPER(COALESCE(l.ScoreBand, l.LeadTemperature)) = N'QUALIFIED' THEN 1 ELSE 0 END) QualifiedLeads
        FROM LeadSet ls JOIN dbo.Leads l ON l.LeadId = ls.LeadId GROUP BY ls.CampaignId
    ),
    InteractionMetrics AS
    (
        SELECT CampaignId, SUM(CASE WHEN UPPER(Direction) = N'INBOUND' THEN 1 ELSE 0 END) TotalInboundInteractions,
            MAX(OccurredAt) MostRecentLeadActivity
        FROM FilteredAttribution GROUP BY CampaignId
    )
    SELECT c.CampaignId, c.Name Campaign, c.Platform, COALESCE(lm.TotalLeads, 0) TotalLeads,
        COALESCE(lm.AverageLeadScore, 0) AverageLeadScore, COALESCE(lm.HotLeads, 0) HotLeads,
        COALESCE(lm.QualifiedLeads, 0) QualifiedLeads, COALESCE(im.TotalInboundInteractions, 0) TotalInboundInteractions,
        im.MostRecentLeadActivity
    FROM dbo.Campaigns c
    LEFT JOIN LeadMetrics lm ON lm.CampaignId = c.CampaignId
    LEFT JOIN InteractionMetrics im ON im.CampaignId = c.CampaignId
    WHERE (@CampaignId IS NULL OR c.CampaignId = @CampaignId)
      AND (@Platform IS NULL OR LOWER(c.Platform) = @Platform)
      AND (@Search IS NULL OR c.Name LIKE N'%' + @Search + N'%')
    ORDER BY
        CASE WHEN @Sort = N'campaign_asc' THEN c.Name END ASC,
        CASE WHEN @Sort = N'average_score_desc' THEN COALESCE(lm.AverageLeadScore, 0) END DESC,
        CASE WHEN @Sort = N'inbound_desc' THEN COALESCE(im.TotalInboundInteractions, 0) END DESC,
        CASE WHEN @Sort = N'recent_desc' THEN im.MostRecentLeadActivity END DESC,
        COALESCE(lm.TotalLeads, 0) DESC, c.Name ASC;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CRMReport_LeadEngagement
    @ScoreBand NVARCHAR(20) = NULL, @MinScore INT = NULL, @MaxScore INT = NULL, @Intent NVARCHAR(64) = NULL,
    @Platform NVARCHAR(32) = NULL, @Source NVARCHAR(100) = NULL, @CampaignId BIGINT = NULL,
    @StartDate DATETIME2(3) = NULL, @EndDate DATETIME2(3) = NULL, @Search NVARCHAR(255) = NULL,
    @Sort NVARCHAR(40) = N'last_interaction_desc', @Page INT = 1, @PageSize INT = 25
AS
BEGIN
    SET NOCOUNT ON;
    SET @Page = CASE WHEN @Page < 1 THEN 1 ELSE @Page END;
    SET @PageSize = CASE WHEN @PageSize < 1 THEN 25 WHEN @PageSize > 500 THEN 500 ELSE @PageSize END;
    SELECT f.LeadId, f.LeadName Lead, f.InboundInteractionCount, f.OutboundInteractionCount, f.CommentCount, f.DMCount,
        f.LastInteraction, f.LastInteractionDate, f.LeadScore, f.ScoreBand Temperature, COUNT_BIG(*) OVER() TotalCount
    FROM dbo.CRMReport_FilteredLeads(@ScoreBand, @MinScore, @MaxScore, @Intent, @Platform, @Source, @CampaignId, @StartDate, @EndDate, @Search) f
    ORDER BY
        CASE WHEN @Sort = N'name_asc' THEN f.LeadName END ASC,
        CASE WHEN @Sort = N'inbound_desc' THEN f.InboundInteractionCount END DESC,
        CASE WHEN @Sort = N'outbound_desc' THEN f.OutboundInteractionCount END DESC,
        CASE WHEN @Sort = N'score_desc' THEN f.LeadScore END DESC,
        f.LastInteractionDate DESC, f.LeadId DESC
    OFFSET (@Page - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
END;
GO

CREATE OR ALTER PROCEDURE dbo.CRMReport_HotLeads
    @ScoreBand NVARCHAR(20) = NULL, @MinScore INT = NULL, @MaxScore INT = NULL, @Intent NVARCHAR(64) = NULL,
    @Platform NVARCHAR(32) = NULL, @Source NVARCHAR(100) = NULL, @CampaignId BIGINT = NULL,
    @StartDate DATETIME2(3) = NULL, @EndDate DATETIME2(3) = NULL, @Search NVARCHAR(255) = NULL,
    @Sort NVARCHAR(40) = N'score_desc', @Page INT = 1, @PageSize INT = 25
AS
BEGIN
    SET NOCOUNT ON;
    SET @Page = CASE WHEN @Page < 1 THEN 1 ELSE @Page END;
    SET @PageSize = CASE WHEN @PageSize < 1 THEN 25 WHEN @PageSize > 500 THEN 500 ELSE @PageSize END;
    SELECT f.LeadId, f.LeadName, f.InstagramUsername, f.FacebookUsername, f.XUsername, f.OtherSocialUsernames,
        f.LeadScore Score, f.Intent, f.LatestMessage, f.LastInteractionDate, f.CampaignId, f.Campaign, f.Source,
        f.Platform, f.ScoreBand Temperature, COUNT_BIG(*) OVER() TotalCount
    FROM dbo.CRMReport_FilteredLeads(@ScoreBand, @MinScore, @MaxScore, @Intent, @Platform, @Source, @CampaignId, @StartDate, @EndDate, @Search) f
    WHERE f.LeadScore >= 80 OR UPPER(f.ScoreBand) = N'HOT'
    ORDER BY
        CASE WHEN @Sort = N'name_asc' THEN f.LeadName END ASC,
        CASE WHEN @Sort = N'last_interaction_desc' THEN f.LastInteractionDate END DESC,
        CASE WHEN @Sort = N'intent_asc' THEN f.Intent END ASC,
        f.LeadScore DESC, f.LastInteractionDate DESC, f.LeadId DESC
    OFFSET (@Page - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;
END;
GO
