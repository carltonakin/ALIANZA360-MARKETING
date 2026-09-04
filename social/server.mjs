import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  SOCIAL_CHANNELS,
  SocialListener,
  createAdaptersFromEnv,
  extractMetaWebhookEvents,
  verifyMetaSignature,
  verifyMetaWebhookChallenge,
} from "./core.mjs";
import {
  channelConfigurationsToEnv,
  encryptChannelSecrets,
  exchangeAuthorizationCode,
  normalizeChannelConfiguration,
  normalizeChannelName,
  publicChannelConfiguration,
} from "./channel-config.mjs";
import { generateAiDraft, generateLeadReplySuggestion } from "./ai.mjs";
import { CampaignAutomationEngine } from "./campaign-automation.mjs";
import {
  DEFAULT_SCORING_RULES,
  DEFAULT_TEMPERATURE_THRESHOLDS,
  INTENT_CATEGORIES,
} from "./intelligence.mjs";
import { SqlServerRepository } from "./sql-server.mjs";
import { createBufferAdapterFromEnv } from "./buffer-adapter.mjs";
import { BufferCampaignService } from "./buffer-campaigns.mjs";
import { AuthService } from "./auth.mjs";
import {
  campaignMediaMaximumBytes,
  storeCampaignMediaBuffer,
} from "../lib/campaign-media.mjs";

/*
|--------------------------------------------------------------------------
| EXPRESS SERVER
|--------------------------------------------------------------------------
|
| server.mjs is an ES module. createRequire allows us to use the requested:
|
| const express = require("express");
|
*/

const require = createRequire(import.meta.url);
const express = require("express");
const multer = require("multer");

const app = express();

const requestedPort =
  process.env.PORT ||
  process.env.SOCIAL_LISTENER_PORT ||
  "3000";

const PORT = Number(requestedPort);

const REPORT_PATHS = new Map([
  ["/reports/leads/scoring", "lead-scoring"],
  ["/reports/leads/temperature", "lead-temperature"],
  ["/reports/leads/intents", "lead-intents"],
  ["/reports/leads/sources", "lead-sources"],
  ["/reports/campaigns/lead-performance", "campaign-lead-performance"],
  ["/reports/leads/engagement", "lead-engagement"],
  ["/reports/leads/hot", "hot-leads"],
]);

const REPORT_DEFAULT_SORTS = Object.freeze({
  "lead-scoring": "score_desc",
  "lead-temperature": "temperature_asc",
  "lead-intents": "lead_count_desc",
  "lead-sources": "lead_count_desc",
  "campaign-lead-performance": "total_leads_desc",
  "lead-engagement": "last_interaction_desc",
  "hot-leads": "score_desc",
});

const REPORT_SORTS = new Set([
  "score_desc", "score_asc", "name_asc", "name_desc", "last_interaction_asc",
  "last_interaction_desc", "intent_asc", "temperature_asc", "lead_count_desc",
  "average_score_desc", "recent_desc", "source_asc", "campaign_asc",
  "total_leads_desc", "inbound_desc", "outbound_desc",
]);

if (
  !Number.isInteger(PORT) ||
  PORT < 1 ||
  PORT > 65_535
) {
  throw new Error(
    "PORT must be an integer between 1 and 65535."
  );
}

/*
|--------------------------------------------------------------------------
| ROOT ROUTE
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.send("Server is running");
});

/*
|--------------------------------------------------------------------------
| RESPONSE HELPERS
|--------------------------------------------------------------------------
*/

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

function safeMessage(error) {
  return error instanceof Error
    ? error.message
        .replace(
          /(access[_ -]?token|bearer|api[_ -]?key|secret|password)\s*[:=]\s*[^\s,;]+/gi,
          "$1=[redacted]"
        )
        .replace(
          /Bearer\s+[A-Za-z0-9._~+/-]+/gi,
          "Bearer [redacted]"
        )
        .slice(0, 300)
    : "Unexpected listener error.";
}

function equalToken(left, right) {
  if (!left || !right || left.length !== right.length) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

function authorized(request, env) {
  const expected = env.SERVICE_AUTH_TOKEN;

  const provided =
    request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "") || "";

  return equalToken(provided, expected);
}

function authorizedExpressRequest(request, env) {
  const provided = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return equalToken(provided, env.SERVICE_AUTH_TOKEN);
}

function uploadErrorStatus(error) {
  if (error?.code === "LIMIT_FILE_SIZE") return 413;
  if (error instanceof multer.MulterError) return 400;
  return Number.isInteger(error?.statusCode) ? error.statusCode : 500;
}

export function registerCampaignMediaExpressRoutes(expressApp, {
  env = process.env,
  logger = console,
  storeMedia = storeCampaignMediaBuffer,
} = {}) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: campaignMediaMaximumBytes(env),
      files: 1,
      fields: 30,
      parts: 31,
      fieldSize: 4096,
    },
  }).single("media");

  expressApp.post(
    "/api/media",
    (request, response) => {
      if (!authorizedExpressRequest(request, env)) {
        response.status(401).json({ ok: false, error: "Unauthorized." });
        return;
      }

      upload(request, response, async (uploadError) => {
        try {
          if (uploadError) throw uploadError;
          if (!request.file) {
            const error = new Error("Choose an image or video file to upload.");
            error.statusCode = 400;
            throw error;
          }
          const requestedServices = Array.isArray(request.body.targetServices)
            ? request.body.targetServices
            : [request.body.targetServices];
          const media = await storeMedia({
            filename: request.file.originalname,
            mimeType: request.file.mimetype,
            size: request.file.size,
            bytes: request.file.buffer,
          }, {
            env,
            postType: String(request.body.postType || "POST"),
            targetServices: requestedServices.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean),
          });
          logger.info?.(JSON.stringify({
            component: "campaign_media",
            operation: "express_upload",
            status: "uploaded",
            provider: "cloudinary",
            originalFileName: media.originalFileName,
            mimeType: media.mimeType,
            size: media.size,
            assetId: media.assetId,
            publicId: media.publicId,
            resourceType: media.resourceType,
            format: media.format,
            mediaUrl: media.mediaUrl,
          }));
          response.status(201).json({
            ok: true,
            assetId: media.assetId,
            publicId: media.publicId,
            resourceType: media.resourceType,
            format: media.format,
            size: media.size,
            mediaUrl: media.mediaUrl,
            media,
          });
        } catch (error) {
          const status = uploadErrorStatus(error);
          logger.error?.(JSON.stringify({
            component: "campaign_media",
            operation: "express_upload",
            status: "failed",
            statusCode: status,
            error: safeMessage(error),
          }));
          response.status(status).json({
            ok: false,
            error: status < 500 ? safeMessage(error) : "The campaign media could not be stored.",
          });
        }
      });
    },
  );
}

async function readJson(request) {
  const raw = await request.text();

  if (raw.length > 1_000_000) {
    const error = new Error(
      "Request payload is too large."
    );

    error.statusCode = 413;

    throw error;
  }

  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    const error = new Error(
      "Malformed JSON payload."
    );

    error.statusCode = 400;

    throw error;
  }
}

/*
|--------------------------------------------------------------------------
| SOCIAL CHANNEL HELPERS
|--------------------------------------------------------------------------
*/

function normalizeRequestedChannels(value) {
  if (!Array.isArray(value)) {
    return SOCIAL_CHANNELS;
  }

  return value
    .map((channel) => {
      const name =
        typeof channel === "string"
          ? channel
          : channel?.name || channel?.channel;

      const normalized = String(
        name || ""
      ).toLowerCase();

      if (normalized.startsWith("instagram")) {
        return "instagram";
      }

      if (normalized.startsWith("facebook")) {
        return "facebook";
      }

      if (
        normalized === "x" ||
        normalized.includes("twitter")
      ) {
        return "x";
      }

      return normalized;
    })
    .filter((channel) =>
      SOCIAL_CHANNELS.includes(channel)
    );
}

/*
|--------------------------------------------------------------------------
| LEADS
|--------------------------------------------------------------------------
*/

const LEAD_STATUSES = new Set([
  "New",
  "Engaged",
  "Hot",
  "Registered",
  "Customer",
]);

function cleanLeadValue(value, maxLength) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const cleaned = String(value).trim();

  if (!cleaned) {
    return null;
  }

  if (cleaned.length > maxLength) {
    const error = new Error(
      `A lead field exceeds its ${maxLength}-character limit.`
    );

    error.statusCode = 400;

    throw error;
  }

  return cleaned;
}

function normalizeLeadInput(body) {
  const lastIntentProvided = Object.prototype.hasOwnProperty.call(body, "lastIntent") ||
    Object.prototype.hasOwnProperty.call(body, "intent");
  const crmNotesProvided = Object.prototype.hasOwnProperty.call(body, "crmnotes") ||
    Object.prototype.hasOwnProperty.call(body, "crmNotes");
  const name = cleanLeadValue(
    body.name,
    255
  );

  const email = cleanLeadValue(
    body.email,
    320
  );

  if (!name || !email) {
    const error = new Error(
      "Lead name and email are required."
    );

    error.statusCode = 400;

    throw error;
  }

  const value = Number(
    body.value || 0
  );

  if (
    !Number.isFinite(value) ||
    value < 0
  ) {
    const error = new Error(
      "Estimated value must be a non-negative number."
    );

    error.statusCode = 400;

    throw error;
  }

  return {
    name,
    email,

    phone: cleanLeadValue(
      body.phone,
      80
    ),

    facebook: cleanLeadValue(
      body.facebook,
      500
    ),

    instagram: cleanLeadValue(
      body.instagram,
      500
    ),

    x: cleanLeadValue(
      body.x,
      500
    ),

    source:
      cleanLeadValue(
        body.source,
        100
      ) || "Manual",

    lastIntent: cleanLeadValue(
      body.lastIntent ?? body.intent,
      64
    ),

    crmNotes: cleanLeadValue(
      body.crmnotes ?? body.crmNotes,
      10000
    ),

    lastIntentProvided,
    crmNotesProvided,

    value,
  };
}

const LEAD_INTERACTION_TYPES = new Set(["COMMENT", "DM"]);
const LEAD_INTERACTION_DIRECTIONS = new Set(["INBOUND", "OUTBOUND"]);
const INTENT_ALIASES = Object.freeze({
  BOOKING: "APPOINTMENT_REQUEST",
  PRICING: "PRICE_REQUEST",
  PURCHASE: "PURCHASE_INTENT",
  QUOTE: "QUOTE_REQUEST",
  DEMO: "DEMO_REQUEST",
  INFORMATION: "INFORMATION_REQUEST",
});
const CRM_OWNED_SCORING_FIELDS = new Set([
  "score", "leadscore", "scoreband", "intentscore", "engagementscore",
  "fitscore", "recencyscore", "sourcescore", "scorereason", "lastscoredat",
]);

function rejectClientScoringFields(body) {
  const supplied = Object.keys(body || {}).find((name) =>
    CRM_OWNED_SCORING_FIELDS.has(String(name).replaceAll("_", "").toLowerCase()));
  if (!supplied) return;
  const error = new Error(`${supplied} is CRM-owned and cannot be supplied by an integration.`);
  error.statusCode = 400;
  throw error;
}

function optionalPositiveId(value, name) {
  if (value === null || value === undefined || value === "") return null;
  const id = Number(String(value).replace(/^[^:]+:/, ""));
  if (!Number.isInteger(id) || id < 1) {
    const error = new Error(`${name} must be a positive integer.`);
    error.statusCode = 400;
    throw error;
  }
  return id;
}

function publicNumericId(value) {
  if (value === null || value === undefined || value === "") return null;
  const id = Number(String(value).replace(/^[^:]+:/, ""));
  return Number.isInteger(id) && id > 0 ? id : value;
}

function interactionApiResult(result) {
  return {
    ...result,
    leadId: publicNumericId(result.leadId),
    interactionId: publicNumericId(result.interactionId),
    duplicateInteraction: Boolean(result.duplicate),
    scoreReason: result.scoreReason || result.reason || "",
  };
}

function normalizeLeadInteractionInput(body) {
  rejectClientScoringFields(body);
  const leadId = optionalPositiveId(body.leadId, "LeadId");
  const platformValue = cleanLeadValue(body.platform ?? body.channel, 32)?.toLowerCase();
  const platform = platformValue === "twitter" ? "x" : platformValue;
  if (!platform || !SOCIAL_CHANNELS.includes(platform)) {
    const error = new Error("Platform must be facebook, instagram, or x.");
    error.statusCode = 400;
    throw error;
  }

  const externalInteractionId = cleanLeadValue(
    body.externalInteractionId ?? body.externalEventId ?? body.interactionId,
    255,
  );
  if (!externalInteractionId) {
    const error = new Error("ExternalInteractionId is required.");
    error.statusCode = 400;
    throw error;
  }

  const externalUserId = cleanLeadValue(body.externalUserId ?? body.platformUserId, 255);
  const username = cleanLeadValue(body.username, 255);
  if (!leadId && !externalUserId && !username) {
    const error = new Error("LeadId, ExternalUserId, or Username is required.");
    error.statusCode = 400;
    throw error;
  }

  const rawType = String(body.interactionType || "").trim().toUpperCase().replaceAll("-", "_");
  const interactionType = rawType === "DIRECT_MESSAGE" ? "DM" : rawType;
  if (!LEAD_INTERACTION_TYPES.has(interactionType)) {
    const error = new Error("InteractionType must be COMMENT or DM.");
    error.statusCode = 400;
    throw error;
  }

  const direction = String(body.direction || "INBOUND").trim().toUpperCase();
  if (!LEAD_INTERACTION_DIRECTIONS.has(direction)) {
    const error = new Error("Direction must be INBOUND or OUTBOUND.");
    error.statusCode = 400;
    throw error;
  }
  if (direction === "OUTBOUND" && body.deliveryConfirmed !== true) {
    const error = new Error("Outbound interactions require successful delivery confirmation.");
    error.statusCode = 409;
    throw error;
  }

  const message = cleanLeadValue(body.messageText ?? body.message, 100_000);
  if (!message) {
    const error = new Error("MessageText is required.");
    error.statusCode = 400;
    throw error;
  }

  const occurred = body.createdAt ?? body.occurredAt;
  const occurredAt = occurred ? new Date(occurred) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    const error = new Error("CreatedAt must be a valid date and time.");
    error.statusCode = 400;
    throw error;
  }

  const classification = body.classification && typeof body.classification === "object"
    ? body.classification
    : {};
  const rawIntent = String(body.intent ?? classification.intent ?? "").trim().toUpperCase().replaceAll(" ", "_");
  const intent = INTENT_ALIASES[rawIntent] || rawIntent;
  if (intent && !INTENT_CATEGORIES.includes(intent)) {
    const error = new Error("Intent is not a supported CRM intent category.");
    error.statusCode = 400;
    throw error;
  }
  const confidenceValue = body.intentConfidence ?? classification.confidence;
  const intentConfidence = confidenceValue === null || confidenceValue === undefined || confidenceValue === ""
    ? null
    : Number(confidenceValue);
  if (intentConfidence !== null && (!Number.isFinite(intentConfidence) || intentConfidence < 0 || intentConfidence > 1)) {
    const error = new Error("IntentConfidence must be between 0 and 1.");
    error.statusCode = 400;
    throw error;
  }

  const sourceTypeValue = String(body.sourceType || (body.advertisementId || body.adId || body.leadFormId ? "PAID" : "ORGANIC")).toUpperCase();
  const sourceType = sourceTypeValue === "PAID" ? "PAID" : "ORGANIC";
  const campaignPostValue = body.campaignPostId;
  const campaignPostId = campaignPostValue === null || campaignPostValue === undefined || campaignPostValue === ""
    ? null
    : Number(campaignPostValue);
  if (campaignPostId !== null && (!Number.isInteger(campaignPostId) || campaignPostId < 1)) {
    const error = new Error("CampaignPostId must be a positive integer.");
    error.statusCode = 400;
    throw error;
  }
  return {
    leadId,
    channel: platform,
    externalEventId: externalInteractionId,
    externalInteractionId,
    eventType: interactionType === "DM" ? "dm" : "comment",
    externalUserId,
    username,
    displayName: cleanLeadValue(body.displayName, 255),
    email: cleanLeadValue(body.email, 320),
    phone: cleanLeadValue(body.phone, 80),
    message,
    postId: cleanLeadValue(body.externalPostId ?? body.postId, 255),
    campaignId: cleanLeadValue(body.campaignId, 255),
    campaignPostId,
    adId: cleanLeadValue(body.advertisementId ?? body.adId, 255),
    leadFormId: cleanLeadValue(body.leadFormId, 255),
    campaignName: cleanLeadValue(body.campaignName, 255),
    conversationId: cleanLeadValue(body.conversationId, 255),
    direction,
    sourceUrl: cleanLeadValue(body.sourceUrl, 2048),
    occurredAt: occurredAt.toISOString(),
    intent: intent || null,
    intentConfidence,
    sourceType,
    rawPayload: body.rawPayload && typeof body.rawPayload === "object" ? body.rawPayload : body,
  };
}

function normalizeLeadIntentInput(body) {
  rejectClientScoringFields(body);
  const interactionId = optionalPositiveId(body.interactionId, "InteractionId");
  if (!interactionId) {
    const error = new Error("InteractionId is required.");
    error.statusCode = 400;
    throw error;
  }

  const rawIntent = String(body.intent || "").trim().toUpperCase().replaceAll(" ", "_");
  const intent = INTENT_ALIASES[rawIntent] || rawIntent;
  if (!intent || !INTENT_CATEGORIES.includes(intent)) {
    const error = new Error("Intent is not a supported CRM intent category.");
    error.statusCode = 400;
    throw error;
  }

  const confidenceValue = body.intentConfidence;
  const intentConfidence = confidenceValue === null || confidenceValue === undefined || confidenceValue === ""
    ? null
    : Number(confidenceValue);
  if (intentConfidence !== null && (!Number.isFinite(intentConfidence) || intentConfidence < 0 || intentConfidence > 1)) {
    const error = new Error("IntentConfidence must be between 0 and 1.");
    error.statusCode = 400;
    throw error;
  }

  for (const field of ["pricingIntent", "purchaseIntent"]) {
    if (body[field] !== undefined && typeof body[field] !== "boolean") {
      const error = new Error(`${field} must be true or false.`);
      error.statusCode = 400;
      throw error;
    }
  }

  return {
    interactionId,
    intent,
    intentConfidence,
    pricingIntent: body.pricingIntent ?? null,
    purchaseIntent: body.purchaseIntent ?? null,
  };
}

const REPLY_MODES = new Set(["AI_AUTOMATIC", "AI_ASSISTED", "MANUAL"]);

function normalizeLeadReplyInput(body, { automatic = false, user = null } = {}) {
  rejectClientScoringFields(body);
  const inReplyToInteractionId = optionalPositiveId(
    body.inReplyToInteractionId ?? body.interactionId,
    "InReplyToInteractionId",
  );
  if (!inReplyToInteractionId) {
    const error = new Error("InReplyToInteractionId is required.");
    error.statusCode = 400;
    throw error;
  }
  const messageText = cleanLeadValue(body.messageText ?? body.message, 100_000);
  if (!messageText) {
    const error = new Error("Reply text is required.");
    error.statusCode = 400;
    throw error;
  }
  const responseMode = automatic
    ? "AI_AUTOMATIC"
    : String(body.responseMode || "MANUAL").trim().toUpperCase();
  if (!REPLY_MODES.has(responseMode) || (!automatic && responseMode === "AI_AUTOMATIC")) {
    const error = new Error("CRM users may send MANUAL or AI_ASSISTED replies.");
    error.statusCode = 400;
    throw error;
  }
  const suppliedIdempotencyKey = cleanLeadValue(body.idempotencyKey, 240);
  if (!suppliedIdempotencyKey) {
    const error = new Error("An idempotency key is required.");
    error.statusCode = 400;
    throw error;
  }
  const idempotencyKey = `crm-reply:${suppliedIdempotencyKey}`;
  const maxAttempts = body.maxAttempts === undefined ? 4 : Number(body.maxAttempts);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    const error = new Error("MaxAttempts must be an integer between 1 and 10.");
    error.statusCode = 400;
    throw error;
  }
  return {
    inReplyToInteractionId,
    messageText,
    responseMode,
    sentByUserId: automatic ? null : user?.id || null,
    sentByUsername: automatic ? null : user?.username || null,
    idempotencyKey,
    maxAttempts,
  };
}

function normalizeLeadReplyCompletion(body) {
  const lockToken = cleanLeadValue(body.lockToken, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(lockToken || "")) {
    const error = new Error("A valid reply lock token is required.");
    error.statusCode = 400;
    throw error;
  }
  if (typeof body.succeeded !== "boolean") {
    const error = new Error("Succeeded must be true or false.");
    error.statusCode = 400;
    throw error;
  }
  const sentAt = body.sentAt ? new Date(body.sentAt) : new Date();
  if (Number.isNaN(sentAt.getTime())) {
    const error = new Error("SentAt must be a valid date and time.");
    error.statusCode = 400;
    throw error;
  }
  const nextAttemptAt = body.nextAttemptAt ? new Date(body.nextAttemptAt) : null;
  if (nextAttemptAt && Number.isNaN(nextAttemptAt.getTime())) {
    const error = new Error("NextAttemptAt must be a valid date and time.");
    error.statusCode = 400;
    throw error;
  }
  const externalReplyId = cleanLeadValue(body.externalReplyId, 255);
  if (body.succeeded && !externalReplyId) {
    const error = new Error("A successful Instagram delivery requires the external reply ID.");
    error.statusCode = 400;
    throw error;
  }
  return {
    lockToken,
    succeeded: body.succeeded,
    externalReplyId,
    externalStatus: cleanLeadValue(body.externalStatus, 100),
    providerResponse: body.providerResponse && typeof body.providerResponse === "object"
      ? body.providerResponse
      : null,
    error: cleanLeadValue(body.error, 1000),
    retryable: body.retryable === true,
    nextAttemptAt: nextAttemptAt?.toISOString() || null,
    sentAt: sentAt.toISOString(),
  };
}

function throwMappedReplyError(error) {
  if (Number.isInteger(error?.statusCode)) throw error;
  const number = Number(error?.number || error?.originalError?.info?.number);
  if (number === 51213 || number === 51205) error.statusCode = 404;
  else if ([51207, 51208, 51209, 51210, 51214].includes(number)) error.statusCode = 409;
  else if (number >= 51200 && number <= 51212) error.statusCode = 400;
  throw error;
}

/*
|--------------------------------------------------------------------------
| CAMPAIGN / CONTENT SETTINGS
|--------------------------------------------------------------------------
*/

const CAMPAIGN_MODES = new Set([
  "draft",
  "test",
  "production",
  "paused",
  "archived",
]);

const CONTENT_STATUSES = new Set([
  "draft",
  "published",
  "paused",
  "archived",
]);

const ROUTINES = new Set([
  "facebook_listener",
  "instagram_listener",
  "x_listener",
  "landing_page_registration",
  "webinar_registration",
  "campaign_conversion",
  "ai_social_listener",
]);

function requiredValue(
  value,
  name,
  maxLength = 2000
) {
  const result = cleanLeadValue(
    value,
    maxLength
  );

  if (!result) {
    const error = new Error(
      `${name} is required.`
    );

    error.statusCode = 400;

    throw error;
  }

  return result;
}

function contentStatus(value) {
  const status = String(
    value || "draft"
  ).toLowerCase();

  if (!CONTENT_STATUSES.has(status)) {
    const error = new Error(
      "Content status must be draft, published, paused, or archived."
    );

    error.statusCode = 400;

    throw error;
  }

  return status;
}

function optionalUrl(value, name) {
  const result = cleanLeadValue(
    value,
    2048
  );

  if (!result) {
    return null;
  }

  try {
    const parsed = new URL(result);

    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {
      throw new Error(
        "Unsupported protocol"
      );
    }
  } catch {
    const error = new Error(
      `${name} must be a valid HTTP or HTTPS URL.`
    );

    error.statusCode = 400;

    throw error;
  }

  return result;
}

function optionalId(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const id = String(value);

  if (
    !/^(campaign|page|webinar):[1-9]\d*$/.test(
      id
    ) &&
    !/^[1-9]\d*$/.test(id)
  ) {
    const error = new Error(
      "A related record ID is invalid."
    );

    error.statusCode = 400;

    throw error;
  }

  return id;
}

function optionalCrmEntityId(
  value,
  name
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const id = String(value);

  if (
    !/^(campaign|social):[1-9]\d*$/.test(
      id
    ) &&
    !/^[1-9]\d*$/.test(id)
  ) {
    const error = new Error(
      `${name} is invalid.`
    );

    error.statusCode = 400;

    throw error;
  }

  return id;
}

function booleanValue(
  value,
  fallback = false
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return [
    "1",
    "true",
    "yes",
    "on",
  ].includes(
    String(value).toLowerCase()
  );
}

function boundedInteger(
  value,
  name,
  {
    min,
    max,
    fallback,
  }
) {
  const number =
    value === undefined ||
    value === null ||
    value === ""
      ? fallback
      : Number(value);

  if (
    !Number.isInteger(number) ||
    number < min ||
    number > max
  ) {
    const error = new Error(
      `${name} must be an integer between ${min} and ${max}.`
    );

    error.statusCode = 400;

    throw error;
  }

  return number;
}

function optionalBoundedInteger(value, name, limits) {
  if (value === undefined || value === null || value === "") return null;
  return boundedInteger(value, name, { ...limits, fallback: limits.min });
}

function optionalDate(
  value,
  name
) {
  const result = cleanLeadValue(
    value,
    64
  );

  if (!result) {
    return null;
  }

  const date = new Date(result);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    const error = new Error(
      `${name} is invalid.`
    );

    error.statusCode = 400;

    throw error;
  }

  return date.toISOString();
}

/*
|--------------------------------------------------------------------------
| LEAD SCORING
|--------------------------------------------------------------------------
*/

function normalizeScoringConfiguration(
  body
) {
  const allowedRules = new Set(
    Object.keys(
      DEFAULT_SCORING_RULES
    )
  );

  const allowedThresholds =
    Object.keys(
      DEFAULT_TEMPERATURE_THRESHOLDS
    );

  const rules = {};

  for (
    const [key, value]
    of Object.entries(
      body?.rules || {}
    )
  ) {
    if (!allowedRules.has(key)) {
      continue;
    }

    rules[key] = boundedInteger(
      value,
      `Scoring rule ${key}`,
      {
        min: 0,
        max: 1000,
        fallback: 0,
      }
    );
  }

  const thresholds = {
    ...DEFAULT_TEMPERATURE_THRESHOLDS,
  };

  for (
    const key
    of allowedThresholds
  ) {
    if (
      body?.thresholds?.[key] !==
      undefined
    ) {
      thresholds[key] =
        boundedInteger(
          body.thresholds[key],
          `${key} threshold`,
          {
            min: 0,
            max: 10000,
            fallback:
              thresholds[key],
          }
        );
    }
  }

  if (
    !allowedThresholds.every(
      (key, index) =>
        index === 0 ||
        thresholds[key] >=
          thresholds[
            allowedThresholds[
              index - 1
            ]
          ]
    )
  ) {
    const error = new Error(
      "Lead temperature thresholds must increase from COLD through VERY_HOT."
    );

    error.statusCode = 400;

    throw error;
  }

  return {
    rules,
    thresholds,
  };
}

/*
|--------------------------------------------------------------------------
| CONTENT NORMALIZATION
|--------------------------------------------------------------------------
*/

function normalizeContentInput(
  body
) {
  const entity = String(
    body.entity || ""
  ).toLowerCase();

  if (entity === "campaign") {
    const status = String(
      body.status || "draft"
    ).toLowerCase();

    if (
      !CAMPAIGN_MODES.has(status)
    ) {
      const error = new Error(
        "A supported campaign mode is required."
      );

      error.statusCode = 400;

      throw error;
    }

    const budget = Number(
      body.budget || 0
    );

    if (
      !Number.isFinite(budget) ||
      budget < 0
    ) {
      const error = new Error(
        "Campaign budget must be a non-negative number."
      );

      error.statusCode = 400;

      throw error;
    }

    return {
      entity,

      id: optionalId(
        body.id
      ),

      name: requiredValue(
        body.name,
        "Campaign name",
        255
      ),

      platform: requiredValue(
        body.platform,
        "Campaign platform",
        100
      ),

      audience: requiredValue(
        body.audience,
        "Campaign audience",
        16_000
      ),

      message: requiredValue(
        body.message,
        "Campaign message",
        16_000
      ),

      budget,

      status,

      createdByAi:
        Boolean(
          body.createdByAi
        ),

      sourceType:
        String(
          body.sourceType ||
            "ORGANIC"
        ).toUpperCase() ===
        "PAID"
          ? "PAID"
          : "ORGANIC",

      externalCampaignId:
        cleanLeadValue(
          body.externalCampaignId,
          255
        ),

      advertisementId:
        cleanLeadValue(
          body.advertisementId,
          255
        ),

      leadFormId:
        cleanLeadValue(
          body.leadFormId,
          255
        ),

      contentReference:
        optionalUrl(
          body.contentReference,
          "Campaign content reference"
        ),

      schedule:
        cleanLeadValue(
          body.schedule,
          255
        ) || "continuous",

      cadenceMinutes:
        boundedInteger(
          body.cadenceMinutes,
          "Campaign cadence",
          {
            min: 1,
            max: 10_080,
            fallback: 60,
          }
        ),

      automationEnabled:
        booleanValue(
          body.automationEnabled
        ),

      maxRetries:
        boundedInteger(
          body.maxRetries,
          "Maximum retries",
          {
            min: 0,
            max: 10,
            fallback: 3,
          }
        ),

      nextRunAt:
        optionalDate(
          body.nextRunAt,
          "Next campaign run"
        ),
    };
  }

  if (
    entity === "landing_page"
  ) {
    return {
      entity,

      id: optionalId(
        body.id
      ),

      campaignId:
        optionalId(
          body.campaignId
        ),

      title: requiredValue(
        body.title,
        "Landing page title",
        255
      ),

      slug: requiredValue(
        body.slug,
        "Landing page slug",
        255
      )
        .toLowerCase()
        .replace(
          /[^a-z0-9-]/g,
          "-"
        ),

      headline:
        requiredValue(
          body.headline,
          "Landing page headline",
          500
        ),

      teaser:
        cleanLeadValue(
          body.teaser,
          16_000
        ),

      webinarUrl:
        optionalUrl(
          body.webinarUrl,
          "Webinar URL"
        ),

      paymentUrl:
        optionalUrl(
          body.paymentUrl,
          "Payment URL"
        ),

      status:
        contentStatus(
          body.status
        ),

      createdByAi:
        Boolean(
          body.createdByAi
        ),
    };
  }

  if (entity === "webinar") {
    const scheduledAt =
      cleanLeadValue(
        body.scheduledAt,
        64
      );

    if (
      scheduledAt &&
      Number.isNaN(
        new Date(
          scheduledAt
        ).getTime()
      )
    ) {
      const error = new Error(
        "Webinar schedule is invalid."
      );

      error.statusCode = 400;

      throw error;
    }

    return {
      entity,

      id:
        optionalId(
          body.id
        ),

      campaignId:
        optionalId(
          body.campaignId
        ),

      landingPageId:
        optionalId(
          body.landingPageId
        ),

      title:
        requiredValue(
          body.title,
          "Webinar title",
          255
        ),

      description:
        cleanLeadValue(
          body.description,
          16_000
        ),

      scheduledAt,

      webinarUrl:
        optionalUrl(
          body.webinarUrl,
          "Webinar URL"
        ),

      status:
        contentStatus(
          body.status
        ),

      createdByAi:
        Boolean(
          body.createdByAi
        ),
    };
  }

  const error = new Error(
    "Entity must be campaign, landing_page, or webinar."
  );

  error.statusCode = 400;

  throw error;
}

/*
|--------------------------------------------------------------------------
| ROUTINE LEADS
|--------------------------------------------------------------------------
*/

function normalizeRoutineLead(
  body
) {
  const routine = String(
    body.routine || ""
  ).toLowerCase();

  if (
    !ROUTINES.has(routine)
  ) {
    const error = new Error(
      "A supported lead routine is required."
    );

    error.statusCode = 400;

    throw error;
  }

  return {
    routine,

    externalEventId:
      requiredValue(
        body.externalEventId,
        "External event ID",
        255
      ),

    name:
      requiredValue(
        body.name,
        "Lead name",
        255
      ),

    email:
      cleanLeadValue(
        body.email,
        320
      ),

    phone:
      cleanLeadValue(
        body.phone,
        80
      ),

    facebook:
      cleanLeadValue(
        body.facebook,
        500
      ),

    instagram:
      cleanLeadValue(
        body.instagram,
        500
      ),

    x:
      cleanLeadValue(
        body.x,
        500
      ),

    source:
      cleanLeadValue(
        body.source,
        100
      ) || routine,

    campaignId:
      optionalId(
        body.campaignId
      ),

    landingPageId:
      optionalId(
        body.landingPageId
      ),

    webinarId:
      optionalId(
        body.webinarId
      ),

    sourceDetail:
      cleanLeadValue(
        body.sourceDetail,
        1000
      ),

    occurredAt:
      body.occurredAt &&
      !Number.isNaN(
        new Date(
          body.occurredAt
        ).getTime()
      )
        ? new Date(
            body.occurredAt
          ).toISOString()
        : new Date().toISOString(),
  };
}

/*
|--------------------------------------------------------------------------
| CONFIG VALIDATION
|--------------------------------------------------------------------------
*/

export function validateServiceConfiguration(
  env,
  {
    requireDatabase = true,
  } = {}
) {
  const missing = [];

  if (
    !env.SERVICE_AUTH_TOKEN
  ) {
    missing.push(
      "SERVICE_AUTH_TOKEN"
    );
  }

  const individualSql =
    (env.DB_SERVER ||
      env.SQL_SERVER_HOST) &&
    (env.DB_NAME ||
      env.SQL_SERVER_DATABASE) &&
    (env.DB_USER ||
      env.SQL_SERVER_USER) &&
    (env.DB_PASSWORD ||
      env.SQL_SERVER_PASSWORD);

  if (
    requireDatabase &&
    !env.SQL_SERVER_CONNECTION_STRING &&
    !individualSql
  ) {
    missing.push(
      "DB_SERVER/DB_NAME/DB_USER/DB_PASSWORD"
    );
  }

  if (missing.length) {
    throw new Error(
      `Missing required listener configuration: ${missing.join(
        ", "
      )}.`
    );
  }

  return {
    valid: true,
  };
}

/*
|--------------------------------------------------------------------------
| CRM SOCIAL LISTENER APPLICATION
|--------------------------------------------------------------------------
*/

export async function createSocialListenerApp({
  env = process.env,
  repository,
  adapters,
  bufferAdapter,
  bufferCampaignService,
  authService: providedAuthService,
  fetchImpl,
  logger = console,
} = {}) {
  const ownsRepository =
    !repository;

  validateServiceConfiguration(
    env,
    {
      requireDatabase:
        ownsRepository,
    }
  );

  const activeRepository =
    repository ||
    (await SqlServerRepository.connectFromEnv(
      env
    ));

  const authRepositoryMethods = [
    "getAuthUserByUsername",
    "listAuthUsers",
    "createAuthUser",
    "updateAuthUser",
    "setAuthUserPassword",
    "recordAuthLogin",
    "createAuthSession",
    "getAuthSession",
    "revokeAuthSession",
  ];
  const activeAuthService = providedAuthService || (
    authRepositoryMethods.every((method) => typeof activeRepository[method] === "function")
      ? new AuthService(activeRepository)
      : null
  );
  if (activeAuthService) await activeAuthService.bootstrapDefaultAdmin();

  let runtimeEnv = {
    ...env,
  };

  if (
    !adapters &&
    typeof activeRepository.getChannelConfigurations ===
      "function"
  ) {
    const configurations =
      await activeRepository.getChannelConfigurations(
        env.CHANNEL_CONFIG_ENCRYPTION_KEY
      );

    runtimeEnv =
      channelConfigurationsToEnv(
        configurations,
        runtimeEnv
      );
  }

  const activeAdapters =
    adapters ||
    createAdaptersFromEnv(
      runtimeEnv,
      {
        fetchImpl,
        logger,
      }
    );

  const listener =
    new SocialListener({
      adapters:
        activeAdapters,
      repository:
        activeRepository,
      logger,
    });

  const automationEngine =
    new CampaignAutomationEngine({
      repository:
        activeRepository,

      listener,

      logger,

      batchSize:
        env.CAMPAIGN_AUTOMATION_BATCH_SIZE,
    });

  const activeBufferAdapter =
    bufferAdapter ||
    createBufferAdapterFromEnv(
      env,
      {
        fetchImpl,
      }
    );

  const activeBufferCampaignService =
    bufferCampaignService ||
    new BufferCampaignService({
      repository:
        activeRepository,

      bufferAdapter:
        activeBufferAdapter,

      logger,

      env,

      fetchImpl,
    });

  async function refreshConfiguredAdapters() {
    if (
      typeof activeRepository.getChannelConfigurations !==
      "function"
    ) {
      return [];
    }

    const configurations =
      await activeRepository.getChannelConfigurations(
        env.CHANNEL_CONFIG_ENCRYPTION_KEY
      );

    runtimeEnv =
      channelConfigurationsToEnv(
        configurations,
        {
          ...env,
        }
      );

    listener.adapters =
      createAdaptersFromEnv(
        runtimeEnv,
        {
          fetchImpl,
          logger,
        }
      );

    return configurations;
  }

  async function publicConfigurations() {
    const saved =
      typeof activeRepository.getChannelConfigurations ===
      "function"
        ? await activeRepository.getChannelConfigurations()
        : [];

    return SOCIAL_CHANNELS.map(
      (channel) => {
        const configuration =
          saved.find(
            (item) =>
              item.channel ===
              channel
          ) || {
            channel,
            enabled: false,
            environment:
              "production",
            status:
              "missing_configuration",
            secretFields: [],
          };

        return publicChannelConfiguration(
          configuration
        );
      }
    );
  }

  /*
  |--------------------------------------------------------------------------
  | MAIN REQUEST HANDLER
  |--------------------------------------------------------------------------
  */

  async function handle(
    request
  ) {
    const url = new URL(
      request.url
    );

    /*
    |--------------------------------------------------------------------------
    | HEALTH
    |--------------------------------------------------------------------------
    */

    if (
      request.method === "GET" &&
      url.pathname === "/health"
    ) {
      try {
        const databaseConnected =
          typeof activeRepository.healthCheck ===
          "function"
            ? await activeRepository.healthCheck()
            : true;

        return json(
          {
            ok:
              databaseConnected,

            service:
              "crm360-social-listener",

            database:
              "sql_server",

            databaseConnected,
          },

          databaseConnected
            ? 200
            : 503
        );
      } catch {
        return json(
          {
            ok: false,

            service:
              "crm360-social-listener",

            database:
              "sql_server",

            databaseConnected:
              false,
          },

          503
        );
      }
    }

    /*
    |--------------------------------------------------------------------------
    | META WEBHOOK VERIFICATION
    |--------------------------------------------------------------------------
    */

    if (
      url.pathname ===
        "/webhooks/meta" &&
      request.method === "GET"
    ) {
      const challenge =
        verifyMetaWebhookChallenge(
          url,
          runtimeEnv.META_VERIFY_TOKEN
        );

      return challenge
        ? new Response(
            challenge,
            {
              status: 200,

              headers: {
                "content-type":
                  "text/plain",
              },
            }
          )
        : json(
            {
              error:
                "Webhook verification failed.",
            },

            403
          );
    }

    /*
    |--------------------------------------------------------------------------
    | META WEBHOOK EVENTS
    |--------------------------------------------------------------------------
    */

    if (
      url.pathname ===
        "/webhooks/meta" &&
      request.method === "POST"
    ) {
      if (
        !runtimeEnv.META_APP_SECRET
      ) {
        return json(
          {
            error:
              "Meta webhook signature validation is not configured.",
          },

          503
        );
      }

      const rawBody =
        await request.text();

      const signature =
        request.headers.get(
          "x-hub-signature-256"
        );

      if (
        !(await verifyMetaSignature(
          rawBody,
          signature,
          runtimeEnv.META_APP_SECRET
        ))
      ) {
        return json(
          {
            error:
              "Invalid Meta webhook signature.",
          },

          401
        );
      }

      let payload;

      try {
        payload =
          JSON.parse(
            rawBody
          );
      } catch {
        return json(
          {
            error:
              "Malformed JSON payload.",
          },

          400
        );
      }

      try {
        const events =
          extractMetaWebhookEvents(
            payload
          );

        if (
          typeof activeRepository.markWebhookReceived ===
          "function"
        ) {
          const receivedAt =
            new Date();

          await Promise.all(
            [
              ...new Set(
                events.map(
                  (event) =>
                    event.channel
                )
              ),
            ].map(
              (channel) =>
                activeRepository.markWebhookReceived(
                  channel,
                  receivedAt
                )
            )
          );
        }

        let processed = 0;
        let duplicates = 0;
        let errors = 0;

        for (
          const event
          of events
        ) {
          try {
            const result =
              await listener.processEvent(
                event.channel,
                event.payload
              );

            if (
              result.duplicate
            ) {
              duplicates += 1;
            } else {
              processed += 1;
            }
          } catch (error) {
            errors += 1;

            await activeRepository.recordError(
              {
                channel:
                  event.channel,

                operation:
                  "meta_webhook",

                message:
                  safeMessage(
                    error
                  ),
              }
            );
          }
        }

        return json(
          {
            ok:
              errors === 0,

            received:
              events.length,

            processed,

            duplicates,

            errors,
          },

          errors
            ? 207
            : 200
        );
      } catch (error) {
        return json(
          {
            error:
              safeMessage(
                error
              ),
          },

          400
        );
      }
    }

    /*
    |--------------------------------------------------------------------------
    | AUTHORIZATION
    |--------------------------------------------------------------------------
    */

    if (
      !authorized(
        request,
        env
      )
    ) {
      return json(
        {
          error:
            "Unauthorized.",
        },

        401
      );
    }

    try {
      const sessionToken = request.headers.get("x-crm-session-token") || "";

      if (request.method === "POST" && url.pathname === "/auth/login") {
        if (!activeAuthService) return json({ error: "Authentication storage is unavailable." }, 503);
        const result = await activeAuthService.login(await readJson(request));
        return json({ ok: true, ...result });
      }

      if (request.method === "GET" && url.pathname === "/auth/me") {
        if (!activeAuthService) return json({ error: "Authentication storage is unavailable." }, 503);
        return json({ ok: true, user: await activeAuthService.authenticate(sessionToken) });
      }

      if (request.method === "POST" && url.pathname === "/auth/logout") {
        if (!activeAuthService) return json({ error: "Authentication storage is unavailable." }, 503);
        await activeAuthService.logout(sessionToken);
        return json({ ok: true });
      }

      if (request.method === "GET" && url.pathname === "/auth/users") {
        if (!activeAuthService) return json({ error: "Authentication storage is unavailable." }, 503);
        return json({ ok: true, users: await activeAuthService.listUsers(sessionToken) });
      }

      if (request.method === "POST" && url.pathname === "/auth/users") {
        if (!activeAuthService) return json({ error: "Authentication storage is unavailable." }, 503);
        const user = await activeAuthService.createUser(sessionToken, await readJson(request));
        return json({ ok: true, user }, 201);
      }

      const authUserMatch = url.pathname.match(/^\/auth\/users\/(\d+)$/);
      if (request.method === "PATCH" && authUserMatch) {
        if (!activeAuthService) return json({ error: "Authentication storage is unavailable." }, 503);
        const user = await activeAuthService.updateUser(sessionToken, authUserMatch[1], await readJson(request));
        return json({ ok: true, user });
      }

      const authPasswordMatch = url.pathname.match(/^\/auth\/users\/(\d+)\/password$/);
      if (request.method === "POST" && authPasswordMatch) {
        if (!activeAuthService) return json({ error: "Authentication storage is unavailable." }, 503);
        const body = await readJson(request);
        const user = await activeAuthService.changePassword(sessionToken, authPasswordMatch[1], body.password);
        return json({ ok: true, user });
      }

      const mediaDeleteMatch = request.method === "DELETE"
        ? url.pathname.match(/^\/api\/media\/([^/]+)$/)
        : null;
      if (mediaDeleteMatch) {
        const body = await readJson(request);
        const result = await activeBufferCampaignService.deleteMediaIfUnreferenced(
          {
            assetId: decodeURIComponent(mediaDeleteMatch[1]),
            publicId: body.publicId,
            resourceType: body.resourceType,
          },
        );
        return json({ ok: true, ...result });
      }

      /*
      |--------------------------------------------------------------------------
      | CHANNEL CONFIGURATIONS
      |--------------------------------------------------------------------------
      */

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/channel-configurations"
      ) {
        return json({
          ok: true,

          channels:
            await publicConfigurations(),
        });
      }

      const channelPath =
        url.pathname.match(
          /^\/channel-configurations\/(instagram|facebook|x)(\/test)?$/
        );

      if (
        channelPath &&
        request.method ===
          "PUT" &&
        !channelPath[2]
      ) {
        const body =
          await readJson(
            request
          );

        const configuration =
          normalizeChannelConfiguration(
            channelPath[1],
            body
          );

        const exchange =
          await exchangeAuthorizationCode(
            channelPath[1],
            configuration,
            body,
            fetchImpl ||
              globalThis.fetch
          );

        configuration.secrets =
          {
            ...configuration.secrets,
            ...exchange.secrets,
          };

        Object.assign(
          configuration,
          exchange.metadata
        );

        const envelope =
          encryptChannelSecrets(
            configuration.secrets,
            env.CHANNEL_CONFIG_ENCRYPTION_KEY
          );

        await activeRepository.upsertChannelConfiguration(
          configuration,
          envelope
        );

        await refreshConfiguredAdapters();

        const saved =
          (
            await publicConfigurations()
          ).find(
            (item) =>
              item.channel ===
              configuration.channel
          );

        return json({
          ok: true,

          channel:
            saved,

          message:
            "Channel configuration was saved. Run the provider identity test before treating it as connected.",
        });
      }

      if (
        channelPath &&
        request.method ===
          "DELETE" &&
        !channelPath[2]
      ) {
        const channel =
          normalizeChannelName(
            channelPath[1]
          );

        await activeRepository.deleteChannelConfiguration(
          channel
        );

        await refreshConfiguredAdapters();

        return json({
          ok: true,

          channel,

          status:
            "missing_configuration",
        });
      }

      if (
        channelPath &&
        request.method ===
          "POST" &&
        channelPath[2] ===
          "/test"
      ) {
        const channel =
          normalizeChannelName(
            channelPath[1]
          );

        await refreshConfiguredAdapters();

        const [result] =
          await listener.validateChannels(
            [channel]
          );

        const saved =
          (
            await publicConfigurations()
          ).find(
            (item) =>
              item.channel ===
              channel
          );

        const ok =
          result.status ===
            "connected" &&
          result.credentialValidation ===
            "pass";

        return json(
          {
            ok,

            message: ok
              ? "Provider identity validation succeeded."
              : result.reason,

            result,

            channel:
              saved,
          },

          ok
            ? 200
            : 424
        );
      }

      /*
      |--------------------------------------------------------------------------
      | STATUS
      |--------------------------------------------------------------------------
      */

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/status"
      ) {
        return json({
          ok: true,

          channels:
            await listener.getStatuses(),
        });
      }

      /*
      |--------------------------------------------------------------------------
      | BUFFER CAMPAIGNS
      |--------------------------------------------------------------------------
      */

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/buffer/channels"
      ) {
        try {
          return json({
            ok: true,

            ...(await activeBufferCampaignService.getChannels()),
          });
        } catch (error) {
          return json(
            {
              ok: false,

              connection:
                activeBufferCampaignService.configurationStatus(),

              channels: [],

              error:
                safeMessage(error),
            },

            Number.isInteger(error?.statusCode)
              ? error.statusCode
              : 502
          );
        }
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/buffer/campaigns"
      ) {
        return json({
          ok: true,

          campaigns:
            await activeBufferCampaignService.getCampaigns(),
        });
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/buffer/campaigns"
      ) {
        try {
          const result =
            await activeBufferCampaignService.scheduleCampaign(
              await readJson(
                request
              )
            );

          return json(
            result,

            result.statusCode
          );
        } catch (error) {
          return json(
            {
              ok: false,

              error:
                safeMessage(error),
            },

            Number.isInteger(error?.statusCode)
              ? error.statusCode
              : 500
          );
        }
      }

      if (
        request.method ===
          "PUT" &&
        url.pathname ===
          "/buffer/campaigns"
      ) {
        try {
          const body =
            await readJson(
              request
            );

          const result =
            await activeBufferCampaignService.updateCampaign(
              body.campaignId,
              body
            );

          return json(
            result,

            result.statusCode
          );
        } catch (error) {
          return json(
            {
              ok: false,

              error:
                safeMessage(error),
            },

            Number.isInteger(error?.statusCode)
              ? error.statusCode
              : 500
          );
        }
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/buffer/posts/status"
      ) {
        return json({
          ok: true,

          posts:
            await activeRepository.getCampaignPosts({
              campaignId:
                url.searchParams.get(
                  "campaignId"
                ) || null,
            }),
        });
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/buffer/posts/sync"
      ) {
        try {
          const body =
            await readJson(
              request
            );

          const result =
            await activeBufferCampaignService.syncPosts({
              campaignId:
                body.campaignId ||
                null,
            });

          return json(
            result,

            result.ok
              ? 200
              : 207
          );
        } catch (error) {
          return json(
            {
              ok: false,

              error:
                safeMessage(error),
            },

            Number.isInteger(error?.statusCode)
              ? error.statusCode
              : 502
          );
        }
      }

      /*
      |--------------------------------------------------------------------------
      | CRM REPORTS
      |--------------------------------------------------------------------------
      */

      const reportName =
        REPORT_PATHS.get(
          url.pathname
        );

      if (
        request.method ===
          "GET" &&
        reportName
      ) {
        if (
          typeof activeRepository.getReport !==
            "function"
        ) {
          return json(
            {
              error:
                "CRM reporting storage is unavailable.",
            },
            503
          );
        }

        const scoreBand =
          cleanLeadValue(
            url.searchParams.get(
              "scoreBand"
            ),
            20
          )?.toUpperCase() || null;

        if (
          scoreBand &&
          ![
            "COLD",
            "WARM",
            "QUALIFIED",
            "HOT",
          ].includes(
            scoreBand
          )
        ) {
          return json(
            {
              error:
                "Score band must be COLD, WARM, QUALIFIED, or HOT.",
            },
            400
          );
        }

        const platform =
          cleanLeadValue(
            url.searchParams.get(
              "platform"
            ),
            32
          )?.toLowerCase() || null;

        if (
          platform &&
          !SOCIAL_CHANNELS.includes(
            platform
          )
        ) {
          return json(
            {
              error:
                "Platform must be instagram, facebook, or x.",
            },
            400
          );
        }

        const minScore =
          optionalBoundedInteger(
            url.searchParams.get(
              "minScore"
            ),
            "Minimum score",
            {
              min: 0,
              max: 100,
            }
          );

        const maxScore =
          optionalBoundedInteger(
            url.searchParams.get(
              "maxScore"
            ),
            "Maximum score",
            {
              min: 0,
              max: 100,
            }
          );

        if (
          minScore !== null &&
          maxScore !== null &&
          minScore > maxScore
        ) {
          return json(
            {
              error:
                "Minimum score cannot exceed maximum score.",
            },
            400
          );
        }

        const startDate =
          optionalDate(
            url.searchParams.get(
              "startDate"
            ),
            "Report start date"
          );

        const endDate =
          optionalDate(
            url.searchParams.get(
              "endDate"
            ),
            "Report end date"
          );

        if (
          startDate &&
          endDate &&
          new Date(startDate) >
            new Date(endDate)
        ) {
          return json(
            {
              error:
                "Report start date cannot be after the end date.",
            },
            400
          );
        }

        const requestedSort =
          cleanLeadValue(
            url.searchParams.get(
              "sort"
            ),
            40
          );

        if (
          requestedSort &&
          !REPORT_SORTS.has(
            requestedSort
          )
        ) {
          return json(
            {
              error:
                "The requested report sort is invalid.",
            },
            400
          );
        }

        const filters = {
          scoreBand,
          minScore,
          maxScore,
          intent:
            cleanLeadValue(
              url.searchParams.get(
                "intent"
              ),
              64
            ),
          platform,
          source:
            cleanLeadValue(
              url.searchParams.get(
                "source"
              ),
              100
            ),
          campaignId:
            url.searchParams.has(
              "campaignId"
            )
              ? optionalCrmEntityId(
                  url.searchParams.get(
                    "campaignId"
                  ),
                  "Campaign ID"
                )
              : null,
          startDate,
          endDate,
          search:
            cleanLeadValue(
              url.searchParams.get(
                "search"
              ),
              255
            ),
          sort:
            requestedSort ||
            REPORT_DEFAULT_SORTS[
              reportName
            ],
          page:
            boundedInteger(
              url.searchParams.get(
                "page"
              ),
              "Report page",
              {
                min: 1,
                max: 1_000_000,
                fallback: 1,
              }
            ),
          pageSize:
            boundedInteger(
              url.searchParams.get(
                "pageSize"
              ),
              "Report page size",
              {
                min: 1,
                max: 500,
                fallback: 25,
              }
            ),
        };

        return json({
          ok: true,
          report:
            reportName,
          ...await activeRepository.getReport(
            reportName,
            filters
          ),
        });
      }

      /*
      |--------------------------------------------------------------------------
      | CAMPAIGN AUTOMATION
      |--------------------------------------------------------------------------
      */

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/campaign-automation"
      ) {
        return json({
          ok: true,

          campaigns:
            await activeRepository.getCampaignAutomation(),
        });
      }

      if (
        request.method ===
          "PUT" &&
        url.pathname ===
          "/campaign-automation"
      ) {
        const body =
          await readJson(
            request
          );

        const campaignId =
          optionalId(
            body.id ||
              body.campaignId
          );

        if (!campaignId) {
          return json(
            {
              error:
                "A campaign ID is required.",
            },

            400
          );
        }

        const input =
          normalizeContentInput({
            entity:
              "campaign",

            name:
              body.name ||
              "Campaign automation",

            platform:
              body.platform,

            audience:
              body.audience ||
              "Configured campaign audience",

            message:
              body.message ||
              "Configured campaign message",

            budget:
              body.budget || 0,

            status:
              body.status ||
              "draft",

            ...body,

            id:
              campaignId,
          });

        const record =
          await activeRepository.saveCampaignAutomation(
            input
          );

        return record
          ? json({
              ok: true,
              record,
            })
          : json(
              {
                error:
                  "Campaign not found.",
              },

              404
            );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/campaign-automation/action"
      ) {
        const body =
          await readJson(
            request
          );

        const action =
          String(
            body.action || ""
          ).toLowerCase();

        if (
          !new Set([
            "start",
            "pause",
            "resume",
            "stop",
          ]).has(action)
        ) {
          return json(
            {
              error:
                "Action must be start, pause, resume, or stop.",
            },

            400
          );
        }

        const record =
          await activeRepository.setCampaignAutomationStatus(
            requiredValue(
              body.id ||
                body.campaignId,

              "Campaign ID",

              100
            ),

            action
          );

        return record
          ? json({
              ok: true,
              record,
            })
          : json(
              {
                error:
                  "Campaign automation was not found.",
              },

              404
            );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/campaign-automation/run-due"
      ) {
        return json({
          ok: true,

          result:
            await automationEngine.tick(),
        });
      }

      /*
      |--------------------------------------------------------------------------
      | SCORING
      |--------------------------------------------------------------------------
      */

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/scoring"
      ) {
        return json({
          ok: true,

          ...(await activeRepository.getScoringConfiguration()),
        });
      }

      if (
        request.method ===
          "PUT" &&
        url.pathname ===
          "/scoring"
      ) {
        const configuration =
          normalizeScoringConfiguration(
            await readJson(
              request
            )
          );

        return json({
          ok: true,

          ...(await activeRepository.saveScoringConfiguration(
            configuration
          )),
        });
      }

      /*
      |--------------------------------------------------------------------------
      | CONTENT
      |--------------------------------------------------------------------------
      */

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/content"
      ) {
        return json({
          ok: true,

          ...(await activeRepository.getContent()),
        });
      }

      if (
        (
          request.method ===
            "POST" ||
          request.method ===
            "PUT"
        ) &&
        url.pathname ===
          "/content"
      ) {
        const input =
          normalizeContentInput(
            await readJson(
              request
            )
          );

        if (
          request.method ===
            "PUT" &&
          !input.id
        ) {
          return json(
            {
              error:
                "A record ID is required when updating content.",
            },

            400
          );
        }

        if (
          request.method ===
            "POST" &&
          input.id
        ) {
          return json(
            {
              error:
                "New content must not include an existing record ID.",
            },

            400
          );
        }

        if (
          request.method ===
            "POST" &&
          input.entity ===
            "campaign" &&
          input.status ===
            "production"
        ) {
          return json(
            {
              error:
                "Campaigns must be created outside production, then promoted through the readiness gate.",
            },

            400
          );
        }

        let record =
          input.entity ===
          "campaign"
            ? await activeRepository.saveCampaign(
                input
              )
            : input.entity ===
              "landing_page"
            ? await activeRepository.saveLandingPage(
                input
              )
            : await activeRepository.saveWebinar(
                input
              );

        if (!record) {
          return json(
            {
              error:
                "Content record not found.",
            },

            404
          );
        }

        if (
          input.entity ===
            "campaign" &&
          typeof activeRepository.saveCampaignAutomation ===
            "function"
        ) {
          const automation =
            await activeRepository.saveCampaignAutomation(
              {
                ...input,
                id: record.id,
              }
            );

          record =
            automation
              ? {
                  ...record,
                  ...automation,
                  id: record.id,
                }
              : record;
        }

        return json(
          {
            ok: true,
            record,
          },

          request.method ===
            "POST"
            ? 201
            : 200
        );
      }

      if (
        request.method ===
          "DELETE" &&
        url.pathname ===
          "/content"
      ) {
        const body =
          await readJson(
            request
          );

        const entity =
          requiredValue(
            body.entity,
            "Entity",
            64
          ).toLowerCase();

        const deleted =
          await activeRepository.deleteContent(
            entity,

            requiredValue(
              body.id,
              "Record ID",
              100
            )
          );

        return deleted
          ? json({
              ok: true,
              deleted: true,
            })
          : json(
              {
                error:
                  "Content record not found.",
              },

              404
            );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/content/campaign-mode"
      ) {
        const body =
          await readJson(
            request
          );

        const mode =
          String(
            body.mode || ""
          ).toLowerCase();

        if (
          !CAMPAIGN_MODES.has(
            mode
          )
        ) {
          return json(
            {
              error:
                "A supported campaign mode is required.",
            },

            400
          );
        }

        const record =
          await activeRepository.setCampaignMode(
            requiredValue(
              body.id,
              "Campaign ID",
              100
            ),

            mode
          );

        return record
          ? json({
              ok: true,
              record,
            })
          : json(
              {
                error:
                  "Campaign not found.",
              },

              404
            );
      }

      /*
      |--------------------------------------------------------------------------
      | ROUTINE LEADS
      |--------------------------------------------------------------------------
      */

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/routine-leads"
      ) {
        const lead =
          normalizeRoutineLead(
            await readJson(
              request
            )
          );

        const result =
          await activeRepository.upsertRoutineLead(
            lead
          );

        return json(
          {
            ok: true,

            ...result,
          },

          result?.duplicate
            ? 200
            : 201
        );
      }

      /*
      |--------------------------------------------------------------------------
      | AI DRAFTS
      |--------------------------------------------------------------------------
      */

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/ai/drafts"
      ) {
        const body =
          await readJson(
            request
          );

        const entity =
          String(
            body.entity || ""
          ).toLowerCase();

        const brief =
          requiredValue(
            body.brief,
            "AI brief",
            12_000
          );

        const generated =
          await generateAiDraft(
            {
              entity,
              brief,
            },

            {
              env,
              fetchImpl,
            }
          );

        const input =
          normalizeContentInput({
            entity,

            ...generated.draft,

            status:
              "draft",

            createdByAi:
              true,
          });

        let record =
          entity ===
          "campaign"
            ? await activeRepository.saveCampaign(
                input
              )
            : entity ===
              "landing_page"
            ? await activeRepository.saveLandingPage(
                input
              )
            : await activeRepository.saveWebinar(
                input
              );

        if (
          entity ===
            "campaign" &&
          typeof activeRepository.saveCampaignAutomation ===
            "function"
        ) {
          const automation =
            await activeRepository.saveCampaignAutomation(
              {
                ...input,
                id: record.id,
              }
            );

          record =
            automation
              ? {
                  ...record,
                  ...automation,
                  id: record.id,
                }
              : record;
        }

        return json(
          {
            ok: true,

            record,

            generated: {
              model:
                generated.model,

              responseId:
                generated.responseId,
            },

            message:
              "The validated AI draft was saved to SQL and is ready for human review.",
          },

          201
        );
      }

      /*
      |--------------------------------------------------------------------------
      | LEADS
      |--------------------------------------------------------------------------
      */

      const leadReplySuggestionPath = url.pathname.match(/^\/leads\/(\d+)\/replies\/ai-suggestion$/);
      if (request.method === "POST" && leadReplySuggestionPath) {
        if (!activeAuthService) return json({ error: "Authentication storage is unavailable." }, 503);
        const user = await activeAuthService.authenticate(sessionToken);
        const body = await readJson(request);
        const targetId = optionalPositiveId(body.inReplyToInteractionId ?? body.interactionId, "InReplyToInteractionId");
        if (!targetId) return json({ error: "InReplyToInteractionId is required." }, 400);
        const unified = await activeRepository.getUnifiedLead(Number(leadReplySuggestionPath[1]));
        if (!unified) return json({ error: "Social lead not found." }, 404);
        const target = (unified.interactions || []).find((item) =>
          Number(String(item.id).replace(/^[^:]+:/, "")) === targetId);
        if (!target || target.platform !== "instagram" || String(target.direction).toUpperCase() !== "INBOUND" ||
            !["COMMENT", "DM", "DIRECT_MESSAGE", "STORY_REPLY"].includes(target.interactionType)) {
          return json({ error: "The AI reply target must be an inbound Instagram comment or DM for this lead." }, 404);
        }
        const generated = await generateLeadReplySuggestion(
          { target, interactions: unified.interactions || [] },
          { env, fetchImpl },
        );
        return json({
          ok: true,
          suggestion: generated.suggestion,
          responseMode: "AI_ASSISTED",
          targetInteractionId: targetId,
          generated: { model: generated.model, responseId: generated.responseId },
          reviewedBy: user.username,
        });
      }

      const automaticLeadReplyPath = url.pathname.match(/^\/leads\/(\d+)\/replies\/automatic$/);
      if (request.method === "POST" && automaticLeadReplyPath) {
        if (typeof activeRepository.createLeadReply !== "function") {
          return json({ error: "Instagram reply delivery is unavailable." }, 503);
        }
        try {
          const input = normalizeLeadReplyInput(await readJson(request), { automatic: true });
          const reply = await activeRepository.createLeadReply({
            ...input,
            leadId: Number(automaticLeadReplyPath[1]),
          });
          return json({
            ok: true,
            replyId: Number(String(reply?.id || "").replace(/^[^:]+:/, "")),
            reply,
          }, reply?.duplicate ? 200 : 202);
        } catch (error) {
          throwMappedReplyError(error);
        }
      }

      const leadReplyPath = url.pathname.match(/^\/leads\/(\d+)\/replies$/);
      if (request.method === "POST" && leadReplyPath) {
        if (!activeAuthService) return json({ error: "Authentication storage is unavailable." }, 503);
        if (typeof activeRepository.createLeadReply !== "function") {
          return json({ error: "Instagram reply delivery is unavailable." }, 503);
        }
        const user = await activeAuthService.authenticate(sessionToken);
        try {
          const input = normalizeLeadReplyInput(await readJson(request), { user });
          const reply = await activeRepository.createLeadReply({
            ...input,
            leadId: Number(leadReplyPath[1]),
          });
          return json({
            ok: true,
            replyId: Number(String(reply?.id || "").replace(/^[^:]+:/, "")),
            reply,
          }, reply?.duplicate ? 200 : 202);
        } catch (error) {
          throwMappedReplyError(error);
        }
      }

      if (request.method === "POST" && url.pathname === "/reply-requests/claim") {
        if (typeof activeRepository.claimLeadReplies !== "function") {
          return json({ error: "Instagram reply delivery is unavailable." }, 503);
        }
        const body = await readJson(request);
        const replyId = optionalPositiveId(body.replyId, "ReplyId");
        const limit = body.limit === undefined ? 10 : Number(body.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
          return json({ error: "Limit must be an integer between 1 and 50." }, 400);
        }
        const lockToken = randomUUID();
        const replies = await activeRepository.claimLeadReplies({
          now: new Date().toISOString(),
          limit,
          lockToken,
          replyId,
        });
        return json({ ok: true, lockToken, replies });
      }

      const replyCompletionPath = url.pathname.match(/^\/reply-requests\/(\d+)\/complete$/);
      if (request.method === "POST" && replyCompletionPath) {
        if (typeof activeRepository.completeLeadReply !== "function") {
          return json({ error: "Instagram reply delivery is unavailable." }, 503);
        }
        try {
          const reply = await activeRepository.completeLeadReply(
            Number(replyCompletionPath[1]),
            normalizeLeadReplyCompletion(await readJson(request)),
          );
          return reply
            ? json({ ok: true, reply })
            : json({ error: "Reply request not found." }, 404);
        } catch (error) {
          throwMappedReplyError(error);
        }
      }

      if (
        request.method === "POST" &&
        url.pathname === "/lead-interactions"
      ) {
        const event = normalizeLeadInteractionInput(await readJson(request));
        const result = await listener.processNormalizedEvent(event, { ensureLead: true });
        return json({ ok: true, ...interactionApiResult(result) }, result.interactionInserted ? 201 : 200);
      }

      const leadIntentPath = url.pathname.match(/^\/leads\/(\d+)\/intent$/);
      if (request.method === "POST" && leadIntentPath) {
        if (typeof activeRepository.updateLeadInteractionIntent !== "function") {
          return json({ error: "Lead intent updates are unavailable." }, 503);
        }
        const classification = normalizeLeadIntentInput(await readJson(request));
        const updated = await activeRepository.updateLeadInteractionIntent(
          Number(leadIntentPath[1]),
          classification.interactionId,
          classification,
        );
        return updated
          ? json({
              ok: true,
              ...updated,
              leadId: publicNumericId(updated.leadId),
              interactionId: publicNumericId(updated.interactionId),
              scoreReason: updated.scoreReason || updated.reason || "",
            })
          : json({ error: "Lead interaction not found for the supplied lead." }, 404);
      }

      const leadInteractionsPath = url.pathname.match(/^\/leads\/(\d+)\/interactions$/);
      if (request.method === "GET" && leadInteractionsPath) {
        const leadId = Number(leadInteractionsPath[1]);
        const unified = await activeRepository.getUnifiedLead(leadId);
        return unified
          ? json({ ok: true, leadId, interactions: unified.interactions || [] })
          : json({ error: "Social lead not found." }, 404);
      }

      const leadDetailPath = url.pathname.match(/^\/leads\/(\d+)$/);
      if (request.method === "GET" && leadDetailPath) {
        const lead = await activeRepository.getUnifiedLead(Number(leadDetailPath[1]));
        return lead
          ? json({ ok: true, ...lead })
          : json({ error: "Social lead not found." }, 404);
      }

      const leadScorePath = url.pathname.match(/^\/leads\/(\d+)\/score$/);
      if (request.method === "POST" && leadScorePath) {
        if (typeof activeRepository.rescoreLead !== "function") {
          return json({ error: "Lead scoring is unavailable." }, 503);
        }
        const scoring = await activeRepository.rescoreLead(Number(leadScorePath[1]));
        return scoring
          ? json({ ok: true, ...scoring })
          : json({ error: "Social lead not found." }, 404);
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/leads"
      ) {
        const limit =
          Number(
            url.searchParams.get(
              "limit"
            ) || 100
          );

        return json({
          ok: true,

          leads:
            await activeRepository.getLeads(
              limit
            ),
        });
      }

      const unifiedLeadPath =
        url.pathname.match(
          /^\/leads\/(\d+)\/unified$/
        );

      if (
        request.method ===
          "GET" &&
        unifiedLeadPath
      ) {
        const lead =
          await activeRepository.getUnifiedLead(
            Number(
              unifiedLeadPath[1]
            )
          );

        return lead
          ? json({
              ok: true,
              ...lead,
            })
          : json(
              {
                error:
                  "Social lead not found.",
              },

              404
            );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/leads"
      ) {
        const body =
          await readJson(
            request
          );

        const lead =
          await activeRepository.createLead(
            normalizeLeadInput(
              body
            )
          );

        return json(
          {
            ok: true,
            lead,
          },

          201
        );
      }

      if (
        request.method ===
          "PUT" &&
        url.pathname ===
          "/leads"
      ) {
        const body =
          await readJson(
            request
          );

        const leadId =
          Number(
            body.leadId
          );

        if (
          !Number.isInteger(
            leadId
          ) ||
          leadId < 1
        ) {
          return json(
            {
              error:
                "A valid social lead is required.",
            },

            400
          );
        }

        const lead =
          await activeRepository.updateLead(
            leadId,

            normalizeLeadInput(
              body
            )
          );

        return lead
          ? json({
              ok: true,
              lead,
            })
          : json(
              {
                error:
                  "Social lead not found.",
              },

              404
            );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/leads/status"
      ) {
        const body =
          await readJson(
            request
          );

        const leadId =
          Number(
            body.leadId
          );

        const status =
          typeof body.status ===
          "string"
            ? body.status.trim()
            : "";

        if (
          !Number.isInteger(
            leadId
          ) ||
          leadId < 1 ||
          !LEAD_STATUSES.has(
            status
          )
        ) {
          return json(
            {
              error:
                "A valid social lead and status are required.",
            },

            400
          );
        }

        const lead =
          await activeRepository.updateLeadStatus(
            leadId,
            status
          );

        return lead
          ? json({
              ok: true,
              lead,
            })
          : json(
              {
                error:
                  "Social lead not found.",
              },

              404
            );
      }

      if (
        request.method ===
          "DELETE" &&
        url.pathname ===
          "/leads"
      ) {
        const body =
          await readJson(
            request
          );

        const leadId =
          Number(
            String(
              body.id ||
                body.leadId ||
                ""
            ).replace(
              /^social:/,
              ""
            )
          );

        if (
          !Number.isInteger(
            leadId
          ) ||
          leadId < 1
        ) {
          return json(
            {
              error:
                "A valid social lead is required.",
            },

            400
          );
        }

        const deleted =
          await activeRepository.deleteLead(
            leadId
          );

        return deleted
          ? json({
              ok: true,
              deleted: true,
            })
          : json(
              {
                error:
                  "Social lead not found.",
              },

              404
            );
      }

      /*
      |--------------------------------------------------------------------------
      | CONNECTION VALIDATION
      |--------------------------------------------------------------------------
      */

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/connections/validate"
      ) {
        const body =
          await readJson(
            request
          );

        const channels =
          normalizeRequestedChannels(
            body.channels
          );

        if (
          !channels.length
        ) {
          return json(
            {
              error:
                "No supported social channels were requested.",
            },

            400
          );
        }

        const results =
          await listener.validateChannels(
            channels
          );

        const verification =
          results.map(
            (result) => ({
              ...result,

              listenerTest:
                "skipped",

              metricsTest:
                "skipped",
            })
          );

        const ok =
          verification.every(
            (result) =>
              result.status ===
              "connected"
          );

        return json(
          {
            ok,

            message: ok
              ? "Every requested provider identity check succeeded."
              : "One or more provider identity checks did not succeed.",

            channels:
              verification,
          },

          ok
            ? 200
            : 424
        );
      }

      /*
      |--------------------------------------------------------------------------
      | SOCIAL SYNC
      |--------------------------------------------------------------------------
      */

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/sync"
      ) {
        const body =
          await readJson(
            request
          );

        const channels =
          normalizeRequestedChannels(
            body.channels
          );

        const results =
          await listener.poll(
            channels,
            body.options || {}
          );

        return json({
          ok:
            results.every(
              (result) =>
                result.errors === 0
            ),

          channels:
            results,
        });
      }

      /*
      |--------------------------------------------------------------------------
      | SOCIAL METRICS
      |--------------------------------------------------------------------------
      */

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/metrics"
      ) {
        const body =
          await readJson(
            request
          );

        const channels =
          normalizeRequestedChannels(
            body.channels
          );

        const results =
          await listener.collectMetrics(
            channels
          );

        return json({
          ok:
            results.every(
              (result) =>
                result.metricsTest ===
                "pass"
            ),

          channels:
            results,
        });
      }

      return json(
        {
          error:
            "Not found.",
        },

        404
      );
    } catch (error) {
      logger.error(
        JSON.stringify({
          component:
            "social_listener",

          operation:
            `${request.method} ${url.pathname}`,

          status:
            "error",

          error:
            safeMessage(
              error
            ),
        })
      );

      const status =
        Number.isInteger(
          error?.statusCode
        )
          ? error.statusCode
          : 500;

      return json(
        {
          error:
            status < 500
              ? safeMessage(
                  error
                )
              : "The Social Listener request could not be completed.",
        },

        status
      );
    }
  }

  return {
    handle,

    listener,

    automationEngine,

    bufferCampaignService:
      activeBufferCampaignService,

    authService:
      activeAuthService,

    close: () =>
      ownsRepository
        ? activeRepository.close()
        : Promise.resolve(),
  };
}

/*
|--------------------------------------------------------------------------
| CONVERT EXPRESS/NODE REQUEST TO WEB REQUEST
|--------------------------------------------------------------------------
*/

async function toRequest(
  request
) {
  const chunks = [];

  for await (
    const chunk
    of request
  ) {
    chunks.push(chunk);
  }

  const body =
    chunks.length
      ? Buffer.concat(
          chunks
        )
      : undefined;

  return new Request(
    `http://${
      request.headers.host ||
      "localhost"
    }${
      request.url || "/"
    }`,
    {
      method:
        request.method,

      headers:
        request.headers,

      body:
        [
          "GET",
          "HEAD",
        ].includes(
          request.method ||
            "GET"
        )
          ? undefined
          : body,
    }
  );
}

/*
|--------------------------------------------------------------------------
| START EXPRESS SERVER
|--------------------------------------------------------------------------
*/

async function start() {
  /*
  |--------------------------------------------------------------------------
  | CREATE EXISTING CRM/SOCIAL LISTENER
  |--------------------------------------------------------------------------
  */

  const socialListenerApp =
    await createSocialListenerApp();

  registerCampaignMediaExpressRoutes(app, {
    env: process.env,
  });

  const automationIntervalMs =
    Math.max(
      5_000,

      Number(
        process.env
          .CAMPAIGN_AUTOMATION_INTERVAL_MS
      ) || 60_000
    );

  /*
  |--------------------------------------------------------------------------
  | SEND ALL OTHER REQUESTS TO EXISTING CRM HANDLER
  |--------------------------------------------------------------------------
  |
  | GET / is handled by Express above.
  |
  | Everything else such as:
  |
  | /health
  | /leads
  | /content
  | /campaign-automation
  | /webhooks/meta
  | /reports/leads/scoring
  | etc.
  |
  | continues through the existing social listener.
  |
  */

  app.use(
    async (
      request,
      response
    ) => {
      try {
        const result =
          await socialListenerApp.handle(
            await toRequest(
              request
            )
          );

        response.status(
          result.status
        );

        for (
          const [
            name,
            value,
          ]
          of result.headers
        ) {
          response.setHeader(
            name,
            value
          );
        }

        response.send(
          Buffer.from(
            await result.arrayBuffer()
          )
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            component:
              "social_listener",

            operation:
              `${request.method} ${request.url}`,

            status:
              "error",

            error:
              safeMessage(
                error
              ),
          })
        );

        if (
          !response.headersSent
        ) {
          response
            .status(500)
            .json({
              error:
                "The Social Listener request could not be completed.",
            });
        }
      }
    }
  );

  /*
  |--------------------------------------------------------------------------
  | START LISTENING
  |--------------------------------------------------------------------------
  */

  const server =
    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `Server running on port ${PORT}`
        );
      }
    );

  /*
  |--------------------------------------------------------------------------
  | CAMPAIGN AUTOMATION TIMER
  |--------------------------------------------------------------------------
  */

  const automationTimer =
    setInterval(
      () => {
        socialListenerApp.automationEngine
          .tick()
          .catch(
            (error) => {
              console.error(
                JSON.stringify({
                  component:
                    "social_listener",

                  operation:
                    "campaign_automation_tick",

                  status:
                    "error",

                  error:
                    safeMessage(
                      error
                    ),
                })
              );
            }
          );
      },

      automationIntervalMs
    );

  automationTimer.unref();

  /*
  |--------------------------------------------------------------------------
  | SERVER CLOSE CLEANUP
  |--------------------------------------------------------------------------
  */

  server.on(
    "close",
    () => {
      clearInterval(
        automationTimer
      );

      socialListenerApp
        .close()
        .catch(() => {});
    }
  );
}

/*
|--------------------------------------------------------------------------
| RUN SERVER WHEN THIS FILE IS EXECUTED DIRECTLY
|--------------------------------------------------------------------------
*/

if (
  process.argv[1] &&
  import.meta.url ===
    pathToFileURL(
      process.argv[1]
    ).href
) {
  start().catch(
    (error) => {
      console.error(
        JSON.stringify({
          component:
            "social_listener",

          operation:
            "startup",

          status:
            "error",

          error:
            safeMessage(
              error
            ),
        })
      );

      process.exitCode = 1;
    }
  );
}
