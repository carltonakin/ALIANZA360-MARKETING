import assert from "node:assert/strict";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertPortAvailable } from "../scripts/start-local.mjs";
import { resolveProductionTopology } from "../scripts/start-production.mjs";

const packageUrl = new URL("../package.json", import.meta.url);

const databaseEnv = {
  DB_SERVER: "sql.example",
  DB_NAME: "crm360",
  DB_USER: "crm_user",
  DB_PASSWORD: "not-a-real-password",
  CLOUDINARY_CLOUD_NAME: "crm-cloud",
  CLOUDINARY_API_KEY: "cloudinary-key",
  CLOUDINARY_API_SECRET: "cloudinary-secret",
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
  assert.equal(topology.listenerEnv.CLOUDINARY_CLOUD_NAME, "crm-cloud");
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
    SOCIAL_LISTENER_SERVICE_URL: "https://listener.example.com",
    SOCIAL_LISTENER_SERVICE_TOKEN: "external-test-token",
  });

  assert.equal(topology.mode, "external");
  assert.equal(topology.dashboardEnv.SOCIAL_LISTENER_SERVICE_URL, "https://listener.example.com");
  assert.equal(topology.dashboardEnv.SOCIAL_LISTENER_SERVICE_TOKEN, "external-test-token");
});

test("production cannot silently start internal mode without MSSQL configuration", () => {
  assert.throws(
    () => resolveProductionTopology({
      PORT: "43131",
      SERVICE_AUTH_TOKEN: "test-service-token",
      CLOUDINARY_CLOUD_NAME: "crm-cloud",
      CLOUDINARY_API_KEY: "cloudinary-key",
      CLOUDINARY_API_SECRET: "cloudinary-secret",
    }),
    /Missing production MSSQL configuration: DB_SERVER, DB_NAME, DB_USER, DB_PASSWORD/,
  );
});

test("an external production listener must use HTTPS", () => {
  assert.throws(
    () => resolveProductionTopology({
      PORT: "43131",
      SOCIAL_LISTENER_SERVICE_URL: "http://listener.example.com",
      SOCIAL_LISTENER_SERVICE_TOKEN: "external-test-token",
    }),
    /must use HTTPS/,
  );
});

test("internal production requires server-side Cloudinary credentials", () => {
  assert.throws(
    () => resolveProductionTopology({ ...databaseEnv, CLOUDINARY_CLOUD_NAME: "", SERVICE_AUTH_TOKEN: "test-service-token" }),
    /CLOUDINARY_CLOUD_NAME/,
  );
  assert.throws(
    () => resolveProductionTopology({ ...databaseEnv, CLOUDINARY_API_KEY: "", SERVICE_AUTH_TOKEN: "test-service-token" }),
    /CLOUDINARY_API_KEY/,
  );
  assert.throws(
    () => resolveProductionTopology({ ...databaseEnv, CLOUDINARY_API_SECRET: "<cloudinary-api-secret>", SERVICE_AUTH_TOKEN: "test-service-token" }),
    /CLOUDINARY_API_SECRET/,
  );
});

test("the normal development command starts the complete SQL-backed local stack", async () => {
  const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));
  assert.equal(packageJson.scripts.dev, "node scripts/start-local.mjs");
  assert.equal(packageJson.scripts["dev:local"], "node scripts/start-local.mjs");
  assert.equal(packageJson.scripts["dev:next"], "next dev");
});

test("local startup rejects a stale occupied port before spawning either server", async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    await assert.rejects(
      () => assertPortAvailable(address.port, "LOCAL_APP_PORT"),
      /LOCAL_APP_PORT \d+ is already in use[\s\S]*npm run dev again/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
