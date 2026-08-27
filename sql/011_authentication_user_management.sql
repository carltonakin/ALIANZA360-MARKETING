SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'dbo.AppUsers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AppUsers
    (
        UserId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AppUsers PRIMARY KEY,
        Username NVARCHAR(128) NOT NULL,
        PasswordHash NVARCHAR(512) NOT NULL,
        Role NVARCHAR(16) NOT NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_AppUsers_IsActive DEFAULT (1),
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AppUsers_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AppUsers_UpdatedAt DEFAULT SYSUTCDATETIME(),
        LastLoginAt DATETIME2(3) NULL,
        CONSTRAINT UQ_AppUsers_Username UNIQUE (Username),
        CONSTRAINT CK_AppUsers_Role CHECK (Role IN (N'ADMIN', N'BASIC'))
    );
END;
GO

IF OBJECT_ID(N'dbo.AuthSessions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AuthSessions
    (
        SessionId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AuthSessions PRIMARY KEY,
        UserId BIGINT NOT NULL,
        TokenHash BINARY(32) NOT NULL,
        ExpiresAt DATETIME2(3) NOT NULL,
        CreatedAt DATETIME2(3) NOT NULL CONSTRAINT DF_AuthSessions_CreatedAt DEFAULT SYSUTCDATETIME(),
        LastSeenAt DATETIME2(3) NOT NULL CONSTRAINT DF_AuthSessions_LastSeenAt DEFAULT SYSUTCDATETIME(),
        RevokedAt DATETIME2(3) NULL,
        CONSTRAINT FK_AuthSessions_AppUsers FOREIGN KEY (UserId) REFERENCES dbo.AppUsers(UserId),
        CONSTRAINT UQ_AuthSessions_TokenHash UNIQUE (TokenHash)
    );

    CREATE INDEX IX_AuthSessions_User_Active
        ON dbo.AuthSessions(UserId, ExpiresAt)
        INCLUDE (RevokedAt, LastSeenAt);
END;
GO

CREATE OR ALTER PROCEDURE dbo.AuthUser_GetByUsername
    @Username NVARCHAR(128)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        UserId,
        Username,
        PasswordHash,
        Role,
        IsActive,
        CreatedAt,
        UpdatedAt,
        LastLoginAt
    FROM dbo.AppUsers
    WHERE Username = @Username;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AuthUser_List
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        UserId,
        Username,
        Role,
        IsActive,
        CreatedAt,
        UpdatedAt,
        LastLoginAt
    FROM dbo.AppUsers
    ORDER BY Username;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AuthUser_Create
    @Username NVARCHAR(128),
    @PasswordHash NVARCHAR(512),
    @Role NVARCHAR(16),
    @IsActive BIT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Role NOT IN (N'ADMIN', N'BASIC')
        THROW 51010, 'Role must be ADMIN or BASIC.', 1;

    INSERT dbo.AppUsers (Username, PasswordHash, Role, IsActive)
    VALUES (@Username, @PasswordHash, @Role, @IsActive);

    DECLARE @UserId BIGINT = SCOPE_IDENTITY();

    SELECT
        UserId,
        Username,
        Role,
        IsActive,
        CreatedAt,
        UpdatedAt,
        LastLoginAt
    FROM dbo.AppUsers
    WHERE UserId = @UserId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AuthUser_Update
    @UserId BIGINT,
    @Username NVARCHAR(128),
    @Role NVARCHAR(16),
    @IsActive BIT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @Role NOT IN (N'ADMIN', N'BASIC')
        THROW 51010, 'Role must be ADMIN or BASIC.', 1;

    BEGIN TRANSACTION;
    BEGIN TRY
        DECLARE @CurrentRole NVARCHAR(16);
        DECLARE @CurrentIsActive BIT;

        SELECT
            @CurrentRole = Role,
            @CurrentIsActive = IsActive
        FROM dbo.AppUsers WITH (UPDLOCK, HOLDLOCK)
        WHERE UserId = @UserId;

        IF @CurrentRole IS NULL
            THROW 51021, 'User was not found.', 1;

        IF @CurrentRole = N'ADMIN'
           AND @CurrentIsActive = 1
           AND (@Role <> N'ADMIN' OR @IsActive = 0)
           AND NOT EXISTS
           (
               SELECT 1
               FROM dbo.AppUsers WITH (UPDLOCK, HOLDLOCK)
               WHERE UserId <> @UserId
                 AND Role = N'ADMIN'
                 AND IsActive = 1
           )
            THROW 51020, 'The last active ADMIN cannot be removed or deactivated.', 1;

        UPDATE dbo.AppUsers
        SET
            Username = @Username,
            Role = @Role,
            IsActive = @IsActive,
            UpdatedAt = SYSUTCDATETIME()
        WHERE UserId = @UserId;

        IF @IsActive = 0 OR @Role <> @CurrentRole
        BEGIN
            UPDATE dbo.AuthSessions
            SET RevokedAt = COALESCE(RevokedAt, SYSUTCDATETIME())
            WHERE UserId = @UserId
              AND RevokedAt IS NULL;
        END;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT
        UserId,
        Username,
        Role,
        IsActive,
        CreatedAt,
        UpdatedAt,
        LastLoginAt
    FROM dbo.AppUsers
    WHERE UserId = @UserId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AuthUser_SetPassword
    @UserId BIGINT,
    @PasswordHash NVARCHAR(512)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;
    BEGIN TRY
        UPDATE dbo.AppUsers
        SET
            PasswordHash = @PasswordHash,
            UpdatedAt = SYSUTCDATETIME()
        WHERE UserId = @UserId;

        IF @@ROWCOUNT = 0
        BEGIN
            ROLLBACK TRANSACTION;
            RETURN;
        END;

        UPDATE dbo.AuthSessions
        SET RevokedAt = COALESCE(RevokedAt, SYSUTCDATETIME())
        WHERE UserId = @UserId
          AND RevokedAt IS NULL;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT
        UserId,
        Username,
        Role,
        IsActive,
        CreatedAt,
        UpdatedAt,
        LastLoginAt
    FROM dbo.AppUsers
    WHERE UserId = @UserId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AuthUser_RecordLogin
    @UserId BIGINT
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.AppUsers
    SET
        LastLoginAt = SYSUTCDATETIME(),
        UpdatedAt = SYSUTCDATETIME()
    WHERE UserId = @UserId
      AND IsActive = 1;

    SELECT
        UserId,
        Username,
        Role,
        IsActive,
        CreatedAt,
        UpdatedAt,
        LastLoginAt
    FROM dbo.AppUsers
    WHERE UserId = @UserId
      AND IsActive = 1;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AuthSession_Create
    @UserId BIGINT,
    @TokenHash BINARY(32),
    @ExpiresAt DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.AppUsers WHERE UserId = @UserId AND IsActive = 1)
        THROW 51022, 'An active user is required.', 1;

    INSERT dbo.AuthSessions (UserId, TokenHash, ExpiresAt)
    VALUES (@UserId, @TokenHash, @ExpiresAt);
END;
GO

CREATE OR ALTER PROCEDURE dbo.AuthSession_Get
    @TokenHash BINARY(32)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.AuthSessions
    SET LastSeenAt = SYSUTCDATETIME()
    WHERE TokenHash = @TokenHash
      AND RevokedAt IS NULL
      AND ExpiresAt > SYSUTCDATETIME();

    SELECT
        U.UserId,
        U.Username,
        U.Role,
        U.IsActive,
        U.CreatedAt,
        U.UpdatedAt,
        U.LastLoginAt,
        S.ExpiresAt
    FROM dbo.AuthSessions AS S
    INNER JOIN dbo.AppUsers AS U ON U.UserId = S.UserId
    WHERE S.TokenHash = @TokenHash
      AND S.RevokedAt IS NULL
      AND S.ExpiresAt > SYSUTCDATETIME()
      AND U.IsActive = 1;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AuthSession_Revoke
    @TokenHash BINARY(32)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.AuthSessions
    SET RevokedAt = COALESCE(RevokedAt, SYSUTCDATETIME())
    WHERE TokenHash = @TokenHash;
END;
GO
