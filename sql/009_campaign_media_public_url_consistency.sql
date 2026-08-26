SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    UPDATE dbo.Campaigns
       SET MediaUrl = STUFF(
           MediaUrl,
           CHARINDEX(N'/api/media/', MediaUrl),
           LEN(N'/api/media/'),
           N'/uploads/campaigns/'
       ),
           UpdatedAt = SYSUTCDATETIME()
     WHERE MediaId IS NOT NULL
       AND MediaUrl IS NOT NULL
       AND CHARINDEX(N'/api/media/', MediaUrl) > 0
       AND RIGHT(MediaUrl, LEN(MediaId)) = MediaId;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
