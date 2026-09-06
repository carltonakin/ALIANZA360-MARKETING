SET XACT_ABORT ON;
GO

/*
Landing-page registrations are recorded as idempotent LEAD_FORM_SUBMISSION
interactions. Keep the established 100-point model and temperature bands;
only include the new interaction type in the existing history calculation.
*/
CREATE OR ALTER PROCEDURE dbo.LeadScore_Recalculate
    @LeadId BIGINT,
    @ScoredAt DATETIME2(3) = NULL,
    @ReturnResult BIT = 1
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.Leads WHERE LeadId = @LeadId) RETURN;

    SET @ScoredAt = COALESCE(@ScoredAt, SYSUTCDATETIME());
    DECLARE @IntentRaw DECIMAL(19,4) = 0, @EngagementRaw DECIMAL(19,4) = 0;
    DECLARE @IntentScore INT = 0, @EngagementScore INT = 0, @FitScore INT = 0;
    DECLARE @RecencyScore INT = 0, @SourceScore INT = 0, @LeadScore INT = 0;
    DECLARE @Band NVARCHAR(20) = N'COLD', @Reason NVARCHAR(1000), @InteractionCount INT = 0;
    DECLARE @LastInteractionAt DATETIME2(3), @LastInteractionType NVARCHAR(64), @LastInteractionText NVARCHAR(MAX);
    DECLARE @LastResponseAt DATETIME2(3), @LastResponseType NVARCHAR(64), @LastResponseText NVARCHAR(MAX);
    DECLARE @LatestIntent NVARCHAR(64), @LatestAgeDays INT;

    ;WITH Meaningful AS
    (
        SELECT si.InteractionType, si.Intent, si.IntentConfidence, si.OccurredAt,
            CASE WHEN DATEDIFF(DAY, si.OccurredAt, @ScoredAt) < 0 THEN 0 ELSE DATEDIFF(DAY, si.OccurredAt, @ScoredAt) END AS AgeDays,
            CASE
                WHEN si.Intent = N'PURCHASE_INTENT' THEN 18
                WHEN si.Intent IN (N'QUOTE_REQUEST', N'DEMO_REQUEST', N'APPOINTMENT_REQUEST') THEN 16
                WHEN si.Intent IN (N'PRICE_REQUEST', N'AVAILABILITY_REQUEST', N'CALL_REQUEST') THEN 12
                WHEN si.Intent IN (N'INFORMATION_REQUEST', N'PRODUCT_QUESTION', N'LOCATION_REQUEST', N'INSTALLATION_REQUEST', N'CUSTOMIZATION_REQUEST') THEN 8
                ELSE 2
            END AS IntentPoints,
            CASE WHEN si.InteractionType IN (N'DM', N'DIRECT_MESSAGE', N'STORY_REPLY') THEN 5 ELSE 3 END AS EngagementPoints
        FROM dbo.SocialInteractions si
        WHERE si.LeadId = @LeadId
          AND UPPER(si.Direction) = N'INBOUND'
          AND si.InteractionType IN (N'COMMENT', N'REPLY', N'MENTION', N'STORY_MENTION', N'DM', N'DIRECT_MESSAGE', N'STORY_REPLY', N'LEAD_FORM_SUBMISSION')
    ), Weighted AS
    (
        SELECT *, CASE
            WHEN AgeDays <= 7 THEN CAST(1.00 AS DECIMAL(5,2))
            WHEN AgeDays <= 30 THEN CAST(0.75 AS DECIMAL(5,2))
            WHEN AgeDays <= 90 THEN CAST(0.40 AS DECIMAL(5,2))
            ELSE CAST(0.10 AS DECIMAL(5,2))
        END AS RecencyWeight
        FROM Meaningful
    )
    SELECT @IntentRaw = COALESCE(SUM(IntentPoints * RecencyWeight * COALESCE(IntentConfidence, 1)), 0),
           @EngagementRaw = COALESCE(SUM(EngagementPoints * RecencyWeight), 0),
           @InteractionCount = COUNT(*)
    FROM Weighted;

    SET @IntentScore = CASE WHEN ROUND(@IntentRaw, 0) > 35 THEN 35 ELSE CONVERT(INT, ROUND(@IntentRaw, 0)) END;
    SET @EngagementScore = CASE WHEN ROUND(@EngagementRaw, 0) > 20 THEN 20 ELSE CONVERT(INT, ROUND(@EngagementRaw, 0)) END;

    SELECT @FitScore =
        CASE WHEN NULLIF(LTRIM(RTRIM(Email)), N'') IS NOT NULL THEN 3 ELSE 0 END +
        CASE WHEN NULLIF(LTRIM(RTRIM(Phone)), N'') IS NOT NULL THEN 4 ELSE 0 END +
        CASE WHEN NULLIF(LTRIM(RTRIM(ProductServiceInterest)), N'') IS NOT NULL OR JSON_VALUE(QualificationJson, '$.productService') IS NOT NULL THEN 3 ELSE 0 END +
        CASE WHEN Budget IS NOT NULL OR TRY_CONVERT(DECIMAL(19,4), JSON_VALUE(QualificationJson, '$.budget')) IS NOT NULL THEN 2 ELSE 0 END +
        CASE WHEN NULLIF(LTRIM(RTRIM(PurchaseTimeline)), N'') IS NOT NULL OR JSON_VALUE(QualificationJson, '$.purchaseTimeline') IS NOT NULL THEN 2 ELSE 0 END +
        CASE WHEN JSON_VALUE(QualificationJson, '$.decisionMaker') IN (N'true', N'1') THEN 1 ELSE 0 END
    FROM dbo.Leads WHERE LeadId = @LeadId;
    SET @FitScore = CASE WHEN @FitScore > 15 THEN 15 ELSE COALESCE(@FitScore, 0) END;

    SELECT TOP (1)
        @LastInteractionAt = si.OccurredAt,
        @LastInteractionType = CASE WHEN si.InteractionType IN (N'DIRECT_MESSAGE', N'STORY_REPLY') THEN N'DM' ELSE si.InteractionType END,
        @LastInteractionText = si.MessageText,
        @LatestIntent = si.Intent
    FROM dbo.SocialInteractions si
    WHERE si.LeadId = @LeadId AND UPPER(si.Direction) = N'INBOUND'
      AND si.InteractionType IN (N'COMMENT', N'REPLY', N'MENTION', N'STORY_MENTION', N'DM', N'DIRECT_MESSAGE', N'STORY_REPLY', N'LEAD_FORM_SUBMISSION')
    ORDER BY si.OccurredAt DESC, si.SocialInteractionId DESC;

    SELECT TOP (1)
        @LastResponseAt = si.OccurredAt,
        @LastResponseType = CASE WHEN si.InteractionType IN (N'DIRECT_MESSAGE', N'STORY_REPLY') THEN N'DM' ELSE si.InteractionType END,
        @LastResponseText = si.MessageText
    FROM dbo.SocialInteractions si
    WHERE si.LeadId = @LeadId AND UPPER(si.Direction) = N'OUTBOUND'
      AND si.InteractionType IN (N'COMMENT', N'REPLY', N'MENTION', N'STORY_MENTION', N'DM', N'DIRECT_MESSAGE', N'STORY_REPLY')
    ORDER BY si.OccurredAt DESC, si.SocialInteractionId DESC;

    IF @LastInteractionAt IS NOT NULL
    BEGIN
        SET @LatestAgeDays = CASE WHEN DATEDIFF(DAY, @LastInteractionAt, @ScoredAt) < 0 THEN 0 ELSE DATEDIFF(DAY, @LastInteractionAt, @ScoredAt) END;
        SET @RecencyScore = CASE WHEN @LatestAgeDays <= 1 THEN 15 WHEN @LatestAgeDays <= 7 THEN 12 WHEN @LatestAgeDays <= 30 THEN 8 WHEN @LatestAgeDays <= 90 THEN 4 ELSE 1 END;
    END;

    SELECT @SourceScore = COALESCE(MAX(CASE
        WHEN si.LeadFormId IS NOT NULL THEN 15
        WHEN si.SourceType = N'PAID' OR si.AdvertisementId IS NOT NULL THEN 12
        WHEN si.CampaignExternalId IS NOT NULL OR si.CampaignName IS NOT NULL THEN 8
        ELSE 5
    END), 0)
    FROM dbo.SocialInteractions si
    WHERE si.LeadId = @LeadId AND UPPER(si.Direction) = N'INBOUND'
      AND si.InteractionType IN (N'COMMENT', N'REPLY', N'MENTION', N'STORY_MENTION', N'DM', N'DIRECT_MESSAGE', N'STORY_REPLY', N'LEAD_FORM_SUBMISSION');

    SET @LeadScore = @IntentScore + @EngagementScore + @FitScore + @RecencyScore + @SourceScore;
    SET @LeadScore = CASE WHEN @LeadScore > 100 THEN 100 WHEN @LeadScore < 0 THEN 0 ELSE @LeadScore END;
    SET @Band = CASE WHEN @LeadScore >= 80 THEN N'HOT' WHEN @LeadScore >= 60 THEN N'QUALIFIED' WHEN @LeadScore >= 30 THEN N'WARM' ELSE N'COLD' END;
    SET @Reason = CASE WHEN @InteractionCount = 0
        THEN CONCAT(N'Intent 0/35; engagement 0/20; fit ', @FitScore, N'/15; recency 0/15; source 0/15. No meaningful inbound interaction history.')
        ELSE CONCAT(N'Intent ', @IntentScore, N'/35; engagement ', @EngagementScore, N'/20 across ', @InteractionCount,
            N' inbound interaction', CASE WHEN @InteractionCount = 1 THEN N'' ELSE N's' END,
            N'; fit ', @FitScore, N'/15; recency ', @RecencyScore, N'/15 (', @LatestAgeDays,
            N' day', CASE WHEN @LatestAgeDays = 1 THEN N'' ELSE N's' END, N'); source ', @SourceScore, N'/15.') END;

    UPDATE dbo.Leads
    SET LeadScore = @LeadScore, LeadTemperature = @Band, ScoreBand = @Band,
        IntentScore = @IntentScore, EngagementScore = @EngagementScore, FitScore = @FitScore,
        RecencyScore = @RecencyScore, SourceScore = @SourceScore, ScoreReason = @Reason,
        LastScoredAt = @ScoredAt, LastIntent = COALESCE(@LatestIntent, LastIntent),
        LastInteractionAt = @LastInteractionAt, LastInteractionType = @LastInteractionType,
        LastInteractionText = @LastInteractionText, LastResponseAt = @LastResponseAt,
        LastResponseType = @LastResponseType, LastResponseText = @LastResponseText,
        LastContactAt = CASE WHEN @LastInteractionAt IS NOT NULL AND (LastContactAt IS NULL OR @LastInteractionAt > LastContactAt) THEN @LastInteractionAt ELSE LastContactAt END,
        UpdatedAt = SYSUTCDATETIME()
    WHERE LeadId = @LeadId;

    IF @ReturnResult = 1
        SELECT LeadId, LeadScore, ScoreBand, IntentScore, EngagementScore, FitScore, RecencyScore,
            SourceScore, ScoreReason, LastScoredAt, CAST(CASE WHEN LeadScore >= 60 THEN 1 ELSE 0 END AS BIT) Qualified
        FROM dbo.Leads WHERE LeadId = @LeadId;
END;
GO
