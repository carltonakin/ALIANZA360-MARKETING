import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const environmentFile = path.join(projectRoot, ".env");
const nextCli = path.join(
  projectRoot,
  "node_modules",
  "next",
  "dist",
  "bin",
  "next",
);
const children = new Map();
let shuttingDown = false;

function requiredDatabaseConfiguration(env) {
  if (env.SQL_SERVER_CONNECTION_STRING?.trim()) return [];

  return [
    ["DB_SERVER", "SQL_SERVER_HOST"],
    ["DB_NAME", "SQL_SERVER_DATABASE"],
    ["DB_USER", "SQL_SERVER_USER"],
    ["DB_PASSWORD", "SQL_SERVER_PASSWORD"],
  ]
    .filter((aliases) => !aliases.some((name) => env[name]?.trim()))
    .map(([preferred]) => preferred);
}

function parsePort(value, name, fallback) {
  const port = Number(value || fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
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
      console.error(`${name} could not be started: ${error.message}`);
      shutdown(1);
    }
  });
  child.once("exit", (code, signal) => {
    children.delete(name);
    if (!shuttingDown) {
      const outcome = signal ? `signal ${signal}` : `exit code ${code ?? 1}`;
      console.error(`${name} stopped unexpectedly (${outcome}).`);
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
      throw new Error("The Social Listener exited before its health check passed.");
    }

    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(2_000),
      });
      const health = await response.json().catch(() => null);

      if (response.ok && health?.databaseConnected === true) return;
      if (response.status === 503 || health?.databaseConnected === false) {
        throw new Error(
          "The Social Listener started, but its SQL Server health check failed.",
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("SQL Server health check failed")
      ) {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Timed out waiting for the Social Listener health check.");
}

async function main() {
  let fileEnv;
  try {
    fileEnv = parseEnv(await readFile(environmentFile, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        "A .env file is required. Copy .env.example to .env and add the local SQL Server credentials.",
      );
    }
    throw error;
  }

  const env = { ...process.env, ...fileEnv };
  const missing = requiredDatabaseConfiguration(env);
  if (!env.SERVICE_AUTH_TOKEN?.trim()) missing.push("SERVICE_AUTH_TOKEN");
  if (missing.length) {
    throw new Error(`Missing required .env values: ${missing.join(", ")}.`);
  }

  const listenerPort = parsePort(
    env.SOCIAL_LISTENER_PORT,
    "SOCIAL_LISTENER_PORT",
    8788,
  );
  const appPort = parsePort(env.LOCAL_APP_PORT, "LOCAL_APP_PORT", 3000);
  if (listenerPort === appPort) {
    throw new Error("SOCIAL_LISTENER_PORT and LOCAL_APP_PORT must be different.");
  }

  const listenerUrl = `http://127.0.0.1:${listenerPort}`;
  const listenerEnv = {
    ...env,
    NODE_ENV: "development",
    PORT: String(listenerPort),
  };
  const dashboardEnv = {
    ...env,
    NODE_ENV: "development",
    SOCIAL_LISTENER_SERVICE_URL: listenerUrl,
    // Both local processes use the listener's token from the same ignored .env.
    SOCIAL_LISTENER_SERVICE_TOKEN: env.SERVICE_AUTH_TOKEN,
  };

  console.log("Starting the SQL Server-backed Social Listener from .env...");
  const listener = launch(
    "Social Listener",
    [path.join(projectRoot, "social", "server.mjs")],
    listenerEnv,
  );

  try {
    await waitForListener(listener, `${listenerUrl}/health`);
  } catch (error) {
    shutdown(1);
    throw error;
  }

  console.log(`Social Listener and SQL Server are healthy on port ${listenerPort}.`);
  console.log(`Starting the CRM dashboard at http://localhost:${appPort} ...`);
  launch(
    "CRM dashboard",
    [nextCli, "dev", "--hostname", "127.0.0.1", "--port", String(appPort)],
    dashboardEnv,
  );
}

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));

main().catch((error) => {
  console.error(`Local startup failed: ${error.message}`);
  shutdown(1);
});
