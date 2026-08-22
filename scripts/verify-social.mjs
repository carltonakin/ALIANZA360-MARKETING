import { SOCIAL_CHANNELS, createAdaptersFromEnv } from "../social/core.mjs";

const silentLogger = { info() {}, error() {}, log() {} };
const adapters = createAdaptersFromEnv(process.env, { logger: silentLogger });
const runReadSmoke = process.env.RUN_SOCIAL_LISTENER_SMOKE === "true";
const verification = {};

function missingEnvironment(channel) {
  if (channel === "instagram") {
    return ["META_ACCESS_TOKEN", "INSTAGRAM_ACCOUNT_ID"].filter((name) => !process.env[name]);
  }
  if (channel === "facebook") {
    return [
      ...(!process.env.META_ACCESS_TOKEN && !process.env.FACEBOOK_ACCESS_TOKEN
        ? ["META_ACCESS_TOKEN or FACEBOOK_ACCESS_TOKEN"]
        : []),
      ...(!process.env.FACEBOOK_PAGE_ID ? ["FACEBOOK_PAGE_ID"] : []),
    ];
  }
  return !process.env.X_BEARER_TOKEN ? ["X_BEARER_TOKEN"] : [];
}

for (const channel of SOCIAL_CHANNELS) {
  const adapter = adapters[channel];
  const configuration = adapter.validateConfiguration();
  if (!configuration.configured) {
    const missing = missingEnvironment(channel);
    verification[channel] = {
      configured: false,
      credentialValidation: "skipped",
      listenerTest: "skipped",
      metricsTest: "skipped",
      status: "missing_configuration",
      reason: `Missing ${missing.join(", ")}.`,
    };
    continue;
  }

  const credential = await adapter.healthCheck();
  const result = {
    configured: true,
    credentialValidation: credential.credentialValidation,
    listenerTest: "skipped",
    metricsTest: "skipped",
    status: credential.status,
    reason: credential.reason,
  };

  if (credential.status === "connected" && runReadSmoke) {
    try {
      await adapter.fetchEvents();
      result.listenerTest = "pass";
    } catch (error) {
      result.listenerTest = "fail";
      result.status = error?.state || "error";
      result.reason = error instanceof Error ? error.message : "Listener read failed.";
    }
    try {
      await adapter.getMetrics();
      result.metricsTest = "pass";
    } catch (error) {
      result.metricsTest = "fail";
      result.status = error?.state || "degraded";
      result.reason = error instanceof Error ? error.message : "Metrics read failed.";
    }
  } else if (credential.status === "connected") {
    result.reason = `${credential.reason} Set RUN_SOCIAL_LISTENER_SMOKE=true to test listener reads and metrics.`;
  }

  verification[channel] = result;
}

console.log(JSON.stringify(verification, null, 2));
