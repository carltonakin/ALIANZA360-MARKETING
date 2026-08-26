import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const nextCli = path.join(
  projectRoot,
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);
const listenerEntry = path.join(projectRoot, "social", "server.mjs");
const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
const children = new Map();
let shuttingDown = false;

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parsePort(value, name, fallback) {
  const port = Number(value || fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
}

function missingDatabaseConfiguration(env) {
  if (clean(env.SQL_SERVER_CONNECTION_STRING)) return [];

  return [
    ["DB_SERVER", "SQL_SERVER_HOST"],
    ["DB_NAME", "SQL_SERVER_DATABASE"],
    ["DB_USER", "SQL_SERVER_USER"],
    ["DB_PASSWORD", "SQL_SERVER_PASSWORD"],
  ]
    .filter((aliases) => !aliases.some((name) => clean(env[name])))
    .map(([preferred]) => preferred);
}

function requiredPublicBaseUrl(env) {
  const value = clean(env.PUBLIC_BASE_URL);
  if (!value || /^<[^>]+>$/.test(value)) {
    throw new Error("PUBLIC_BASE_URL is required with the public HTTPS app origin.");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("PUBLIC_BASE_URL must be a valid HTTPS origin.");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privateHost = hostname === "localhost" || hostname.endsWith(".local") || hostname === "::1" ||
    hostname === "0.0.0.0" || hostname.startsWith("127.") || hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") || hostname.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) || /^f[cd][0-9a-f]{2}:/i.test(hostname) ||
    /^fe[89ab][0-9a-f]:/i.test(hostname);
  if (
    parsed.protocol !== "https:" ||
    privateHost ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !["", "/"].includes(parsed.pathname)
  ) {
    throw new Error("PUBLIC_BASE_URL must contain only the public HTTPS app origin.");
  }
  return parsed.origin;
}

function requiredCampaignMediaPublicPath(env) {
  const value = clean(env.CAMPAIGN_MEDIA_PUBLIC_PATH) || "/uploads/campaigns";
  if (value.replace(/\/$/, "") !== "/uploads/campaigns") {
    throw new Error("CAMPAIGN_MEDIA_PUBLIC_PATH must be /uploads/campaigns.");
  }
  return "/uploads/campaigns";
}

function serviceSelection(env) {
  const value = clean(env.SOCIAL_LISTENER_SERVICE_URL).replace(/\/$/, "");
  if (!value) return { mode: "internal", port: null };

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SOCIAL_LISTENER_SERVICE_URL must be a valid URL.");
  }

  if (loopbackHosts.has(url.hostname.toLowerCase())) {
    return {
      mode: "internal",
      port: url.port ? parsePort(url.port, "SOCIAL_LISTENER_SERVICE_URL port") : null,
    };
  }

  if (url.protocol !== "https:") {
    throw new Error("An external production SOCIAL_LISTENER_SERVICE_URL must use HTTPS.");
  }

  return { mode: "external", serviceUrl: value };
}

export function resolveProductionTopology(env = process.env) {
  const appPort = parsePort(env.PORT, "PORT", 3000);
  const publicBaseUrl = requiredPublicBaseUrl(env);
  const mediaPublicPath = requiredCampaignMediaPublicPath(env);
  const selection = serviceSelection(env);

  if (selection.mode === "external") {
    const serviceToken = clean(env.SOCIAL_LISTENER_SERVICE_TOKEN);
    if (!serviceToken) {
      throw new Error(
        "SOCIAL_LISTENER_SERVICE_TOKEN is required with an external Social Listener URL.",
      );
    }

    return {
      mode: "external",
      appPort,
      dashboardEnv: {
        ...env,
        NODE_ENV: "production",
        PORT: String(appPort),
        PUBLIC_BASE_URL: publicBaseUrl,
        CAMPAIGN_MEDIA_PUBLIC_PATH: mediaPublicPath,
        SOCIAL_LISTENER_SERVICE_URL: selection.serviceUrl,
        SOCIAL_LISTENER_SERVICE_TOKEN: serviceToken,
      },
    };
  }

  const listenerPort = selection.port || parsePort(
    env.SOCIAL_LISTENER_PORT,
    "SOCIAL_LISTENER_PORT",
    8788,
  );
  if (listenerPort === appPort) {
    throw new Error("SOCIAL_LISTENER_PORT must differ from SmarterASP's PORT.");
  }

  const missing = missingDatabaseConfiguration(env);
  const serviceToken = clean(env.SERVICE_AUTH_TOKEN) || clean(env.SOCIAL_LISTENER_SERVICE_TOKEN);
  if (!serviceToken) missing.push("SERVICE_AUTH_TOKEN");
  if (missing.length) {
    throw new Error(
      `Missing production MSSQL configuration: ${missing.join(", ")}.`,
    );
  }

  const serviceUrl = `http://127.0.0.1:${listenerPort}`;
  return {
    mode: "internal",
    appPort,
    listenerPort,
    healthUrl: `${serviceUrl}/health`,
    listenerEnv: {
      ...env,
      NODE_ENV: "production",
      PORT: String(listenerPort),
      PUBLIC_BASE_URL: publicBaseUrl,
      CAMPAIGN_MEDIA_PUBLIC_PATH: mediaPublicPath,
      SERVICE_AUTH_TOKEN: serviceToken,
    },
    dashboardEnv: {
      ...env,
      NODE_ENV: "production",
      PORT: String(appPort),
      PUBLIC_BASE_URL: publicBaseUrl,
      CAMPAIGN_MEDIA_PUBLIC_PATH: mediaPublicPath,
      SOCIAL_LISTENER_SERVICE_URL: serviceUrl,
      SOCIAL_LISTENER_SERVICE_TOKEN: serviceToken,
    },
  };
}

function launch(name, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    env,
    stdio: "inherit",
    windowsHide: true,
  });

  children.set(name, child);
  child.once("error", (error) => {
    if (!shuttingDown) {
      console.error(`[startup] ${name} could not be started: ${error.message}`);
      shutdown(1);
    }
  });
  child.once("exit", (code, signal) => {
    children.delete(name);
    if (!shuttingDown) {
      const outcome = signal ? `signal ${signal}` : `exit code ${code ?? 1}`;
      console.error(`[startup] ${name} stopped unexpectedly (${outcome}).`);
      shutdown(code || 1);
    }
  });

  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;

  for (const child of children.values()) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  }
}

async function waitForListener(listener, healthUrl) {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (listener.exitCode !== null || listener.signalCode !== null) {
      throw new Error("The SQL-backed Social Listener exited during startup.");
    }

    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(2_000),
      });
      const health = await response.json().catch(() => null);
      if (response.ok && health?.databaseConnected === true) return;
      if (response.status === 503 || health?.databaseConnected === false) {
        throw new Error("The production MSSQL health check failed.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("MSSQL health check failed")) {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Timed out waiting for the production MSSQL health check.");
}

async function main() {
  const topology = resolveProductionTopology(process.env);

  if (topology.mode === "internal") {
    console.log("[startup] Production data source selected: MSSQL via the internal Social Listener.");
    const listener = launch(
      "Social Listener",
      [listenerEntry],
      topology.listenerEnv,
    );
    try {
      await waitForListener(listener, topology.healthUrl);
    } catch (error) {
      shutdown(1);
      throw error;
    }
    console.log("[startup] Production MSSQL connection: healthy.");
  } else {
    console.log("[startup] Production data source selected: MSSQL via the configured HTTPS Social Listener.");
  }

  console.log(`[startup] Starting the Next.js dashboard on the assigned port ${topology.appPort}.`);
  launch("CRM dashboard", [nextCli, "start"], topology.dashboardEnv);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  process.once("SIGINT", () => shutdown(0));
  process.once("SIGTERM", () => shutdown(0));
  main().catch((error) => {
    console.error(`[startup] Production startup failed: ${error.message}`);
    shutdown(1);
  });
}
