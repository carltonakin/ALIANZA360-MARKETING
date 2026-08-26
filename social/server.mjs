import { createRequire } from "node:module";
import path from "node:path";
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
import { generateAiDraft } from "./ai.mjs";
import { CampaignAutomationEngine } from "./campaign-automation.mjs";
import { CrmSocialOrchestrator } from "./crm-orchestrator.mjs";
import {
  DEFAULT_SCORING_RULES,
  DEFAULT_TEMPERATURE_THRESHOLDS,
} from "./intelligence.mjs";
import { SqlServerRepository } from "./sql-server.mjs";
import { createSproutAdapterFromEnv } from "./sprout.mjs";
import { createBufferAdapterFromEnv } from "./buffer-adapter.mjs";
import { BufferCampaignService } from "./buffer-campaigns.mjs";
import {
  campaignMediaDirectory,
  campaignMediaMaximumBytes,
  campaignMediaPublicPath,
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
  const mediaDirectory = campaignMediaDirectory(env);
  const mediaPublicPath = campaignMediaPublicPath(env);
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
            requestUrl: `${request.protocol}://${request.get("host")}${request.originalUrl}`,
            env,
            postType: String(request.body.postType || "POST"),
            targetServices: requestedServices.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean),
          });
          logger.info?.(JSON.stringify({
            component: "campaign_media",
            operation: "express_upload",
            status: "stored",
            mediaDirectory,
            originalFileName: media.originalFileName,
            mimeType: media.mimeType,
            size: media.size,
            storedFileName: media.storedFileName,
            diskPath: path.join(mediaDirectory, media.storedFileName),
            mediaUrl: media.mediaUrl,
          }));
          response.status(201).json({
            ok: true,
            originalFileName: media.originalFileName,
            storedFileName: media.storedFileName,
            mimeType: media.mimeType,
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

  expressApp.use(
    mediaPublicPath,
    express.static(mediaDirectory, {
      index: false,
      dotfiles: "deny",
      fallthrough: false,
      immutable: true,
      maxAge: "1y",
      setHeaders(response) {
        response.setHeader("x-content-type-options", "nosniff");
        response.setHeader("content-disposition", "inline");
      },
    }),
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

    value,
  };
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
  sproutAdapter,
  bufferAdapter,
  bufferCampaignService,
  orchestrator,
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

  const activeSproutAdapter =
    sproutAdapter ||
    createSproutAdapterFromEnv(
      env,
      {
        fetchImpl,
        logger,
      }
    );

  const socialOrchestrator =
    orchestrator ||
    new CrmSocialOrchestrator({
      repository:
        activeRepository,

      listener,

      sprout:
        activeSproutAdapter,

      logger,
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
      const mediaDeleteMatch = request.method === "DELETE"
        ? url.pathname.match(/^\/api\/media\/([^/]+)$/)
        : null;
      if (mediaDeleteMatch) {
        const result = await activeBufferCampaignService.deleteMediaIfUnreferenced(
          decodeURIComponent(mediaDeleteMatch[1]),
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
      | INTEGRATIONS
      |--------------------------------------------------------------------------
      */

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/integrations"
      ) {
        const limit =
          boundedInteger(
            url.searchParams.get(
              "limit"
            ),

            "Integration event limit",

            {
              min: 1,
              max: 500,
              fallback: 100,
            }
          );

        return json({
          ok: true,

          integrations:
            socialOrchestrator.getIntegrationStatuses(),

          channels:
            await listener.getStatuses(),

          actions:
            await activeRepository.getIntegrationActions(
              {
                limit,

                campaignId:
                  url.searchParams.get(
                    "campaignId"
                  ) || null,
              }
            ),
        });
      }

      /*
      |--------------------------------------------------------------------------
      | SPROUT TEST
      |--------------------------------------------------------------------------
      */

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/integrations/sprout/test"
      ) {
        const result =
          await socialOrchestrator.testIntegration(
            "sprout"
          );

        return json(
          {
            ok:
              result.status ===
              "connected",

            integration:
              result,
          },

          result.status ===
            "connected"
            ? 200
            : 424
        );
      }

      /*
      |--------------------------------------------------------------------------
      | SPROUT SYNC
      |--------------------------------------------------------------------------
      */

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/integrations/sprout/sync"
      ) {
        const body =
          await readJson(
            request
          );

        const since =
          body.since
            ? optionalDate(
                body.since,
                "Sprout sync start"
              )
            : null;

        const result =
          await socialOrchestrator.syncSprout(
            {
              ...(since
                ? {
                    since,
                  }
                : {}),

              limit:
                boundedInteger(
                  body.limit,

                  "Sprout sync limit",

                  {
                    min: 1,
                    max: 100,
                    fallback: 50,
                  }
                ),
            }
          );

        return json({
          ok: true,

          result,
        });
      }

      /*
      |--------------------------------------------------------------------------
      | SPROUT METRICS
      |--------------------------------------------------------------------------
      */

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/integrations/sprout/metrics"
      ) {
        const body =
          await readJson(
            request
          );

        const start =
          body.start
            ? optionalDate(
                body.start,
                "Metrics start"
              )
            : null;

        const end =
          body.end
            ? optionalDate(
                body.end,
                "Metrics end"
              )
            : null;

        const metrics =
          await socialOrchestrator.collectSproutMetrics(
            {
              ...(start
                ? {
                    start,
                  }
                : {}),

              ...(end
                ? {
                    end,
                  }
                : {}),
            }
          );

        return json({
          ok: true,

          metrics,
        });
      }

      /*
      |--------------------------------------------------------------------------
      | INTEGRATION ACTIONS
      |--------------------------------------------------------------------------
      */

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/integration-actions"
      ) {
        const limit =
          boundedInteger(
            url.searchParams.get(
              "limit"
            ),

            "Integration action limit",

            {
              min: 1,
              max: 500,
              fallback: 100,
            }
          );

        return json({
          ok: true,

          actions:
            await activeRepository.getIntegrationActions(
              {
                limit,

                campaignId:
                  url.searchParams.get(
                    "campaignId"
                  ) || null,
              }
            ),
        });
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/integration-actions"
      ) {
        const body =
          await readJson(
            request
          );

        const scheduledAt =
          body.scheduledAt
            ? optionalDate(
                body.scheduledAt,
                "Scheduled delivery time"
              )
            : null;

        if (
          scheduledAt &&
          new Date(
            scheduledAt
          ).getTime() <=
            Date.now()
        ) {
          return json(
            {
              error:
                "Scheduled delivery time must be in the future.",
            },

            400
          );
        }

        const campaignId =
          body.campaignId
            ? optionalId(
                body.campaignId
              )
            : null;

        const action =
          await socialOrchestrator.queueAction(
            {
              provider:
                String(
                  body.provider ||
                    "sprout"
                ).toLowerCase(),

              actionType:
                String(
                  body.actionType ||
                    "PUBLISH_POST"
                ).toUpperCase(),

              channel:
                cleanLeadValue(
                  body.channel,
                  32
                ),

              campaignId,

              leadId:
                optionalCrmEntityId(
                  body.leadId,
                  "Lead ID"
                ),

              idempotencyKey:
                cleanLeadValue(
                  body.idempotencyKey,
                  255
                ),

              actorId:
                cleanLeadValue(
                  body.actorId,
                  255
                ) ||
                "crm-dashboard",

              maxAttempts:
                boundedInteger(
                  body.maxAttempts,

                  "Maximum attempts",

                  {
                    min: 1,
                    max: 10,
                    fallback: 4,
                  }
                ),

              payload: {
                text:
                  requiredValue(
                    body.text,

                    "Post text",

                    16_000
                  ),

                ...(scheduledAt
                  ? {
                      scheduledAt,
                    }
                  : {}),

                ...(Array.isArray(
                  body.profileIds
                )
                  ? {
                      profileIds:
                        body.profileIds
                          .map(String)
                          .slice(
                            0,
                            100
                          ),
                    }
                  : {}),

                ...(cleanLeadValue(
                  body.groupId,
                  255
                )
                  ? {
                      groupId:
                        cleanLeadValue(
                          body.groupId,
                          255
                        ),
                    }
                  : {}),

                ...(Array.isArray(
                  body.media
                )
                  ? {
                      media:
                        body.media.slice(
                          0,
                          20
                        ),
                    }
                  : {}),

                ...(Array.isArray(
                  body.tagIds
                )
                  ? {
                      tagIds:
                        body.tagIds.slice(
                          0,
                          100
                        ),
                    }
                  : {}),
              },
            }
          );

        let execution = null;

        const executeNow =
          booleanValue(
            body.executeNow,
            true
          );

        if (
          executeNow &&
          [
            "PENDING",
            "RETRY_SCHEDULED",
          ].includes(
            action.status
          )
        ) {
          execution =
            await socialOrchestrator.runDue(
              {
                limit: 1,

                actionId:
                  action.id,
              }
            );
        }

        const current =
          (
            await activeRepository.getIntegrationActions(
              {
                limit: 100,
                campaignId,
              }
            )
          ).find(
            (item) =>
              Number(item.id) ===
              Number(action.id)
          ) || action;

        return json(
          {
            ok:
              current.status ===
                "SUCCEEDED" ||
              current.status ===
                "PENDING" ||
              current.status ===
                "RETRY_SCHEDULED",

            action:
              current,

            duplicate:
              action.duplicate,

            execution,
          },

          action.duplicate
            ? 200
            : 201
        );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/integration-actions/run-due"
      ) {
        const body =
          await readJson(
            request
          );

        const result =
          await socialOrchestrator.runDue(
            {
              limit:
                boundedInteger(
                  body.limit,

                  "Integration action limit",

                  {
                    min: 1,
                    max: 100,
                    fallback: 10,
                  }
                ),

              actionId:
                body.actionId
                  ? requiredValue(
                      body.actionId,
                      "Integration action ID",
                      100
                    )
                  : null,
            }
          );

        return json({
          ok: true,

          result,
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

    socialOrchestrator,

    bufferCampaignService:
      activeBufferCampaignService,

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

  const integrationIntervalMs =
    Math.max(
      5_000,

      Number(
        process.env
          .SPROUT_ACTION_INTERVAL_MS
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
  | /integrations
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
  | SPROUT / INTEGRATION ACTION TIMER
  |--------------------------------------------------------------------------
  */

  const integrationTimer =
    setInterval(
      () => {
        socialListenerApp.socialOrchestrator
          .runDue()
          .catch(
            (error) => {
              console.error(
                JSON.stringify({
                  component:
                    "crm_social_orchestrator",

                  operation:
                    "integration_action_tick",

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

      integrationIntervalMs
    );

  integrationTimer.unref();

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

      clearInterval(
        integrationTimer
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
