const DEFAULT_BUFFER_API_URL = "https://api.buffer.com";

export const BUFFER_POST_STATUSES = Object.freeze([
  "DRAFT",
  "SCHEDULED",
  "QUEUED",
  "PUBLISHED",
  "FAILED",
]);

export class BufferApiError extends Error {
  constructor(message, { statusCode = 502, retryable = false, code = "BUFFER_API_ERROR" } = {}) {
    super(safeBufferMessage(message));
    this.name = "BufferApiError";
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.code = code;
  }
}

export function safeBufferMessage(value) {
  const message = value instanceof Error ? value.message : String(value || "Buffer request failed.");
  return message
    .replace(/(access[_ -]?token|bearer|api[_ -]?key|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .slice(0, 1000);
}

function requiredString(value, label, maximum = 2048) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new BufferApiError(`${label} is required.`, { statusCode: 400, code: "VALIDATION_ERROR" });
  if (normalized.length > maximum) {
    throw new BufferApiError(`${label} must be ${maximum} characters or fewer.`, { statusCode: 400, code: "VALIDATION_ERROR" });
  }
  return normalized;
}

function responseError(status, payload) {
  const providerMessage = payload?.errors?.[0]?.message || payload?.message;
  if (status === 401 || status === 403) {
    return new BufferApiError("Buffer rejected the configured API credentials.", {
      statusCode: 424,
      code: "BUFFER_INVALID_CREDENTIALS",
    });
  }
  if (status === 429) {
    return new BufferApiError("Buffer rate limited the request. Try again later.", {
      statusCode: 429,
      retryable: true,
      code: "BUFFER_RATE_LIMITED",
    });
  }
  if (status >= 500) {
    return new BufferApiError("Buffer is temporarily unavailable.", {
      statusCode: 503,
      retryable: true,
      code: "BUFFER_UNAVAILABLE",
    });
  }
  return new BufferApiError(providerMessage || `Buffer returned HTTP ${status}.`, {
    statusCode: 424,
    code: "BUFFER_REQUEST_REJECTED",
  });
}

export function mapBufferPostStatus(status) {
  switch (String(status || "").toLowerCase()) {
    case "sent":
      return "PUBLISHED";
    case "sending":
      return "QUEUED";
    case "scheduled":
      return "SCHEDULED";
    case "error":
      return "FAILED";
    case "draft":
    case "needs_approval":
    default:
      return "DRAFT";
  }
}

export function externalPostIdFromLink(platform, value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const path = url.pathname;
  const service = String(platform || "").toLowerCase();
  const match = service === "twitter" || service === "x"
    ? path.match(/\/status\/(\d+)/i)
    : service === "instagram"
      ? path.match(/\/(?:p|reel|tv)\/([^/?#]+)/i)
      : service === "facebook"
        ? path.match(/\/(?:posts|videos)\/([^/?#]+)/i) || url.searchParams.get("story_fbid")?.match(/^(.+)$/)
        : service === "linkedin"
          ? path.match(/\/feed\/update\/([^/?#]+)/i)
          : null;
  return match?.[1] || null;
}

export function bufferPostMetadata(service, postType = "POST") {
  const normalizedService = String(service || "").trim().toLowerCase();
  const type = String(postType || "POST").trim().toLowerCase();
  if (normalizedService === "instagram") {
    return { instagram: { type, shouldShareToFeed: type !== "story" } };
  }
  if (normalizedService === "facebook") return { facebook: { type } };
  return undefined;
}

function bufferAssets(mediaType, mediaUrl) {
  if (!mediaType || !mediaUrl) return [];
  return [{ [mediaType]: { url: mediaUrl } }];
}

function postFields() {
  return `
    id
    channelId
    channelService
    dueAt
    sentAt
    status
    externalLink
    error { message }
  `;
}

export class BufferAdapter {
  constructor(config = {}, { fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
    this.apiKey = String(config.apiKey || "").trim();
    this.organizationId = String(config.organizationId || "").trim();
    this.apiUrl = String(config.apiUrl || DEFAULT_BUFFER_API_URL).trim();
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(1_000, Number(timeoutMs) || 10_000);
  }

  configurationStatus() {
    const missing = [];
    if (!this.apiKey) missing.push("BUFFER_API_KEY");
    if (!this.organizationId) missing.push("BUFFER_ORGANIZATION_ID");
    return {
      provider: "buffer",
      configured: missing.length === 0,
      status: missing.length ? "missing_configuration" : "configured",
      reason: missing.length
        ? `Missing server configuration: ${missing.join(", ")}.`
        : "Buffer credentials are stored on the server and ready for a live channel check.",
      missing,
    };
  }

  assertConfigured() {
    const status = this.configurationStatus();
    if (!status.configured) {
      throw new BufferApiError(status.reason, { statusCode: 503, code: "BUFFER_NOT_CONFIGURED" });
    }
  }

  async request(query, variables, operation) {
    this.assertConfigured();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(this.apiUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
    } catch (error) {
      const message = error?.name === "AbortError"
        ? `Buffer ${operation} timed out.`
        : `Buffer ${operation} could not be reached.`;
      throw new BufferApiError(message, { statusCode: 503, retryable: true, code: "BUFFER_NETWORK_ERROR" });
    } finally {
      clearTimeout(timeout);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new BufferApiError("Buffer returned malformed JSON.", { statusCode: 502, code: "BUFFER_INVALID_RESPONSE" });
    }
    if (!response.ok) throw responseError(response.status, payload);
    if (Array.isArray(payload?.errors) && payload.errors.length) {
      throw new BufferApiError(payload.errors[0]?.message || `Buffer ${operation} failed.`, {
        statusCode: 424,
        code: "BUFFER_GRAPHQL_ERROR",
      });
    }
    return payload?.data || {};
  }

  async getChannels() {
    const data = await this.request(
      `query BufferChannels($input: ChannelsInput!) {
        channels(input: $input) {
          id
          name
          displayName
          service
          avatar
          isQueuePaused
        }
      }`,
      { input: { organizationId: this.organizationId } },
      "channel lookup",
    );
    return (Array.isArray(data.channels) ? data.channels : []).map((channel) => ({
      id: requiredString(channel.id, "Buffer channel ID", 255),
      name: String(channel.name || "").trim(),
      displayName: String(channel.displayName || channel.name || channel.service || "Buffer channel").trim(),
      service: String(channel.service || "unknown").trim().toLowerCase(),
      avatar: typeof channel.avatar === "string" ? channel.avatar : null,
      isQueuePaused: Boolean(channel.isQueuePaused),
    }));
  }

  async schedulePost({
    channelId,
    service,
    postType = "POST",
    text,
    dueAt,
    mediaType = null,
    mediaUrl = null,
    aiAssisted = false,
  }) {
    const input = {
      channelId: requiredString(channelId, "Buffer channel ID", 255),
      text: requiredString(text, "Post text", 16_000),
      schedulingType: "automatic",
      mode: "customScheduled",
      dueAt: new Date(requiredString(dueAt, "Publish date")).toISOString(),
      aiAssisted: Boolean(aiAssisted),
      assets: bufferAssets(mediaType, mediaUrl),
    };
    const metadata = bufferPostMetadata(service, postType);
    if (metadata) input.metadata = metadata;

    const data = await this.request(
      `mutation ScheduleBufferPost($input: CreatePostInput!) {
        createPost(input: $input) {
          __typename
          ... on PostActionSuccess {
            post {
              ${postFields()}
            }
          }
          ... on MutationError { message }
        }
      }`,
      { input },
      "post scheduling",
    );
    if (data.createPost?.__typename !== "PostActionSuccess" || !data.createPost?.post?.id) {
      throw new BufferApiError(data.createPost?.message || "Buffer did not schedule the post.", {
        statusCode: 424,
        code: "BUFFER_SCHEDULE_REJECTED",
      });
    }
    return data.createPost.post;
  }

  async editPost({
    postId,
    service,
    postType = "POST",
    text,
    dueAt,
    mediaType = null,
    mediaUrl = null,
    aiAssisted = false,
  }) {
    const input = {
      id: requiredString(postId, "Buffer post ID", 255),
      text: requiredString(text, "Post text", 16_000),
      schedulingType: "automatic",
      mode: "customScheduled",
      dueAt: new Date(requiredString(dueAt, "Publish date")).toISOString(),
      aiAssisted: Boolean(aiAssisted),
      assets: bufferAssets(mediaType, mediaUrl),
    };
    const metadata = bufferPostMetadata(service, postType);
    if (metadata) input.metadata = metadata;

    const data = await this.request(
      `mutation EditBufferPost($input: EditPostInput!) {
        editPost(input: $input) {
          __typename
          ... on PostActionSuccess {
            post {
              ${postFields()}
            }
          }
          ... on MutationError { message }
        }
      }`,
      { input },
      "post editing",
    );
    if (data.editPost?.__typename !== "PostActionSuccess" || !data.editPost?.post?.id) {
      throw new BufferApiError(data.editPost?.message || "Buffer did not edit the post.", {
        statusCode: 424,
        code: "BUFFER_EDIT_REJECTED",
      });
    }
    return data.editPost.post;
  }

  async getPost(postId) {
    const data = await this.request(
      `query BufferPost($input: PostInput!) {
        post(input: $input) {
          ${postFields()}
        }
      }`,
      { input: { id: requiredString(postId, "Buffer post ID", 255) } },
      "post status lookup",
    );
    if (!data.post?.id) {
      throw new BufferApiError("Buffer did not return the requested post.", {
        statusCode: 404,
        code: "BUFFER_POST_NOT_FOUND",
      });
    }
    return data.post;
  }
}

export function createBufferAdapterFromEnv(env = process.env, options = {}) {
  return new BufferAdapter({
    apiKey: env.BUFFER_API_KEY,
    organizationId: env.BUFFER_ORGANIZATION_ID,
    apiUrl: env.BUFFER_API_URL || DEFAULT_BUFFER_API_URL,
  }, options);
}
