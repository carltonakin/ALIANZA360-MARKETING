import { decryptChannelSecrets, publicChannelConfiguration } from "./channel-config.mjs";
import { openSqlConnection } from "./sql-connection.mjs";
import { resolvePersistedLandingPageMedia } from "../lib/landing-page-video.mjs";
import {
  CRM_AUTHORITATIVE_TIME_ZONE,
  CRM_DISPLAY_TIME_ZONE,
  compareTimelineNewestFirst,
  dedupeTimelineProjection,
  dualTimestamp,
  enrichTimelineRecord,
  toBogotaIso,
  toUtcIso,
} from "../lib/crm-time.mjs";

function iso(value) {
  return toUtcIso(value) || value || null;
}

function timestampFields(name, value) {
  const timestamp = dualTimestamp(value);
  return {
    [`${name}Utc`]: timestamp.utc,
    [`${name}Bogota`]: timestamp.bogota,
  };
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

function scoreBand(value) {
  const score = Math.max(0, Math.min(100, Number(value) || 0));
  if (score >= 80) return "HOT";
  if (score >= 60) return "QUALIFIED";
  if (score >= 30) return "WARM";
  return "COLD";
}

export function toSqlInteger(value) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  let number;
  try {
    number = Number(value);
  } catch {
    return null;
  }
  return Number.isFinite(number) ? Math.round(number) : null;
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
    createdAt: iso(row.CreatedAt),
    ...timestampFields("createdAt", row.CreatedAt),
    updatedAt: iso(row.UpdatedAt),
    ...timestampFields("updatedAt", row.UpdatedAt),
    firstName: row.FirstName || "",
    lastName: row.LastName || "",
    displayName: row.DisplayName || row.Name || "",
    company: row.Company || "",
    country: row.Country || "",
    stateRegion: row.StateRegion || "",
    city: row.City || "",
    leadScore: Number(row.LeadScore || 0),
    leadTemperature: row.LeadTemperature || "COLD",
    scoreBand: row.ScoreBand || scoreBand(row.LeadScore),
    intentScore: Number(row.IntentScore || 0),
    engagementScore: Number(row.EngagementScore || 0),
    fitScore: Number(row.FitScore || 0),
    recencyScore: Number(row.RecencyScore || 0),
    sourceScore: Number(row.SourceScore || 0),
    scoreReason: row.ScoreReason || "",
    lastScoredAt: iso(row.LastScoredAt),
    ...timestampFields("lastScoredAt", row.LastScoredAt),
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
    ...timestampFields("firstContactAt", row.FirstContactAt),
    lastContactAt: iso(row.LastContactAt),
    ...timestampFields("lastContactAt", row.LastContactAt),
    lastInteractionAt: iso(row.LastInteractionAt),
    ...timestampFields("lastInteractionAt", row.LastInteractionAt),
    lastInteractionType: row.LastInteractionType || null,
    lastInteractionText: row.LastInteractionText || "",
    lastResponseAt: iso(row.LastResponseAt),
    ...timestampFields("lastResponseAt", row.LastResponseAt),
    lastResponseType: row.LastResponseType || null,
    lastResponseText: row.LastResponseText || "",
  };
}

function mapLeadInteraction(row) {
  const qualification = jsonValue(row.QualificationJson, {});
  const direction = String(row.Direction || "INBOUND").toUpperCase();
  const responseStatus = row.ResponseStatus || (direction === "OUTBOUND" ? "SENT" : "PENDING");
  const occurredAt = iso(row.OccurredAt);
  const sentAt = iso(row.SentAt) || (direction === "OUTBOUND" && responseStatus === "SENT" ? occurredAt : null);
  return enrichTimelineRecord({
    id: `interaction:${row.SocialInteractionId ?? row.InteractionId}`,
    platform: row.Platform || null,
    externalInteractionId: row.ExternalInteractionId || null,
    externalReplyId: row.ExternalReplyId || (direction === "OUTBOUND" ? row.ExternalInteractionId || null : null),
    platformUserId: row.PlatformUserId || null,
    platformPostId: row.ExternalPostId || row.PlatformPostId || null,
    platformConversationId: row.PlatformConversationId || null,
    inReplyToInteractionId: row.InReplyToInteractionId
      ? `interaction:${row.InReplyToInteractionId}`
      : null,
    interactionType: row.InteractionType,
    message: row.MessageText || "",
    occurredAt,
    direction,
    intent: row.Intent,
    intentConfidence: row.IntentConfidence === null || row.IntentConfidence === undefined
      ? null
      : Number(row.IntentConfidence),
    sentiment: row.Sentiment,
    productService: row.ProductService || "",
    campaignId: row.CampaignExternalId || null,
    campaignPostId: row.CampaignPostId === null || row.CampaignPostId === undefined
      ? null
      : Number(row.CampaignPostId),
    campaignName: row.CampaignName || "",
    advertisementId: row.AdvertisementId || null,
    leadFormId: row.LeadFormId || null,
    sourceType: row.SourceType,
    responseMode: row.ResponseMode || (direction === "OUTBOUND" ? "AI_AUTOMATIC" : null),
    sentByUserId: row.SentByUserId === null || row.SentByUserId === undefined
      ? null
      : Number(row.SentByUserId),
    sentByUsername: row.SentByUsername || null,
    responseStatus,
    sentAt,
    deliveryError: row.DeliveryError || null,
    qualification,
    aiClassification: qualification.aiClassification || {},
    processedAt: iso(row.ProcessedAt),
    ...timestampFields("processedAt", row.ProcessedAt),
    duplicate: Boolean(row.Duplicate),
    duplicateCompletion: Boolean(row.DuplicateCompletion),
    queueStatus: row.QueueStatus || null,
  });
}

function mapLeadReplyClaim(row) {
  return {
    integrationEventId: Number(row.IntegrationEventId),
    lockToken: row.LockToken ? String(row.LockToken) : null,
    attemptCount: Number(row.AttemptCount || 0),
    maxAttempts: Number(row.MaxAttempts || 0),
    replyId: Number(row.ReplyId),
    leadId: Number(row.LeadId),
    platform: row.Platform,
    interactionType: row.InteractionType,
    messageText: row.MessageText || "",
    responseMode: row.ResponseMode,
    inReplyToInteractionId: Number(row.InReplyToInteractionId),
    inReplyToExternalInteractionId: row.InReplyToExternalInteractionId || null,
    externalPostId: row.ExternalPostId || null,
    conversationId: row.ConversationId || null,
    externalUserId: row.ExternalUserId || null,
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
    mediaId: row.MediaId || null,
    cloudinaryAssetId: row.CloudinaryAssetId || null,
    cloudinaryPublicId: row.CloudinaryPublicId || null,
    cloudinaryResourceType: row.CloudinaryResourceType || null,
    cloudinaryFormat: row.CloudinaryFormat || null,
    mediaType: row.MediaType || null,
    mediaUrl: row.MediaUrl || null,
    mediaOriginalName: row.MediaOriginalName || null,
    mediaMimeType: row.MediaMimeType || null,
    mediaSizeBytes: row.MediaSizeBytes == null ? null : Number(row.MediaSizeBytes),
    mediaWidth: row.MediaWidth == null ? null : Number(row.MediaWidth),
    mediaHeight: row.MediaHeight == null ? null : Number(row.MediaHeight),
    mediaDurationSeconds: row.MediaDurationSeconds == null ? null : Number(row.MediaDurationSeconds),
    mediaFrameRate: row.MediaFrameRate == null ? null : Number(row.MediaFrameRate),
    mediaVideoCodec: row.MediaVideoCodec || null,
    mediaAudioCodec: row.MediaAudioCodec || null,
    mediaAudioSampleRate: row.MediaAudioSampleRate == null ? null : Number(row.MediaAudioSampleRate),
    mediaVideoBitrate: row.MediaVideoBitrate == null ? null : Number(row.MediaVideoBitrate),
    mediaAudioBitrate: row.MediaAudioBitrate == null ? null : Number(row.MediaAudioBitrate),
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

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function mapCompanyProfile(row) {
  if (!row) return null;
  return {
    id: Number(row.CompanyProfileId),
    companyName: row.CompanyName || "",
    companyDescription: row.CompanyDescription || "",
    productsServices: row.ProductsServices || "",
    targetAudience: row.TargetAudience || "",
    brandVoice: row.BrandVoice || "",
    offers: row.Offers || "",
    website: row.Website || "",
    preferredCTA: row.PreferredCTA || "",
    industry: row.Industry || "",
    businessGoals: row.BusinessGoals || "",
    otherProfileContext: row.OtherProfileContext || "",
    createdAt: iso(row.CreatedAt),
    updatedAt: iso(row.UpdatedAt),
  };
}

function mapAiProviderConfiguration(row, encryptionKey = null) {
  const configuration = {
    id: Number(row.AIProviderConfigurationId),
    providerCode: row.ProviderCode,
    providerName: row.ProviderName,
    model: row.Model,
    enabled: Boolean(row.Enabled),
    isDefault: Boolean(row.IsDefault),
    capabilities: jsonValue(row.CapabilitiesJson, []),
    hasSecret: Boolean(row.SecretCiphertext),
    secretFields: String(row.SecretFields || "").split(",").filter(Boolean),
    connectionStatus: row.ConnectionStatus || "NOT_TESTED",
    lastTestedAt: iso(row.LastTestedAt),
    lastSuccessAt: iso(row.LastSuccessAt),
    lastErrorAt: iso(row.LastErrorAt),
    lastError: row.LastError || null,
    createdAt: iso(row.CreatedAt),
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

function mapAiCampaignConfiguration(row) {
  return {
    id: Number(row.AICampaignConfigurationId),
    campaignName: row.CampaignName,
    campaignObjective: row.CampaignObjective,
    startDate: dateOnly(row.StartDate),
    endDate: dateOnly(row.EndDate),
    postsPerDay: Number(row.PostsPerDay || 1),
    contentTypes: jsonValue(row.ContentTypesJson, []),
    aiProviderId: Number(row.AIProviderConfigurationId),
    aiModel: row.AIModel || null,
    fallbackProviderId: row.FallbackProviderConfigurationId ? Number(row.FallbackProviderConfigurationId) : null,
    selectedBufferChannelIds: jsonValue(row.SelectedBufferChannelIdsJson, []),
    cta: row.CTA || "",
    destinationUrl: row.DestinationUrl || "",
    publishingMode: row.PublishingMode || "DRAFT",
    status: row.Status || "DRAFT",
    lastGenerationDate: dateOnly(row.LastGenerationDate),
    lastError: row.LastError || null,
    providerCode: row.ProviderCode || null,
    providerName: row.ProviderName || null,
    providerDefaultModel: row.ProviderDefaultModel || null,
    fallbackProviderCode: row.FallbackProviderCode || null,
    fallbackProviderName: row.FallbackProviderName || null,
    successfulGenerationCount: Number(row.SuccessfulGenerationCount || 0),
    lastGenerationAt: iso(row.LastGenerationAt),
    createdAt: iso(row.CreatedAt),
    updatedAt: iso(row.UpdatedAt),
  };
}

function mapAiGenerationRun(row) {
  return {
    id: Number(row.AICampaignGenerationRunId),
    configurationId: Number(row.AICampaignConfigurationId),
    generationDate: dateOnly(row.GenerationDate),
    runSlot: Number(row.RunSlot),
    bufferChannelId: row.BufferChannelId,
    regenerationSequence: Number(row.RegenerationSequence || 0),
    generationStatus: row.GenerationStatus,
    providerId: row.AIProviderConfigurationId ? Number(row.AIProviderConfigurationId) : null,
    providerCode: row.ProviderCode || null,
    model: row.Model || null,
    campaignId: row.CampaignId ? `campaign:${row.CampaignId}` : null,
    campaignPostId: row.CampaignPostId ? Number(row.CampaignPostId) : null,
    regenerated: Boolean(row.RegeneratedFlag),
    fallbackUsed: Boolean(row.FallbackUsed),
    attemptCount: Number(row.AttemptCount || 0),
    inputContext: jsonValue(row.InputContextJson, null),
    normalizedOutput: jsonValue(row.NormalizedOutputJson, null),
    error: row.ErrorMessage || null,
    campaignName: row.CampaignName || null,
    campaignObjective: row.CampaignObjective || null,
    generatedCampaignName: row.GeneratedCampaignName || null,
    postStatus: row.PostStatus || null,
    scheduledAt: iso(row.ScheduledAt),
    publishedAt: iso(row.PublishedAt),
    bufferPostId: row.BufferPostId || null,
    postUrl: row.PostUrl || null,
    startedAt: iso(row.StartedAt),
    completedAt: iso(row.CompletedAt),
    updatedAt: iso(row.UpdatedAt),
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
  const media = resolvePersistedLandingPageMedia({
    mediaMode: row.MediaMode,
    mediaOrder: row.MediaOrder,
    videoSourceType: row.VideoSourceType,
    videoUrl: row.VideoUrl,
    videoProvider: row.VideoProvider,
    cloudinaryAssetId: row.CloudinaryAssetId,
    cloudinaryPublicId: row.CloudinaryPublicId,
    cloudinaryResourceType: row.CloudinaryResourceType,
    videoAutoplay: row.VideoAutoplay,
    videoMuted: row.VideoMuted,
    videoShowControls: row.VideoShowControls,
    pictureUrl: row.PictureUrl,
    pictureCloudinaryAssetId: row.PictureCloudinaryAssetId,
    pictureCloudinaryPublicId: row.PictureCloudinaryPublicId,
    pictureCloudinaryResourceType: row.PictureCloudinaryResourceType,
  });
  return {
    id: `page:${row.LandingPageId}`,
    campaignId: row.CampaignId ? `campaign:${row.CampaignId}` : null,
    title: row.Title,
    slug: row.Slug,
    headline: row.Headline,
    teaser: row.Teaser || "",
    webinarUrl: row.WebinarUrl || "",
    paymentUrl: row.PaymentUrl || "",
    ...media,
    videoUrl: media.videoUrl || "",
    pictureUrl: media.pictureUrl || "",
    preVideoCtaEnabled: row.PreVideoCtaEnabled == null
      ? Boolean(row.PreVideoCtaText && row.PreVideoCtaUrl)
      : Boolean(row.PreVideoCtaEnabled),
    preVideoCtaText: row.PreVideoCtaText || "",
    preVideoCtaUrl: row.PreVideoCtaUrl || "",
    submitButtonText: row.SubmitButtonText || "Register Now for an Interview",
    status: row.Status,
    registrations: Number(row.Registrations || 0),
    createdByAi: Boolean(row.CreatedByAi),
    createdAt: iso(row.CreatedAt),
    updatedAt: iso(row.UpdatedAt),
  };
}

function mapLandingPageBlock(row) {
  return {
    id: row.BlockKey || `block:${row.LandingPageBlockId}`,
    type: row.BlockType,
    sortOrder: Number(row.SortOrder || 0),
    enabled: row.IsEnabled == null ? true : Boolean(row.IsEnabled),
    config: jsonValue(row.ConfigurationJson, {}),
    createdAt: iso(row.CreatedAt),
    updatedAt: iso(row.UpdatedAt),
  };
}

function mapLandingPageAnalytics(row) {
  return {
    pageId: `page:${row.LandingPageId}`,
    visitors: Number(row.Visitors || 0),
    registrations: Number(row.Registrations || 0),
    conversionRate: Number(row.ConversionRate || 0),
    averageScore: Number(row.AverageScore || 0),
    cold: Number(row.Cold || 0),
    warm: Number(row.Warm || 0),
    qualified: Number(row.Qualified || 0),
    hot: Number(row.Hot || 0),
    sources: jsonValue(row.SourcesJson, []),
    campaigns: jsonValue(row.CampaignsJson, []),
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

function mapAuthUser(row, { includePasswordHash = false } = {}) {
  if (!row) return null;
  const user = {
    id: Number(row.UserId),
    username: row.Username,
    role: row.Role,
    isActive: Boolean(row.IsActive),
    createdAt: iso(row.CreatedAt),
    updatedAt: iso(row.UpdatedAt),
    lastLoginAt: iso(row.LastLoginAt),
  };
  if (includePasswordHash) user.passwordHash = row.PasswordHash;
  return user;
}

const REPORT_PROCEDURES = Object.freeze({
  "lead-scoring": "dbo.CRMReport_LeadScoring",
  "lead-temperature": "dbo.CRMReport_LeadTemperature",
  "lead-intents": "dbo.CRMReport_LeadIntents",
  "lead-sources": "dbo.CRMReport_LeadSources",
  "campaign-lead-performance": "dbo.CRMReport_CampaignLeadPerformance",
  "lead-engagement": "dbo.CRMReport_LeadEngagement",
  "hot-leads": "dbo.CRMReport_HotLeads",
});

const PAGED_REPORTS = new Set(["lead-scoring", "lead-engagement", "hot-leads"]);

function reportFieldName(value) {
  if (value.startsWith("DM")) return `dm${value.slice(2)}`;
  return value ? `${value[0].toLowerCase()}${value.slice(1)}` : value;
}

function mapReportRow(row) {
  return Object.fromEntries(Object.entries(row)
    .filter(([key]) => key !== "TotalCount")
    .map(([key, value]) => {
      const mapped = value instanceof Date
        ? value.toISOString()
        : typeof value === "bigint"
          ? Number(value)
          : value;
      return [reportFieldName(key), mapped];
    }));
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

  async getAuthUserByUsername(username) {
    const request = this.request();
    request.input("Username", this.sql.NVarChar(128), username);
    const response = await request.execute("dbo.AuthUser_GetByUsername");
    return mapAuthUser(response.recordset?.[0], { includePasswordHash: true });
  }

  async listAuthUsers() {
    const response = await this.request().execute("dbo.AuthUser_List");
    return (response.recordset || []).map((row) => mapAuthUser(row));
  }

  async createAuthUser({ username, passwordHash, role, isActive }) {
    const request = this.request();
    request.input("Username", this.sql.NVarChar(128), username);
    request.input("PasswordHash", this.sql.NVarChar(512), passwordHash);
    request.input("Role", this.sql.NVarChar(16), role);
    request.input("IsActive", this.sql.Bit, isActive ? 1 : 0);
    const response = await request.execute("dbo.AuthUser_Create");
    return mapAuthUser(response.recordset?.[0]);
  }

  async updateAuthUser(id, { username, role, isActive }) {
    const request = this.request();
    request.input("UserId", this.sql.BigInt, Number(id));
    request.input("Username", this.sql.NVarChar(128), username);
    request.input("Role", this.sql.NVarChar(16), role);
    request.input("IsActive", this.sql.Bit, isActive ? 1 : 0);
    const response = await request.execute("dbo.AuthUser_Update");
    return mapAuthUser(response.recordset?.[0]);
  }

  async setAuthUserPassword(id, passwordHash) {
    const request = this.request();
    request.input("UserId", this.sql.BigInt, Number(id));
    request.input("PasswordHash", this.sql.NVarChar(512), passwordHash);
    const response = await request.execute("dbo.AuthUser_SetPassword");
    return mapAuthUser(response.recordset?.[0]);
  }

  async recordAuthLogin(id) {
    const request = this.request();
    request.input("UserId", this.sql.BigInt, Number(id));
    const response = await request.execute("dbo.AuthUser_RecordLogin");
    return mapAuthUser(response.recordset?.[0]);
  }

  async createAuthSession({ userId: id, tokenHash, expiresAt }) {
    const request = this.request();
    request.input("UserId", this.sql.BigInt, Number(id));
    request.input("TokenHash", this.sql.VarBinary(32), tokenHash);
    request.input("ExpiresAt", this.sql.DateTime2, expiresAt);
    await request.execute("dbo.AuthSession_Create");
  }

  async getAuthSession(tokenHash) {
    const request = this.request();
    request.input("TokenHash", this.sql.VarBinary(32), tokenHash);
    const response = await request.execute("dbo.AuthSession_Get");
    return mapAuthUser(response.recordset?.[0]);
  }

  async revokeAuthSession(tokenHash) {
    const request = this.request();
    request.input("TokenHash", this.sql.VarBinary(32), tokenHash);
    await request.execute("dbo.AuthSession_Revoke");
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
    request.input("IntentConfidence", this.sql.Decimal(5, 4), intelligence.intentConfidence ?? event.intentConfidence ?? null);
    request.input("CampaignPostId", this.sql.BigInt, numericId(event.campaignPostId));
    request.input("SourceType", this.sql.NVarChar(16), intelligence.sourceType || "ORGANIC");
    request.input("RawRetentionDays", this.sql.Int, this.rawRetentionDays);
    request.input("RequestedLeadId", this.sql.BigInt, numericId(event.leadId));
    let response;
    try {
      response = await request.execute("dbo.SocialEvent_Process");
    } catch (error) {
      if (error?.number === 51122) error.statusCode = 404;
      if (error?.number === 51123) error.statusCode = 409;
      throw error;
    }
    const row = response.recordset?.[0] || {};
    return {
      duplicate: Boolean(row.Duplicate),
      leadCreated: Boolean(row.LeadCreated),
      leadUpdated: Boolean(row.LeadUpdated),
      leadId: row.LeadId ?? null,
      socialEventId: row.SocialEventId ?? null,
      interactionId: row.InteractionId ?? null,
      interactionInserted: Boolean(row.InteractionInserted),
      score: row.LeadScore === null || row.LeadScore === undefined ? null : Number(row.LeadScore),
      band: row.ScoreBand || row.LeadTemperature || null,
      qualified: Boolean(row.Qualified),
      scoreReason: row.ScoreReason || "",
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
    const blocksByPage = new Map();
    for (const row of recordsets[3] || []) {
      const key = Number(row.LandingPageId);
      const current = blocksByPage.get(key) || [];
      current.push(mapLandingPageBlock(row));
      blocksByPage.set(key, current);
    }
    return {
      campaigns: (recordsets[0] || []).map(mapCampaign),
      pages: (recordsets[1] || []).map((row) => ({
        ...mapLandingPage(row),
        blocks: blocksByPage.get(Number(row.LandingPageId)) || [],
      })),
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
    request.input("MediaId", this.sql.NVarChar(255), input.mediaId || null);
    request.input("CloudinaryAssetId", this.sql.NVarChar(255), input.cloudinaryAssetId || null);
    request.input("CloudinaryPublicId", this.sql.NVarChar(512), input.cloudinaryPublicId || null);
    request.input("CloudinaryResourceType", this.sql.NVarChar(16), input.cloudinaryResourceType || null);
    request.input("CloudinaryFormat", this.sql.NVarChar(32), input.cloudinaryFormat || null);
    request.input("MediaType", this.sql.NVarChar(16), input.mediaType || null);
    request.input("MediaUrl", this.sql.NVarChar(2048), input.mediaUrl || null);
    request.input("MediaOriginalName", this.sql.NVarChar(255), input.mediaOriginalName || null);
    request.input("MediaMimeType", this.sql.NVarChar(127), input.mediaMimeType || null);
    request.input("MediaSizeBytes", this.sql.BigInt, toSqlInteger(input.mediaSizeBytes));
    request.input("MediaWidth", this.sql.Int, toSqlInteger(input.mediaWidth));
    request.input("MediaHeight", this.sql.Int, toSqlInteger(input.mediaHeight));
    request.input("MediaDurationSeconds", this.sql.Decimal(12, 3), input.mediaDurationSeconds == null ? null : Number(input.mediaDurationSeconds));
    request.input("MediaFrameRate", this.sql.Decimal(8, 3), input.mediaFrameRate == null ? null : Number(input.mediaFrameRate));
    request.input("MediaVideoCodec", this.sql.NVarChar(64), input.mediaVideoCodec || null);
    request.input("MediaAudioCodec", this.sql.NVarChar(64), input.mediaAudioCodec || null);
    request.input("MediaAudioSampleRate", this.sql.Int, toSqlInteger(input.mediaAudioSampleRate));
    request.input("MediaVideoBitrate", this.sql.BigInt, toSqlInteger(input.mediaVideoBitrate));
    request.input("MediaAudioBitrate", this.sql.BigInt, toSqlInteger(input.mediaAudioBitrate));
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
    request.input("VideoSourceType", this.sql.NVarChar(20), input.videoSourceType || "NONE");
    request.input("VideoUrl", this.sql.NVarChar(2048), input.videoUrl);
    request.input("VideoProvider", this.sql.NVarChar(32), input.videoProvider);
    request.input("CloudinaryAssetId", this.sql.NVarChar(255), input.cloudinaryAssetId);
    request.input("CloudinaryPublicId", this.sql.NVarChar(500), input.cloudinaryPublicId);
    request.input("CloudinaryResourceType", this.sql.NVarChar(32), input.cloudinaryResourceType);
    request.input("VideoAutoplay", this.sql.Bit, input.videoAutoplay === false ? 0 : 1);
    request.input("VideoMuted", this.sql.Bit, input.videoMuted === false ? 0 : 1);
    request.input("VideoShowControls", this.sql.Bit, input.videoShowControls === false ? 0 : 1);
    request.input("MediaMode", this.sql.NVarChar(32), input.mediaMode || "NONE");
    request.input("MediaOrder", this.sql.NVarChar(32), input.mediaOrder || "VIDEO_FIRST");
    request.input("PictureUrl", this.sql.NVarChar(2048), input.pictureUrl);
    request.input("PictureCloudinaryAssetId", this.sql.NVarChar(255), input.pictureCloudinaryAssetId);
    request.input("PictureCloudinaryPublicId", this.sql.NVarChar(500), input.pictureCloudinaryPublicId);
    request.input("PictureCloudinaryResourceType", this.sql.NVarChar(32), input.pictureCloudinaryResourceType);
    request.input("PreVideoCtaEnabled", this.sql.Bit, input.preVideoCtaEnabled ? 1 : 0);
    request.input("PreVideoCtaText", this.sql.NVarChar(255), input.preVideoCtaText);
    request.input("PreVideoCtaUrl", this.sql.NVarChar(2048), input.preVideoCtaUrl);
    request.input("SubmitButtonText", this.sql.NVarChar(255), input.submitButtonText || "Register Now for an Interview");
    request.input("Status", this.sql.NVarChar(32), input.status || "draft");
    request.input("CreatedByAi", this.sql.Bit, input.createdByAi ? 1 : 0);
    request.input("BlocksJson", this.sql.NVarChar(this.sql.MAX), Array.isArray(input.blocks) ? JSON.stringify(input.blocks) : null);
    const response = await request.execute("dbo.LandingPage_Save");
    return response.recordset?.[0] ? { ...mapLandingPage(response.recordset[0]), blocks: input.blocks || [] } : null;
  }

  async duplicateLandingPage(id) {
    const request = this.request();
    request.input("LandingPageId", this.sql.BigInt, numericId(id));
    const response = await request.execute("dbo.LandingPage_Duplicate");
    if (!response.recordset?.[0]) return null;
    const record = mapLandingPage(response.recordset[0]);
    const content = await this.getContent();
    return content.pages.find((page) => page.id === record.id) || { ...record, blocks: [] };
  }

  async recordLandingPageView(input) {
    const request = this.request();
    request.input("LandingPageId", this.sql.BigInt, numericId(input.pageId));
    request.input("VisitorHash", this.sql.Binary(32), input.visitorHash);
    request.input("ViewedAt", this.sql.DateTime2, new Date(input.viewedAt));
    request.input("Source", this.sql.NVarChar(255), input.source || null);
    request.input("Medium", this.sql.NVarChar(255), input.medium || null);
    request.input("Campaign", this.sql.NVarChar(255), input.campaign || null);
    request.input("Content", this.sql.NVarChar(255), input.content || null);
    request.input("Term", this.sql.NVarChar(255), input.term || null);
    const response = await request.execute("dbo.LandingPageView_Record");
    return { inserted: Boolean(response.recordset?.[0]?.Inserted) };
  }

  async getLandingPageAnalytics() {
    const response = await this.request().execute("dbo.LandingPageAnalytics_GetAll");
    return (response.recordset || []).map(mapLandingPageAnalytics);
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
    const occurredAtInput = input.routine === "landing_page_registration" ? null : input.occurredAt;
    request.input("OccurredAt", this.sql.DateTime2, occurredAtInput ? new Date(occurredAtInput) : null);
    const response = await request.execute("dbo.CRMLead_UpsertFromRoutine");
    const row = response.recordset?.[0];
    const occurredAt = iso(row?.OccurredAt);
    return row ? {
      leadId: Number(row.LeadId),
      duplicate: Boolean(row.Duplicate),
      occurredAt,
      registeredAtUtc: input.routine === "landing_page_registration" ? occurredAt : null,
      registeredAtBogota: input.routine === "landing_page_registration" ? toBogotaIso(occurredAt) : null,
    } : null;
  }

  async getLeads(limit = 100) {
    const request = this.request();
    request.input("Limit", this.sql.Int, Math.max(1, Math.min(500, Number(limit) || 100)));
    const response = await request.execute("dbo.SocialLead_GetRecent");
    return (response.recordset || []).map(mapLead);
  }

  async getReport(reportName, filters = {}) {
    const procedure = REPORT_PROCEDURES[reportName];
    if (!procedure) {
      const error = new Error("Unknown CRM report.");
      error.statusCode = 404;
      throw error;
    }

    const page = Math.max(1, Number(filters.page) || 1);
    const pageSize = Math.max(1, Math.min(500, Number(filters.pageSize) || 25));
    const request = this.request();
    request.input("ScoreBand", this.sql.NVarChar(20), filters.scoreBand || null);
    request.input("MinScore", this.sql.Int, filters.minScore ?? null);
    request.input("MaxScore", this.sql.Int, filters.maxScore ?? null);
    request.input("Intent", this.sql.NVarChar(64), filters.intent || null);
    request.input("Platform", this.sql.NVarChar(32), filters.platform || null);
    request.input("Source", this.sql.NVarChar(100), filters.source || null);
    request.input("CampaignId", this.sql.BigInt, numericId(filters.campaignId));
    request.input("StartDate", this.sql.DateTime2, filters.startDate ? new Date(filters.startDate) : null);
    request.input("EndDate", this.sql.DateTime2, filters.endDate ? new Date(filters.endDate) : null);
    request.input("Search", this.sql.NVarChar(255), filters.search || null);
    request.input("Sort", this.sql.NVarChar(40), filters.sort || null);
    request.input("Page", this.sql.Int, page);
    request.input("PageSize", this.sql.Int, pageSize);

    const response = await request.execute(procedure);
    const sourceRows = response.recordset || [];
    const rows = sourceRows.map(mapReportRow);
    const total = PAGED_REPORTS.has(reportName)
      ? Number(sourceRows[0]?.TotalCount || 0)
      : rows.length;
    return {
      rows,
      pagination: {
        page: PAGED_REPORTS.has(reportName) ? page : 1,
        pageSize: PAGED_REPORTS.has(reportName) ? pageSize : Math.max(rows.length, 1),
        total,
        totalPages: PAGED_REPORTS.has(reportName) ? Math.max(1, Math.ceil(total / pageSize)) : 1,
      },
    };
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

  async createLeadReply(input) {
    const request = this.request();
    request.input("LeadId", this.sql.BigInt, numericId(input.leadId));
    request.input("InReplyToInteractionId", this.sql.BigInt, numericId(input.inReplyToInteractionId));
    request.input("MessageText", this.sql.NVarChar(this.sql.MAX), input.messageText);
    request.input("ResponseMode", this.sql.NVarChar(32), input.responseMode);
    request.input("SentByUserId", this.sql.BigInt, numericId(input.sentByUserId));
    request.input("IdempotencyKey", this.sql.NVarChar(255), input.idempotencyKey);
    request.input("MaxAttempts", this.sql.Int, Math.max(1, Math.min(10, Number(input.maxAttempts) || 4)));
    const response = await request.execute("dbo.LeadReply_Create");
    return response.recordset?.[0] ? mapLeadInteraction(response.recordset[0]) : null;
  }

  async claimLeadReplies({ now, limit, lockToken, replyId = null }) {
    const request = this.request();
    request.input("Now", this.sql.DateTime2, new Date(now));
    request.input("Limit", this.sql.Int, Math.max(1, Math.min(50, Number(limit) || 10)));
    request.input("LockToken", this.sql.UniqueIdentifier, lockToken);
    request.input("ReplyId", this.sql.BigInt, numericId(replyId));
    const response = await request.execute("dbo.LeadReply_Claim");
    return (response.recordset || []).map(mapLeadReplyClaim);
  }

  async completeLeadReply(replyId, result) {
    const request = this.request();
    request.input("ReplyId", this.sql.BigInt, numericId(replyId));
    request.input("LockToken", this.sql.UniqueIdentifier, result.lockToken);
    request.input("Succeeded", this.sql.Bit, result.succeeded ? 1 : 0);
    request.input("ExternalReplyId", this.sql.NVarChar(255), result.externalReplyId || null);
    request.input("ExternalStatus", this.sql.NVarChar(100), result.externalStatus || null);
    request.input("ProviderResponseJson", this.sql.NVarChar(this.sql.MAX), result.providerResponse
      ? JSON.stringify(result.providerResponse)
      : null);
    request.input("LastError", this.sql.NVarChar(1000), result.error || null);
    request.input("Retryable", this.sql.Bit, result.retryable ? 1 : 0);
    request.input("NextAttemptAt", this.sql.DateTime2, result.nextAttemptAt ? new Date(result.nextAttemptAt) : null);
    request.input("SentAt", this.sql.DateTime2, result.sentAt ? new Date(result.sentAt) : null);
    const response = await request.execute("dbo.LeadReply_Complete");
    return response.recordset?.[0] ? mapLeadInteraction(response.recordset[0]) : null;
  }

  async getUnifiedLead(leadId) {
    const request = this.request();
    request.input("LeadId", this.sql.BigInt, Number(leadId));
    const response = await request.execute("dbo.SocialLead_GetUnified");
    const sets = response.recordsets || [];
    const row = sets[0]?.[0];
    if (!row) return null;
    const interactions = (sets[2] || []).map(mapLeadInteraction).sort(compareTimelineNewestFirst);
    const activities = (sets[4] || []).map((item) => enrichTimelineRecord({
      id: `activity:${item.LeadActivityId}`,
      type: item.ActivityType,
      summary: item.Summary || "",
      sourceReference: item.SourceReference || null,
      campaignId: item.CampaignExternalId || null,
      occurredAt: iso(item.OccurredAt),
    })).sort(compareTimelineNewestFirst);
    return {
      timeZone: {
        authoritative: CRM_AUTHORITATIVE_TIME_ZONE,
        display: CRM_DISPLAY_TIME_ZONE,
      },
      lead: mapLead(row),
      socialAccounts: (sets[1] || []).map((item) => ({
        id: `account:${item.SocialAccountId}`,
        platform: item.Platform,
        platformUserId: item.PlatformUserId,
        username: item.Username || "",
        displayName: item.DisplayName || "",
        profileUrl: item.ProfileUrl || null,
        lastVerifiedAt: iso(item.LastVerifiedAt),
        ...timestampFields("lastVerifiedAt", item.LastVerifiedAt),
      })),
      interactions,
      conversations: (sets[3] || []).map((item) => ({
        id: `conversation:${item.SocialConversationId}`,
        platform: item.Platform,
        platformConversationId: item.PlatformConversationId,
        lastMessageAt: iso(item.LastMessageAt),
        ...timestampFields("lastMessageAt", item.LastMessageAt),
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
      timeline: dedupeTimelineProjection([...interactions, ...activities])
        .sort(compareTimelineNewestFirst),
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
    request.input("LastIntent", this.sql.NVarChar(64), input.lastIntent);
    request.input("CrmNotes", this.sql.NVarChar(this.sql.MAX), input.crmNotes);
    request.input("LastIntentProvided", this.sql.Bit, input.lastIntentProvided ? 1 : 0);
    request.input("CrmNotesProvided", this.sql.Bit, input.crmNotesProvided ? 1 : 0);
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

  async rescoreLead(leadId, asOf = new Date()) {
    const request = this.request();
    request.input("LeadId", this.sql.BigInt, Number(leadId));
    request.input("ScoredAt", this.sql.DateTime2, new Date(asOf));
    request.input("ReturnResult", this.sql.Bit, 1);
    const response = await request.execute("dbo.LeadScore_Recalculate");
    const row = response.recordset?.[0];
    if (!row) return null;
    return {
      leadId: Number(row.LeadId),
      score: Number(row.LeadScore || 0),
      band: row.ScoreBand || scoreBand(row.LeadScore),
      qualified: Boolean(row.Qualified),
      intentScore: Number(row.IntentScore || 0),
      engagementScore: Number(row.EngagementScore || 0),
      fitScore: Number(row.FitScore || 0),
      recencyScore: Number(row.RecencyScore || 0),
      sourceScore: Number(row.SourceScore || 0),
      reason: row.ScoreReason || "",
      lastScoredAt: iso(row.LastScoredAt),
    };
  }

  async updateLeadInteractionIntent(leadId, interactionId, classification) {
    const request = this.request();
    request.input("LeadId", this.sql.BigInt, Number(leadId));
    request.input("InteractionId", this.sql.BigInt, numericId(interactionId));
    request.input("Intent", this.sql.NVarChar(64), classification.intent);
    request.input("IntentConfidence", this.sql.Decimal(5, 4), classification.intentConfidence ?? null);
    request.input("PricingIntent", this.sql.Bit, classification.pricingIntent ?? null);
    request.input("PurchaseIntent", this.sql.Bit, classification.purchaseIntent ?? null);
    const response = await request.execute("dbo.LeadInteraction_UpdateIntent");
    const row = response.recordset?.[0];
    if (!row) return null;
    return {
      leadId: Number(row.LeadId),
      interactionId: Number(row.InteractionId),
      intent: row.Intent,
      intentConfidence: row.IntentConfidence === null || row.IntentConfidence === undefined
        ? null
        : Number(row.IntentConfidence),
      aiClassification: jsonValue(row.AIClassificationJson, {}),
      score: Number(row.LeadScore || 0),
      band: row.ScoreBand || scoreBand(row.LeadScore),
      qualified: Boolean(row.Qualified),
      intentScore: Number(row.IntentScore || 0),
      engagementScore: Number(row.EngagementScore || 0),
      fitScore: Number(row.FitScore || 0),
      recencyScore: Number(row.RecencyScore || 0),
      sourceScore: Number(row.SourceScore || 0),
      reason: row.ScoreReason || "",
      scoreReason: row.ScoreReason || "",
      lastScoredAt: iso(row.LastScoredAt),
    };
  }

  async deleteLead(leadId) {
    const request = this.request();
    request.input("LeadId", this.sql.BigInt, Number(leadId));
    const response = await request.execute("dbo.SocialLead_Delete");
    return Number(response.recordset?.[0]?.Deleted || 0) === 1;
  }

  async getCompanyProfile() {
    const response = await this.request().execute("dbo.CompanyProfile_Get");
    return mapCompanyProfile(response.recordset?.[0]);
  }

  async saveCompanyProfile(input) {
    const request = this.request();
    request.input("CompanyName", this.sql.NVarChar(255), input.companyName);
    request.input("CompanyDescription", this.sql.NVarChar(this.sql.MAX), input.companyDescription || null);
    request.input("ProductsServices", this.sql.NVarChar(this.sql.MAX), input.productsServices || null);
    request.input("TargetAudience", this.sql.NVarChar(this.sql.MAX), input.targetAudience || null);
    request.input("BrandVoice", this.sql.NVarChar(2000), input.brandVoice || null);
    request.input("Offers", this.sql.NVarChar(this.sql.MAX), input.offers || null);
    request.input("Website", this.sql.NVarChar(2048), input.website || null);
    request.input("PreferredCTA", this.sql.NVarChar(500), input.preferredCTA || null);
    request.input("Industry", this.sql.NVarChar(255), input.industry || null);
    request.input("BusinessGoals", this.sql.NVarChar(this.sql.MAX), input.businessGoals || null);
    request.input("OtherProfileContext", this.sql.NVarChar(this.sql.MAX), input.otherProfileContext || null);
    const response = await request.execute("dbo.CompanyProfile_Upsert");
    return mapCompanyProfile(response.recordset?.[0]);
  }

  async getAiProviderConfigurations({ providerId = null, enabledOnly = false, encryptionKey = null } = {}) {
    const request = this.request();
    request.input("AIProviderConfigurationId", this.sql.BigInt, numericId(providerId));
    request.input("EnabledOnly", this.sql.Bit, enabledOnly ? 1 : 0);
    const response = await request.execute("dbo.AIProviderConfiguration_Get");
    return (response.recordset || []).map((row) => mapAiProviderConfiguration(row, encryptionKey));
  }

  async saveAiProviderConfiguration(input, envelope = null) {
    const request = this.request();
    request.input("AIProviderConfigurationId", this.sql.BigInt, numericId(input.id));
    request.input("ProviderName", this.sql.NVarChar(255), input.providerName);
    request.input("Model", this.sql.NVarChar(255), input.model);
    request.input("Enabled", this.sql.Bit, input.enabled ? 1 : 0);
    request.input("IsDefault", this.sql.Bit, input.isDefault ? 1 : 0);
    request.input("CapabilitiesJson", this.sql.NVarChar(2000), JSON.stringify(input.capabilities || []));
    request.input("ReplaceSecret", this.sql.Bit, envelope ? 1 : 0);
    request.input("SecretCiphertext", this.sql.NVarChar(this.sql.MAX), envelope?.ciphertext || null);
    request.input("SecretIv", this.sql.NVarChar(255), envelope?.iv || null);
    request.input("SecretAuthTag", this.sql.NVarChar(255), envelope?.authTag || null);
    request.input("SecretFields", this.sql.NVarChar(1000), envelope ? "apiKey" : null);
    request.input("KeyVersion", this.sql.NVarChar(32), envelope?.keyVersion || null);
    const response = await request.execute("dbo.AIProviderConfiguration_Upsert");
    return response.recordset?.[0] ? mapAiProviderConfiguration(response.recordset[0]) : null;
  }

  async setAiProviderTestResult(providerId, { succeeded, error = null }) {
    const request = this.request();
    request.input("AIProviderConfigurationId", this.sql.BigInt, numericId(providerId));
    request.input("Succeeded", this.sql.Bit, succeeded ? 1 : 0);
    request.input("ErrorMessage", this.sql.NVarChar(1000), error || null);
    const response = await request.execute("dbo.AIProviderConfiguration_SetTestResult");
    return response.recordset?.[0] ? mapAiProviderConfiguration(response.recordset[0]) : null;
  }

  async saveAiCampaignConfiguration(input) {
    const request = this.request();
    request.input("AICampaignConfigurationId", this.sql.BigInt, numericId(input.id));
    request.input("CampaignName", this.sql.NVarChar(255), input.campaignName);
    request.input("CampaignObjective", this.sql.NVarChar(2000), input.campaignObjective);
    request.input("StartDate", this.sql.Date, input.startDate);
    request.input("EndDate", this.sql.Date, input.endDate);
    request.input("PostsPerDay", this.sql.Int, input.postsPerDay);
    request.input("ContentTypesJson", this.sql.NVarChar(2000), JSON.stringify(input.contentTypes));
    request.input("AIProviderConfigurationId", this.sql.BigInt, numericId(input.aiProviderId));
    request.input("AIModel", this.sql.NVarChar(255), input.aiModel || null);
    request.input("FallbackProviderConfigurationId", this.sql.BigInt, numericId(input.fallbackProviderId));
    request.input("SelectedBufferChannelIdsJson", this.sql.NVarChar(this.sql.MAX), JSON.stringify(input.selectedBufferChannelIds));
    request.input("CTA", this.sql.NVarChar(500), input.cta || null);
    request.input("DestinationUrl", this.sql.NVarChar(2048), input.destinationUrl || null);
    request.input("PublishingMode", this.sql.NVarChar(16), input.publishingMode);
    request.input("Status", this.sql.NVarChar(16), input.status || "DRAFT");
    const response = await request.execute("dbo.AICampaignConfiguration_Save");
    return response.recordset?.[0] ? mapAiCampaignConfiguration(response.recordset[0]) : null;
  }

  async getAiCampaignConfigurations(id = null) {
    const request = this.request();
    request.input("AICampaignConfigurationId", this.sql.BigInt, numericId(id));
    const response = await request.execute("dbo.AICampaignConfiguration_Get");
    return (response.recordset || []).map(mapAiCampaignConfiguration);
  }

  async setAiCampaignStatus(id, status, error = null) {
    const request = this.request();
    request.input("AICampaignConfigurationId", this.sql.BigInt, numericId(id));
    request.input("Status", this.sql.NVarChar(16), status);
    request.input("ErrorMessage", this.sql.NVarChar(1000), error || null);
    const response = await request.execute("dbo.AICampaignConfiguration_SetStatus");
    return response.recordset?.[0] ? mapAiCampaignConfiguration(response.recordset[0]) : null;
  }

  async getDueAiCampaignConfigurations(currentDate) {
    const request = this.request();
    request.input("CurrentDate", this.sql.Date, currentDate);
    const response = await request.execute("dbo.AICampaignConfiguration_GetDue");
    return (response.recordset || []).map(mapAiCampaignConfiguration);
  }

  async completeExpiredAiCampaigns(currentDate) {
    const request = this.request();
    request.input("CurrentDate", this.sql.Date, currentDate);
    const response = await request.execute("dbo.AICampaignConfiguration_CompleteExpired");
    return Number(response.recordset?.[0]?.CompletedCount || 0);
  }

  async claimAiGenerationRun(input) {
    const request = this.request();
    request.input("AICampaignConfigurationId", this.sql.BigInt, numericId(input.configurationId));
    request.input("GenerationDate", this.sql.Date, input.generationDate);
    request.input("RunSlot", this.sql.Int, input.runSlot);
    request.input("BufferChannelId", this.sql.NVarChar(255), input.bufferChannelId);
    request.input("RegeneratedFlag", this.sql.Bit, input.regenerated ? 1 : 0);
    request.input("RetryFailed", this.sql.Bit, input.retryFailed ? 1 : 0);
    request.input("InputContextJson", this.sql.NVarChar(this.sql.MAX), input.inputContext ? JSON.stringify(input.inputContext) : null);
    const response = await request.execute("dbo.AICampaignGenerationRun_Claim");
    return response.recordset?.[0] ? mapAiGenerationRun(response.recordset[0]) : null;
  }

  async succeedAiGenerationRun(runId, input) {
    const request = this.request();
    request.input("AICampaignGenerationRunId", this.sql.BigInt, numericId(runId));
    request.input("AIProviderConfigurationId", this.sql.BigInt, numericId(input.providerId));
    request.input("ProviderCode", this.sql.NVarChar(64), input.providerCode);
    request.input("Model", this.sql.NVarChar(255), input.model);
    request.input("CampaignId", this.sql.BigInt, numericId(input.campaignId));
    request.input("CampaignPostId", this.sql.BigInt, numericId(input.campaignPostId));
    request.input("FallbackUsed", this.sql.Bit, input.fallbackUsed ? 1 : 0);
    request.input("AttemptCount", this.sql.Int, input.attemptCount || 1);
    request.input("NormalizedOutputJson", this.sql.NVarChar(this.sql.MAX), JSON.stringify(input.normalizedOutput));
    const response = await request.execute("dbo.AICampaignGenerationRun_Succeed");
    return response.recordset?.[0] ? mapAiGenerationRun(response.recordset[0]) : null;
  }

  async failAiGenerationRun(runId, input) {
    const request = this.request();
    request.input("AICampaignGenerationRunId", this.sql.BigInt, numericId(runId));
    request.input("AIProviderConfigurationId", this.sql.BigInt, numericId(input.providerId));
    request.input("ProviderCode", this.sql.NVarChar(64), input.providerCode || null);
    request.input("Model", this.sql.NVarChar(255), input.model || null);
    request.input("FallbackUsed", this.sql.Bit, input.fallbackUsed ? 1 : 0);
    request.input("AttemptCount", this.sql.Int, input.attemptCount || 0);
    request.input("ErrorMessage", this.sql.NVarChar(1000), input.error);
    const response = await request.execute("dbo.AICampaignGenerationRun_Fail");
    return response.recordset?.[0] ? mapAiGenerationRun(response.recordset[0]) : null;
  }

  async getAiGenerationHistory({ configurationId = null, runId = null, campaignPostId = null, limit = 100 } = {}) {
    const request = this.request();
    request.input("AICampaignConfigurationId", this.sql.BigInt, numericId(configurationId));
    request.input("AICampaignGenerationRunId", this.sql.BigInt, numericId(runId));
    request.input("CampaignPostId", this.sql.BigInt, numericId(campaignPostId));
    request.input("Limit", this.sql.Int, Math.max(1, Math.min(500, Number(limit) || 100)));
    const response = await request.execute("dbo.AICampaignGenerationHistory_Get");
    return (response.recordset || []).map(mapAiGenerationRun);
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
