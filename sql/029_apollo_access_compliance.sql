/*
  Apollo endpoint-access compliance guard.
  Reclassifies permanent authorization failures and exposes them separately
  from transient provider failures and rate limits.
*/

IF OBJECT_ID(N'dbo.AIAcquisitionApolloUsage', N'U') IS NOT NULL
BEGIN
    UPDATE dbo.AIAcquisitionApolloUsage
    SET [Status]=N'ACCESS_DENIED',
        ErrorCode=COALESCE(NULLIF(ErrorCode,N''),N'ENDPOINT_NOT_PERMITTED'),
        UpdatedAt=SYSUTCDATETIME()
    WHERE RequestKind IN (N'PEOPLE_SEARCH',N'COMPANY_SEARCH')
      AND [Status]=N'FAILED'
      AND (LOWER(COALESCE(ErrorMessage,N'')) LIKE N'%not permitted%'
        OR LOWER(COALESCE(ErrorMessage,N'')) LIKE N'%not authorized%'
        OR LOWER(COALESCE(ErrorMessage,N'')) LIKE N'%forbidden%');
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
      COALESCE(SUM(CASE WHEN [Status]=N'RATE_LIMITED' THEN 1 ELSE 0 END),0) RateLimitedRequests,
      COALESCE(SUM(CASE WHEN [Status]=N'ACCESS_DENIED' THEN 1 ELSE 0 END),0) AccessDeniedRequests
    FROM dbo.AIAcquisitionApolloUsage WHERE AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId;
    SELECT TOP (@Limit) * FROM dbo.AIAcquisitionApolloUsage
    WHERE AIAcquisitionConfigurationId=@AIAcquisitionConfigurationId
    ORDER BY CreatedAt DESC,AIAcquisitionApolloUsageId DESC;
END
GO
