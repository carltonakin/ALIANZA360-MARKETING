import assert from "node:assert/strict";
import test from "node:test";
import { createAdaptersFromEnv } from "../social/core.mjs";

const silentLogger = { info() {}, error() {}, log() {} };
const adapters = createAdaptersFromEnv(process.env, { logger: silentLogger });

function missing(...names) {
  return names.filter((name) => !process.env[name]);
}

const instagramMissing = missing("META_ACCESS_TOKEN", "INSTAGRAM_ACCOUNT_ID");
test("real Instagram identity connectivity", {
  skip: instagramMissing.length ? `Missing ${instagramMissing.join(", ")}.` : false,
}, async () => {
  const result = await adapters.instagram.healthCheck();
  assert.equal(result.status, "connected", result.reason);
  assert.equal(result.credentialValidation, "pass");
});

const facebookMissing = [
  ...(!process.env.META_ACCESS_TOKEN && !process.env.FACEBOOK_ACCESS_TOKEN
    ? ["META_ACCESS_TOKEN or FACEBOOK_ACCESS_TOKEN"]
    : []),
  ...missing("FACEBOOK_PAGE_ID"),
];
test("real Facebook identity connectivity", {
  skip: facebookMissing.length ? `Missing ${facebookMissing.join(", ")}.` : false,
}, async () => {
  const result = await adapters.facebook.healthCheck();
  assert.equal(result.status, "connected", result.reason);
  assert.equal(result.credentialValidation, "pass");
});

const xMissing = missing("X_BEARER_TOKEN");
test("real X identity connectivity", {
  skip: xMissing.length ? `Missing ${xMissing.join(", ")}.` : false,
}, async () => {
  const result = await adapters.x.healthCheck();
  assert.equal(result.status, "connected", result.reason);
  assert.equal(result.credentialValidation, "pass");
});
