const TRUE_VALUES = new Set(["true", "yes", "1", "on"]);
const FALSE_VALUES = new Set(["false", "no", "0", "off"]);

export function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return fallback;
}

export function parseServerName(server) {
  const raw = String(server || "").trim();
  if (!raw) return { server: "", instanceName: null };
  const slash = raw.indexOf("\\");
  if (slash < 0) return { server: raw, instanceName: null };
  const host = raw.slice(0, slash).trim();
  const instanceName = raw.slice(slash + 1).trim();
  return { server: host || raw, instanceName: instanceName || null };
}

export function buildSqlConfig(env = process.env) {
  const rawServer = env.DB_SERVER || env.SQL_SERVER_HOST;
  const database = env.DB_NAME || env.SQL_SERVER_DATABASE;
  const user = env.DB_USER || env.SQL_SERVER_USER;
  const password = env.DB_PASSWORD || env.SQL_SERVER_PASSWORD;
  const missing = [];
  if (!rawServer) missing.push("DB_SERVER");
  if (!database) missing.push("DB_NAME");
  if (!user) missing.push("DB_USER");
  if (!password) missing.push("DB_PASSWORD");
  if (missing.length) {
    const error = new Error(`Missing SQL Server configuration: ${missing.join(", ")}.`);
    error.code = "SQL_CONFIG_MISSING";
    throw error;
  }

  const parsed = parseServerName(rawServer);
  const rawPort = env.DB_PORT || env.SQL_SERVER_PORT;
  const port = rawPort ? Number(rawPort) : null;
  if (rawPort && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    const error = new Error(`Invalid SQL Server port: ${rawPort}. DB_PORT must be a TCP port between 1 and 65535.`);
    error.code = "SQL_CONFIG_INVALID_PORT";
    throw error;
  }

  const config = {
    server: parsed.server,
    database,
    user,
    password,
    options: {
      encrypt: toBoolean(env.DB_ENCRYPT ?? env.SQL_SERVER_ENCRYPT, true),
      trustServerCertificate: toBoolean(
        env.DB_TRUST_SERVER_CERTIFICATE ?? env.SQL_SERVER_TRUST_SERVER_CERTIFICATE,
        false,
      ),
    },
  };

  if (parsed.instanceName) {
    config.options.instanceName = parsed.instanceName;
    // Tedious resolves named instances through SQL Server Browser. A port and
    // instance name are alternatives; don't pass both to avoid ambiguity.
  } else {
    config.port = port || 1433;
  }

  return config;
}

export function describeSqlTarget(config) {
  const instance = config.options?.instanceName;
  if (instance) return `${config.server}\\${instance}`;
  return `${config.server}:${config.port || 1433}`;
}

export function classifySqlError(error, config) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || error || "");
  const lower = message.toLowerCase();
  const target = describeSqlTarget(config);

  if (["ELOGIN", "EINVALIDCREDENTIALS"].includes(code) || /login failed|authentication failed|password/i.test(message)) {
    return {
      code: "SQL_LOGIN_FAILED",
      message: `SQL Server rejected the login for ${config.user}. Check DB_USER and DB_PASSWORD. The server was reached, so this is not a network/port problem.`,
      detail: message,
    };
  }
  if (code === "ETIMEOUT" || /timeout|timed out/i.test(message)) {
    return {
      code: "SQL_CONNECTION_TIMEOUT",
      message: `SQL Server connection timed out while connecting to ${target}. For SQLEXPRESS named instances, make sure SQL Server Browser is running and TCP/IP is enabled, or set DB_SERVER to the host and DB_PORT to the instance's TCP port.`,
      detail: message,
    };
  }
  if (["ESOCKET", "ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH"].includes(code) || /connection refused|could not connect|failed to connect|server is not found|network-related/i.test(lower)) {
    return {
      code: "SQL_SERVER_UNREACHABLE",
      message: `SQL Server could not be reached at ${target}. Check that SQL Server is running, TCP/IP is enabled, and the host/instance/port are correct.`,
      detail: message,
    };
  }
  if (/database .* does not exist|cannot open database|invalid object name/i.test(lower)) {
    return {
      code: "SQL_DATABASE_UNAVAILABLE",
      message: `SQL Server was reached, but database ${config.database} could not be opened. Check DB_NAME and that the database exists and the login has access.`,
      detail: message,
    };
  }
  if (/certificate|tls|ssl/i.test(lower)) {
    return {
      code: "SQL_TLS_ERROR",
      message: `SQL Server was reached, but the TLS/certificate negotiation failed. For a local SQL Express installation, verify DB_ENCRYPT and DB_TRUST_SERVER_CERTIFICATE.`,
      detail: message,
    };
  }
  return {
    code: "SQL_CONNECTION_FAILED",
    message: `SQL Server connection failed for ${target}.`,
    detail: message,
  };
}

export async function openSqlConnection(env = process.env) {
  const sqlModule = await import("mssql");
  const sql = sqlModule.default || sqlModule;
  const config = buildSqlConfig(env);
  try {
    const pool = await new sql.ConnectionPool(config).connect();
    return { sql, pool, config };
  } catch (error) {
    const diagnostic = classifySqlError(error, config);
    const wrapped = new Error(`${diagnostic.message} [${diagnostic.code}]`);
    wrapped.code = diagnostic.code;
    wrapped.cause = error;
    wrapped.detail = diagnostic.detail;
    throw wrapped;
  }
}

export async function testSqlConnection(env = process.env) {
  const { sql, pool, config } = await openSqlConnection(env);
  try {
    const result = await pool.request().query("SELECT CAST(1 AS INT) AS ok, DB_NAME() AS databaseName, @@SERVERNAME AS serverName");
    return {
      ok: result.recordset?.[0]?.ok === 1,
      target: describeSqlTarget(config),
      database: result.recordset?.[0]?.databaseName || config.database,
      serverName: result.recordset?.[0]?.serverName || null,
      driver: sql.name || "mssql",
    };
  } finally {
    await pool.close();
  }
}
