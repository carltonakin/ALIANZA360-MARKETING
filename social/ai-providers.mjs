const CAPABILITIES = Object.freeze({
  OPENAI: ["TEXT_GENERATION", "STRUCTURED_OUTPUT"],
  ANTHROPIC: ["TEXT_GENERATION", "STRUCTURED_OUTPUT"],
  GOOGLE_GEMINI: ["TEXT_GENERATION", "STRUCTURED_OUTPUT"],
});

export const AI_PROVIDER_DEFINITIONS = Object.freeze({
  OPENAI: Object.freeze({ name: "OpenAI", capabilities: CAPABILITIES.OPENAI }),
  ANTHROPIC: Object.freeze({ name: "Anthropic Claude", capabilities: CAPABILITIES.ANTHROPIC }),
  GOOGLE_GEMINI: Object.freeze({ name: "Google Gemini", capabilities: CAPABILITIES.GOOGLE_GEMINI }),
});

export const AI_CAMPAIGN_CONTENT_TYPES = Object.freeze([
  "EDUCATIONAL",
  "PROMOTIONAL",
  "TESTIMONIAL",
  "FAQ",
  "BENEFITS",
  "PROBLEM_SOLUTION",
  "SOCIAL_PROOF",
  "TIPS",
  "STORY",
  "URGENCY",
  "DIRECT_CTA",
]);

export const NORMALIZED_AI_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "headline", "caption", "body", "hashtags", "cta_text", "cta_url", "content_type",
    "image_prompt", "video_prompt", "platform", "recommended_publish_time",
  ],
  properties: {
    headline: { type: "string" },
    caption: { type: "string" },
    body: { type: "string" },
    hashtags: { type: "array", items: { type: "string" }, maxItems: 20 },
    cta_text: { type: "string" },
    cta_url: { type: "string" },
    content_type: { type: "string", enum: AI_CAMPAIGN_CONTENT_TYPES },
    image_prompt: { type: "string" },
    video_prompt: { type: "string" },
    platform: { type: "string" },
    recommended_publish_time: { type: "string", description: "24-hour UTC time formatted HH:mm" },
  },
});

function clean(value, maximum = 16_000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function jsonFromText(value) {
  const raw = clean(value, 100_000);
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(unfenced);
}

function responseText(body) {
  if (typeof body?.output_text === "string") return body.output_text;
  for (const item of body?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") return content.text;
    }
  }
  for (const content of body?.content || []) {
    if (typeof content?.text === "string") return content.text;
  }
  return body?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("") || "";
}

function statusError(providerName, response, body) {
  const message = clean(body?.error?.message || body?.message || `${providerName} returned HTTP ${response.status}.`, 1000);
  const error = new Error(message || `${providerName} request failed.`);
  error.statusCode = response.status;
  error.retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
  return error;
}

export function safeAiMessage(error) {
  return clean(error instanceof Error ? error.message : error || "AI provider request failed.", 1000)
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{8,})\b/g, "[redacted]")
    .replace(/\b(api[_ -]?key|token|secret|authorization)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]");
}

function requiredApiKey(configuration) {
  const apiKey = clean(configuration?.secrets?.apiKey, 10_000);
  if (!apiKey) {
    const error = new Error(`${configuration?.providerName || "AI provider"} has no stored API key.`);
    error.statusCode = 409;
    throw error;
  }
  return apiKey;
}

function providerPrompt(context) {
  return [
    "Create one original social campaign post and return only JSON matching the supplied schema.",
    "The saved company profile is authoritative. Never invent account IDs, testimonials, prices, guarantees, or factual claims.",
    "Vary the topic, headline, CTA wording, and visual concepts from previous posts.",
    "Use the requested platform conventions and a natural brand voice. recommended_publish_time must be HH:mm in UTC.",
    JSON.stringify(context),
  ].join("\n\n");
}

export class OpenAIAdapter {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    this.fetchImpl = fetchImpl;
  }

  async generateCampaignContent(configuration, context) {
    const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${requiredApiKey(configuration)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: configuration.effectiveModel,
        input: providerPrompt(context),
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "next2thetop_campaign_content",
            strict: true,
            schema: NORMALIZED_AI_OUTPUT_SCHEMA,
          },
        },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw statusError(configuration.providerName, response, body);
    return jsonFromText(responseText(body));
  }

  async testConnection(configuration) {
    const response = await this.fetchImpl("https://api.openai.com/v1/models", {
      headers: { authorization: `Bearer ${requiredApiKey(configuration)}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw statusError(configuration.providerName, response, body);
    return true;
  }
}

export class AnthropicAdapter {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    this.fetchImpl = fetchImpl;
  }

  async generateCampaignContent(configuration, context) {
    const response = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": requiredApiKey(configuration),
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: configuration.effectiveModel,
        max_tokens: 1800,
        messages: [{ role: "user", content: providerPrompt(context) }],
        output_config: {
          format: { type: "json_schema", schema: NORMALIZED_AI_OUTPUT_SCHEMA },
        },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw statusError(configuration.providerName, response, body);
    return jsonFromText(responseText(body));
  }

  async testConnection(configuration) {
    const response = await this.fetchImpl("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": requiredApiKey(configuration),
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw statusError(configuration.providerName, response, body);
    return true;
  }
}

export class GeminiAdapter {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    this.fetchImpl = fetchImpl;
  }

  async generateCampaignContent(configuration, context) {
    const model = clean(configuration.effectiveModel, 255).replace(/^models\//, "");
    const response = await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": requiredApiKey(configuration),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: providerPrompt(context) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: NORMALIZED_AI_OUTPUT_SCHEMA,
        },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw statusError(configuration.providerName, response, body);
    return jsonFromText(responseText(body));
  }

  async testConnection(configuration) {
    const model = clean(configuration.effectiveModel, 255).replace(/^models\//, "");
    const response = await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, {
      headers: { "x-goog-api-key": requiredApiKey(configuration) },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw statusError(configuration.providerName, response, body);
    return true;
  }
}

export function createAiProviderAdapters(options = {}) {
  return new Map([
    ["OPENAI", new OpenAIAdapter(options)],
    ["ANTHROPIC", new AnthropicAdapter(options)],
    ["GOOGLE_GEMINI", new GeminiAdapter(options)],
  ]);
}

function validUrl(value, fallback = "") {
  const candidate = clean(value, 2048) || clean(fallback, 2048);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

export function normalizeAiCampaignOutput(value, { providerCode, model, platform, destinationUrl = "", cta = "" } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AI provider returned an invalid content object.");
  const headline = clean(value.headline, 500);
  const body = clean(value.body, 12_000);
  const caption = clean(value.caption, 4000);
  if (!headline || (!body && !caption)) throw new Error("AI provider response is missing required campaign copy.");
  const rawHashtags = Array.isArray(value.hashtags) ? value.hashtags : [];
  const hashtags = [...new Set(rawHashtags
    .map((item) => clean(item, 100).replace(/^#+/, ""))
    .filter(Boolean)
    .map((item) => `#${item.replace(/\s+/g, "")}`))].slice(0, 20);
  const requestedContentType = clean(value.content_type, 64).toUpperCase();
  const contentType = AI_CAMPAIGN_CONTENT_TYPES.includes(requestedContentType) ? requestedContentType : "EDUCATIONAL";
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(clean(value.recommended_publish_time, 10))
    ? clean(value.recommended_publish_time, 10)
    : "16:00";
  return {
    headline,
    caption,
    body,
    hashtags,
    cta_text: clean(value.cta_text, 500) || clean(cta, 500),
    cta_url: validUrl(value.cta_url, destinationUrl),
    content_type: contentType,
    image_prompt: clean(value.image_prompt, 4000),
    video_prompt: clean(value.video_prompt, 4000),
    platform: clean(platform || value.platform, 64).toLowerCase(),
    recommended_publish_time: time,
    metadata: {
      provider: clean(providerCode, 64),
      model: clean(model, 255),
    },
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withRetry(operation, { attempts = 3 } = {}) {
  let lastError;
  let attempted = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    attempted = attempt;
    try {
      return { value: await operation(), attempts: attempt };
    } catch (error) {
      lastError = error;
      if (!error?.retryable || attempt === attempts) break;
      await sleep(250 * (2 ** (attempt - 1)));
    }
  }
  const failure = lastError instanceof Error ? lastError : new Error("AI provider request failed.");
  failure.attempts = attempted;
  throw failure;
}

export class AIProviderService {
  constructor({ repository, encryptionKey, fetchImpl = globalThis.fetch, adapters } = {}) {
    this.repository = repository;
    this.encryptionKey = encryptionKey;
    this.adapters = adapters || createAiProviderAdapters({ fetchImpl });
  }

  async provider(providerId, { requireEnabled = true } = {}) {
    const providers = await this.repository.getAiProviderConfigurations({
      providerId,
      encryptionKey: this.encryptionKey,
    });
    const provider = providers[0];
    if (!provider) throw Object.assign(new Error("AI provider configuration was not found."), { statusCode: 404 });
    if (requireEnabled && !provider.enabled) throw Object.assign(new Error(`${provider.providerName} is disabled.`), { statusCode: 409 });
    if (!provider.secrets?.apiKey) throw Object.assign(new Error(`${provider.providerName} has no stored API key.`), { statusCode: 409 });
    const adapter = this.adapters.get(provider.providerCode);
    if (!adapter) throw Object.assign(new Error(`${provider.providerCode} is not supported by this server build.`), { statusCode: 409 });
    return { ...provider, adapter };
  }

  async generateCampaignContent({ providerId, fallbackProviderId = null, model = null, context }) {
    const execute = async (id, fallbackUsed) => {
      const provider = await this.provider(id);
      const effectiveModel = clean(model && !fallbackUsed ? model : provider.model, 255);
      let attempted;
      try {
        attempted = await withRetry(() => provider.adapter.generateCampaignContent({ ...provider, effectiveModel }, context));
      } catch (error) {
        error.providerId = provider.id;
        error.providerCode = provider.providerCode;
        error.model = effectiveModel;
        error.fallbackUsed = fallbackUsed;
        throw error;
      }
      return {
        output: normalizeAiCampaignOutput(attempted.value, {
          providerCode: provider.providerCode,
          model: effectiveModel,
          platform: context.platform,
          destinationUrl: context.destinationUrl,
          cta: context.cta,
        }),
        providerId: provider.id,
        providerCode: provider.providerCode,
        model: effectiveModel,
        fallbackUsed,
        attempts: attempted.attempts,
      };
    };

    try {
      return await execute(providerId, false);
    } catch (primaryError) {
      if (!fallbackProviderId) throw primaryError;
      try {
        const result = await execute(fallbackProviderId, true);
        return { ...result, attempts: (Number(primaryError?.attempts) || 3) + result.attempts };
      } catch (fallbackError) {
        fallbackError.message = `Primary provider failed: ${safeAiMessage(primaryError)} Fallback provider failed: ${safeAiMessage(fallbackError)}`;
        fallbackError.attempts = (Number(primaryError?.attempts) || 3) + (Number(fallbackError?.attempts) || 3);
        throw fallbackError;
      }
    }
  }

  async testConnection(providerId) {
    const provider = await this.provider(providerId, { requireEnabled: false });
    await provider.adapter.testConnection({ ...provider, effectiveModel: provider.model });
    return provider;
  }

  generatePostText(output) {
    return clean(output?.body || output?.caption);
  }

  generateCaption(output) {
    return clean(output?.caption);
  }

  generateCTA(output) {
    return { text: clean(output?.cta_text, 500), url: validUrl(output?.cta_url) };
  }

  generateHashtags(output) {
    return Array.isArray(output?.hashtags) ? output.hashtags : [];
  }

  generateImagePrompt(output) {
    return clean(output?.image_prompt, 4000);
  }

  generateVideoPrompt(output) {
    return clean(output?.video_prompt, 4000);
  }
}

export function providerCapabilities(providerCode) {
  return AI_PROVIDER_DEFINITIONS[providerCode]?.capabilities || ["TEXT_GENERATION"];
}
