import { decryptChannelSecrets, publicChannelConfiguration } from "./channel-config.mjs";
import { openSqlConnection } from "./sql-connection.mjs";

function iso(value) {
  return value?.toISOString?.() || value || null;
}

function jsonValue(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function numericId(value) {
  if (value === null || value === undefined || value === "") return null;
  const id = Number(String(value).replace(/^[^:]+:/, ""));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function mapLead(row) {
  return {
    id: `social:${row.LeadId}`,
    name: row.Name,
    email: row.Email || "",
    phone: row.Phone || "",
    social: row.SocialUsername || row.Instagram || row.Facebook || row.X || "",
    facebook: row.Facebook || "",
    instagram: row.Instagram || "",
    x: row.X || "",
    source: row.SourceChannel === "x"
      ? "X"
      : `${String(row.SourceChannel || "Manual")[0].toUpperCase()}${String(row.SourceChannel || "Manual").slice(1)}`,
    status: row.Status || "New",
    value: Number(row.Value || 0),
    createdAt: row.CreatedAt?.toISOString?.() || row.CreatedAt,
    updatedAt: iso(row.UpdatedAt),
    firstName: row.FirstName || "",
    lastName: row.LastName || "",
    displayName: row.DisplayName || row.Name || "",
    company: row.Company || "",
    country: row.Country || "",
    stateRegion: row.StateRegion || "",
    city: row.City || "",
    leadScore: Number(row.LeadScore || 0),
    leadTemperature: row.LeadTemperature || "COLD",
    intent: row.LastIntent || "OTHER",
    productServiceInterest: row.ProductServiceInterest || "",
    qualification: jsonValue(row.QualificationJson, {}),
    budget: row.Budget === null || row.Budget === undefined ? null : Number(row.Budget),
    purchaseTimeline: row.PurchaseTimeline || "",
    preferredContactMethod: row.PreferredContactMethod || "",
    assignedSalesperson: row.AssignedSalesperson || "",
    consentStatus: row.ConsentStatus || "",
    crmNotes: row.CrmNotes || "",
    convertedCustomer: Boolean(row.ConvertedCustomer),
    lostReason: row.LostReason || "",
    firstContactAt: iso(row.FirstContactAt),
    lastContactAt: iso(row.LastContactAt),
  };
}

function mapChannelConfiguration(row, encryptionKey) {
  const secretFields = String(row.SecretFields || "").split(",").filter(Boolean);
  const configuration = {
    channel: String(row.Channel),
    enabled: Boolean(row.Enabled),
    environment: row.Environment,
    accountId: row.AccountId,
    pageId: row.PageId,
    adAccountId: row.AdAccountId,
    businessId: row.BusinessId,
    appId: row.AppId,
    clientId: row.ClientId,
    loginMode: row.LoginMode,
    tokenType: row.TokenType,
    accessTokenExpiresAt: iso(row.AccessTokenExpiresAt),
    refreshTokenExpiresAt: iso(row.RefreshTokenExpiresAt),
    lastTokenRefreshAt: iso(row.LastTokenRefreshAt),
    nextTokenRefreshAt: iso(row.NextTokenRefreshAt),
    webhookUrl: row.WebhookUrl,
    callbackUrl: row.CallbackUrl,
    scopes: row.Scopes,
    requiredScopes: row.RequiredScopes,
    grantedScopes: row.GrantedScopes,
    permissionsValidatedAt: iso(row.PermissionsValidatedAt),
    webhookSubscribedFields: row.WebhookSubscribedFields,
    webhookSubscriptionId: row.WebhookSubscriptionId,
    webhookSubscribedAt: iso(row.WebhookSubscribedAt),
    lastWebhookReceivedAt: iso(row.LastWebhookReceivedAt),
    apiVersion: row.ApiVersion,
    appMode: row.AppMode,
    advancedAccessStatus: row.AdvancedAccessStatus,
    businessVerificationStatus: row.BusinessVerificationStatus,
    secretFields,
    status: row.Status,
    lastTestedAt: iso(row.LastTestedAt),
    lastSuccessAt: iso(row.LastSuccessAt),
    lastErrorAt: iso(row.LastErrorAt),
    lastError: row.LastError,
    updatedAt: iso(row.UpdatedAt),
  };
  if (encryptionKey && row.SecretCiphertext) {
    configuration.secrets = decryptChannelSecrets({
      ciphertext: row.SecretCiphertext,
      iv: row.SecretIv,
      authTag: row.SecretAuthTag,
    }, encryptionKey);
  }
  return configuration;
}

function mapCampaignPost(row) {
  return {
    id: Number(row.CampaignPostId),
    campaignId: row.CampaignId ? `campaign:${row.CampaignId}` : null,
    platform: row.Platform,
    bufferChannelId: row.BufferChannelId,
    bufferPostId: row.BufferPostId || null,
    scheduledAt: iso(row.ScheduledAt),
    publishedAt: iso(row.PublishedAt),
    postStatus: row.PostStatus || "DRAFT",
    externalPostId: row.ExternalPostId || null,
    postUrl: row.PostUrl || null,
    lastCheckedAt: iso(row.LastCheckedAt),
    errorSource: row.ErrorSource || null,
    errorMessage: row.ErrorMessage || null,
    lastAttemptAt: iso(row.LastAttemptAt),
    isActive: row.IsActive === undefined ? true : Boolean(row.IsActive),
    createdAt: iso(row.CreatedAt),
    updatedAt: iso(row.UpdatedAt),
  };
}

function mapCampaign(row) {
  const currentMetrics = jsonValue(row.CurrentMetricsJson, null);
  const campaignPostRows = jsonValue(row.CampaignPostsJson, []);
  const campaignPosts = Array.isArray(campaignPostRows) ? campaignPostRows.map(mapCampaignPost) : [];
  return {
    id: `campaign:${row.CampaignId}`,
    name: row.Name,
    platform: row.Platform,
    audience: row.Audience,
    message: row.Message,
    budget: Number(row.Budget || 0),
    status: row.Mode,
    createdByAi: Boolean(row.CreatedByAi),
    campaignObjective: row.CampaignObjective || row.Audience || "",
    postText: row.PostText || row.Message || "",
    postType: row.PostType || "POST",
    mediaType: row.MediaType || null,
    mediaUrl: row.MediaUrl || null,
    mediaOriginalName: row.MediaOriginalName || null,
    mediaMimeType: row.MediaMimeType || null,
    mediaSizeBytes: row.MediaSizeBytes == null ? null : Number(row.MediaSizeBytes),
    publishDateTime: iso(row.PublishDateTime),
    highIntentKeywords: row.HighIntentKeywords || "",
    aiReplyEnabled: Boolean(row.AIReplyEnabled),
    targetSocialChannels: jsonValue(row.TargetSocialChannelsJson, []),
    campaignPosts,
    lastReadinessCheckAt: iso(row.LastReadinessCheckAt),
    lastReadinessError: row.LastReadinessError || null,
    createdAt: iso(row.CreatedAt),
    updatedAt: iso(row.UpdatedAt),
    sourceType: row.SourceType || "ORGANIC",
    externalCampaignId: row.ExternalCampaignId || null,
    advertisementId: row.AdvertisementId || null,
    leadFormId: row.LeadFormId || null,
    contentReference: row.ContentReference || null,
    automationStatus: row.AutomationStatus || "DRAFT",
    automationEnabled: Boolean(row.AutomationEnabled),
    schedule: row.Schedule || "continuous",
    cadenceMinutes: Number(row.CadenceMinutes || 60),
    lastRunAt: iso(row.LastRunAt),
    nextRunAt: iso(row.NextRunAt),
    lastError: row.LastError || null,
    retryCount: Number(row.RetryCount || 0),
    maxRetries: Number(row.MaxRetries ?? 3),
    currentMetrics,
    lastProcessed: Number(row.LastProcessed || 0),
    impressions: Number(currentMetrics?.impressions || 0),
    clicks: Number(currentMetrics?.clicks || 0),
  };
}

function mapSocialCampaign(row) {
  return {
    id: row.SocialCampaignId ?? numericId(row.CampaignId),
    campaignId: row.CampaignId ? `campaign:${row.CampaignId}` : null,
    name: row.Name || "",
    platform: row.Platform,
    platformName: row.PlatformName || row.Platform,
    sourceType: row.SourceType || "ORGANIC",
    externalCampaignId: row.ExternalCampaignId || null,
    advertisementId: row.AdvertisementId || null,
    leadFormId: row.LeadFormId || null,
    contentReference: row.ContentReference || null,
    automationStatus: row.AutomationStatus || "DRAFT",
    automationEnabled: Boolean(row.AutomationEnabled),
    schedule: row.Schedule || "continuous",
    cadenceMinutes: Number(row.CadenceMinutes || 60),
    lastRunAt: iso(row.LastRunAt),
    nextRunAt: iso(row.NextRunAt),
    lastError: row.LastError || null,
    retryCount: Number(row.RetryCount || 0),
    maxRetries: Number(row.MaxRetries ?? 3),
    currentMetrics: jsonValue(row.CurrentMetricsJson, null),
    lastProcessed: Number(row.LastProcessed || 0),
    lastMetricsRefreshAt: iso(row.LastMetricsRefreshAt),
    lockToken: row.LockToken ? String(row.LockToken) : null,
    createdAt: iso(row.CreatedAt),
    updatedAt: iso(row.UpdatedAt),
  };
}

function mapIntegrationEvent(row) {
  return {
    id: Number(row.IntegrationEventId),
    provider: row.Provider,
    channel: row.Channel || null,
    direction: row.Direction,
    eventType: row.EventType,
    idempotencyKey: row.IdempotencyKey,
    externalId: row.ExternalId || null,
    externalStatus: row.ExternalStatus || null,
    status: row.Status,
    attemptCount: Number(row.AttemptCount || 0),
    maxAttempts: Number(row.MaxAttempts || 0),
    nextAttemptAt: iso(row.NextAttemptAt),
    lastAttemptAt: iso(row.LastAttemptAt),
    processedAt: iso(row.ProcessedAt),
    lockToken: row.LockToken ? String(row.LockToken) : null,
    lockedAt: iso(row.LockedAt),
    campaignId: row.CampaignId ? `campaign:${row.CampaignId}` : null,
    leadId: row.LeadId ? `social:${row.LeadId}` : null,
    request: jsonValue(row.RequestJson, {}),
    response: jsonValue(row.ResponseJson, null),
    lastError: row.LastError || null,
    createdAt: iso(row.CreatedAt),
    updatedAt: iso(row.UpdatedAt),
    duplicate: Boolean(row.Duplicate),
  };
}

function mapWorkflowRun(row) {
  return {
    id: Number(row.WorkflowRunId),
    workflowType: row.WorkflowType,
    triggerType: row.TriggerType,
    triggerRecordId: row.TriggerRecordId || null,
    integrationEventId: row.IntegrationEventId ? Number(row.IntegrationEventId) : null,
    state: row.State,
    currentStep: row.CurrentStep || null,
    context: jsonValue(row.ContextJson, {}),
    lastError: row.LastError || null,
    startedAt: iso(row.StartedAt),
    completedAt: iso(row.CompletedAt),
    updatedAt: iso(row.UpdatedAt),
  };
}

function mapLandingPage(row) {
  return {
    id: `page:${row.LandingPageId}`,
    campaignId: row.CampaignId ? `campaign:${row.CampaignId}` : null,
    title: row.Title,
    slug: row.Slug,
    headline: row.Headline,
    teaser: row.Teaser || "",
    webinarUrl: row.WebinarUrl || "",
    paymentUrl: row.PaymentUrl || "",
    status: row.Status,
    registrations: Number(row.Registrations || 0),
    createdByAi: Boolean(row.CreatedByAi),
    createdAt: iso(row.CreatedAt),
    updatedAt: iso(row.UpdatedAt),
  };
}

function mapWebinar(row) {
  return {
    id: `webinar:${row.WebinarId}`,
    campaignId: row.CampaignId ? `campaign:${row.CampaignId}` : null,
    landingPageId: row.LandingPageId ? `page:${row.LandingPageId}` : null,
    title: row.Title,
    description: row.Description || "",
    scheduledAt: iso(row.ScheduledAt),
    webinarUrl: row.WebinarUrl || "",
    status: row.Status,
    createdByAi: Boolean(row.CreatedByAi),
    createdAt: iso(row.CreatedAt),
    updatedAt: iso(row.UpdatedAt),
  };
}

export class SqlServerRepository {
  constructor(sql, pool, { rawRetentionDays = 7 } = {}) {
    this.sql = sql;
    this.pool = pool;
    this.rawRetentionDays = Math.max(1, Math.min(90, Number(rawRetentionDays) || 7));
  }

  static async connect(connectionString, options) {
    if (!connectionString) {
      throw new Error("SQL_SERVER_CONNECTION_STRING is required.");
    }
    const sqlModule = await import("mssql");
    const sql = sqlModule.default || sqlModule;
    const pool = await new sql.ConnectionPool(connectionString).connect();
    return new SqlServerRepository(sql, pool, options);
  }

  static async connectFromEnv(env = process.env) {
    const options = { rawRetentionDays: env.SOCIAL_RAW_EVENT_RETENTION_DAYS };
    if (env.SQL_SERVER_CONNECTION_STRING) return SqlServerRepository.connect(env.SQL_SERVER_CONNECTION_STRING, options);
    const { sql, pool } = await openSqlConnection(env);
    return new SqlServerRepository(sql, pool, options);
  }

  request() {
    return this.pool.request();
  }

  async healthCheck() {
    const response = await this.request().query("SELECT CAST(1 AS INT) AS ok");
    return response.recordset?.[0]?.ok === 1;
  }

  async upsertConnectionStatus(result) {
    const request = this.request();
    request.input("Channel", this.sql.NVarChar(32), result.channel);
    request.input("IsConfigured", this.sql.Bit, result.configured ? 1 : 0);
    request.input("Status", this.sql.NVarChar(32), result.status);
    request.input("ExternalAccountId", this.sql.NVarChar(255), result.identity?.id || null);
    request.input("DisplayName", this.sql.NVarChar(255), result.identity?.name || result.identity?.username || null);
    request.input("CheckedAt", this.sql.DateTime2, new Date(result.checkedAt));
    request.input("LastError", this.sql.NVarChar(1000), result.status === "connected" ? null : result.reason);
    await request.execute("dbo.SocialListenerStatus_Upsert");
  }

  async recordError(entry) {
    const request = this.request();
    request.input("Channel", this.sql.NVarChar(32), entry.channel);
    request.input("Operation", this.sql.NVarChar(100), entry.operation);
    request.input("ErrorCode", this.sql.NVarChar(100), entry.code || null);
    request.input("SafeMessage", this.sql.NVarChar(1000), entry.message);
    request.input("IsTransient", this.sql.Bit, entry.transient ? 1 : 0);
    await request.execute("dbo.SocialListenerError_Insert");
  }

  async processEvent(event, lead, intelligence = {}) {
    const request = this.request();
    request.input("Channel", this.sql.NVarChar(32), event.channel);
    request.input("ExternalEventId", this.sql.NVarChar(255), event.externalEventId);
    request.input("EventType", this.sql.NVarChar(100), event.eventType);
    request.input("ExternalUserId", this.sql.NVarChar(255), event.externalUserId);
    request.input("Username", this.sql.NVarChar(255), event.username);
    request.input("DisplayName", this.sql.NVarChar(255), event.displayName);
    request.input("Email", this.sql.NVarChar(320), event.email);
    request.input("Phone", this.sql.NVarChar(80), event.phone);
    request.input("Message", this.sql.NVarChar(this.sql.MAX), event.message);
    request.input("PostId", this.sql.NVarChar(255), event.postId);
    request.input("CampaignId", this.sql.NVarChar(255), event.campaignId);
    request.input("AdId", this.sql.NVarChar(255), event.adId);
    request.input("LeadFormId", this.sql.NVarChar(255), event.leadFormId);
    request.input("CampaignName", this.sql.NVarChar(255), event.campaignName);
    request.input("ConversationId", this.sql.NVarChar(255), event.conversationId);
    request.input("Direction", this.sql.NVarChar(16), event.direction || "INBOUND");
    request.input("SourceUrl", this.sql.NVarChar(2048), event.sourceUrl);
    request.input("OccurredAt", this.sql.DateTime2, new Date(event.occurredAt));
    request.input("RawPayload", this.sql.NVarChar(this.sql.MAX), JSON.stringify(event.rawPayload));
    request.input("Qualified", this.sql.Bit, lead ? 1 : 0);
    request.input("LeadName", this.sql.NVarChar(255), lead?.name || null);
    request.input("InteractionType", this.sql.NVarChar(64), intelligence.interactionType || "POST_INTERACTION");
    request.input("Intent", this.sql.NVarChar(64), intelligence.intent || "OTHER");
    request.input("Sentiment", this.sql.NVarChar(20), intelligence.sentiment || "NEUTRAL");
    request.input("QualificationJson", this.sql.NVarChar(this.sql.MAX), JSON.stringify(intelligence.qualification || {}));
    request.input("ScoreDelta", this.sql.Int, Number(intelligence.scoreDelta || 0));
    request.input("SourceType", this.sql.NVarChar(16), intelligence.sourceType || "ORGANIC");
    request.input("RawRetentionDays", this.sql.Int, this.rawRetentionDays);
    const response = await request.execute("dbo.SocialEvent_Process");
    const row = response.recordset?.[0] || {};
    return {
      duplicate: Boolean(row.Duplicate),
      leadCreated: Boolean(row.LeadCreated),
      leadUpdated: Boolean(row.LeadUpdated),
      leadId: row.LeadId ?? null,
      socialEventId: row.SocialEventId ?? null,
    };
  }

  async saveMetrics(channel, values) {
    const request = this.request();
    request.input("Channel", this.sql.NVarChar(32), channel);
    request.input("MetricName", this.sql.NVarChar(255), "provider_metrics");
    request.input("MetricValue", this.sql.Decimal(19, 4), null);
    request.input("MetricPayload", this.sql.NVarChar(this.sql.MAX), JSON.stringify(values));
    request.input("MeasuredAt", this.sql.DateTime2, new Date());
    await request.execute("dbo.SocialMetric_Upsert");
  }

  async getStatuses(adapters) {
    const response = await this.request().execute("dbo.SocialListenerStatus_GetAll");
    const rows = new Map((response.recordset || []).map((row) => [String(row.Channel), row]));
    return Object.entries(adapters).map(([channel, adapter]) => {
      const row = rows.get(channel);
      const configuration = adapter.validateConfiguration();
      return {
        channel,
        name: channel === "x" ? "X" : `${channel[0].toUpperCase()}${channel.slice(1)}`,
        configured: configuration.configured,
        credentialValidation: row?.Status === "connected" ? "pass" : "skipped",
        listenerTest: row?.LastReceivedEvent ? "pass" : "skipped",
        metricsTest: row?.LastMetricAt ? "pass" : "skipped",
        status: row?.Status || (configuration.configured ? "disconnected" : "missing_configuration"),
        reason: row?.LastError || (configuration.configured
          ? "Provider credentials have not been validated."
          : `Missing ${configuration.missing.join(", ")}.`),
        lastSuccessfulCheck: row?.LastSuccessfulCheck?.toISOString?.() || row?.LastSuccessfulCheck || null,
        lastReceivedEvent: row?.LastReceivedEvent?.toISOString?.() || row?.LastReceivedEvent || null,
        lastError: row?.LastError || null,
        eventsProcessed: Number(row?.EventsProcessed || 0),
        leadsGenerated: Number(row?.LeadsGenerated || 0),
        supportedMetrics: channel === "instagram"
          ? ["reach", "profile_views"]
          : channel === "facebook"
            ? ["page_impressions", "page_post_engagements"]
            : ["account_public_metrics"],
      };
    });
  }

  async getChannelConfigurations(encryptionKey) {
    const response = await this.request().execute("dbo.SocialChannelConfiguration_GetAll");
    return (response.recordset || []).map((row) => mapChannelConfiguration(row, encryptionKey));
  }

  async getPublicChannelConfigurations() {
    return (await this.getChannelConfigurations()).map(publicChannelConfiguration);
  }

  async upsertChannelConfiguration(configuration, envelope) {
    const request = this.request();
    request.input("Channel", this.sql.NVarChar(32), configuration.channel);
    request.input("Enabled", this.sql.Bit, configuration.enabled ? 1 : 0);
    request.input("Environment", this.sql.NVarChar(32), configuration.environment);
    request.input("AccountId", this.sql.NVarChar(255), configuration.accountId);
    request.input("PageId", this.sql.NVarChar(255), configuration.pageId);
    request.input("AdAccountId", this.sql.NVarChar(255), configuration.adAccountId);
    request.input("BusinessId", this.sql.NVarChar(255), configuration.businessId);
    request.input("AppId", this.sql.NVarChar(255), configuration.appId);
    request.input("ClientId", this.sql.NVarChar(255), configuration.clientId);
    request.input("LoginMode", this.sql.NVarChar(64), configuration.loginMode);
    request.input("TokenType", this.sql.NVarChar(64), configuration.tokenType);
    request.input("AccessTokenExpiresAt", this.sql.DateTime2, configuration.accessTokenExpiresAt ? new Date(configuration.accessTokenExpiresAt) : null);
    request.input("RefreshTokenExpiresAt", this.sql.DateTime2, configuration.refreshTokenExpiresAt ? new Date(configuration.refreshTokenExpiresAt) : null);
    request.input("LastTokenRefreshAt", this.sql.DateTime2, configuration.lastTokenRefreshAt ? new Date(configuration.lastTokenRefreshAt) : null);
    request.input("NextTokenRefreshAt", this.sql.DateTime2, configuration.nextTokenRefreshAt ? new Date(configuration.nextTokenRefreshAt) : null);
    request.input("WebhookUrl", this.sql.NVarChar(2048), configuration.webhookUrl);
    request.input("CallbackUrl", this.sql.NVarChar(2048), configuration.callbackUrl);
    request.input("Scopes", this.sql.NVarChar(2000), configuration.scopes);
    request.input("RequiredScopes", this.sql.NVarChar(2000), configuration.requiredScopes);
    request.input("GrantedScopes", this.sql.NVarChar(2000), configuration.grantedScopes);
    request.input("PermissionsValidatedAt", this.sql.DateTime2, configuration.permissionsValidatedAt ? new Date(configuration.permissionsValidatedAt) : null);
    request.input("WebhookSubscribedFields", this.sql.NVarChar(2000), configuration.webhookSubscribedFields);
    request.input("WebhookSubscriptionId", this.sql.NVarChar(255), configuration.webhookSubscriptionId);
    request.input("WebhookSubscribedAt", this.sql.DateTime2, configuration.webhookSubscribedAt ? new Date(configuration.webhookSubscribedAt) : null);
    request.input("LastWebhookReceivedAt", this.sql.DateTime2, configuration.lastWebhookReceivedAt ? new Date(configuration.lastWebhookReceivedAt) : null);
    request.input("ApiVersion", this.sql.NVarChar(64), configuration.apiVersion);
    request.input("AppMode", this.sql.NVarChar(32), configuration.appMode);
    request.input("AdvancedAccessStatus", this.sql.NVarChar(32), configuration.advancedAccessStatus);
    request.input("BusinessVerificationStatus", this.sql.NVarChar(32), configuration.businessVerificationStatus);
    request.input("ReplaceSecrets", this.sql.Bit, envelope ? 1 : 0);
    request.input("SecretCiphertext", this.sql.NVarChar(this.sql.MAX), envelope?.ciphertext || null);
    request.input("SecretIv", this.sql.NVarChar(255), envelope?.iv || null);
    request.input("SecretAuthTag", this.sql.NVarChar(255), envelope?.authTag || null);
    request.input("SecretFields", this.sql.NVarChar(2000), envelope ? Object.keys(configuration.secrets).join(",") : null);
    request.input("KeyVersion", this.sql.NVarChar(32), envelope?.keyVersion || null);
    await request.execute("dbo.SocialChannelConfiguration_Upsert");
  }

  async deleteChannelConfiguration(channel) {
    const request = this.request();
    request.input("Channel", this.sql.NVarChar(32), channel);
    await request.execute("dbo.SocialChannelConfiguration_Delete");
  }

  async markWebhookReceived(channel, receivedAt = new Date()) {
    const request = this.request();
    request.input("Channel", this.sql.NVarChar(32), channel);
    request.input("ReceivedAt", this.sql.DateTime2, receivedAt instanceof Date ? receivedAt : new Date(receivedAt));
    await request.execute("dbo.SocialChannelConfiguration_MarkWebhookReceived");
  }

  async getContent() {
    const response = await this.request().execute("dbo.CRMContent_GetAll");
    const recordsets = response.recordsets || [];
    return {
      campaigns: (recordsets[0] || []).map(mapCampaign),
      pages: (recordsets[1] || []).map(mapLandingPage),
      webinars: (recordsets[2] || []).map(mapWebinar),
    };
  }

  async saveCampaign(input) {
    const request = this.request();
    request.input("CampaignId", this.sql.BigInt, numericId(input.id));
    request.input("Name", this.sql.NVarChar(255), input.name);
    request.input("Platform", this.sql.NVarChar(100), input.platform);
    request.input("Audience", this.sql.NVarChar(this.sql.MAX), input.audience);
    request.input("Message", this.sql.NVarChar(this.sql.MAX), input.message);
    request.input("Budget", this.sql.Decimal(19, 4), input.budget);
    request.input("Mode", this.sql.NVarChar(32), input.status || "draft");
    request.input("CreatedByAi", this.sql.Bit, input.createdByAi ? 1 : 0);
    request.input("CampaignObjective", this.sql.NVarChar(2000), input.campaignObjective || null);
    request.input("PostText", this.sql.NVarChar(this.sql.MAX), input.postText || null);
    request.input("PostType", this.sql.NVarChar(16), input.postType || "POST");
    request.input("MediaType", this.sql.NVarChar(16), input.mediaType || null);
    request.input("MediaUrl", this.sql.NVarChar(2048), input.mediaUrl || null);
    request.input("MediaOriginalName", this.sql.NVarChar(255), input.mediaOriginalName || null);
    request.input("MediaMimeType", this.sql.NVarChar(127), input.mediaMimeType || null);
    request.input("MediaSizeBytes", this.sql.BigInt, input.mediaSizeBytes == null ? null : Number(input.mediaSizeBytes));
    request.input("PublishDateTime", this.sql.DateTime2, input.publishDateTime ? new Date(input.publishDateTime) : null);
    request.input("HighIntentKeywords", this.sql.NVarChar(2000), input.highIntentKeywords || null);
    request.input("AIReplyEnabled", this.sql.Bit, input.aiReplyEnabled ? 1 : 0);
    request.input("TargetSocialChannelsJson", this.sql.NVarChar(this.sql.MAX),
      input.targetSocialChannels ? JSON.stringify(input.targetSocialChannels) : null);
    const response = await request.execute("dbo.Campaign_Save");
    return response.recordset?.[0] ? mapCampaign(response.recordset[0]) : null;
  }

  async createCampaignPost(input) {
    return this.upsertCampaignPost(input);
  }

  async upsertCampaignPost(input) {
    const request = this.request();
    request.input("CampaignId", this.sql.BigInt, numericId(input.campaignId));
    request.input("Platform", this.sql.NVarChar(64), input.platform);
    request.input("BufferChannelId", this.sql.NVarChar(255), input.bufferChannelId);
    request.input("ScheduledAt", this.sql.DateTime2, new Date(input.scheduledAt));
    const response = await request.execute("dbo.BufferCampaignPost_Upsert");
    return response.recordset?.[0] ? mapCampaignPost(response.recordset[0]) : null;
  }

  async deactivateMissingCampaignPosts(campaignId, selectedChannelIds) {
    const request = this.request();
    request.input("CampaignId", this.sql.BigInt, numericId(campaignId));
    request.input("SelectedChannelIdsJson", this.sql.NVarChar(this.sql.MAX), JSON.stringify(selectedChannelIds || []));
    const response = await request.execute("dbo.BufferCampaignPost_DeactivateMissingDrafts");
    return (response.recordset || []).map(mapCampaignPost);
  }

  async applyCampaignPostStatus(campaignPostId, input) {
    const request = this.request();
    request.input("CampaignPostId", this.sql.BigInt, numericId(campaignPostId));
    request.input("BufferPostId", this.sql.NVarChar(255), input.bufferPostId || null);
    request.input("ScheduledAt", this.sql.DateTime2, input.scheduledAt ? new Date(input.scheduledAt) : null);
    request.input("PublishedAt", this.sql.DateTime2, input.publishedAt ? new Date(input.publishedAt) : null);
    request.input("PostStatus", this.sql.NVarChar(16), input.postStatus);
    request.input("ExternalPostId", this.sql.NVarChar(255), input.externalPostId || null);
    request.input("PostUrl", this.sql.NVarChar(2048), input.postUrl || null);
    request.input("ErrorMessage", this.sql.NVarChar(1000), input.errorMessage || null);
    const response = await request.execute("dbo.BufferCampaignPost_ApplyStatus");
    return response.recordset?.[0] ? mapCampaignPost(response.recordset[0]) : null;
  }

  async failCampaignPost(campaignPostId, message) {
    const request = this.request();
    request.input("CampaignPostId", this.sql.BigInt, numericId(campaignPostId));
    request.input("ErrorMessage", this.sql.NVarChar(1000), message);
    const response = await request.execute("dbo.BufferCampaignPost_Fail");
    return response.recordset?.[0] ? mapCampaignPost(response.recordset[0]) : null;
  }

  async recordCampaignPostAttemptError(campaignPostId, message) {
    const request = this.request();
    request.input("CampaignPostId", this.sql.BigInt, numericId(campaignPostId));
    request.input("ErrorMessage", this.sql.NVarChar(1000), message);
    const response = await request.execute("dbo.BufferCampaignPost_RecordAttemptError");
    return response.recordset?.[0] ? mapCampaignPost(response.recordset[0]) : null;
  }

  async getCampaignPosts({ campaignId = null, syncableOnly = false, activeOnly = false } = {}) {
    const request = this.request();
    request.input("CampaignId", this.sql.BigInt, numericId(campaignId));
    request.input("SyncableOnly", this.sql.Bit, syncableOnly ? 1 : 0);
    request.input("ActiveOnly", this.sql.Bit, activeOnly ? 1 : 0);
    const response = await request.execute("dbo.BufferCampaignPost_Get");
    return (response.recordset || []).map(mapCampaignPost);
  }

  async setBufferCampaignMode(id, mode) {
    const request = this.request();
    request.input("CampaignId", this.sql.BigInt, numericId(id));
    request.input("Mode", this.sql.NVarChar(32), mode);
    const response = await request.execute("dbo.BufferCampaign_SetMode");
    return response.recordset?.[0] ? mapCampaign(response.recordset[0]) : null;
  }

  async saveLandingPage(input) {
    const request = this.request();
    request.input("LandingPageId", this.sql.BigInt, numericId(input.id));
    request.input("CampaignId", this.sql.BigInt, numericId(input.campaignId));
    request.input("Title", this.sql.NVarChar(255), input.title);
    request.input("Slug", this.sql.NVarChar(255), input.slug);
    request.input("Headline", this.sql.NVarChar(500), input.headline);
    request.input("Teaser", this.sql.NVarChar(this.sql.MAX), input.teaser);
    request.input("WebinarUrl", this.sql.NVarChar(2048), input.webinarUrl);
    request.input("PaymentUrl", this.sql.NVarChar(2048), input.paymentUrl);
    request.input("Status", this.sql.NVarChar(32), input.status || "draft");
    request.input("CreatedByAi", this.sql.Bit, input.createdByAi ? 1 : 0);
    const response = await request.execute("dbo.LandingPage_Save");
    return response.recordset?.[0] ? mapLandingPage(response.recordset[0]) : null;
  }

  async saveWebinar(input) {
    const request = this.request();
    request.input("WebinarId", this.sql.BigInt, numericId(input.id));
    request.input("CampaignId", this.sql.BigInt, numericId(input.campaignId));
    request.input("LandingPageId", this.sql.BigInt, numericId(input.landingPageId));
    request.input("Title", this.sql.NVarChar(255), input.title);
    request.input("Description", this.sql.NVarChar(this.sql.MAX), input.description);
    request.input("ScheduledAt", this.sql.DateTime2, input.scheduledAt ? new Date(input.scheduledAt) : null);
    request.input("WebinarUrl", this.sql.NVarChar(2048), input.webinarUrl);
    request.input("Status", this.sql.NVarChar(32), input.status || "draft");
    request.input("CreatedByAi", this.sql.Bit, input.createdByAi ? 1 : 0);
    const response = await request.execute("dbo.Webinar_Save");
    return response.recordset?.[0] ? mapWebinar(response.recordset[0]) : null;
  }

  async setCampaignMode(id, mode) {
    const request = this.request();
    request.input("CampaignId", this.sql.BigInt, numericId(id));
    request.input("Mode", this.sql.NVarChar(32), mode);
    try {
      const response = await request.execute("dbo.Campaign_SetMode");
      return response.recordset?.[0] ? mapCampaign(response.recordset[0]) : null;
    } catch (error) {
      error.statusCode = error?.number >= 51000 && error?.number < 51100 ? 409 : error.statusCode;
      throw error;
    }
  }

  async upsertRoutineLead(input) {
    const request = this.request();
    request.input("Routine", this.sql.NVarChar(64), input.routine);
    request.input("ExternalEventId", this.sql.NVarChar(255), input.externalEventId);
    request.input("Name", this.sql.NVarChar(255), input.name);
    request.input("Email", this.sql.NVarChar(320), input.email);
    request.input("Phone", this.sql.NVarChar(80), input.phone);
    request.input("Facebook", this.sql.NVarChar(500), input.facebook);
    request.input("Instagram", this.sql.NVarChar(500), input.instagram);
    request.input("X", this.sql.NVarChar(500), input.x);
    request.input("Source", this.sql.NVarChar(100), input.source);
    request.input("CampaignId", this.sql.BigInt, numericId(input.campaignId));
    request.input("LandingPageId", this.sql.BigInt, numericId(input.landingPageId));
    request.input("WebinarId", this.sql.BigInt, numericId(input.webinarId));
    request.input("SourceDetail", this.sql.NVarChar(1000), input.sourceDetail);
    request.input("OccurredAt", this.sql.DateTime2, new Date(input.occurredAt));
    const response = await request.execute("dbo.CRMLead_UpsertFromRoutine");
    const row = response.recordset?.[0];
    return row ? { leadId: Number(row.LeadId), duplicate: Boolean(row.Duplicate) } : null;
  }

  async getLeads(limit = 100) {
    const request = this.request();
    request.input("Limit", this.sql.Int, Math.max(1, Math.min(500, Number(limit) || 100)));
    const response = await request.execute("dbo.SocialLead_GetRecent");
    return (response.recordset || []).map(mapLead);
  }

  async getScoringConfiguration() {
    const response = await this.request().execute("dbo.LeadScoringConfiguration_Get");
    const [ruleRows = [], thresholdRows = []] = response.recordsets || [];
    return {
      rules: Object.fromEntries(ruleRows.filter((row) => row.IsEnabled).map((row) => [row.RuleKey, Number(row.ScoreValue)])),
      thresholds: Object.fromEntries(thresholdRows.map((row) => [row.Temperature, Number(row.MinimumScore)])),
    };
  }

  async saveScoringConfiguration({ rules = {}, thresholds = {} }) {
    for (const [key, value] of Object.entries(rules)) {
      const request = this.request();
      request.input("RuleKey", this.sql.NVarChar(100), key);
      request.input("ScoreValue", this.sql.Int, Number(value));
      request.input("IsEnabled", this.sql.Bit, 1);
      await request.execute("dbo.LeadScoringRule_Upsert");
    }
    const sortOrder = { COLD: 1, WARM: 2, HOT: 3, VERY_HOT: 4 };
    for (const [temperature, value] of Object.entries(thresholds)) {
      const request = this.request();
      request.input("Temperature", this.sql.NVarChar(20), temperature);
      request.input("MinimumScore", this.sql.Int, Number(value));
      request.input("SortOrder", this.sql.Int, sortOrder[temperature] || 99);
      await request.execute("dbo.LeadTemperatureThreshold_Upsert");
    }
    return this.getScoringConfiguration();
  }

  async saveCampaignAutomation(input) {
    const request = this.request();
    request.input("CampaignId", this.sql.BigInt, numericId(input.id || input.campaignId));
    request.input("Platform", this.sql.NVarChar(32), input.platform);
    request.input("SourceType", this.sql.NVarChar(16), input.sourceType || "ORGANIC");
    request.input("ExternalCampaignId", this.sql.NVarChar(255), input.externalCampaignId || null);
    request.input("AdvertisementId", this.sql.NVarChar(255), input.advertisementId || null);
    request.input("LeadFormId", this.sql.NVarChar(255), input.leadFormId || null);
    request.input("ContentReference", this.sql.NVarChar(2048), input.contentReference || null);
    request.input("Schedule", this.sql.NVarChar(255), input.schedule || "continuous");
    request.input("CadenceMinutes", this.sql.Int, Number(input.cadenceMinutes || 60));
    request.input("AutomationEnabled", this.sql.Bit, input.automationEnabled ? 1 : 0);
    request.input("MaxRetries", this.sql.Int, Number(input.maxRetries ?? 3));
    request.input("NextRunAt", this.sql.DateTime2, input.nextRunAt ? new Date(input.nextRunAt) : null);
    const response = await request.execute("dbo.SocialCampaign_Save");
    return response.recordset?.[0] ? mapSocialCampaign(response.recordset[0]) : null;
  }

  async getCampaignAutomation(campaignId = null) {
    const request = this.request();
    request.input("CampaignId", this.sql.BigInt, numericId(campaignId));
    const response = await request.execute("dbo.SocialCampaign_GetAll");
    return (response.recordset || []).map(mapSocialCampaign);
  }

  async setCampaignAutomationStatus(id, action, now = new Date().toISOString()) {
    const request = this.request();
    request.input("CampaignId", this.sql.BigInt, numericId(id));
    request.input("Action", this.sql.NVarChar(16), action);
    request.input("Now", this.sql.DateTime2, new Date(now));
    const response = await request.execute("dbo.SocialCampaign_SetStatus");
    return response.recordset?.[0] ? mapSocialCampaign(response.recordset[0]) : null;
  }

  async claimDueCampaigns({ now, limit, lockToken }) {
    const request = this.request();
    request.input("Now", this.sql.DateTime2, new Date(now));
    request.input("Limit", this.sql.Int, Math.max(1, Math.min(100, Number(limit) || 10)));
    request.input("LockToken", this.sql.UniqueIdentifier, lockToken);
    const response = await request.execute("dbo.SocialCampaign_ClaimDue");
    return (response.recordset || []).map(mapSocialCampaign);
  }

  async completeCampaignRun(id, result) {
    const request = this.request();
    request.input("SocialCampaignId", this.sql.BigInt, numericId(id));
    request.input("LockToken", this.sql.UniqueIdentifier, result.lockToken);
    request.input("Succeeded", this.sql.Bit, result.succeeded ? 1 : 0);
    request.input("LastRunAt", this.sql.DateTime2, new Date(result.lastRunAt));
    request.input("NextRunAt", this.sql.DateTime2, result.nextRunAt ? new Date(result.nextRunAt) : null);
    request.input("RetryCount", this.sql.Int, Number(result.retryCount || 0));
    request.input("Retryable", this.sql.Bit, result.retryable ? 1 : 0);
    request.input("LastError", this.sql.NVarChar(1000), result.error || null);
    request.input("CurrentMetricsJson", this.sql.NVarChar(this.sql.MAX), result.metrics ? JSON.stringify(result.metrics) : null);
    request.input("LastProcessed", this.sql.Int, Number(result.processed || 0));
    await request.execute("dbo.SocialCampaign_CompleteRun");
  }

  async createIntegrationAction(input) {
    const request = this.request();
    request.input("Provider", this.sql.NVarChar(64), input.provider);
    request.input("Channel", this.sql.NVarChar(32), input.channel || null);
    request.input("Direction", this.sql.NVarChar(16), input.direction);
    request.input("EventType", this.sql.NVarChar(100), input.eventType);
    request.input("IdempotencyKey", this.sql.NVarChar(255), input.idempotencyKey);
    request.input("CampaignId", this.sql.BigInt, numericId(input.campaignId));
    request.input("LeadId", this.sql.BigInt, numericId(input.leadId));
    request.input("RequestJson", this.sql.NVarChar(this.sql.MAX), JSON.stringify(input.request || {}));
    request.input("MaxAttempts", this.sql.Int, Number(input.maxAttempts || 4));
    const response = await request.execute("dbo.CRMIntegrationEvent_Create");
    return response.recordset?.[0] ? mapIntegrationEvent(response.recordset[0]) : null;
  }

  async recordInboundIntegrationEvent(input) {
    const request = this.request();
    request.input("Provider", this.sql.NVarChar(64), input.provider);
    request.input("Channel", this.sql.NVarChar(32), input.channel || null);
    request.input("EventType", this.sql.NVarChar(100), input.eventType);
    request.input("IdempotencyKey", this.sql.NVarChar(255), input.idempotencyKey);
    request.input("ExternalId", this.sql.NVarChar(255), input.externalId || null);
    request.input("RequestJson", this.sql.NVarChar(this.sql.MAX), JSON.stringify(input.request || {}));
    request.input("Succeeded", this.sql.Bit, input.succeeded === false ? 0 : 1);
    request.input("LastError", this.sql.NVarChar(1000), input.error || null);
    const response = await request.execute("dbo.CRMIntegrationEvent_RecordInbound");
    return response.recordset?.[0] ? mapIntegrationEvent(response.recordset[0]) : null;
  }

  async claimDueIntegrationActions({ now, limit, lockToken, actionId = null }) {
    const request = this.request();
    request.input("Now", this.sql.DateTime2, new Date(now));
    request.input("Limit", this.sql.Int, Math.max(1, Math.min(100, Number(limit) || 10)));
    request.input("LockToken", this.sql.UniqueIdentifier, lockToken);
    request.input("IntegrationEventId", this.sql.BigInt, numericId(actionId));
    const response = await request.execute("dbo.CRMIntegrationEvent_ClaimDue");
    return (response.recordset || []).map(mapIntegrationEvent);
  }

  async completeIntegrationAction(id, result) {
    const request = this.request();
    request.input("IntegrationEventId", this.sql.BigInt, numericId(id));
    request.input("LockToken", this.sql.UniqueIdentifier, result.lockToken);
    request.input("Succeeded", this.sql.Bit, result.succeeded ? 1 : 0);
    request.input("ExternalId", this.sql.NVarChar(255), result.externalId || null);
    request.input("ExternalStatus", this.sql.NVarChar(100), result.externalStatus || null);
    request.input("ResponseJson", this.sql.NVarChar(this.sql.MAX), result.response ? JSON.stringify(result.response) : null);
    request.input("LastError", this.sql.NVarChar(1000), result.error || null);
    request.input("Retryable", this.sql.Bit, result.retryable ? 1 : 0);
    request.input("NextAttemptAt", this.sql.DateTime2, result.nextAttemptAt ? new Date(result.nextAttemptAt) : null);
    request.input("ProcessedAt", this.sql.DateTime2, new Date(result.processedAt));
    const response = await request.execute("dbo.CRMIntegrationEvent_Complete");
    return response.recordset?.[0] ? mapIntegrationEvent(response.recordset[0]) : null;
  }

  async getIntegrationActions({ limit = 100, campaignId = null } = {}) {
    const request = this.request();
    request.input("Limit", this.sql.Int, Math.max(1, Math.min(500, Number(limit) || 100)));
    request.input("CampaignId", this.sql.BigInt, numericId(campaignId));
    const response = await request.execute("dbo.CRMIntegrationEvent_GetRecent");
    return (response.recordset || []).map(mapIntegrationEvent);
  }

  async startWorkflowRun(input) {
    const request = this.request();
    request.input("WorkflowType", this.sql.NVarChar(100), input.workflowType);
    request.input("TriggerType", this.sql.NVarChar(100), input.triggerType);
    request.input("TriggerRecordId", this.sql.NVarChar(255), input.triggerRecordId ? String(input.triggerRecordId) : null);
    request.input("IntegrationEventId", this.sql.BigInt, numericId(input.integrationEventId));
    request.input("ContextJson", this.sql.NVarChar(this.sql.MAX), JSON.stringify(input.context || {}));
    const response = await request.execute("dbo.CRMWorkflowRun_Start");
    return response.recordset?.[0] ? mapWorkflowRun(response.recordset[0]) : null;
  }

  async completeWorkflowRun(id, result) {
    if (!id) return null;
    const request = this.request();
    request.input("WorkflowRunId", this.sql.BigInt, numericId(id));
    request.input("State", this.sql.NVarChar(32), result.state);
    request.input("CurrentStep", this.sql.NVarChar(100), result.currentStep || null);
    request.input("LastError", this.sql.NVarChar(1000), result.error || null);
    const response = await request.execute("dbo.CRMWorkflowRun_Complete");
    return response.recordset?.[0] ? mapWorkflowRun(response.recordset[0]) : null;
  }

  async insertAuditLog(input) {
    const request = this.request();
    request.input("EntityType", this.sql.NVarChar(100), input.entityType);
    request.input("EntityId", this.sql.NVarChar(255), input.entityId === null || input.entityId === undefined ? null : String(input.entityId));
    request.input("Action", this.sql.NVarChar(100), input.action);
    request.input("ActorType", this.sql.NVarChar(50), input.actorType);
    request.input("ActorId", this.sql.NVarChar(255), input.actorId || null);
    request.input("CorrelationId", this.sql.NVarChar(255), input.correlationId || null);
    request.input("DetailsJson", this.sql.NVarChar(this.sql.MAX), JSON.stringify(input.details || {}));
    const response = await request.execute("dbo.CRMAuditLog_Insert");
    return response.recordset?.[0] || null;
  }

  async getUnifiedLead(leadId) {
    const request = this.request();
    request.input("LeadId", this.sql.BigInt, Number(leadId));
    const response = await request.execute("dbo.SocialLead_GetUnified");
    const sets = response.recordsets || [];
    const row = sets[0]?.[0];
    if (!row) return null;
    const interactions = (sets[2] || []).map((item) => ({
      id: `interaction:${item.SocialInteractionId}`,
      platform: item.Platform,
      platformUserId: item.PlatformUserId || null,
      platformPostId: item.PlatformPostId || null,
      platformConversationId: item.PlatformConversationId || null,
      interactionType: item.InteractionType,
      message: item.MessageText || "",
      occurredAt: iso(item.OccurredAt),
      direction: item.Direction,
      intent: item.Intent,
      sentiment: item.Sentiment,
      productService: item.ProductService || "",
      campaignId: item.CampaignExternalId || null,
      campaignName: item.CampaignName || "",
      advertisementId: item.AdvertisementId || null,
      leadFormId: item.LeadFormId || null,
      sourceType: item.SourceType,
      responseStatus: item.ResponseStatus,
      qualification: jsonValue(item.QualificationJson, {}),
    }));
    const activities = (sets[4] || []).map((item) => ({
      id: `activity:${item.LeadActivityId}`,
      type: item.ActivityType,
      summary: item.Summary || "",
      sourceReference: item.SourceReference || null,
      campaignId: item.CampaignExternalId || null,
      occurredAt: iso(item.OccurredAt),
    }));
    return {
      lead: mapLead(row),
      socialAccounts: (sets[1] || []).map((item) => ({
        id: `account:${item.SocialAccountId}`,
        platform: item.Platform,
        platformUserId: item.PlatformUserId,
        username: item.Username || "",
        displayName: item.DisplayName || "",
        profileUrl: item.ProfileUrl || null,
        lastVerifiedAt: iso(item.LastVerifiedAt),
      })),
      interactions,
      conversations: (sets[3] || []).map((item) => ({
        id: `conversation:${item.SocialConversationId}`,
        platform: item.Platform,
        platformConversationId: item.PlatformConversationId,
        lastMessageAt: iso(item.LastMessageAt),
        direction: item.Direction,
        importantMessage: item.ImportantMessage || "",
        status: item.Status,
        assignedCrmUser: item.AssignedCrmUser || "",
        referenceUrl: item.ReferenceUrl || null,
      })),
      leadActivities: activities,
      opportunities: sets[5] || [],
      quotes: sets[6] || [],
      appointments: sets[7] || [],
      conversionHistory: sets[8] || [],
      timeline: [...interactions, ...activities].sort((left, right) =>
        String(right.occurredAt).localeCompare(String(left.occurredAt))),
    };
  }

  leadRequest(input, leadId) {
    const request = this.request();
    if (leadId !== undefined) request.input("LeadId", this.sql.BigInt, Number(leadId));
    request.input("Name", this.sql.NVarChar(255), input.name);
    request.input("Email", this.sql.NVarChar(320), input.email);
    request.input("Phone", this.sql.NVarChar(80), input.phone);
    request.input("Facebook", this.sql.NVarChar(500), input.facebook);
    request.input("Instagram", this.sql.NVarChar(500), input.instagram);
    request.input("X", this.sql.NVarChar(500), input.x);
    request.input("Source", this.sql.NVarChar(100), input.source);
    request.input("EstimatedValue", this.sql.Decimal(19, 4), input.value);
    return request;
  }

  async createLead(input) {
    const response = await this.leadRequest(input).execute("dbo.SocialLead_Create");
    return response.recordset?.[0] ? mapLead(response.recordset[0]) : null;
  }

  async updateLead(leadId, input) {
    const response = await this.leadRequest(input, leadId).execute("dbo.SocialLead_Update");
    return response.recordset?.[0] ? mapLead(response.recordset[0]) : null;
  }

  async updateLeadStatus(leadId, status) {
    const request = this.request();
    request.input("LeadId", this.sql.BigInt, Number(leadId));
    request.input("Status", this.sql.NVarChar(50), status);
    const response = await request.execute("dbo.SocialLead_UpdateStatus");
    return response.recordset?.[0] || null;
  }

  async deleteLead(leadId) {
    const request = this.request();
    request.input("LeadId", this.sql.BigInt, Number(leadId));
    const response = await request.execute("dbo.SocialLead_Delete");
    return Number(response.recordset?.[0]?.Deleted || 0) === 1;
  }

  async deleteContent(entity, id) {
    const procedures = { campaign: "dbo.Campaign_Delete", landing_page: "dbo.LandingPage_Delete", webinar: "dbo.Webinar_Delete" };
    const parameters = { campaign: "CampaignId", landing_page: "LandingPageId", webinar: "WebinarId" };
    const procedure = procedures[entity];
    if (!procedure) throw Object.assign(new Error("Unsupported content entity."), { statusCode: 400 });
    const request = this.request();
    request.input(parameters[entity], this.sql.BigInt, numericId(id));
    const response = await request.execute(procedure);
    return Number(response.recordset?.[0]?.Deleted || 0) === 1;
  }

  close() {
    return this.pool.close();
  }
}
