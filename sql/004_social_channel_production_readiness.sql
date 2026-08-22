SET XACT_ABORT ON;
GO

IF COL_LENGTH(N'dbo.SocialChannelConfigurations', N'AdAccountId') IS NULL ALTER TABLE dbo.SocialChannelConfigurations ADD AdAccountId NVARCHAR(255) NULL;
IF COL_LENGTH(N'dbo.SocialChannelConfigurations', N'LoginMode') IS NULL ALTER TABLE dbo.SocialChannelConfigurations ADD LoginMode NVARCHAR(64) NULL;
IF COL_LENGTH(N'dbo.SocialChannelConfigurations', N'TokenType') IS NULL ALTER TABLE dbo.SocialChannelConfigurations ADD TokenType NVARCHAR(64) NULL;
IF COL_LENGTH(N'dbo.SocialChannelConfigurations', N'AccessTokenExpiresAt') IS NULL ALTER TABLE dbo.SocialChannelConfigurations ADD AccessTokenExpiresAt DATETIME2(3) NULL;
IF COL_LENGTH(N'dbo.SocialChannelConfigurations', N'RefreshTokenExpiresAt') IS NULL ALTER TABLE dbo.SocialChannelConfigurations ADD RefreshTokenExpiresAt DATETIME2(3) NULL;
IF COL_LENGTH(N'dbo.SocialChannelConfigurations', N'LastTokenRefreshAt') IS NULL ALTER TABLE dbo.SocialChannelConfigurations ADD LastTokenRefreshAt DATETIME2(3) NULL;
IF COL_LENGTH(N'dbo.SocialChannelConfigurations', N'NextTokenRefreshAt') IS NULL ALTER TABLE dbo.SocialChannelConfigurations ADD NextTokenRefreshAt DATETIME2(3) NULL;
IF COL_LENGTH(N'dbo.SocialChannelConfigurations', N'RequiredScopes') IS NULL ALTER TABLE dbo.SocialChannelConfigurations ADD RequiredScopes NVARCHAR(2000) NULL;
IF COL_LENGTH(N'dbo.SocialChannelConfigurations', N'GrantedScopes') IS NULL ALTER TABLE dbo.SocialChannelConfigurations ADD GrantedScopes NVARCHAR(2000) NULL;
IF COL_LENGTH(N'dbo.SocialChannelConfigurations', N'PermissionsValidatedAt') IS NULL ALTER TABLE dbo.SocialChannelConfigurations ADD PermissionsValidatedAt DATETIME2(3) NULL;
IF COL_LENGTH(N'dbo.SocialChannelConfigurations', N'WebhookSubscribedFields') IS NULL ALTER TABLE dbo.SocialChannelConfigurations ADD WebhookSubscribedFields NVARCHAR(2000) NULL;
IF COL_LENGTH(N'dbo.SocialChannelConfigurations', N'WebhookSubscriptionId') IS NULL ALTER TABLE dbo.SocialChannelConfigurations ADD WebhookSubscriptionId NVARCHAR(255) NULL;
IF COL_LENGTH(N'dbo.SocialChannelConfigurations', N'WebhookSubscribedAt') IS NULL ALTER TABLE dbo.SocialChannelConfigurations ADD WebhookSubscribedAt DATETIME2(3) NULL;
IF COL_LENGTH(N'dbo.SocialChannelConfigurations', N'LastWebhookReceivedAt') IS NULL ALTER TABLE dbo.SocialChannelConfigurations ADD LastWebhookReceivedAt DATETIME2(3) NULL;
IF COL_LENGTH(N'dbo.SocialChannelConfigurations', N'AppMode') IS NULL ALTER TABLE dbo.SocialChannelConfigurations ADD AppMode NVARCHAR(32) NULL;
IF COL_LENGTH(N'dbo.SocialChannelConfigurations', N'AdvancedAccessStatus') IS NULL ALTER TABLE dbo.SocialChannelConfigurations ADD AdvancedAccessStatus NVARCHAR(32) NULL;
IF COL_LENGTH(N'dbo.SocialChannelConfigurations', N'BusinessVerificationStatus') IS NULL ALTER TABLE dbo.SocialChannelConfigurations ADD BusinessVerificationStatus NVARCHAR(32) NULL;
GO

CREATE OR ALTER PROCEDURE dbo.SocialChannelConfiguration_GetAll
AS
BEGIN
    SET NOCOUNT ON;
    SELECT Channel, Enabled, Environment, AccountId, PageId, AdAccountId, BusinessId, AppId, ClientId,
           LoginMode, TokenType, AccessTokenExpiresAt, RefreshTokenExpiresAt, LastTokenRefreshAt,
           NextTokenRefreshAt, WebhookUrl, CallbackUrl, Scopes, RequiredScopes, GrantedScopes,
           PermissionsValidatedAt, WebhookSubscribedFields, WebhookSubscriptionId, WebhookSubscribedAt,
           LastWebhookReceivedAt, ApiVersion, AppMode, AdvancedAccessStatus, BusinessVerificationStatus,
           SecretCiphertext, SecretIv, SecretAuthTag, SecretFields, KeyVersion, Status, LastTestedAt,
           LastSuccessAt, LastErrorAt, LastError, CreatedAt, UpdatedAt
    FROM dbo.SocialChannelConfigurations
    ORDER BY CASE Channel WHEN N'instagram' THEN 1 WHEN N'facebook' THEN 2 ELSE 3 END;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialChannelConfiguration_Upsert
    @Channel NVARCHAR(32),
    @Enabled BIT,
    @Environment NVARCHAR(32),
    @AccountId NVARCHAR(255) = NULL,
    @PageId NVARCHAR(255) = NULL,
    @AdAccountId NVARCHAR(255) = NULL,
    @BusinessId NVARCHAR(255) = NULL,
    @AppId NVARCHAR(255) = NULL,
    @ClientId NVARCHAR(255) = NULL,
    @LoginMode NVARCHAR(64) = NULL,
    @TokenType NVARCHAR(64) = NULL,
    @AccessTokenExpiresAt DATETIME2(3) = NULL,
    @RefreshTokenExpiresAt DATETIME2(3) = NULL,
    @LastTokenRefreshAt DATETIME2(3) = NULL,
    @NextTokenRefreshAt DATETIME2(3) = NULL,
    @WebhookUrl NVARCHAR(2048) = NULL,
    @CallbackUrl NVARCHAR(2048) = NULL,
    @Scopes NVARCHAR(2000) = NULL,
    @RequiredScopes NVARCHAR(2000) = NULL,
    @GrantedScopes NVARCHAR(2000) = NULL,
    @PermissionsValidatedAt DATETIME2(3) = NULL,
    @WebhookSubscribedFields NVARCHAR(2000) = NULL,
    @WebhookSubscriptionId NVARCHAR(255) = NULL,
    @WebhookSubscribedAt DATETIME2(3) = NULL,
    @LastWebhookReceivedAt DATETIME2(3) = NULL,
    @ApiVersion NVARCHAR(64) = NULL,
    @AppMode NVARCHAR(32) = NULL,
    @AdvancedAccessStatus NVARCHAR(32) = NULL,
    @BusinessVerificationStatus NVARCHAR(32) = NULL,
    @ReplaceSecrets BIT = 0,
    @SecretCiphertext NVARCHAR(MAX) = NULL,
    @SecretIv NVARCHAR(255) = NULL,
    @SecretAuthTag NVARCHAR(255) = NULL,
    @SecretFields NVARCHAR(2000) = NULL,
    @KeyVersion NVARCHAR(32) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.SocialChannelConfigurations
    SET Enabled = @Enabled,
        Environment = @Environment,
        AccountId = @AccountId,
        PageId = @PageId,
        AdAccountId = @AdAccountId,
        BusinessId = @BusinessId,
        AppId = @AppId,
        ClientId = @ClientId,
        LoginMode = @LoginMode,
        TokenType = @TokenType,
        AccessTokenExpiresAt = COALESCE(@AccessTokenExpiresAt, AccessTokenExpiresAt),
        RefreshTokenExpiresAt = COALESCE(@RefreshTokenExpiresAt, RefreshTokenExpiresAt),
        LastTokenRefreshAt = COALESCE(@LastTokenRefreshAt, LastTokenRefreshAt),
        NextTokenRefreshAt = COALESCE(@NextTokenRefreshAt, NextTokenRefreshAt),
        WebhookUrl = @WebhookUrl,
        CallbackUrl = @CallbackUrl,
        Scopes = @Scopes,
        RequiredScopes = @RequiredScopes,
        GrantedScopes = @GrantedScopes,
        PermissionsValidatedAt = COALESCE(@PermissionsValidatedAt, PermissionsValidatedAt),
        WebhookSubscribedFields = @WebhookSubscribedFields,
        WebhookSubscriptionId = @WebhookSubscriptionId,
        WebhookSubscribedAt = COALESCE(@WebhookSubscribedAt, WebhookSubscribedAt),
        LastWebhookReceivedAt = COALESCE(@LastWebhookReceivedAt, LastWebhookReceivedAt),
        ApiVersion = @ApiVersion,
        AppMode = @AppMode,
        AdvancedAccessStatus = @AdvancedAccessStatus,
        BusinessVerificationStatus = @BusinessVerificationStatus,
        SecretCiphertext = CASE WHEN @ReplaceSecrets = 1 THEN @SecretCiphertext ELSE SecretCiphertext END,
        SecretIv = CASE WHEN @ReplaceSecrets = 1 THEN @SecretIv ELSE SecretIv END,
        SecretAuthTag = CASE WHEN @ReplaceSecrets = 1 THEN @SecretAuthTag ELSE SecretAuthTag END,
        SecretFields = CASE WHEN @ReplaceSecrets = 1 THEN @SecretFields ELSE SecretFields END,
        KeyVersion = CASE WHEN @ReplaceSecrets = 1 THEN @KeyVersion ELSE KeyVersion END,
        Status = N'disconnected',
        LastError = NULL,
        UpdatedAt = SYSUTCDATETIME()
    WHERE Channel = @Channel;

    IF @@ROWCOUNT = 0
        INSERT dbo.SocialChannelConfigurations
            (Channel, Enabled, Environment, AccountId, PageId, AdAccountId, BusinessId, AppId, ClientId,
             LoginMode, TokenType, AccessTokenExpiresAt, RefreshTokenExpiresAt, LastTokenRefreshAt,
             NextTokenRefreshAt, WebhookUrl, CallbackUrl, Scopes, RequiredScopes, GrantedScopes,
             PermissionsValidatedAt, WebhookSubscribedFields, WebhookSubscriptionId, WebhookSubscribedAt,
             LastWebhookReceivedAt, ApiVersion, AppMode, AdvancedAccessStatus, BusinessVerificationStatus,
             SecretCiphertext, SecretIv, SecretAuthTag, SecretFields, KeyVersion, Status)
        VALUES
            (@Channel, @Enabled, @Environment, @AccountId, @PageId, @AdAccountId, @BusinessId, @AppId, @ClientId,
             @LoginMode, @TokenType, @AccessTokenExpiresAt, @RefreshTokenExpiresAt, @LastTokenRefreshAt,
             @NextTokenRefreshAt, @WebhookUrl, @CallbackUrl, @Scopes, @RequiredScopes, @GrantedScopes,
             @PermissionsValidatedAt, @WebhookSubscribedFields, @WebhookSubscriptionId, @WebhookSubscribedAt,
             @LastWebhookReceivedAt, @ApiVersion, @AppMode, @AdvancedAccessStatus, @BusinessVerificationStatus,
             @SecretCiphertext, @SecretIv, @SecretAuthTag, @SecretFields, @KeyVersion, N'disconnected');

    EXEC dbo.SocialChannelConfiguration_GetAll;
END;
GO

CREATE OR ALTER PROCEDURE dbo.SocialChannelConfiguration_MarkWebhookReceived
    @Channel NVARCHAR(32),
    @ReceivedAt DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.SocialChannelConfigurations
    SET LastWebhookReceivedAt = @ReceivedAt, UpdatedAt = SYSUTCDATETIME()
    WHERE Channel = @Channel;
END;
GO
