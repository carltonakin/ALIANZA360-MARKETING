const BASE_SCHEMAS = Object.freeze({
  campaign: {
    properties: {
      name: { type: "string", minLength: 1, maxLength: 255 },
      platform: { type: "string", enum: ["Instagram", "Facebook", "X / Twitter", "Multi-channel"] },
      audience: { type: "string", minLength: 1 },
      message: { type: "string", minLength: 1 },
      budget: { type: "number", minimum: 0 },
    },
    required: ["name", "platform", "audience", "message", "budget"],
  },
  landing_page: {
    properties: {
      title: { type: "string", minLength: 1, maxLength: 255 },
      slug: { type: "string", minLength: 1, maxLength: 255 },
      headline: { type: "string", minLength: 1, maxLength: 500 },
      teaser: { type: "string" },
      webinarUrl: { type: "string" },
      paymentUrl: { type: "string" },
    },
    required: ["title", "slug", "headline", "teaser", "webinarUrl", "paymentUrl"],
  },
  webinar: {
    properties: {
      title: { type: "string", minLength: 1, maxLength: 255 },
      description: { type: "string" },
      scheduledAt: { type: "string" },
      webinarUrl: { type: "string" },
    },
    required: ["title", "description", "scheduledAt", "webinarUrl"],
  },
});

function safeApiError(payload, status) {
  const message = payload?.error?.message;
  if (status === 401 || status === 403) return "OpenAI rejected the configured API credentials.";
  if (status === 429) return "OpenAI rate limits prevented draft generation.";
  return typeof message === "string" && !/key|token|secret/i.test(message)
    ? message.slice(0, 300)
    : `OpenAI returned HTTP ${status}.`;
}

function outputText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "refusal") {
        const error = new Error("The model declined to generate this draft.");
        error.statusCode = 422;
        throw error;
      }
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return null;
}

export async function generateAiDraft({ entity, brief }, {
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const base = BASE_SCHEMAS[entity];
  if (!base) {
    const error = new Error("AI entity must be campaign, landing_page, or webinar.");
    error.statusCode = 400;
    throw error;
  }
  if (!env.OPENAI_API_KEY) {
    const error = new Error("OPENAI_API_KEY is not configured on the listener service.");
    error.statusCode = 503;
    throw error;
  }
  const model = env.OPENAI_MODEL || "gpt-5.6";
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        {
          role: "system",
          content: "Create a concise CRM marketing draft. Do not claim it is published. Return only fields allowed by the schema; all output requires human review.",
        },
        { role: "user", content: String(brief || "").trim().slice(0, 12_000) },
      ],
      text: {
        format: {
          type: "json_schema",
          name: `crm360_${entity}_draft`,
          strict: true,
          schema: { type: "object", ...base, additionalProperties: false },
        },
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(safeApiError(payload, response.status));
    error.statusCode = response.status === 400 ? 400 : 502;
    throw error;
  }
  const text = outputText(payload);
  if (!text) {
    const error = new Error("OpenAI returned no structured draft.");
    error.statusCode = 502;
    throw error;
  }
  try {
    return { draft: JSON.parse(text), model, responseId: payload.id || null };
  } catch {
    const error = new Error("OpenAI returned an invalid structured draft.");
    error.statusCode = 502;
    throw error;
  }
}

export async function generateLeadReplySuggestion({ target, interactions = [] }, {
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!target || target.platform !== "instagram" || String(target.direction).toUpperCase() !== "INBOUND") {
    const error = new Error("An inbound Instagram interaction is required for an AI suggestion.");
    error.statusCode = 400;
    throw error;
  }
  if (!env.OPENAI_API_KEY) {
    const error = new Error("OPENAI_API_KEY is not configured on the listener service.");
    error.statusCode = 503;
    throw error;
  }

  const model = env.OPENAI_MODEL || "gpt-5.6";
  const conversation = interactions
    .filter((item) => item.platform === "instagram" && ["COMMENT", "DM", "DIRECT_MESSAGE", "STORY_REPLY"].includes(item.interactionType))
    .slice(0, 12)
    .reverse()
    .map((item) => ({
      direction: String(item.direction || "INBOUND").toUpperCase(),
      type: ["DIRECT_MESSAGE", "STORY_REPLY"].includes(item.interactionType) ? "DM" : item.interactionType,
      message: String(item.message || "").slice(0, 2_000),
      occurredAt: item.occurredAt || null,
    }));
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        {
          role: "system",
          content: "Draft one concise, helpful Instagram reply for a CRM user to review. Do not claim an action, price, availability, or commitment that is not present in the conversation. Do not mention AI. Return only the schema field. The draft must not be sent automatically.",
        },
        {
          role: "user",
          content: JSON.stringify({
            replyTarget: {
              type: ["DIRECT_MESSAGE", "STORY_REPLY"].includes(target.interactionType) ? "DM" : target.interactionType,
              message: String(target.message || "").slice(0, 4_000),
            },
            recentConversation: conversation,
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "crm360_instagram_reply_suggestion",
          strict: true,
          schema: {
            type: "object",
            properties: {
              suggestion: { type: "string", minLength: 1, maxLength: 2_200 },
            },
            required: ["suggestion"],
            additionalProperties: false,
          },
        },
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(safeApiError(payload, response.status));
    error.statusCode = response.status === 400 ? 400 : 502;
    throw error;
  }
  const text = outputText(payload);
  if (!text) {
    const error = new Error("OpenAI returned no reply suggestion.");
    error.statusCode = 502;
    throw error;
  }
  try {
    const parsed = JSON.parse(text);
    const suggestion = typeof parsed.suggestion === "string" ? parsed.suggestion.trim() : "";
    if (!suggestion) throw new Error("empty suggestion");
    return { suggestion: suggestion.slice(0, 2_200), model, responseId: payload.id || null };
  } catch {
    const error = new Error("OpenAI returned an invalid reply suggestion.");
    error.statusCode = 502;
    throw error;
  }
}
