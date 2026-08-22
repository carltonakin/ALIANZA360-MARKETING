import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getChannelProductionReadiness,
  normalizeChannelConfiguration,
  publicChannelConfiguration,
} from "../social/channel-config.mjs";

test("dashboard backend configuration is environment-only and never browser-managed", async () => {
  const [config, route, hosting] = await Promise.all([
    readFile(new URL("../app/api/social/_config.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/social/config/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(config, /SOCIAL_LISTENER_SERVICE_URL/);
  assert.match(config, /SOCIAL_LISTENER_SERVICE_TOKEN/);
  assert.doesNotMatch(config, /AES-GCM|token_ciphertext|\.prepare\(/);
  assert.match(route, /environment variables/i);
  assert.doesNotMatch(route, /serviceToken\s*=\s*clean/);
  assert.match(hosting, /"d1": null/);
});

test("channel configuration normalizes production readiness metadata", () => {
  const configuration = normalizeChannelConfiguration("facebook", {
    enabled: true,
    environment: "production",
    pageId: "page-42",
    adAccountId: "act_42",
    appId: "app-42",
    loginMode: "facebook_login",
    tokenType: "page",
    callbackUrl: "https://crm.example.com/oauth/meta",
    requiredScopes: "pages_read_engagement pages_messaging ads_management",
    grantedScopes: "pages_read_engagement,pages_messaging,ads_management",
    permissionsValidatedAt: "2026-08-17T12:00:00Z",
    appMode: "live",
    advancedAccessStatus: "approved",
    businessVerificationStatus: "verified",
    webhookUrl: "https://crm.example.com/webhooks/meta",
    webhookSubscribedFields: "messages feed",
    webhookSubscribedAt: "2026-08-17T12:00:00Z",
    secrets: { accessToken: "secret" },
  });
  configuration.status = "connected";
  configuration.lastSuccessAt = "2026-08-17T12:05:00.000Z";
  assert.equal(configuration.adAccountId, "act_42");
  assert.equal(configuration.permissionsValidatedAt, "2026-08-17T12:00:00.000Z");
  assert.deepEqual(getChannelProductionReadiness(configuration), {
    ready: true,
    missing: [],
    missingScopes: [],
  });
});

test("public channel configuration reports missing scopes without returning secrets", () => {
  const result = publicChannelConfiguration({
    channel: "x",
    enabled: true,
    environment: "production",
    loginMode: "oauth2_pkce",
    tokenType: "bearer",
    clientId: "client-1",
    callbackUrl: "https://crm.example.com/oauth/x",
    requiredScopes: "tweet.read tweet.write offline.access",
    grantedScopes: "tweet.read",
    permissionsValidatedAt: null,
    appMode: "development",
    advancedAccessStatus: "not_required",
    businessVerificationStatus: "not_required",
    secrets: { accessToken: "never-return-this" },
  });
  assert.equal(result.secretsStored, true);
  assert.deepEqual(result.productionReadiness.missingScopes, ["tweet.write", "offline.access"]);
  assert.match(result.productionReadiness.missing.join(" "), /Grant required scopes/);
  assert.doesNotMatch(JSON.stringify(result), /never-return-this/);
});
