import { openSqlConnection } from "../../../../social/sql-connection.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// TEMPORARY SMARTERASP DIAGNOSTIC.
// Remove this entire route after the production environment check is complete.
export const PRESENCE_ENVIRONMENT_VARIABLES = Object.freeze([
  "DB_SERVER",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "DB_PORT",
  "DB_ENCRYPT",
  "DB_TRUST_SERVER_CERTIFICATE",
  "SOCIAL_LISTENER_SERVICE_URL",
  "SOCIAL_LISTENER_SERVICE_TOKEN",
  "SERVICE_AUTH_TOKEN",
  "SOCIAL_LISTENER_PORT",
  "CHANNEL_CONFIG_ENCRYPTION_KEY",
]);

const REQUIRED_DATABASE_VARIABLES = ["DB_SERVER", "DB_NAME", "DB_USER", "DB_PASSWORD"];
const RESPONSE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  "x-robots-tag": "noindex, nofollow, noarchive",
};

function hasNonEmptyValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function environmentVariablePresence(env = process.env) {
  return Object.fromEntries(
    PRESENCE_ENVIRONMENT_VARIABLES.map((name) => [name, hasNonEmptyValue(env[name])]),
  );
}

function nodeEnvironment(env) {
  return hasNonEmptyValue(env.NODE_ENV) ? env.NODE_ENV.trim() : "unknown";
}

function diagnosticTimestamp(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string") return value.slice(0, 64);
  return null;
}

export function redactDiagnosticLead(row, index) {
  return {
    rowNumber: index + 1,
    status: typeof row?.Status === "string" ? row.Status.slice(0, 50) : null,
    createdAt: diagnosticTimestamp(row?.CreatedAt),
    updatedAt: diagnosticTimestamp(row?.UpdatedAt),
    piiRedacted: true,
  };
}

function leadsNotRun(message) {
  return {
    leadsQuerySucceeded: false,
    leadsReturned: 0,
    leads: [],
    leadsMessage: message,
  };
}

async function checkDatabase(env, variables) {
  if (!REQUIRED_DATABASE_VARIABLES.every((name) => variables[name])) {
    return {
      databaseConnected: false,
      databaseName: null,
      databaseMessage:
        "Database connectivity check was skipped because required database environment variables are missing.",
      ...leadsNotRun("The leads query was not run because database configuration is missing."),
    };
  }

  let pool;
  try {
    ({ pool } = await openSqlConnection(env));
    const databaseResult = await pool.request().query("SELECT DB_NAME() AS databaseName");
    const databaseName = databaseResult.recordset?.[0]?.databaseName;

    try {
      const leadsResult = await pool.request().query("SELECT TOP 5 * FROM dbo.leads");
      const rows = Array.isArray(leadsResult.recordset) ? leadsResult.recordset : [];
      const leads = rows.map(redactDiagnosticLead);
      return {
        databaseConnected: true,
        databaseName: typeof databaseName === "string" ? databaseName : null,
        leadsQuerySucceeded: true,
        leadsReturned: leads.length,
        leads,
      };
    } catch {
      return {
        databaseConnected: true,
        databaseName: typeof databaseName === "string" ? databaseName : null,
        ...leadsNotRun("The read-only dbo.leads diagnostic query failed."),
      };
    }
  } catch {
    return {
      databaseConnected: false,
      databaseName: null,
      databaseMessage: "Database connectivity check failed.",
      ...leadsNotRun("The leads query was not run because the database connection failed."),
    };
  } finally {
    if (pool) await pool.close().catch(() => {});
  }
}

export async function GET() {
  try {
    const environmentVariables = environmentVariablePresence(process.env);
    const database = await checkDatabase(process.env, environmentVariables);
    return Response.json(
      {
        nodeEnvironment: nodeEnvironment(process.env),
        environmentVariables,
        ...database,
      },
      { headers: RESPONSE_HEADERS },
    );
  } catch {
    return Response.json(
      { error: "The temporary environment diagnostic could not be completed." },
      { status: 500, headers: RESPONSE_HEADERS },
    );
  }
}
