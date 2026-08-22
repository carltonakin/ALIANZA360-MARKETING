SET XACT_ABORT ON;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_Leads_Status_UpdatedAt' AND object_id=OBJECT_ID(N'dbo.Leads'))
    CREATE INDEX IX_Leads_Status_UpdatedAt ON dbo.Leads(Status, UpdatedAt DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_Leads_Email' AND object_id=OBJECT_ID(N'dbo.Leads'))
    CREATE INDEX IX_Leads_Email ON dbo.Leads(Email) WHERE Email IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_LandingPages_CampaignId' AND object_id=OBJECT_ID(N'dbo.LandingPages'))
    CREATE INDEX IX_LandingPages_CampaignId ON dbo.LandingPages(CampaignId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'IX_Webinars_CampaignId' AND object_id=OBJECT_ID(N'dbo.Webinars'))
    CREATE INDEX IX_Webinars_CampaignId ON dbo.Webinars(CampaignId);
GO

CREATE OR ALTER PROCEDURE dbo.SocialLead_Delete @LeadId BIGINT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        DELETE dbo.LeadRoutineEvents WHERE LeadId=@LeadId;
        DELETE dbo.LeadSourceAttribution WHERE LeadId=@LeadId;
        DELETE dbo.Leads WHERE LeadId=@LeadId;
        DECLARE @Deleted BIT=CASE WHEN @@ROWCOUNT=1 THEN 1 ELSE 0 END;
        COMMIT TRANSACTION;
        SELECT @Deleted AS Deleted;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.Campaign_Delete @CampaignId BIGINT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        UPDATE dbo.LeadRoutineEvents SET CampaignId=NULL WHERE CampaignId=@CampaignId;
        UPDATE dbo.Webinars SET CampaignId=NULL WHERE CampaignId=@CampaignId;
        UPDATE dbo.LandingPages SET CampaignId=NULL WHERE CampaignId=@CampaignId;
        DELETE dbo.Campaigns WHERE CampaignId=@CampaignId;
        DECLARE @Deleted BIT=CASE WHEN @@ROWCOUNT=1 THEN 1 ELSE 0 END;
        COMMIT TRANSACTION;
        SELECT @Deleted AS Deleted;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.LandingPage_Delete @LandingPageId BIGINT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        UPDATE dbo.LeadRoutineEvents SET LandingPageId=NULL WHERE LandingPageId=@LandingPageId;
        UPDATE dbo.Webinars SET LandingPageId=NULL WHERE LandingPageId=@LandingPageId;
        DELETE dbo.LandingPages WHERE LandingPageId=@LandingPageId;
        DECLARE @Deleted BIT=CASE WHEN @@ROWCOUNT=1 THEN 1 ELSE 0 END;
        COMMIT TRANSACTION;
        SELECT @Deleted AS Deleted;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.Webinar_Delete @WebinarId BIGINT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    BEGIN TRY
        BEGIN TRANSACTION;
        UPDATE dbo.LeadRoutineEvents SET WebinarId=NULL WHERE WebinarId=@WebinarId;
        DELETE dbo.Webinars WHERE WebinarId=@WebinarId;
        DECLARE @Deleted BIT=CASE WHEN @@ROWCOUNT=1 THEN 1 ELSE 0 END;
        COMMIT TRANSACTION;
        SELECT @Deleted AS Deleted;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO
