CREATE OR ALTER PROCEDURE dbo.SocialLead_Create
    @Name NVARCHAR(255),
    @Email NVARCHAR(320),
    @Phone NVARCHAR(80) = NULL,
    @Facebook NVARCHAR(500) = NULL,
    @Instagram NVARCHAR(500) = NULL,
    @X NVARCHAR(500) = NULL,
    @Source NVARCHAR(100) = N'Manual',
    @EstimatedValue DECIMAL(19,4) = 0,
    @LastIntent NVARCHAR(64) = NULL,
    @CrmNotes NVARCHAR(MAX) = NULL,
    @LastIntentProvided BIT = 0,
    @CrmNotesProvided BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @LeadId BIGINT;

    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT TOP (1) @LeadId = LeadId
        FROM dbo.Leads WITH (UPDLOCK, HOLDLOCK)
        WHERE Email = @Email
        ORDER BY LeadId;

        IF @LeadId IS NULL
        BEGIN
            INSERT dbo.Leads
                (Name, Email, Phone, SocialUsername, Facebook, Instagram, [X], [Source],
                 EstimatedValue, Status, LastIntent, CrmNotes)
            VALUES
                (@Name, @Email, @Phone, COALESCE(@Instagram, @Facebook, @X),
                 @Facebook, @Instagram, @X, @Source, @EstimatedValue, N'New',
                 CASE WHEN @LastIntentProvided = 1 THEN @LastIntent ELSE NULL END,
                 CASE WHEN @CrmNotesProvided = 1 THEN @CrmNotes ELSE NULL END);
            SET @LeadId = SCOPE_IDENTITY();
        END
        ELSE
        BEGIN
            UPDATE dbo.Leads
            SET Name = @Name,
                Phone = @Phone,
                SocialUsername = COALESCE(@Instagram, @Facebook, @X),
                Facebook = @Facebook,
                Instagram = @Instagram,
                [X] = @X,
                [Source] = @Source,
                EstimatedValue = @EstimatedValue,
                LastIntent = CASE WHEN @LastIntentProvided = 1 THEN @LastIntent ELSE LastIntent END,
                CrmNotes = CASE WHEN @CrmNotesProvided = 1 THEN @CrmNotes ELSE CrmNotes END,
                UpdatedAt = SYSUTCDATETIME()
            WHERE LeadId = @LeadId;
        END;
        COMMIT TRANSACTION;

        SELECT LeadId, Name, Email, Phone, SocialUsername, Facebook, Instagram, [X],
               COALESCE(NULLIF([Source], N''), N'Manual') AS SourceChannel,
               Status, EstimatedValue AS Value, LeadScore, LeadTemperature, LastIntent,
               CrmNotes, CreatedAt, UpdatedAt
        FROM dbo.Leads WHERE LeadId = @LeadId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialLead_Update
    @LeadId BIGINT,
    @Name NVARCHAR(255),
    @Email NVARCHAR(320),
    @Phone NVARCHAR(80) = NULL,
    @Facebook NVARCHAR(500) = NULL,
    @Instagram NVARCHAR(500) = NULL,
    @X NVARCHAR(500) = NULL,
    @Source NVARCHAR(100) = N'Manual',
    @EstimatedValue DECIMAL(19,4) = 0,
    @LastIntent NVARCHAR(64) = NULL,
    @CrmNotes NVARCHAR(MAX) = NULL,
    @LastIntentProvided BIT = 0,
    @CrmNotesProvided BIT = 0
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.Leads
    SET Name = @Name,
        Email = @Email,
        Phone = @Phone,
        SocialUsername = COALESCE(@Instagram, @Facebook, @X),
        Facebook = @Facebook,
        Instagram = @Instagram,
        [X] = @X,
        [Source] = @Source,
        EstimatedValue = @EstimatedValue,
        LastIntent = CASE WHEN @LastIntentProvided = 1 THEN @LastIntent ELSE LastIntent END,
        CrmNotes = CASE WHEN @CrmNotesProvided = 1 THEN @CrmNotes ELSE CrmNotes END,
        UpdatedAt = SYSUTCDATETIME()
    WHERE LeadId = @LeadId;

    IF @@ROWCOUNT > 0
        SELECT LeadId, Name, Email, Phone, SocialUsername, Facebook, Instagram, [X],
               COALESCE(NULLIF([Source], N''), N'Manual') AS SourceChannel,
               Status, EstimatedValue AS Value, LeadScore, LeadTemperature, LastIntent,
               CrmNotes, CreatedAt, UpdatedAt
        FROM dbo.Leads WHERE LeadId = @LeadId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialLead_GetRecent
    @Limit INT = 100
AS
BEGIN
    SET NOCOUNT ON;
    SET @Limit = CASE WHEN @Limit < 1 THEN 1 WHEN @Limit > 500 THEN 500 ELSE @Limit END;

    SELECT TOP (@Limit)
        l.LeadId, l.Name, l.FirstName, l.LastName, l.DisplayName, l.Company,
        l.Email, l.Phone, l.SocialUsername, l.Facebook, l.Instagram, l.[X],
        COALESCE(NULLIF(l.[Source], N''), N'Manual') AS SourceChannel,
        l.Status, l.EstimatedValue AS Value, l.LeadScore, l.LeadTemperature,
        l.LastIntent, l.CrmNotes, l.ProductServiceInterest, l.QualificationJson,
        l.Budget, l.PurchaseTimeline, l.PreferredContactMethod, l.AssignedSalesperson,
        l.ConsentStatus, l.ConvertedCustomer, l.LostReason, l.FirstContactAt,
        l.LastContactAt, l.CreatedAt, l.UpdatedAt
    FROM dbo.Leads l
    ORDER BY l.UpdatedAt DESC, l.LeadId DESC;
END;
GO
