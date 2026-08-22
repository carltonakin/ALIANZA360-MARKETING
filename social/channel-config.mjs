import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const CHANNEL_CONFIGURATION_FIELDS = Object.freeze([
  "enabled",
  "environment",
  "accountId",
  "pageId",
  "adAccountId",
  "businessId",
  "appId",
  "clientId",
  "loginMode",
  "tokenType",
  "accessTokenExpiresAt",
  "refreshTokenExpiresAt",
  "lastTokenRefreshAt",
  "nextTokenRefreshAt",
  "webhookUrl",
  "callbackUrl",
  "scopes",
  "requiredScopes",
  "grantedScopes",
  "permissionsValidatedAt",
  "webhookSubscribedFields",
  "webhookSubscriptionId",
  "webhookSubscribedAt",
  "lastWebhookReceivedAt",
  "apiVersion",
  "appMode",
  "advancedAccessStatus",
  "businessVerificationStatus",
]);

export const CHANNEL_SECRET_FIELDS = Object.freeze([
  "accessToken",
  "refreshToken",
  "apiKey",
  "apiSecret",
  "clientSecret",
  "appSecret",
  "bearerToken",
  "verificationToken",
  "webhookSecret",
]);

const CHANNELS = new Set(["instagram", "facebook", "x"]);
const ENVIRONMENTS = new Set(["sandbox", "test", "production"]);
const LOGIN_MODES = Object.freeze({
  instagram: new Set(["facebook_login", "instagram_login"]),
  facebook: new Set(["facebook_login"]),
  x: new Set(["oauth2_pkce", "app_only"]),
});
const TOKEN_TYPES = new Set(["bearer", "user", "page", "system_user", "app"]);
const APP_MODES = new Set(["development", "live"]);
const ADVANCED_ACCESS_STATUSES = new Set(["not_requested", "pending", "approved", "rejected", "not_required"]);
const BUSINESS_VERIFICATION_STATUSES = new Set(["unverified", "pending", "verified", "rejected", "not_required"]);

function clean(value, max = 2048) {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  if (!result) return null;
  if (result.length > max) {
    const error = new Error(`A channel configuration field exceeds its ${max}-character limit.`);
    error.statusCode = 400;
    throw error;
  }
  return result;
}

function validateHttpsUrl(value, field) {
  const result = clean(value);
  if (!result) return null;
  let parsed;
  try {
    parsed = new URL(result);
  } catch {
    const error = new Error(`${field} must be a valid URL.`);
    error.statusCode = 400;
    throw error;
  }
  if (parsed.protocol !== "https:") {
    const error = new Error(`${field} must use HTTPS.`);
    error.statusCode = 400;
    throw error;
  }
  return parsed.href;
}

function normalizeChoice(value, field, choices, fallback) {
  const result = clean(value, 64) || fallback;
  if (!choices.has(result)) {
    const error = new Error(`${field} has an unsupported value.`);
    error.statusCode = 400;
    throw error;
  }
  return result;
}

function normalizeDate(value, field) {
  const result = clean(value, 64);
  if (!result) return null;
  const date = new Date(result);
  if (Number.isNaN(date.getTime())) {
    const error = new Error(`${field} must be a valid date and time.`);
    error.statusCode = 400;
    throw error;
  }
  return date.toISOString();
}

function normalizeScopes(value) {
  return Array.isArray(value)
    ? value.map((item) => clean(item, 255)).filter(Boolean).join(" ")
    : clean(value, 2000);
}

function scopeSet(value) {
  return new Set(String(value || "").split(/[\s,]+/).map((item) => item.trim().toLowerCase()).filter(Boolean));
}

export function getChannelProductionReadiness(configuration = {}) {
  const channel = normalizeChannelName(configuration.channel);
  const missing = [];
  const secretFields = new Set(Array.isArray(configuration.secretFields)
    ? configuration.secretFields
    : Object.keys(configuration.secrets || {}));
  const requiredScopes = scopeSet(configuration.requiredScopes || configuration.scopes);
  const grantedScopes = scopeSet(configuration.grantedScopes);
  const missingScopes = [...requiredScopes].filter((scope) => !grantedScopes.has(scope));

  if (!configuration.enabled) missing.push("Enable the channel");
  if (configuration.status !== "connected" || !configuration.lastSuccessAt) missing.push("Run a successful provider identity test");
  if (!configuration.loginMode) missing.push("Select a login mode");
  if (!configuration.tokenType) missing.push("Select a token type");
  if (!secretFields.has("accessToken") && !secretFields.has("bearerToken")) missing.push("Save an access token");
  if (channel === "instagram" && !configuration.accountId) missing.push("Add the Instagram professional account ID");
  if (channel === "instagram" && configuration.loginMode === "facebook_login" && !configuration.pageId) missing.push("Add the linked Facebook Page ID");
  if (channel === "facebook" && !configuration.pageId) missing.push("Add the Facebook Page ID");
  if (configuration.loginMode !== "app_only" && !configuration.callbackUrl) missing.push("Add the OAuth callback URL");
  if (configuration.loginMode !== "app_only" && !configuration.clientId && !configuration.appId) missing.push("Add the app or client ID");
  if (!requiredScopes.size) missing.push("Define required scopes");
  if (missingScopes.length) missing.push(`Grant required scopes: ${missingScopes.join(", ")}`);
  if (!configuration.permissionsValidatedAt) missing.push("Validate provider permissions");
  if (configuration.appMode !== "live") missing.push("Set the provider app to live mode");
  if (channel !== "x" && !["approved", "not_required"].includes(configuration.advancedAccessStatus)) {
    missing.push("Complete Advanced Access approval");
  }
  if (channel !== "x" && !["verified", "not_required"].includes(configuration.businessVerificationStatus)) {
    missing.push("Complete business verification");
  }
  if ([...requiredScopes].some((scope) => scope.startsWith("ads_") || scope === "leads_retrieval") && !configuration.adAccountId) {
    missing.push("Add the Meta Ad Account ID");
  }
  if (configuration.webhookUrl && !configuration.webhookSubscribedFields) missing.push("Select webhook subscription fields");
  if (configuration.webhookUrl && !configuration.webhookSubscribedAt) missing.push("Confirm the webhook subscription");
  if (configuration.accessTokenExpiresAt && new Date(configuration.accessTokenExpiresAt).getTime() <= Date.now()) {
    missing.push("Replace the expired access token");
  }

  return { ready: missing.length === 0, missing, missingScopes };
}

export function normalizeChannelName(value) {
  const channel = String(value || "").trim().toLowerCase();
  if (!CHANNELS.has(channel)) {
    const error = new Error("Channel must be instagram, facebook, or x.");
    error.statusCode = 400;
    throw error;
  }
  return channel;
}

export function normalizeChannelConfiguration(channelValue, input = {}) {
  const channel = normalizeChannelName(channelValue);
  const environment = clean(input.environment, 32) || "production";
  if (!ENVIRONMENTS.has(environment)) {
    const error = new Error("Environment must be sandbox, test, or production.");
    error.statusCode = 400;
    throw error;
  }
  const scopes = normalizeScopes(input.scopes);
  const requiredScopes = normalizeScopes(input.requiredScopes) || scopes;
  const grantedScopes = normalizeScopes(input.grantedScopes);
  const defaultLoginMode = channel === "x" ? "oauth2_pkce" : "facebook_login";
  const defaultTokenType = channel === "facebook" ? "page" : "bearer";
  const secrets = Object.fromEntries(CHANNEL_SECRET_FIELDS
    .map((field) => [field, clean(input.secrets?.[field] ?? input[field], 16_000)])
    .filter(([, value]) => Boolean(value) && value !== "********"));

  return {
    channel,
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    environment,
    accountId: clean(input.accountId, 255),
    pageId: clean(input.pageId, 255),
    adAccountId: clean(input.adAccountId, 255),
    businessId: clean(input.businessId, 255),
    appId: clean(input.appId, 255),
    clientId: clean(input.clientId, 255),
    loginMode: normalizeChoice(input.loginMode, "Login mode", LOGIN_MODES[channel], defaultLoginMode),
    tokenType: normalizeChoice(input.tokenType, "Token type", TOKEN_TYPES, defaultTokenType),
    accessTokenExpiresAt: normalizeDate(input.accessTokenExpiresAt, "Access token expiration"),
    refreshTokenExpiresAt: normalizeDate(input.refreshTokenExpiresAt, "Refresh token expiration"),
    lastTokenRefreshAt: normalizeDate(input.lastTokenRefreshAt, "Last token refresh"),
    nextTokenRefreshAt: normalizeDate(input.nextTokenRefreshAt, "Next token refresh"),
    webhookUrl: validateHttpsUrl(input.webhookUrl, "Webhook URL"),
    callbackUrl: validateHttpsUrl(input.callbackUrl, "Callback URL"),
    scopes,
    requiredScopes,
    grantedScopes,
    permissionsValidatedAt: normalizeDate(input.permissionsValidatedAt, "Permissions validation time"),
    webhookSubscribedFields: clean(input.webhookSubscribedFields, 2000),
    webhookSubscriptionId: clean(input.webhookSubscriptionId, 255),
    webhookSubscribedAt: normalizeDate(input.webhookSubscribedAt, "Webhook subscription time"),
    lastWebhookReceivedAt: normalizeDate(input.lastWebhookReceivedAt, "Last webhook receipt time"),
    apiVersion: clean(input.apiVersion, 64),
    appMode: normalizeChoice(input.appMode, "App mode", APP_MODES, "development"),
    advancedAccessStatus: normalizeChoice(
      input.advancedAccessStatus,
      "Advanced Access status",
      ADVANCED_ACCESS_STATUSES,
      channel === "x" ? "not_required" : "not_requested",
    ),
    businessVerificationStatus: normalizeChoice(
      input.businessVerificationStatus,
      "Business verification status",
      BUSINESS_VERIFICATION_STATUSES,
      channel === "x" ? "not_required" : "unverified",
    ),
    secrets,
  };
}

function encryptionKey(value) {
  let key;
  try {
    key = Buffer.from(String(value || ""), "base64");
  } catch {
    key = Buffer.alloc(0);
  }
  if (key.length !== 32) {
    const error = new Error("CHANNEL_CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
    error.statusCode = 503;
    throw error;
  }
  return key;
}

export function encryptChannelSecrets(secrets, keyValue) {
  const entries = Object.entries(secrets || {}).filter(([, value]) => Boolean(value));
  if (!entries.length) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(keyValue), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(Object.fromEntries(entries)), "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: "v1",
  };
}

export function decryptChannelSecrets(envelope, keyValue) {
  if (!envelope?.ciphertext) return {};
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(keyValue),
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const parsed = JSON.parse(plaintext);
  return Object.fromEntries(CHANNEL_SECRET_FIELDS
    .filter((field) => typeof parsed[field] === "string" && parsed[field])
    .map((field) => [field, parsed[field]]));
}

export function publicChannelConfiguration(configuration) {
  const secretFields = Array.isArray(configuration.secretFields)
    ? configuration.secretFields.filter((field) => CHANNEL_SECRET_FIELDS.includes(field))
    : Object.keys(configuration.secrets || {}).filter((field) => CHANNEL_SECRET_FIELDS.includes(field));
  const result = {};
  for (const field of CHANNEL_CONFIGURATION_FIELDS) result[field] = configuration[field] ?? null;
  const publicConfiguration = {
    channel: configuration.channel,
    ...result,
    secretsStored: secretFields.length > 0,
    secretFields,
    maskedSecrets: Object.fromEntries(secretFields.map((field) => [field, "********"])),
    status: configuration.status || "missing_configuration",
    lastTestedAt: configuration.lastTestedAt || null,
    lastSuccessAt: configuration.lastSuccessAt || null,
    lastErrorAt: configuration.lastErrorAt || null,
    lastError: configuration.lastError || null,
    updatedAt: configuration.updatedAt || null,
  };
  return {
    ...publicConfiguration,
    productionReadiness: getChannelProductionReadiness(publicConfiguration),
  };
}

export function channelConfigurationsToEnv(configurations, fallback = {}) {
  const next = { ...fallback };
  for (const config of configurations || []) {
    if (!config.enabled) continue;
    const secrets = config.secrets || {};
    if (config.channel === "instagram") {
      next.INSTAGRAM_ACCESS_TOKEN = secrets.accessToken || next.INSTAGRAM_ACCESS_TOKEN || next.META_ACCESS_TOKEN;
      next.INSTAGRAM_ACCOUNT_ID = config.accountId || next.INSTAGRAM_ACCOUNT_ID;
      next.META_APP_SECRET = secrets.appSecret || secrets.webhookSecret || next.META_APP_SECRET;
      next.META_VERIFY_TOKEN = secrets.verificationToken || next.META_VERIFY_TOKEN;
      next.INSTAGRAM_GRAPH_API_VERSION = config.apiVersion || next.INSTAGRAM_GRAPH_API_VERSION || next.META_GRAPH_API_VERSION;
      next.INSTAGRAM_GRAPH_API_BASE_URL = config.loginMode === "instagram_login"
        ? "https://graph.instagram.com"
        : next.INSTAGRAM_GRAPH_API_BASE_URL || next.META_GRAPH_API_BASE_URL;
    } else if (config.channel === "facebook") {
      next.FACEBOOK_ACCESS_TOKEN = secrets.accessToken || next.FACEBOOK_ACCESS_TOKEN;
      next.FACEBOOK_PAGE_ID = config.pageId || next.FACEBOOK_PAGE_ID;
      next.META_APP_SECRET = secrets.appSecret || secrets.webhookSecret || next.META_APP_SECRET;
      next.META_VERIFY_TOKEN = secrets.verificationToken || next.META_VERIFY_TOKEN;
      next.FACEBOOK_GRAPH_API_VERSION = config.apiVersion || next.FACEBOOK_GRAPH_API_VERSION || next.META_GRAPH_API_VERSION;
      next.FACEBOOK_GRAPH_API_BASE_URL = next.FACEBOOK_GRAPH_API_BASE_URL || next.META_GRAPH_API_BASE_URL;
    } else if (config.channel === "x") {
      next.X_BEARER_TOKEN = secrets.bearerToken || secrets.accessToken || next.X_BEARER_TOKEN;
    }
  }
  return next;
}

export async function exchangeAuthorizationCode(channelValue, configuration, input, fetchImpl = globalThis.fetch) {
  const channel = normalizeChannelName(channelValue);
  const code = clean(input.authorizationCode, 16_000);
  if (!code) return { secrets: {}, metadata: {} };
  const callbackUrl = configuration.callbackUrl;
  const clientId = configuration.clientId || configuration.appId;
  const clientSecret = configuration.secrets.clientSecret || configuration.secrets.appSecret;
  if (!callbackUrl || !clientId) {
    const error = new Error("Callback URL and client/app ID are required to exchange an authorization code.");
    error.statusCode = 400;
    throw error;
  }
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl,
  });
  let endpoint;
  const headers = { "content-type": "application/x-www-form-urlencoded" };
  if (channel === "x") {
    form.set("client_id", clientId);
    const verifier = clean(input.codeVerifier, 512);
    if (!verifier) {
      const error = new Error("X authorization-code exchange requires the one-time PKCE code verifier.");
      error.statusCode = 400;
      throw error;
    }
    form.set("code_verifier", verifier);
    if (clientSecret) headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    endpoint = "https://api.x.com/2/oauth2/token";
  } else {
    if (!clientSecret) {
      const error = new Error("Meta authorization-code exchange requires the app/client secret.");
      error.statusCode = 400;
      throw error;
    }
    form.set("client_id", clientId);
    form.set("client_secret", clientSecret);
    endpoint = channel === "instagram" && configuration.loginMode === "instagram_login"
      ? "https://api.instagram.com/oauth/access_token"
      : `https://graph.facebook.com/${configuration.apiVersion || "v23.0"}/oauth/access_token`;
  }
  const response = await fetchImpl(endpoint, { method: "POST", headers, body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const error = new Error(response.status === 401 || response.status === 403
      ? "The provider rejected the authorization code or client credentials."
      : "The provider could not exchange the authorization code.");
    error.statusCode = 424;
    throw error;
  }
  if (!payload.access_token) {
    const error = new Error("The provider authorization-code response did not include an access token.");
    error.statusCode = 424;
    throw error;
  }
  const issuedAt = new Date();
  const accessTokenExpiresAt = Number(payload.expires_in) > 0
    ? new Date(issuedAt.getTime() + (Number(payload.expires_in) * 1000))
    : null;
  const refreshTokenExpiresAt = Number(payload.refresh_token_expires_in) > 0
    ? new Date(issuedAt.getTime() + (Number(payload.refresh_token_expires_in) * 1000))
    : null;
  const refreshBuffer = accessTokenExpiresAt
    ? Math.min(24 * 60 * 60 * 1000, Math.max(5 * 60 * 1000, Number(payload.expires_in) * 100))
    : null;
  return {
    secrets: {
      accessToken: String(payload.access_token),
      ...(payload.refresh_token ? { refreshToken: String(payload.refresh_token) } : {}),
      ...(channel === "x" ? { bearerToken: String(payload.access_token) } : {}),
    },
    metadata: {
      tokenType: clean(payload.token_type, 64)?.toLowerCase() || configuration.tokenType || "bearer",
      grantedScopes: normalizeScopes(payload.scope) || configuration.grantedScopes,
      accessTokenExpiresAt: accessTokenExpiresAt?.toISOString() || configuration.accessTokenExpiresAt,
      refreshTokenExpiresAt: refreshTokenExpiresAt?.toISOString() || configuration.refreshTokenExpiresAt,
      lastTokenRefreshAt: issuedAt.toISOString(),
      nextTokenRefreshAt: accessTokenExpiresAt && refreshBuffer
        ? new Date(accessTokenExpiresAt.getTime() - refreshBuffer).toISOString()
        : configuration.nextTokenRefreshAt,
    },
  };
}
