import {
  DEFAULT_SCORING_RULES,
  DEFAULT_TEMPERATURE_THRESHOLDS,
  evaluateSocialEvent,
  temperatureForScore,
} from "./intelligence.mjs";

const CHANNEL_NAMES = Object.freeze({
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
});

export const SOCIAL_CHANNELS = Object.freeze(Object.keys(CHANNEL_NAMES));

export const CONNECTION_STATES = Object.freeze([
  "connected",
  "disconnected",
  "missing_configuration",
  "invalid_credentials",
  "rate_limited",
  "degraded",
  "error",
]);

export class ProviderError extends Error {
  constructor(message, { state = "error", status = 0, retryable = false } = {}) {
    super(message);
    this.name = "ProviderError";
    this.state = state;
    this.status = status;
    this.retryable = retryable;
  }
}

export class MalformedPayloadError extends Error {
  constructor(message) {
    super(message);
    this.name = "MalformedPayloadError";
  }
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function eventTime(value) {
  const candidate = typeof value === "number" && value < 10_000_000_000
    ? value * 1000
    : value;
  const parsed = candidate ? new Date(candidate) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    throw new MalformedPayloadError("The provider event has an invalid timestamp.");
  }
  return parsed.toISOString();
}

function safeReason(value) {
  const message = value instanceof Error ? value.message : String(value || "Unknown error");
  return message
    .replace(/(access[_ -]?token|bearer|api[_ -]?key|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .slice(0, 300);
}

function log(logger, level, entry) {
  const method = typeof logger?.[level] === "function" ? logger[level] : logger?.log;
  method?.call(logger, JSON.stringify({
    component: "social_listener",
    at: new Date().toISOString(),
    ...entry,
  }));
}

export async function withRetry(operation, {
  attempts = 3,
  baseDelayMs = 150,
  maxDelayMs = 1500,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
} = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation(attempt + 1);
    } catch (error) {
      lastError = error;
      if (!(error instanceof ProviderError) || !error.retryable || attempt === attempts - 1) {
        throw error;
      }
      await sleep(Math.min(maxDelayMs, baseDelayMs * (2 ** attempt)));
    }
  }
  throw lastError;
}

function mapProviderFailure(status, payload) {
  const providerMessage =
    stringOrNull(payload?.error?.message) ||
    stringOrNull(payload?.detail) ||
    stringOrNull(payload?.title) ||
    `Provider request failed with HTTP ${status}.`;

  if (status === 401 || status === 403) {
    return new ProviderError("The provider rejected the configured credentials.", {
      state: "invalid_credentials",
      status,
    });
  }
  if (status === 429) {
    return new ProviderError("The provider rate limit was reached.", {
      state: "rate_limited",
      status,
      retryable: true,
    });
  }
  if (status >= 500) {
    return new ProviderError("The provider is temporarily unavailable.", {
      state: "degraded",
      status,
      retryable: true,
    });
  }
  return new ProviderError(providerMessage, { state: "error", status });
}

export class ISocialMediaProvider {
  normalizeEvent() {
    throw new Error("Provider event normalization is not implemented.");
  }

  fetchEvents() {
    return Promise.resolve([]);
  }

  fetchCampaignActivity(campaign) {
    return this.fetchEvents({ campaign });
  }
}

class SocialChannelAdapter extends ISocialMediaProvider {
  constructor(channel, config, options = {}) {
    super();
    this.channel = channel;
    this.config = config;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.sleep = options.sleep;
    this.logger = options.logger || console;
    this.timeoutMs = options.timeoutMs || 8_000;
  }

  requiredConfiguration() {
    return [];
  }

  validateConfiguration() {
    const missing = this.requiredConfiguration().filter((key) => !this.config[key]);
    return { configured: missing.length === 0, missing };
  }

  async requestJson(url, options = {}, operation = "provider_request") {
    const startedAt = Date.now();
    try {
      const payload = await withRetry(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const response = await this.fetchImpl(url, {
            ...options,
            signal: controller.signal,
          });
          let body;
          try {
            body = await response.json();
          } catch {
            throw new ProviderError("The provider returned malformed JSON.", {
              state: "degraded",
            });
          }
          if (!response.ok || body?.error) {
            throw mapProviderFailure(response.status || 500, body);
          }
          return body;
        } catch (error) {
          if (error instanceof ProviderError) throw error;
          if (error?.name === "AbortError") {
            throw new ProviderError("The provider request timed out.", {
              state: "degraded",
              retryable: true,
            });
          }
          throw new ProviderError("The provider could not be reached.", {
            state: "degraded",
            retryable: true,
          });
        } finally {
          clearTimeout(timeout);
        }
      }, { sleep: this.sleep });

      log(this.logger, "info", {
        channel: this.channel,
        operation,
        status: "success",
        latencyMs: Date.now() - startedAt,
      });
      return payload;
    } catch (error) {
      log(this.logger, "error", {
        channel: this.channel,
        operation,
        status: error?.state || "error",
        latencyMs: Date.now() - startedAt,
        error: safeReason(error),
      });
      throw error;
    }
  }

  async connect() {
    return this.validateCredentials();
  }

  async healthCheck() {
    return this.validateCredentials();
  }

  async validateCredentials() {
    const checkedAt = new Date().toISOString();
    const configuration = this.validateConfiguration();
    if (!configuration.configured) {
      return {
        channel: this.channel,
        name: CHANNEL_NAMES[this.channel],
        configured: false,
        credentialValidation: "skipped",
        status: "missing_configuration",
        checkedAt,
        reason: `Missing ${configuration.missing.join(", ")}.`,
      };
    }

    try {
      const identity = await this.fetchIdentity();
      if (!stringOrNull(identity?.id)) {
        throw new ProviderError("The provider identity response did not include an account ID.", {
          state: "degraded",
        });
      }
      return {
        channel: this.channel,
        name: CHANNEL_NAMES[this.channel],
        configured: true,
        credentialValidation: "pass",
        status: "connected",
        checkedAt,
        reason: "Provider identity validation succeeded.",
        identity: {
          id: String(identity.id),
          name: stringOrNull(identity.name),
          username: stringOrNull(identity.username),
        },
      };
    } catch (error) {
      return {
        channel: this.channel,
        name: CHANNEL_NAMES[this.channel],
        configured: true,
        credentialValidation: "fail",
        status: CONNECTION_STATES.includes(error?.state) ? error.state : "error",
        checkedAt,
        reason: safeReason(error),
      };
    }
  }

  async fetchOrReceiveEvents(options) {
    return this.fetchEvents(options);
  }

  extractLead(event, intelligence = evaluateSocialEvent(event)) {
    const hasIdentity = Boolean(event.externalUserId || event.username || event.email || event.phone);
    const qualified = hasIdentity && intelligence.shouldCreateLead;
    if (!qualified) return null;

    return {
      name: event.displayName || event.username || `${CHANNEL_NAMES[event.channel]} prospect`,
      email: event.email,
      phone: event.phone,
      socialUsername: event.username,
      sourceChannel: event.channel,
      campaignId: event.campaignId,
      adId: event.adId,
      postId: event.postId,
      externalEventId: event.externalEventId,
      externalUserId: event.externalUserId,
      intent: intelligence.intent,
      leadScore: intelligence.scoreDelta,
      leadTemperature: intelligence.temperature,
      qualification: intelligence.qualification,
      productServiceInterest: intelligence.qualification.productService,
      budget: intelligence.qualification.budget,
      purchaseTimeline: intelligence.qualification.purchaseTimeline,
      firstTouchAt: event.occurredAt,
      lastInteractionAt: event.occurredAt,
    };
  }
}

class MetaAdapter extends SocialChannelAdapter {
  constructor(channel, config, options) {
    super(channel, config, options);
    const version = config.graphApiVersion || "v23.0";
    this.baseUrl = `${config.graphApiBaseUrl || "https://graph.facebook.com"}/${version}`;
  }

  headers() {
    return { authorization: `Bearer ${this.config.accessToken}` };
  }

  async graph(path, params, operation) {
    const query = new URLSearchParams(params || {});
    const suffix = query.size ? `?${query}` : "";
    return this.requestJson(`${this.baseUrl}/${path}${suffix}`, {
      headers: this.headers(),
    }, operation);
  }

  async fetchLeadFormEvents(campaign, { since } = {}) {
    const params = {
      fields: "id,created_time,ad_id,campaign_id,form_id,field_data",
      limit: "50",
    };
    if (since) params.since = since;
    const result = await this.graph(`${campaign.leadFormId}/leads`, params, "fetch_paid_campaign_leads");
    return (Array.isArray(result.data) ? result.data : []).map((lead) => {
      const fields = Object.fromEntries((lead.field_data || []).map((field) => [
        String(field.name || "").toLowerCase(),
        Array.isArray(field.values) ? field.values[0] : field.value,
      ]));
      return {
        id: lead.id,
        event_type: "leadgen",
        created_time: lead.created_time,
        campaign_id: lead.campaign_id || campaign.externalCampaignId,
        ad_id: lead.ad_id || campaign.advertisementId,
        lead_form_id: lead.form_id || campaign.leadFormId,
        email: fields.email || null,
        phone: fields.phone_number || fields.phone || null,
        name: fields.full_name || fields.name || null,
        field_data: lead.field_data || [],
      };
    });
  }

  fetchCampaignActivity(campaign, options = {}) {
    return campaign.sourceType === "PAID" && campaign.leadFormId
      ? this.fetchLeadFormEvents(campaign, options)
      : this.fetchEvents(options);
  }
}

export class InstagramAdapter extends MetaAdapter {
  constructor(config, options) {
    super("instagram", config, options);
  }

  requiredConfiguration() {
    return ["accessToken", "accountId"];
  }

  fetchIdentity() {
    return this.graph(this.config.accountId, { fields: "id,username,name" }, "validate_credentials");
  }

  async fetchEvents({ since } = {}) {
    const params = {
      fields: "id,caption,timestamp,permalink,comments.limit(50){id,text,timestamp,username,from}",
      limit: "25",
    };
    if (since) params.since = since;
    const result = await this.graph(`${this.config.accountId}/media`, params, "fetch_events");
    return (Array.isArray(result.data) ? result.data : []).flatMap((media) =>
      (Array.isArray(media?.comments?.data) ? media.comments.data : []).map((comment) => ({
        ...comment,
        post_id: media.id,
        permalink: media.permalink,
      })),
    );
  }

  normalizeEvent(input) {
    const payload = objectOrEmpty(input);
    const from = objectOrEmpty(payload.from);
    const externalEventId = stringOrNull(payload.id || payload.comment_id);
    if (!externalEventId) throw new MalformedPayloadError("Instagram event ID is required.");
    return {
      channel: "instagram",
      externalEventId,
      eventType: stringOrNull(payload.event_type || payload.verb || payload.field) || "comment",
      externalUserId: stringOrNull(from.id || payload.user_id),
      username: stringOrNull(payload.username || from.username),
      displayName: stringOrNull(from.name || payload.name),
      email: stringOrNull(payload.email),
      phone: stringOrNull(payload.phone),
      message: stringOrNull(payload.text || payload.message || payload.caption),
      postId: stringOrNull(payload.post_id || payload.media?.id || payload.media_id),
      campaignId: stringOrNull(payload.campaign_id),
      adId: stringOrNull(payload.ad_id),
      leadFormId: stringOrNull(payload.lead_form_id || payload.form_id),
      campaignName: stringOrNull(payload.campaign_name),
      conversationId: stringOrNull(payload.conversation_id || payload.thread_id),
      direction: stringOrNull(payload.direction) || "INBOUND",
      sourceUrl: stringOrNull(payload.permalink || payload.source_url),
      occurredAt: eventTime(payload.timestamp || payload.created_time),
      rawPayload: payload,
    };
  }

  async getMetrics() {
    const result = await this.graph(`${this.config.accountId}/insights`, {
      metric: "reach,profile_views",
      period: "day",
    }, "get_metrics");
    return Array.isArray(result.data) ? result.data : [];
  }
}

export class FacebookAdapter extends MetaAdapter {
  constructor(config, options) {
    super("facebook", config, options);
  }

  requiredConfiguration() {
    return ["accessToken", "pageId"];
  }

  fetchIdentity() {
    return this.graph(this.config.pageId, { fields: "id,name" }, "validate_credentials");
  }

  async fetchEvents({ since } = {}) {
    const params = {
      fields: "id,message,created_time,permalink_url,comments.limit(50){id,message,created_time,from}",
      limit: "25",
    };
    if (since) params.since = since;
    const result = await this.graph(`${this.config.pageId}/feed`, params, "fetch_events");
    return (Array.isArray(result.data) ? result.data : []).flatMap((post) =>
      (Array.isArray(post?.comments?.data) ? post.comments.data : []).map((comment) => ({
        ...comment,
        post_id: post.id,
        permalink_url: post.permalink_url,
      })),
    );
  }

  normalizeEvent(input) {
    const payload = objectOrEmpty(input);
    const from = objectOrEmpty(payload.from);
    const lead = objectOrEmpty(payload.leadgen);
    const externalEventId = stringOrNull(payload.id || payload.comment_id || payload.leadgen_id);
    if (!externalEventId) throw new MalformedPayloadError("Facebook event ID is required.");
    return {
      channel: "facebook",
      externalEventId,
      eventType: stringOrNull(payload.event_type || payload.verb || payload.field) || (payload.leadgen_id ? "leadgen" : "comment"),
      externalUserId: stringOrNull(from.id || payload.user_id),
      username: stringOrNull(from.username || payload.username),
      displayName: stringOrNull(from.name || payload.name || lead.name),
      email: stringOrNull(payload.email || lead.email),
      phone: stringOrNull(payload.phone || lead.phone),
      message: stringOrNull(payload.message || payload.text),
      postId: stringOrNull(payload.post_id),
      campaignId: stringOrNull(payload.campaign_id),
      adId: stringOrNull(payload.ad_id),
      leadFormId: stringOrNull(payload.lead_form_id || payload.form_id || payload.leadgen_id),
      campaignName: stringOrNull(payload.campaign_name),
      conversationId: stringOrNull(payload.conversation_id || payload.thread_id),
      direction: stringOrNull(payload.direction) || "INBOUND",
      sourceUrl: stringOrNull(payload.permalink_url || payload.source_url),
      occurredAt: eventTime(payload.created_time || payload.timestamp),
      rawPayload: payload,
    };
  }

  async getMetrics() {
    const result = await this.graph(`${this.config.pageId}/insights`, {
      metric: "page_impressions,page_post_engagements",
      period: "day",
    }, "get_metrics");
    return Array.isArray(result.data) ? result.data : [];
  }
}

export class XAdapter extends SocialChannelAdapter {
  constructor(config, options) {
    super("x", config, options);
    this.baseUrl = config.apiBaseUrl || "https://api.x.com/2";
    this.identity = null;
  }

  requiredConfiguration() {
    return ["bearerToken"];
  }

  request(path, params, operation) {
    const query = new URLSearchParams(params || {});
    const suffix = query.size ? `?${query}` : "";
    return this.requestJson(`${this.baseUrl}/${path}${suffix}`, {
      headers: { authorization: `Bearer ${this.config.bearerToken}` },
    }, operation);
  }

  async fetchIdentity() {
    const result = await this.request("users/me", {
      "user.fields": "id,name,username,public_metrics",
    }, "validate_credentials");
    this.identity = result?.data || null;
    return this.identity;
  }

  async fetchEvents({ sinceId } = {}) {
    const identity = this.identity || await this.fetchIdentity();
    const params = {
      "tweet.fields": "author_id,conversation_id,created_at,entities,public_metrics",
      expansions: "author_id",
      "user.fields": "id,name,username",
      max_results: "25",
    };
    if (sinceId) params.since_id = sinceId;
    const result = await this.request(`users/${identity.id}/mentions`, params, "fetch_events");
    const users = new Map((result?.includes?.users || []).map((user) => [String(user.id), user]));
    return (Array.isArray(result?.data) ? result.data : []).map((tweet) => ({
      ...tweet,
      author: users.get(String(tweet.author_id)),
    }));
  }

  normalizeEvent(input) {
    const payload = objectOrEmpty(input);
    const author = objectOrEmpty(payload.author);
    const externalEventId = stringOrNull(payload.id);
    if (!externalEventId) throw new MalformedPayloadError("X event ID is required.");
    const username = stringOrNull(author.username || payload.username);
    return {
      channel: "x",
      externalEventId,
      eventType: stringOrNull(payload.event_type) || "mention",
      externalUserId: stringOrNull(payload.author_id || author.id),
      username,
      displayName: stringOrNull(author.name || payload.name),
      email: stringOrNull(payload.email),
      phone: stringOrNull(payload.phone),
      message: stringOrNull(payload.text),
      postId: stringOrNull(payload.conversation_id || payload.id),
      campaignId: stringOrNull(payload.campaign_id),
      adId: stringOrNull(payload.ad_id),
      leadFormId: stringOrNull(payload.lead_form_id),
      campaignName: stringOrNull(payload.campaign_name),
      conversationId: stringOrNull(payload.conversation_id),
      direction: stringOrNull(payload.direction) || "INBOUND",
      sourceUrl: username ? `https://x.com/${username}/status/${externalEventId}` : null,
      occurredAt: eventTime(payload.created_at || payload.timestamp),
      rawPayload: payload,
    };
  }

  async getMetrics() {
    const identity = this.identity || await this.fetchIdentity();
    return [{ id: identity.id, name: "account_public_metrics", values: identity.public_metrics || {} }];
  }
}

export class InstagramProvider extends InstagramAdapter {}
export class FacebookProvider extends FacebookAdapter {}
export class XProvider extends XAdapter {}

export function createAdaptersFromEnv(env = {}, options = {}) {
  return {
    instagram: new InstagramProvider({
      accessToken: env.INSTAGRAM_ACCESS_TOKEN || env.META_ACCESS_TOKEN,
      accountId: env.INSTAGRAM_ACCOUNT_ID,
      graphApiVersion: env.INSTAGRAM_GRAPH_API_VERSION || env.META_GRAPH_API_VERSION,
      graphApiBaseUrl: env.INSTAGRAM_GRAPH_API_BASE_URL || env.META_GRAPH_API_BASE_URL,
    }, options),
    facebook: new FacebookProvider({
      accessToken: env.FACEBOOK_ACCESS_TOKEN || env.META_ACCESS_TOKEN,
      pageId: env.FACEBOOK_PAGE_ID,
      graphApiVersion: env.FACEBOOK_GRAPH_API_VERSION || env.META_GRAPH_API_VERSION,
      graphApiBaseUrl: env.FACEBOOK_GRAPH_API_BASE_URL || env.META_GRAPH_API_BASE_URL,
    }, options),
    x: new XProvider({
      bearerToken: env.X_BEARER_TOKEN,
      apiBaseUrl: env.X_API_BASE_URL,
    }, options),
  };
}

function defaultStatus(channel, adapter) {
  const configuration = adapter.validateConfiguration();
  return {
    channel,
    name: CHANNEL_NAMES[channel],
    configured: configuration.configured,
    credentialValidation: "skipped",
    listenerTest: "skipped",
    metricsTest: "skipped",
    status: configuration.configured ? "disconnected" : "missing_configuration",
    reason: configuration.configured
      ? "Provider credentials have not been validated."
      : `Missing ${configuration.missing.join(", ")}.`,
    lastSuccessfulCheck: null,
    lastReceivedEvent: null,
    lastError: null,
    eventsProcessed: 0,
    leadsGenerated: 0,
    supportedMetrics: channel === "instagram"
      ? ["reach", "profile_views"]
      : channel === "facebook"
        ? ["page_impressions", "page_post_engagements"]
        : ["account_public_metrics"],
  };
}

export class InMemorySocialRepository {
  constructor() {
    this.events = new Map();
    this.leads = new Map();
    this.statuses = new Map();
    this.errors = [];
    this.metrics = new Map();
    this.channelConfigurations = new Map();
    this.campaigns = new Map();
    this.campaignPosts = new Map();
    this.pages = new Map();
    this.webinars = new Map();
    this.routineEvents = new Map();
    this.socialAccounts = new Map();
    this.conversations = new Map();
    this.interactions = new Map();
    this.leadActivities = [];
    this.integrationEvents = new Map();
    this.workflowRuns = new Map();
    this.auditLogs = [];
    this.scoringRules = { ...DEFAULT_SCORING_RULES };
    this.temperatureThresholds = { ...DEFAULT_TEMPERATURE_THRESHOLDS };
  }

  async healthCheck() { return true; }

  async upsertConnectionStatus(result) {
    const current = this.statuses.get(result.channel) || {};
    this.statuses.set(result.channel, {
      ...current,
      ...result,
      lastSuccessfulCheck: result.status === "connected"
        ? result.checkedAt
        : current.lastSuccessfulCheck || null,
      lastError: result.status !== "connected" && result.status !== "missing_configuration"
        ? result.reason
        : null,
    });
    const configuration = this.channelConfigurations.get(result.channel);
    if (configuration) {
      this.channelConfigurations.set(result.channel, {
        ...configuration,
        status: result.status,
        lastTestedAt: result.checkedAt,
        lastSuccessAt: result.status === "connected"
          ? result.checkedAt
          : configuration.lastSuccessAt || null,
        lastErrorAt: result.status === "connected" ? null : result.checkedAt,
        lastError: result.status === "connected" ? null : result.reason,
      });
    }
  }

  async recordError(entry) {
    this.errors.push({ ...entry, occurredAt: new Date().toISOString() });
  }

  async processEvent(event, lead, intelligence = evaluateSocialEvent(event, {
    scoringRules: this.scoringRules,
    temperatureThresholds: this.temperatureThresholds,
  })) {
    const eventKey = `${event.channel}:${event.externalEventId}`;
    if (this.events.has(eventKey)) {
      return { duplicate: true, leadCreated: false, leadUpdated: false };
    }
    this.events.set(eventKey, structuredClone(event));
    let leadCreated = false;
    let leadUpdated = false;
    let savedLead = null;
    if (lead) {
      const accountKey = event.externalUserId ? `${event.channel}:${event.externalUserId}` : null;
      const linkedLeadId = accountKey ? this.socialAccounts.get(accountKey)?.leadId : null;
      const linkedEntry = linkedLeadId
        ? [...this.leads.entries()].find(([, item]) => item.id === linkedLeadId)
        : null;
      const leadKey = linkedEntry?.[0] || lead.email?.toLowerCase() || lead.phone ||
        `${event.channel}:${event.externalUserId || event.username}`;
      const socialFields = {
        facebook: event.channel === "facebook" ? event.username || "" : "",
        instagram: event.channel === "instagram" ? event.username || "" : "",
        x: event.channel === "x" ? event.username || "" : "",
      };
      if (this.leads.has(leadKey)) {
        const currentLead = this.leads.get(leadKey);
        savedLead = {
          ...currentLead,
          ...structuredClone(lead),
          facebook: socialFields.facebook || currentLead.facebook || "",
          instagram: socialFields.instagram || currentLead.instagram || "",
          x: socialFields.x || currentLead.x || "",
          leadScore: Number(currentLead.leadScore || 0) + Number(intelligence.scoreDelta || 0),
          leadTemperature: temperatureForScore(
            Number(currentLead.leadScore || 0) + Number(intelligence.scoreDelta || 0),
            this.temperatureThresholds,
          ),
          lastIntent: intelligence.intent,
          lastContactAt: event.occurredAt,
          qualification: { ...currentLead.qualification, ...intelligence.qualification },
        };
        this.leads.set(leadKey, savedLead);
        leadUpdated = true;
      } else {
        savedLead = {
          ...structuredClone(lead),
          ...socialFields,
          id: `social:${this.leads.size + 1}`,
          status: "New",
          value: 0,
          createdAt: lead.firstTouchAt,
          leadScore: Number(intelligence.scoreDelta || 0),
          leadTemperature: temperatureForScore(intelligence.scoreDelta, this.temperatureThresholds),
          lastIntent: intelligence.intent,
          firstContactAt: event.occurredAt,
          lastContactAt: event.occurredAt,
          qualification: structuredClone(intelligence.qualification),
        };
        this.leads.set(leadKey, savedLead);
        leadCreated = true;
      }
      if (accountKey && savedLead) {
        const currentAccount = this.socialAccounts.get(accountKey);
        this.socialAccounts.set(accountKey, {
          id: currentAccount?.id || `account:${this.socialAccounts.size + 1}`,
          leadId: savedLead.id,
          platform: event.channel,
          platformUserId: event.externalUserId,
          username: event.username,
          profileUrl: event.sourceUrl,
          displayName: event.displayName,
          updatedAt: event.occurredAt,
        });
      }
    }
    const interaction = {
      id: `interaction:${this.interactions.size + 1}`,
      leadId: savedLead?.id || null,
      platform: event.channel,
      platformUserId: event.externalUserId,
      platformPostId: event.postId,
      platformConversationId: event.conversationId,
      interactionType: intelligence.interactionType,
      message: event.message,
      occurredAt: event.occurredAt,
      direction: event.direction || "INBOUND",
      intent: intelligence.intent,
      sentiment: intelligence.sentiment,
      productService: intelligence.qualification?.productService || null,
      campaignId: event.campaignId,
      campaignName: event.campaignName,
      advertisementId: event.adId,
      leadFormId: event.leadFormId,
      sourceType: intelligence.sourceType,
      responseStatus: "PENDING",
      sourceUrl: event.sourceUrl,
    };
    this.interactions.set(eventKey, interaction);
    if (event.conversationId) {
      const conversationKey = `${event.channel}:${event.conversationId}`;
      const currentConversation = this.conversations.get(conversationKey);
      this.conversations.set(conversationKey, {
        id: currentConversation?.id || `conversation:${this.conversations.size + 1}`,
        leadId: savedLead?.id || currentConversation?.leadId || null,
        platform: event.channel,
        platformConversationId: event.conversationId,
        lastMessageAt: event.occurredAt,
        direction: event.direction || "INBOUND",
        importantMessage: event.message,
        status: "OPEN",
        referenceUrl: event.sourceUrl,
      });
    }
    if (savedLead) {
      this.leadActivities.push({
        id: `activity:${this.leadActivities.length + 1}`,
        leadId: savedLead.id,
        type: intelligence.interactionType,
        summary: event.message || intelligence.intent,
        occurredAt: event.occurredAt,
        platform: event.channel,
        campaignId: event.campaignId,
      });
    }
    const current = this.statuses.get(event.channel) || {};
    this.statuses.set(event.channel, {
      ...current,
      lastReceivedEvent: event.occurredAt,
      eventsProcessed: Number(current.eventsProcessed || 0) + 1,
      leadsGenerated: Number(current.leadsGenerated || 0) + (leadCreated ? 1 : 0),
    });
    return { duplicate: false, leadCreated, leadUpdated };
  }

  async saveMetrics(channel, values) {
    this.metrics.set(channel, structuredClone(values));
  }

  async getLeads(limit = 100) {
    return [...this.leads.values()].slice(0, limit).map((lead) => ({
      id: lead.id,
      name: lead.name,
      email: lead.email || "",
      phone: lead.phone || "",
      social: lead.socialUsername || "",
      facebook: lead.facebook || "",
      instagram: lead.instagram || "",
      x: lead.x || "",
      source: lead.source || (lead.sourceChannel === "x"
        ? "X"
        : lead.sourceChannel
          ? `${lead.sourceChannel[0].toUpperCase()}${lead.sourceChannel.slice(1)}`
          : "Manual"),
      status: lead.status || "New",
      value: Number(lead.value || 0),
      createdAt: lead.createdAt,
      leadScore: Number(lead.leadScore || 0),
      leadTemperature: lead.leadTemperature || "COLD",
      intent: lead.lastIntent || "OTHER",
      crmNotes: lead.crmNotes || "",
      qualification: lead.qualification || {},
      lastContactAt: lead.lastContactAt || lead.createdAt,
    }));
  }

  async getScoringConfiguration() {
    return {
      rules: { ...this.scoringRules },
      thresholds: { ...this.temperatureThresholds },
    };
  }

  async saveScoringConfiguration({ rules = {}, thresholds = {} }) {
    for (const [key, value] of Object.entries(rules)) {
      if (key in this.scoringRules && Number.isFinite(Number(value)) && Number(value) >= 0) {
        this.scoringRules[key] = Number(value);
      }
    }
    const ordered = ["COLD", "WARM", "HOT", "VERY_HOT"];
    const nextThresholds = { ...this.temperatureThresholds, ...thresholds };
    if (ordered.every((key, index) => index === 0 || Number(nextThresholds[key]) >= Number(nextThresholds[ordered[index - 1]]))) {
      this.temperatureThresholds = Object.fromEntries(ordered.map((key) => [key, Number(nextThresholds[key])]));
    }
    return this.getScoringConfiguration();
  }

  async getUnifiedLead(leadId) {
    const id = `social:${Number(leadId)}`;
    const lead = (await this.getLeads(500)).find((item) => item.id === id);
    if (!lead) return null;
    const accounts = [...this.socialAccounts.values()].filter((item) => item.leadId === id);
    const interactions = [...this.interactions.values()].filter((item) => item.leadId === id)
      .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
    const conversations = [...this.conversations.values()].filter((item) => item.leadId === id);
    const activities = this.leadActivities.filter((item) => item.leadId === id);
    const timeline = [...interactions, ...activities].sort((a, b) =>
      String(b.occurredAt).localeCompare(String(a.occurredAt)));
    return {
      lead,
      socialAccounts: accounts,
      interactions,
      conversations,
      leadActivities: activities,
      opportunities: [],
      quotes: [],
      appointments: [],
      conversionHistory: [],
      timeline,
    };
  }

  async createLead(input) {
    const leadKey = input.email?.toLowerCase() || `manual:${this.leads.size + 1}`;
    const current = this.leads.get(leadKey);
    const changes = structuredClone(input);
    if (!input.lastIntentProvided) delete changes.lastIntent;
    if (!input.crmNotesProvided) delete changes.crmNotes;
    delete changes.lastIntentProvided;
    delete changes.crmNotesProvided;
    const saved = {
      ...current,
      ...changes,
      id: current?.id || `social:${this.leads.size + 1}`,
      socialUsername: input.instagram || input.facebook || input.x || "",
      status: current?.status || "New",
      createdAt: current?.createdAt || new Date().toISOString(),
    };
    this.leads.set(leadKey, saved);
    return (await this.getLeads()).find((lead) => lead.id === saved.id);
  }

  async updateLead(leadId, input) {
    const entry = [...this.leads.entries()].find(([, lead]) => lead.id === `social:${leadId}`);
    if (!entry) return null;
    const [key, current] = entry;
    const changes = structuredClone(input);
    if (!input.lastIntentProvided) delete changes.lastIntent;
    if (!input.crmNotesProvided) delete changes.crmNotes;
    delete changes.lastIntentProvided;
    delete changes.crmNotesProvided;
    const saved = {
      ...current,
      ...changes,
      socialUsername: input.instagram || input.facebook || input.x || "",
    };
    const nextKey = saved.email?.toLowerCase() || key;
    if (nextKey !== key) this.leads.delete(key);
    this.leads.set(nextKey, saved);
    return (await this.getLeads()).find((lead) => lead.id === saved.id);
  }

  async updateLeadStatus(leadId, status) {
    const entry = [...this.leads.entries()].find(([, lead]) => lead.id === `social:${leadId}`);
    if (!entry) return null;
    const [key, lead] = entry;
    const updated = { ...lead, status };
    this.leads.set(key, updated);
    return { id: updated.id, status: updated.status };
  }

  async deleteLead(leadId) {
    const entry=[...this.leads.entries()].find(([,lead])=>lead.id===`social:${leadId}`);
    if(!entry)return false;this.leads.delete(entry[0]);return true;
  }

  async getStatuses(adapters) {
    return SOCIAL_CHANNELS.map((channel) => ({
      ...defaultStatus(channel, adapters[channel]),
      ...(this.statuses.get(channel) || {}),
    }));
  }

  async getChannelConfigurations() {
    return [...this.channelConfigurations.values()].map((item) => structuredClone(item));
  }

  async upsertChannelConfiguration(configuration) {
    const current = this.channelConfigurations.get(configuration.channel) || {};
    this.channelConfigurations.set(configuration.channel, {
      ...current,
      ...structuredClone(configuration),
      secrets: Object.keys(configuration.secrets || {}).length
        ? structuredClone(configuration.secrets)
        : current.secrets || {},
      secretFields: Object.keys(configuration.secrets || {}).length
        ? Object.keys(configuration.secrets)
        : current.secretFields || [],
      status: "disconnected",
      updatedAt: new Date().toISOString(),
    });
  }

  async deleteChannelConfiguration(channel) {
    this.channelConfigurations.delete(channel);
    this.statuses.delete(channel);
  }

  async markWebhookReceived(channel, receivedAt = new Date()) {
    const current = this.channelConfigurations.get(channel);
    if (!current) return;
    this.channelConfigurations.set(channel, {
      ...current,
      lastWebhookReceivedAt: (receivedAt instanceof Date ? receivedAt : new Date(receivedAt)).toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  async getContent() {
    return {
      campaigns: [...this.campaigns.values()].map((item) => ({
        ...structuredClone(item),
        campaignPosts: [...this.campaignPosts.values()]
          .filter((post) => post.campaignId === item.id)
          .map((post) => structuredClone(post)),
      })),
      pages: [...this.pages.values()].map((item) => structuredClone(item)),
      webinars: [...this.webinars.values()].map((item) => structuredClone(item)),
    };
  }

  async saveCampaign(input) {
    const id = input.id || `campaign:${this.campaigns.size + 1}`;
    if (input.id && !this.campaigns.has(id)) return null;
    const current = this.campaigns.get(id);
    if (input.status === "production" && current?.status !== "production") {
      const error = new Error("Use the campaign readiness gate to enter production mode.");
      error.statusCode = 409;
      throw error;
    }
    const item = {
      ...structuredClone(input),
      id,
      status: input.status || "draft",
      createdByAi: Boolean(input.createdByAi),
      impressions: 0,
      clicks: 0,
      createdAt: this.campaigns.get(id)?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceType: current?.sourceType || input.sourceType || "ORGANIC",
      automationStatus: current?.automationStatus || "DRAFT",
      automationEnabled: current?.automationEnabled || false,
      cadenceMinutes: current?.cadenceMinutes || 60,
      retryCount: current?.retryCount || 0,
      maxRetries: current?.maxRetries ?? 3,
      lastRunAt: current?.lastRunAt || null,
      nextRunAt: current?.nextRunAt || null,
      lastError: current?.lastError || null,
      currentMetrics: current?.currentMetrics || null,
    };
    this.campaigns.set(id, item);
    return structuredClone(item);
  }

  async createCampaignPost(input) {
    return this.upsertCampaignPost(input);
  }

  async upsertCampaignPost(input) {
    const existing = [...this.campaignPosts.values()].find((post) =>
      post.campaignId === input.campaignId && post.bufferChannelId === input.bufferChannelId);
    if (existing) {
      const updated = {
        ...existing,
        platform: input.platform,
        scheduledAt: input.scheduledAt || existing.scheduledAt,
        isActive: true,
        updatedAt: new Date().toISOString(),
      };
      this.campaignPosts.set(existing.id, updated);
      return structuredClone(updated);
    }
    const id = this.campaignPosts.size + 1;
    const now = new Date().toISOString();
    const item = {
      id,
      campaignId: input.campaignId,
      platform: input.platform,
      bufferChannelId: input.bufferChannelId,
      bufferPostId: null,
      scheduledAt: input.scheduledAt || null,
      publishedAt: null,
      postStatus: "DRAFT",
      externalPostId: null,
      postUrl: null,
      lastCheckedAt: null,
      errorSource: null,
      errorMessage: null,
      lastAttemptAt: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    this.campaignPosts.set(id, item);
    return structuredClone(item);
  }

  async deactivateMissingCampaignPosts(campaignId, selectedChannelIds) {
    const selected = new Set(selectedChannelIds || []);
    for (const [id, post] of this.campaignPosts.entries()) {
      if (post.campaignId === campaignId && !post.bufferPostId && !selected.has(post.bufferChannelId)) {
        this.campaignPosts.set(id, { ...post, isActive: false, updatedAt: new Date().toISOString() });
      }
    }
    return this.getCampaignPosts({ campaignId });
  }

  async applyCampaignPostStatus(campaignPostId, input) {
    const id = Number(campaignPostId);
    const current = this.campaignPosts.get(id);
    if (!current) return null;
    const now = new Date().toISOString();
    const updated = {
      ...current,
      bufferPostId: input.bufferPostId || current.bufferPostId,
      scheduledAt: input.scheduledAt || current.scheduledAt,
      publishedAt: input.publishedAt || current.publishedAt,
      postStatus: input.postStatus,
      externalPostId: input.externalPostId || current.externalPostId,
      postUrl: input.postUrl || current.postUrl,
      lastCheckedAt: now,
      lastAttemptAt: now,
      errorSource: input.postStatus === "FAILED" ? "BUFFER" : null,
      errorMessage: input.postStatus === "FAILED" ? input.errorMessage || "Buffer reported a publishing failure." : null,
      updatedAt: now,
    };
    this.campaignPosts.set(id, updated);
    return structuredClone(updated);
  }

  async failCampaignPost(campaignPostId, message) {
    const id = Number(campaignPostId);
    const current = this.campaignPosts.get(id);
    if (!current) return null;
    const now = new Date().toISOString();
    const updated = {
      ...current,
      postStatus: "FAILED",
      errorSource: "BUFFER",
      errorMessage: message,
      lastCheckedAt: now,
      lastAttemptAt: now,
      updatedAt: now,
    };
    this.campaignPosts.set(id, updated);
    return structuredClone(updated);
  }

  async recordCampaignPostAttemptError(campaignPostId, message) {
    const id = Number(campaignPostId);
    const current = this.campaignPosts.get(id);
    if (!current) return null;
    const now = new Date().toISOString();
    const updated = {
      ...current,
      errorSource: "BUFFER",
      errorMessage: message,
      lastCheckedAt: now,
      lastAttemptAt: now,
      updatedAt: now,
    };
    this.campaignPosts.set(id, updated);
    return structuredClone(updated);
  }

  async getCampaignPosts({ campaignId = null, syncableOnly = false, activeOnly = false } = {}) {
    return [...this.campaignPosts.values()]
      .filter((post) => !campaignId || post.campaignId === campaignId)
      .filter((post) => !activeOnly || post.isActive !== false)
      .filter((post) => !syncableOnly || (post.isActive !== false && post.bufferPostId && post.postStatus !== "PUBLISHED"))
      .map((post) => structuredClone(post));
  }

  async setBufferCampaignMode(id, mode) {
    const campaign = this.campaigns.get(id);
    if (!campaign) return null;
    const posts = [...this.campaignPosts.values()].filter((post) => post.campaignId === id && post.isActive !== false);
    if (mode === "production" && (!posts.length || posts.some((post) =>
      !new Set(["SCHEDULED", "QUEUED", "PUBLISHED"]).has(post.postStatus)))) {
      const error = new Error("Every Buffer campaign post must be scheduled before production mode.");
      error.statusCode = 409;
      throw error;
    }
    const updated = { ...campaign, status: mode, updatedAt: new Date().toISOString() };
    this.campaigns.set(id, updated);
    return structuredClone(updated);
  }

  async saveLandingPage(input) {
    const id = input.id || `page:${this.pages.size + 1}`;
    if (input.id && !this.pages.has(id)) return null;
    const item = {
      ...structuredClone(input),
      id,
      status: input.status || "draft",
      registrations: this.pages.get(id)?.registrations || 0,
      createdByAi: Boolean(input.createdByAi),
      createdAt: this.pages.get(id)?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.pages.set(id, item);
    return structuredClone(item);
  }

  async saveWebinar(input) {
    const id = input.id || `webinar:${this.webinars.size + 1}`;
    if (input.id && !this.webinars.has(id)) return null;
    const item = {
      ...structuredClone(input),
      id,
      status: input.status || "draft",
      createdByAi: Boolean(input.createdByAi),
      createdAt: this.webinars.get(id)?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.webinars.set(id, item);
    return structuredClone(item);
  }

  async deleteContent(entity,id){const stores={campaign:this.campaigns,landing_page:this.pages,webinar:this.webinars};const store=stores[entity];return store?store.delete(id):false}

  async setCampaignMode(id, mode) {
    const campaign = this.campaigns.get(id);
    if (!campaign) return null;
    if (mode === "production") {
      const selected = String(campaign.platform || "").toLowerCase();
      const connected = [...this.channelConfigurations.values()].some((config) =>
        config.enabled && config.status === "connected" &&
        (selected.includes("multi") || selected.includes(config.channel) ||
          (selected.includes("twitter") && config.channel === "x")));
      const hasContent = [...this.pages.values(), ...this.webinars.values()]
        .some((item) => item.campaignId === id);
      if (!connected || !campaign.audience || !campaign.message || !hasContent) {
        const error = new Error(!connected
          ? "No selected channel has a successful persisted provider identity test."
          : !hasContent
            ? "Attach a landing page or webinar before entering production mode."
            : "Campaign audience and message must pass content validation.");
        error.statusCode = 409;
        throw error;
      }
    }
    const updated = { ...campaign, status: mode, updatedAt: new Date().toISOString() };
    this.campaigns.set(id, updated);
    return structuredClone(updated);
  }

  async saveCampaignAutomation(input) {
    const id = input.id || input.campaignId;
    const campaign = this.campaigns.get(id);
    if (!campaign) return null;
    const updated = {
      ...campaign,
      sourceType: input.sourceType === "PAID" ? "PAID" : "ORGANIC",
      externalCampaignId: input.externalCampaignId || null,
      advertisementId: input.advertisementId || null,
      leadFormId: input.leadFormId || null,
      contentReference: input.contentReference || null,
      schedule: input.schedule || "continuous",
      cadenceMinutes: Math.max(1, Math.min(10_080, Number(input.cadenceMinutes) || 60)),
      automationEnabled: Boolean(input.automationEnabled),
      maxRetries: Math.max(0, Math.min(10, Number(input.maxRetries ?? campaign.maxRetries ?? 3))),
      nextRunAt: input.nextRunAt || campaign.nextRunAt || null,
      updatedAt: new Date().toISOString(),
    };
    this.campaigns.set(id, updated);
    return structuredClone(updated);
  }

  async getCampaignAutomation() {
    return [...this.campaigns.values()].map((campaign) => structuredClone(campaign));
  }

  async setCampaignAutomationStatus(id, action, now = new Date().toISOString()) {
    const campaign = this.campaigns.get(id);
    if (!campaign) return null;
    const states = { start: "RUNNING", resume: "RUNNING", pause: "PAUSED", stop: "STOPPED" };
    const automationStatus = states[action];
    if (!automationStatus) throw Object.assign(new Error("Unsupported campaign automation action."), { statusCode: 400 });
    const running = automationStatus === "RUNNING";
    const updated = {
      ...campaign,
      automationStatus,
      automationEnabled: running,
      nextRunAt: running ? now : null,
      lockToken: null,
      lockedAt: null,
      lastError: action === "resume" || action === "start" ? null : campaign.lastError,
      updatedAt: now,
    };
    this.campaigns.set(id, updated);
    return structuredClone(updated);
  }

  async claimDueCampaigns({ now, limit, lockToken }) {
    const claimed = [];
    for (const [id, campaign] of this.campaigns) {
      if (claimed.length >= limit) break;
      if (!campaign.automationEnabled || campaign.automationStatus !== "RUNNING" || campaign.lockToken) continue;
      if (campaign.nextRunAt && new Date(campaign.nextRunAt).getTime() > new Date(now).getTime()) continue;
      const locked = { ...campaign, lockToken, lockedAt: now };
      this.campaigns.set(id, locked);
      claimed.push(structuredClone(locked));
    }
    return claimed;
  }

  async completeCampaignRun(id, result) {
    const campaign = this.campaigns.get(id);
    if (!campaign || campaign.lockToken !== result.lockToken) return null;
    const succeeded = Boolean(result.succeeded);
    const updated = {
      ...campaign,
      automationStatus: succeeded || result.retryable ? "RUNNING" : "ERROR",
      automationEnabled: succeeded || Boolean(result.retryable),
      lastRunAt: result.lastRunAt,
      nextRunAt: result.nextRunAt,
      lastError: succeeded ? null : result.error,
      retryCount: succeeded ? 0 : Number(result.retryCount || 0),
      currentMetrics: result.metrics || campaign.currentMetrics || null,
      lastProcessed: Number(result.processed || 0),
      lockToken: null,
      lockedAt: null,
      updatedAt: result.lastRunAt,
    };
    this.campaigns.set(id, updated);
    return structuredClone(updated);
  }

  async createIntegrationAction(input) {
    const key = `${input.provider}:${input.direction}:${input.idempotencyKey}`;
    const existing = this.integrationEvents.get(key);
    if (existing) return { ...structuredClone(existing), duplicate: true };
    const now = new Date().toISOString();
    const action = {
      id: this.integrationEvents.size + 1,
      provider: input.provider,
      channel: input.channel || null,
      direction: input.direction,
      eventType: input.eventType,
      idempotencyKey: input.idempotencyKey,
      externalId: null,
      externalStatus: null,
      status: "PENDING",
      attemptCount: 0,
      maxAttempts: input.maxAttempts || 4,
      nextAttemptAt: null,
      lastAttemptAt: null,
      processedAt: null,
      lockToken: null,
      lockedAt: null,
      campaignId: input.campaignId || null,
      leadId: input.leadId || null,
      request: structuredClone(input.request || {}),
      response: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      duplicate: false,
    };
    this.integrationEvents.set(key, action);
    return structuredClone(action);
  }

  async recordInboundIntegrationEvent(input) {
    const key = `${input.provider}:INBOUND:${input.idempotencyKey}`;
    const existing = this.integrationEvents.get(key);
    if (existing) {
      if (input.succeeded && existing.status === "FAILED") {
        const recovered = {
          ...existing,
          status: "SUCCEEDED",
          externalStatus: "RECEIVED",
          lastError: null,
          processedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.integrationEvents.set(key, recovered);
        return { ...structuredClone(recovered), duplicate: true };
      }
      return { ...structuredClone(existing), duplicate: true };
    }
    const now = new Date().toISOString();
    const event = {
      id: this.integrationEvents.size + 1,
      provider: input.provider,
      channel: input.channel || null,
      direction: "INBOUND",
      eventType: input.eventType,
      idempotencyKey: input.idempotencyKey,
      externalId: input.externalId || null,
      externalStatus: input.succeeded === false ? "PROCESSING_FAILED" : "RECEIVED",
      status: input.succeeded === false ? "FAILED" : "SUCCEEDED",
      attemptCount: 1,
      maxAttempts: 1,
      nextAttemptAt: null,
      lastAttemptAt: now,
      processedAt: now,
      lockToken: null,
      lockedAt: null,
      campaignId: null,
      leadId: null,
      request: structuredClone(input.request || {}),
      response: null,
      lastError: input.error || null,
      createdAt: now,
      updatedAt: now,
      duplicate: false,
    };
    this.integrationEvents.set(key, event);
    return structuredClone(event);
  }

  async claimDueIntegrationActions({ now, limit, lockToken, actionId = null }) {
    const dueAt = new Date(now).getTime();
    const actions = [...this.integrationEvents.values()]
      .filter((item) => item.direction === "OUTBOUND" && ["PENDING", "RETRY_SCHEDULED"].includes(item.status))
      .filter((item) => actionId === null || Number(item.id) === Number(actionId))
      .filter((item) => !item.nextAttemptAt || new Date(item.nextAttemptAt).getTime() <= dueAt)
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
      .slice(0, Math.max(1, Math.min(100, Number(limit) || 10)));
    return actions.map((item) => {
      const claimed = {
        ...item,
        status: "PROCESSING",
        attemptCount: Number(item.attemptCount || 0) + 1,
        lastAttemptAt: now,
        lockToken,
        lockedAt: now,
        updatedAt: now,
      };
      this.integrationEvents.set(`${item.provider}:${item.direction}:${item.idempotencyKey}`, claimed);
      return structuredClone(claimed);
    });
  }

  async completeIntegrationAction(id, result) {
    const entry = [...this.integrationEvents.entries()].find(([, item]) => Number(item.id) === Number(id));
    if (!entry) return null;
    const [key, item] = entry;
    if (item.status !== "PROCESSING" || item.lockToken !== result.lockToken) return structuredClone(item);
    const retryScheduled = !result.succeeded && result.retryable && result.nextAttemptAt && item.attemptCount < item.maxAttempts;
    const completed = {
      ...item,
      status: result.succeeded ? "SUCCEEDED" : retryScheduled ? "RETRY_SCHEDULED" : "FAILED",
      externalId: result.externalId || item.externalId || null,
      externalStatus: result.externalStatus || item.externalStatus || null,
      response: result.response ? structuredClone(result.response) : item.response,
      lastError: result.succeeded ? null : result.error || "Integration action failed.",
      nextAttemptAt: retryScheduled ? result.nextAttemptAt : null,
      processedAt: result.succeeded || !retryScheduled ? result.processedAt : item.processedAt,
      lockToken: null,
      lockedAt: null,
      updatedAt: result.processedAt,
    };
    this.integrationEvents.set(key, completed);
    return structuredClone(completed);
  }

  async getIntegrationActions({ limit = 100, campaignId = null } = {}) {
    return [...this.integrationEvents.values()]
      .filter((item) => !campaignId || String(item.campaignId) === String(campaignId))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, Math.max(1, Math.min(500, Number(limit) || 100)))
      .map((item) => structuredClone(item));
  }

  async startWorkflowRun(input) {
    const now = new Date().toISOString();
    const run = {
      id: this.workflowRuns.size + 1,
      workflowType: input.workflowType,
      triggerType: input.triggerType,
      triggerRecordId: input.triggerRecordId || null,
      integrationEventId: input.integrationEventId || null,
      state: "RUNNING",
      currentStep: "STARTED",
      context: structuredClone(input.context || {}),
      lastError: null,
      startedAt: now,
      completedAt: null,
      updatedAt: now,
    };
    this.workflowRuns.set(run.id, run);
    return structuredClone(run);
  }

  async completeWorkflowRun(id, result) {
    if (!id || !this.workflowRuns.has(Number(id))) return null;
    const run = this.workflowRuns.get(Number(id));
    const now = new Date().toISOString();
    const updated = {
      ...run,
      state: result.state,
      currentStep: result.currentStep || run.currentStep,
      lastError: result.error || null,
      completedAt: ["SUCCEEDED", "FAILED"].includes(result.state) ? now : null,
      updatedAt: now,
    };
    this.workflowRuns.set(Number(id), updated);
    return structuredClone(updated);
  }

  async insertAuditLog(input) {
    const entry = { id: this.auditLogs.length + 1, ...structuredClone(input), createdAt: new Date().toISOString() };
    this.auditLogs.push(entry);
    return structuredClone(entry);
  }

  async upsertRoutineLead(input) {
    const key = `${input.routine}:${input.externalEventId}`;
    if (this.routineEvents.has(key)) return { ...this.routineEvents.get(key), duplicate: true };
    const lead = await this.createLead({
      name: input.name,
      email: input.email,
      phone: input.phone,
      facebook: input.facebook,
      instagram: input.instagram,
      x: input.x,
      source: input.source,
      value: 0,
    });
    const result = { leadId: Number(String(lead.id).replace("social:", "")), duplicate: false };
    this.routineEvents.set(key, result);
    if (input.routine === "landing_page_registration" && input.landingPageId && this.pages.has(input.landingPageId)) {
      const page = this.pages.get(input.landingPageId);
      this.pages.set(input.landingPageId, { ...page, registrations: Number(page.registrations || 0) + 1 });
    }
    return result;
  }
}

export class SocialListener {
  constructor({ adapters, repository, logger = console }) {
    this.adapters = adapters;
    this.repository = repository;
    this.logger = logger;
  }

  normalizeChannels(channels) {
    const requested = Array.isArray(channels) && channels.length ? channels : SOCIAL_CHANNELS;
    return [...new Set(requested.map((channel) => String(channel).toLowerCase()))]
      .filter((channel) => SOCIAL_CHANNELS.includes(channel));
  }

  async validateChannels(channels) {
    const requested = this.normalizeChannels(channels);
    const results = await Promise.all(requested.map(async (channel) => {
      try {
        const result = await this.adapters[channel].validateCredentials();
        await this.repository.upsertConnectionStatus(result);
        return result;
      } catch (error) {
        const result = {
          channel,
          name: CHANNEL_NAMES[channel],
          configured: true,
          credentialValidation: "fail",
          status: "error",
          checkedAt: new Date().toISOString(),
          reason: safeReason(error),
        };
        await this.repository.upsertConnectionStatus(result);
        await this.repository.recordError({ channel, operation: "validate_credentials", message: result.reason });
        return result;
      }
    }));
    return results;
  }

  async processEvent(channel, payload) {
    const adapter = this.adapters[channel];
    if (!adapter) throw new MalformedPayloadError(`Unsupported channel: ${channel}.`);
    const event = adapter.normalizeEvent(payload);
    return this.processNormalizedEvent(event);
  }

  async processNormalizedEvent(event) {
    const adapter = this.adapters[event?.channel];
    if (!adapter) throw new MalformedPayloadError(`Unsupported channel: ${event?.channel || "unknown"}.`);
    const scoring = typeof this.repository.getScoringConfiguration === "function"
      ? await this.repository.getScoringConfiguration()
      : { rules: DEFAULT_SCORING_RULES, thresholds: DEFAULT_TEMPERATURE_THRESHOLDS };
    const intelligence = evaluateSocialEvent(event, {
      scoringRules: scoring.rules,
      temperatureThresholds: scoring.thresholds,
    });
    const lead = adapter.extractLead(event, intelligence);
    return this.repository.processEvent(event, lead, intelligence);
  }

  async runCampaign(campaign) {
    const selected = String(campaign.platform || "").toLowerCase();
    const channels = selected.includes("multi")
      ? SOCIAL_CHANNELS
      : selected.includes("instagram")
        ? ["instagram"]
        : selected.includes("facebook")
          ? ["facebook"]
          : selected === "x" || selected.includes("twitter")
            ? ["x"]
            : [];
    if (!channels.length) throw new MalformedPayloadError("The campaign platform is not supported.");

    const channelResults = await Promise.all(channels.map(async (channel) => {
      const adapter = this.adapters[channel];
      if (!adapter.validateConfiguration().configured) {
        throw new ProviderError(`${CHANNEL_NAMES[channel]} is not configured.`, {
          state: "missing_configuration",
          retryable: false,
        });
      }
      const payloads = await adapter.fetchCampaignActivity(campaign, {});
      let processed = 0;
      let duplicates = 0;
      for (const payload of payloads) {
        const result = await this.processEvent(channel, payload);
        if (result.duplicate) duplicates += 1;
        else processed += 1;
      }
      const metrics = await adapter.getMetrics();
      await this.repository.saveMetrics(channel, metrics);
      return { channel, processed, duplicates, metrics };
    }));
    return {
      processed: channelResults.reduce((total, item) => total + item.processed, 0),
      duplicates: channelResults.reduce((total, item) => total + item.duplicates, 0),
      metrics: Object.fromEntries(channelResults.map((item) => [item.channel, item.metrics])),
      channels: channelResults,
    };
  }

  async poll(channels, options = {}) {
    const requested = this.normalizeChannels(channels);
    return Promise.all(requested.map(async (channel) => {
      const adapter = this.adapters[channel];
      const configuration = adapter.validateConfiguration();
      if (!configuration.configured) {
        return { channel, status: "missing_configuration", processed: 0, errors: 0 };
      }
      try {
        const payloads = await adapter.fetchEvents(options[channel] || {});
        let processed = 0;
        let duplicates = 0;
        let errors = 0;
        for (const payload of payloads) {
          try {
            const result = await this.processEvent(channel, payload);
            if (result.duplicate) duplicates += 1;
            else processed += 1;
          } catch (error) {
            errors += 1;
            await this.repository.recordError({
              channel,
              operation: "process_event",
              message: safeReason(error),
            });
          }
        }
        return { channel, status: errors ? "degraded" : "connected", processed, duplicates, errors };
      } catch (error) {
        await this.repository.recordError({ channel, operation: "fetch_events", message: safeReason(error) });
        return {
          channel,
          status: CONNECTION_STATES.includes(error?.state) ? error.state : "error",
          processed: 0,
          errors: 1,
          reason: safeReason(error),
        };
      }
    }));
  }

  async collectMetrics(channels) {
    const requested = this.normalizeChannels(channels);
    return Promise.all(requested.map(async (channel) => {
      const adapter = this.adapters[channel];
      if (!adapter.validateConfiguration().configured) {
        return { channel, status: "missing_configuration", metricsTest: "skipped", values: [] };
      }
      try {
        const values = await adapter.getMetrics();
        await this.repository.saveMetrics(channel, values);
        return { channel, status: "connected", metricsTest: "pass", values };
      } catch (error) {
        await this.repository.recordError({ channel, operation: "get_metrics", message: safeReason(error) });
        return {
          channel,
          status: CONNECTION_STATES.includes(error?.state) ? error.state : "error",
          metricsTest: "fail",
          reason: safeReason(error),
          values: [],
        };
      }
    }));
  }

  getStatuses() {
    return this.repository.getStatuses(this.adapters);
  }
}

export function extractMetaWebhookEvents(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.entry)) {
    throw new MalformedPayloadError("A Meta webhook payload must include an entry array.");
  }
  const events = [];
  for (const entry of payload.entry) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = objectOrEmpty(change.value);
      const channel = payload.object === "instagram" || String(change.field).includes("instagram")
        ? "instagram"
        : "facebook";
      events.push({
        channel,
        payload: {
          ...value,
          field: change.field,
          event_type: value.event_type || change.field,
          id: value.id || value.comment_id || value.leadgen_id,
          post_id: value.post_id || value.media?.id,
          timestamp: value.timestamp || entry.time,
        },
      });
    }
    for (const message of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      events.push({
        channel: payload.object === "instagram" ? "instagram" : "facebook",
        payload: {
          id: message.message?.mid,
          event_type: "message",
          user_id: message.sender?.id,
          message: message.message?.text,
          timestamp: message.timestamp,
        },
      });
    }
  }
  return events.filter((event) => event.payload.id);
}

function toHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualText(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret || !signatureHeader?.startsWith("sha256=")) return false;
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  return timingSafeEqualText(`sha256=${toHex(digest)}`, signatureHeader.toLowerCase());
}

export function verifyMetaWebhookChallenge(url, verifyToken) {
  const requestUrl = url instanceof URL ? url : new URL(url);
  const mode = requestUrl.searchParams.get("hub.mode");
  const token = requestUrl.searchParams.get("hub.verify_token");
  const challenge = requestUrl.searchParams.get("hub.challenge");
  if (mode === "subscribe" && verifyToken && token === verifyToken && challenge) {
    return challenge;
  }
  return null;
}
