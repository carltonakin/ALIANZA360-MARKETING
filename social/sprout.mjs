import { ProviderError, withRetry } from "./core.mjs";

const DEFAULT_API_BASE_URL = "https://api.sproutsocial.com";
const DEFAULT_TOKEN_URL = "https://identity.sproutsocial.com/oauth2/84e39c75-d770-45d9-90a9-7b79e3037d2c/v1/token";
const SUPPORTED_NETWORKS = Object.freeze({
  FACEBOOK: "facebook",
  INSTAGRAM: "instagram",
  TWITTER: "x",
  X: "x",
});

function list(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function safeMessage(error) {
  return String(error?.message || error || "Sprout request failed.")
    .replace(/(access[_ -]?token|bearer|api[_ -]?key|client[_ -]?secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .slice(0, 500);
}

function providerError(status, body) {
  const detail = typeof body?.error === "string" ? body.error : body?.error?.message;
  if (status === 202) return new ProviderError("Sprout is still preparing the response.", { state: "degraded", status, retryable: true });
  if (status === 401 || status === 403) return new ProviderError("Sprout rejected the configured credentials or permissions.", { state: "invalid_credentials", status });
  if (status === 429) return new ProviderError("The Sprout API rate limit was reached.", { state: "rate_limited", status, retryable: true });
  if ([500, 503, 504].includes(status)) return new ProviderError("Sprout is temporarily unavailable.", { state: "degraded", status, retryable: true });
  return new ProviderError(detail || `Sprout request failed with HTTP ${status}.`, { state: "error", status });
}

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

export function sproutConfigurationFromEnv(env = process.env) {
  return {
    apiBaseUrl: env.SPROUT_API_BASE_URL || DEFAULT_API_BASE_URL,
    tokenUrl: env.SPROUT_OAUTH_TOKEN_URL || DEFAULT_TOKEN_URL,
    authMode: env.SPROUT_AUTH_MODE || (env.SPROUT_API_TOKEN ? "api_token" : "client_credentials"),
    customerId: env.SPROUT_CUSTOMER_ID || "",
    groupId: env.SPROUT_GROUP_ID || "",
    apiToken: env.SPROUT_API_TOKEN || "",
    clientId: env.SPROUT_CLIENT_ID || "",
    clientSecret: env.SPROUT_CLIENT_SECRET || "",
    profileIds: list(env.SPROUT_PROFILE_IDS),
    listeningTopicIds: list(env.SPROUT_LISTENING_TOPIC_IDS),
  };
}

export class SproutSocialAdapter {
  constructor(config = {}, options = {}) {
    this.config = {
      apiBaseUrl: DEFAULT_API_BASE_URL,
      tokenUrl: DEFAULT_TOKEN_URL,
      authMode: config.apiToken ? "api_token" : "client_credentials",
      profileIds: [],
      listeningTopicIds: [],
      ...config,
    };
    this.config.profileIds = list(config.profileIds);
    this.config.listeningTopicIds = list(config.listeningTopicIds);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.sleep = options.sleep;
    this.timeoutMs = Number(options.timeoutMs || 10_000);
    this.cachedToken = null;
    this.lastHealth = null;
  }

  validateConfiguration() {
    const missing = [];
    if (!this.config.customerId) missing.push("SPROUT_CUSTOMER_ID");
    if (this.config.authMode === "api_token") {
      if (!this.config.apiToken) missing.push("SPROUT_API_TOKEN");
    } else {
      if (!this.config.clientId) missing.push("SPROUT_CLIENT_ID");
      if (!this.config.clientSecret) missing.push("SPROUT_CLIENT_SECRET");
    }
    return { configured: missing.length === 0, missing };
  }

  publishingConfiguration() {
    const missing = [];
    if (!this.config.groupId) missing.push("SPROUT_GROUP_ID");
    if (!this.config.profileIds.length) missing.push("SPROUT_PROFILE_IDS");
    return { configured: this.validateConfiguration().configured && !missing.length, missing: [...this.validateConfiguration().missing, ...missing] };
  }

  status() {
    const configuration = this.validateConfiguration();
    const publishing = this.publishingConfiguration();
    return {
      provider: "sprout",
      name: "Sprout Social",
      configured: configuration.configured,
      status: this.lastHealth?.status || (configuration.configured ? "configured" : "missing_configuration"),
      reason: this.lastHealth?.reason || (configuration.configured
        ? "Credentials are stored server-side. Run the connection test to validate access."
        : `Missing ${configuration.missing.join(", ")}.`),
      checkedAt: this.lastHealth?.checkedAt || null,
      customerId: this.config.customerId || null,
      profileCount: this.config.profileIds.length,
      listeningTopicCount: this.config.listeningTopicIds.length,
      publishingReady: publishing.configured,
      publishingMissing: publishing.missing,
      capabilities: ["draft_publishing", "inbox_messages", "owned_analytics", "listening"],
    };
  }

  async accessToken(forceRefresh = false) {
    if (this.config.authMode === "api_token") return this.config.apiToken;
    if (!forceRefresh && this.cachedToken && this.cachedToken.expiresAt > Date.now() + 30_000) return this.cachedToken.value;
    const configuration = this.validateConfiguration();
    if (!configuration.configured) throw new ProviderError(`Sprout is missing ${configuration.missing.join(", ")}.`, { state: "missing_configuration" });
    const form = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: "client_credentials",
      scope: "organization_id",
    });
    let response;
    try {
      response = await this.fetchImpl(this.config.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: form,
      });
    } catch {
      throw new ProviderError("The Sprout authorization server could not be reached.", { state: "degraded", retryable: true });
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) throw providerError(response.status || 500, body);
    this.cachedToken = {
      value: body.access_token,
      expiresAt: Date.now() + Math.max(60, Number(body.expires_in || 3600)) * 1000,
    };
    return this.cachedToken.value;
  }

  async request(path, { method = "GET", body, operation = "sprout_request" } = {}) {
    const configuration = this.validateConfiguration();
    if (!configuration.configured) throw new ProviderError(`Sprout is missing ${configuration.missing.join(", ")}.`, { state: "missing_configuration" });
    let refreshed = false;
    return withRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const token = await this.accessToken(refreshed);
        const response = await this.fetchImpl(`${this.config.apiBaseUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/json",
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || response.status === 202 || payload?.error) {
          if (response.status === 401 && this.config.authMode !== "api_token" && !refreshed) {
            refreshed = true;
            this.cachedToken = null;
            throw new ProviderError("Refreshing the Sprout access token.", { state: "degraded", status: 401, retryable: true });
          }
          throw providerError(response.status || 500, payload);
        }
        return {
          ...payload,
          requestId: response.headers?.get?.("x-sprout-request-id") || null,
          operation,
        };
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (error?.name === "AbortError") throw new ProviderError("The Sprout request timed out.", { state: "degraded", retryable: true });
        throw new ProviderError(`The Sprout API could not be reached during ${operation}.`, { state: "degraded", retryable: true });
      } finally {
        clearTimeout(timeout);
      }
    }, { attempts: 3, sleep: this.sleep });
  }

  async healthCheck() {
    const checkedAt = new Date().toISOString();
    const configuration = this.validateConfiguration();
    if (!configuration.configured) {
      this.lastHealth = { status: "missing_configuration", reason: `Missing ${configuration.missing.join(", ")}.`, checkedAt };
      return this.status();
    }
    try {
      const result = await this.request("/v1/metadata/client", { operation: "validate_credentials" });
      const customers = Array.isArray(result.data) ? result.data : [];
      const customer = customers.find((item) => String(item.customer_id ?? item.id) === String(this.config.customerId));
      if (!customer) throw new ProviderError("The configured Sprout customer ID is not available to these credentials.", { state: "invalid_credentials" });
      this.lastHealth = { status: "connected", reason: "Sprout customer access was validated.", checkedAt };
    } catch (error) {
      this.lastHealth = { status: error?.state || "error", reason: safeMessage(error), checkedAt };
    }
    return this.status();
  }

  async fetchMessages({ since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), limit = 50 } = {}) {
    if (!this.config.groupId) throw new ProviderError("Sprout inbox sync requires SPROUT_GROUP_ID.", { state: "missing_configuration" });
    const filters = [
      `group_id.eq(${this.config.groupId})`,
      `created_time.in(${new Date(since).toISOString()}..${new Date().toISOString()})`,
    ];
    if (this.config.profileIds.length) filters.push(`customer_profile_id.eq(${this.config.profileIds.join(", ")})`);
    const result = await this.request(`/v1/${encodeURIComponent(this.config.customerId)}/messages`, {
      method: "POST",
      operation: "fetch_messages",
      body: {
        filters,
        fields: ["network", "created_time", "post_category", "post_type", "perma_link", "text", "from", "profile_guid"],
        sort: ["created_time:asc"],
        limit: Math.max(1, Math.min(100, Number(limit) || 50)),
      },
    });
    return (Array.isArray(result.data) ? result.data : []).map((item) => ({ ...item, sprout_source: "messages" }));
  }

  async fetchListeningMessages({ since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), limit = 50 } = {}) {
    const results = [];
    for (const topicId of this.config.listeningTopicIds) {
      const response = await this.request(`/v1/${encodeURIComponent(this.config.customerId)}/listening/topics/${encodeURIComponent(topicId)}/messages`, {
        method: "POST",
        operation: "fetch_listening_messages",
        body: {
          filters: [`created_time.in(${new Date(since).toISOString()}..${new Date().toISOString()})`],
          fields: ["content_category", "created_time", "from", "network", "perma_link", "text", "visual_media"],
          metrics: ["engagements", "likes", "replies", "shares_count", "from.followers_count"],
          sort: ["created_time:asc"],
          limit: Math.max(1, Math.min(100, Number(limit) || 50)),
          page: 1,
        },
      });
      results.push(...(Array.isArray(response.data) ? response.data : []).map((item) => ({ ...item, sprout_source: "listening", sprout_topic_id: topicId })));
    }
    return results;
  }

  async fetchInboundEvents(options = {}) {
    const [messages, listening] = await Promise.all([
      this.fetchMessages(options),
      this.fetchListeningMessages(options),
    ]);
    return [...messages, ...listening];
  }

  normalizeEvent(input) {
    const channel = SUPPORTED_NETWORKS[String(input?.network || "").toUpperCase()];
    if (!channel) return null;
    const externalEventId = String(input.guid || input.message_id || input.id || "").trim();
    if (!externalEventId) throw new Error("A Sprout message GUID is required.");
    const from = input.from && typeof input.from === "object" ? input.from : {};
    return {
      channel,
      externalEventId,
      eventType: String(input.post_type || input.content_category || input.post_category || "message").toLowerCase(),
      externalUserId: String(from.guid || from.id || "").trim() || null,
      username: String(from.screen_name || from.username || "").trim() || null,
      displayName: String(from.name || "").trim() || null,
      email: null,
      phone: null,
      message: String(input.text || "").trim() || null,
      postId: String(input.guid || "").trim() || null,
      campaignId: null,
      adId: null,
      leadFormId: null,
      campaignName: null,
      conversationId: String(input.thread_guid || input.conversation_id || input.guid || "").trim() || null,
      direction: "INBOUND",
      sourceUrl: String(input.perma_link || "").trim() || null,
      occurredAt: new Date(input.created_time || Date.now()).toISOString(),
      rawPayload: { ...input, integration_provider: "sprout" },
    };
  }

  async getMetrics({ start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), end = new Date() } = {}) {
    if (!this.config.profileIds.length) throw new ProviderError("Sprout analytics requires SPROUT_PROFILE_IDS.", { state: "missing_configuration" });
    const result = await this.request(`/v1/${encodeURIComponent(this.config.customerId)}/analytics/profiles`, {
      method: "POST",
      operation: "get_profile_metrics",
      body: {
        filters: [
          `customer_profile_id.eq(${this.config.profileIds.join(", ")})`,
          `reporting_period.in(${dateOnly(start)}...${dateOnly(end)})`,
        ],
        metrics: ["impressions", "reactions"],
        page: 1,
      },
    });
    return Array.isArray(result.data) ? result.data : [];
  }

  async getPostMetrics({ start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), end = new Date() } = {}) {
    if (!this.config.profileIds.length) throw new ProviderError("Sprout analytics requires SPROUT_PROFILE_IDS.", { state: "missing_configuration" });
    const result = await this.request(`/v1/${encodeURIComponent(this.config.customerId)}/analytics/posts`, {
      method: "POST",
      operation: "get_post_metrics",
      body: {
        fields: ["created_time", "perma_link", "text", "profile_guid"],
        filters: [
          `customer_profile_id.eq(${this.config.profileIds.join(", ")})`,
          `created_time.in(${new Date(start).toISOString()}..${new Date(end).toISOString()})`,
        ],
        metrics: [
          "lifetime.impressions",
          "lifetime.reactions",
          "lifetime.comments_count",
          "lifetime.shares_count",
          "lifetime.post_content_clicks",
        ],
        timezone: "UTC",
        page: 1,
      },
    });
    return Array.isArray(result.data) ? result.data : [];
  }

  async collectMetrics(options = {}) {
    const [profiles, posts] = await Promise.all([
      this.getMetrics(options),
      this.getPostMetrics(options),
    ]);
    return { profiles, posts };
  }

  async createPublishingDraft(input) {
    const profileIds = list(input.profileIds).length ? list(input.profileIds) : this.config.profileIds;
    const groupId = input.groupId || this.config.groupId;
    if (!groupId || !profileIds.length) throw new ProviderError("Sprout publishing requires a group ID and at least one customer profile ID.", { state: "missing_configuration" });
    const text = String(input.text || "").trim();
    if (!text && !(Array.isArray(input.media) && input.media.length)) throw new ProviderError("A Sprout draft requires text or media.", { state: "error" });
    const body = {
      group_id: Number.isNaN(Number(groupId)) ? groupId : Number(groupId),
      customer_profile_ids: profileIds.map((id) => Number.isNaN(Number(id)) ? id : Number(id)),
      is_draft: true,
      ...(text ? { text } : {}),
      ...(Array.isArray(input.media) && input.media.length ? { media: input.media } : {}),
      ...(Array.isArray(input.tagIds) && input.tagIds.length ? { tag_ids: input.tagIds } : {}),
      ...(input.scheduledAt ? { delivery: { scheduled_times: [new Date(input.scheduledAt).toISOString()], type: "SCHEDULED" } } : {}),
    };
    const result = await this.request(`/v1/${encodeURIComponent(this.config.customerId)}/publishing/posts`, {
      method: "POST",
      operation: "create_publishing_draft",
      body,
    });
    const posts = Array.isArray(result.data) ? result.data : [];
    const publishingPostIds = posts.map((post) => post?.internal?.publishing?.publishing_post_id).filter((id) => id !== undefined && id !== null).map(String);
    const deliveryStatuses = posts.flatMap((post) => post?.internal?.publishing?.deliveries || []).map((delivery) => delivery.delivery_status).filter(Boolean);
    return {
      externalId: publishingPostIds[0] || null,
      externalIds: publishingPostIds,
      externalStatus: deliveryStatuses[0] || "PENDING",
      isDraft: true,
      profileCount: posts.length,
      requestId: result.requestId,
      posts,
    };
  }

  async getPublishingDraft(externalId) {
    const result = await this.request(`/v1/${encodeURIComponent(this.config.customerId)}/publishing/posts/${encodeURIComponent(externalId)}`, {
      operation: "get_publishing_draft",
    });
    const posts = Array.isArray(result.data) ? result.data : [];
    const statuses = posts.flatMap((post) => post?.internal?.publishing?.deliveries || []).map((delivery) => delivery.delivery_status).filter(Boolean);
    return { externalId: String(externalId), externalStatus: statuses[0] || "PENDING", posts, requestId: result.requestId };
  }
}

export function createSproutAdapterFromEnv(env = process.env, options = {}) {
  return new SproutSocialAdapter(sproutConfigurationFromEnv(env), options);
}
