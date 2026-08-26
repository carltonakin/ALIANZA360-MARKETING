import assert from "node:assert/strict";
import test from "node:test";
import { resolveProductionTopology } from "../scripts/start-production.mjs";

const databaseEnv = {
  DB_SERVER: "sql.example",
  DB_NAME: "crm360",
  DB_USER: "crm_user",
  DB_PASSWORD: "not-a-real-password",
  PUBLIC_BASE_URL: "https://crm.example.com",
  CAMPAIGN_MEDIA_PUBLIC_PATH: "/uploads/campaigns",
};

test("SmarterASP single-app mode starts an internal MSSQL listener", () => {
  const topology = resolveProductionTopology({
    ...databaseEnv,
    PORT: "43131",
    SOCIAL_LISTENER_PORT: "8788",
    SERVICE_AUTH_TOKEN: "test-service-token",
  });

  assert.equal(topology.mode, "internal");
  assert.equal(topology.dashboardEnv.PORT, "43131");
  assert.equal(topology.listenerEnv.PORT, "8788");
  assert.equal(topology.dashboardEnv.SOCIAL_LISTENER_SERVICE_URL, "http://127.0.0.1:8788");
  assert.equal(topology.dashboardEnv.SOCIAL_LISTENER_SERVICE_TOKEN, "test-service-token");
  assert.equal(topology.listenerEnv.SERVICE_AUTH_TOKEN, "test-service-token");
  assert.equal(topology.listenerEnv.DB_NAME, "crm360");
  assert.equal(topology.listenerEnv.CAMPAIGN_MEDIA_PUBLIC_PATH, "/uploads/campaigns");
});

test("a local service URL remains internal during production startup", () => {
  const topology = resolveProductionTopology({
    ...databaseEnv,
    PORT: "43131",
    SOCIAL_LISTENER_SERVICE_URL: "http://localhost:8790",
    SERVICE_AUTH_TOKEN: "test-service-token",
  });

  assert.equal(topology.mode, "internal");
  assert.equal(topology.listenerPort, 8790);
  assert.equal(topology.dashboardEnv.SOCIAL_LISTENER_SERVICE_URL, "http://127.0.0.1:8790");
});

test("an explicit external HTTPS listener remains supported", () => {
  const topology = resolveProductionTopology({
    PORT: "43131",
    PUBLIC_BASE_URL: "https://crm.example.com",
    SOCIAL_LISTENER_SERVICE_URL: "https://listener.example.com",
    SOCIAL_LISTENER_SERVICE_TOKEN: "external-test-token",
  });

  assert.equal(topology.mode, "external");
  assert.equal(topology.dashboardEnv.SOCIAL_LISTENER_SERVICE_URL, "https://listener.example.com");
  assert.equal(topology.dashboardEnv.SOCIAL_LISTENER_SERVICE_TOKEN, "external-test-token");
});

test("production cannot silently start internal mode without MSSQL configuration", () => {
  assert.throws(
    () => resolveProductionTopology({ PORT: "43131", PUBLIC_BASE_URL: "https://crm.example.com", SERVICE_AUTH_TOKEN: "test-service-token" }),
    /Missing production MSSQL configuration: DB_SERVER, DB_NAME, DB_USER, DB_PASSWORD/,
  );
});

test("an external production listener must use HTTPS", () => {
  assert.throws(
    () => resolveProductionTopology({
      PORT: "43131",
      PUBLIC_BASE_URL: "https://crm.example.com",
      SOCIAL_LISTENER_SERVICE_URL: "http://listener.example.com",
      SOCIAL_LISTENER_SERVICE_TOKEN: "external-test-token",
    }),
    /must use HTTPS/,
  );
});

test("production requires an explicit public HTTPS media origin", () => {
  assert.throws(
    () => resolveProductionTopology({ ...databaseEnv, PUBLIC_BASE_URL: "", SERVICE_AUTH_TOKEN: "test-service-token" }),
    /PUBLIC_BASE_URL is required/,
  );
  assert.throws(
    () => resolveProductionTopology({ ...databaseEnv, PUBLIC_BASE_URL: "http://crm.example.com", SERVICE_AUTH_TOKEN: "test-service-token" }),
    /public HTTPS app origin/,
  );
  assert.throws(
    () => resolveProductionTopology({ ...databaseEnv, PUBLIC_BASE_URL: "https://127.0.0.1", SERVICE_AUTH_TOKEN: "test-service-token" }),
    /public HTTPS app origin/,
  );
  assert.throws(
    () => resolveProductionTopology({ ...databaseEnv, CAMPAIGN_MEDIA_PUBLIC_PATH: "/media/upload", SERVICE_AUTH_TOKEN: "test-service-token" }),
    /CAMPAIGN_MEDIA_PUBLIC_PATH must be \/uploads\/campaigns/,
  );
});
