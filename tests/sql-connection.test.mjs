import test from "node:test";
import assert from "node:assert/strict";
import { buildSqlConfig, classifySqlError, parseServerName, describeSqlTarget } from "../social/sql-connection.mjs";

test("parses SQL Express named instance", () => {
  assert.deepEqual(parseServerName("localhost\\SQLEXPRESS"), {
    server: "localhost",
    instanceName: "SQLEXPRESS",
  });
});

test("builds mssql config using instanceName instead of port", () => {
  const config = buildSqlConfig({
    DB_SERVER: "localhost\\SQLEXPRESS",
    DB_NAME: "CRMMarketingFunnel360",
    DB_USER: "m360",
    DB_PASSWORD: "secret",
    DB_ENCRYPT: "true",
    DB_TRUST_SERVER_CERTIFICATE: "yes",
    DB_PORT: "1433",
  });
  assert.equal(config.server, "localhost");
  assert.equal(config.options.instanceName, "SQLEXPRESS");
  assert.equal(config.port, undefined);
  assert.equal(config.options.encrypt, true);
  assert.equal(config.options.trustServerCertificate, true);
  assert.equal(describeSqlTarget(config), "localhost\\SQLEXPRESS");
});

test("builds TCP config when no named instance is present", () => {
  const config = buildSqlConfig({
    DB_SERVER: "localhost",
    DB_PORT: "1433",
    DB_NAME: "CRMMarketingFunnel360",
    DB_USER: "m360",
    DB_PASSWORD: "secret",
  });
  assert.equal(config.server, "localhost");
  assert.equal(config.port, 1433);
  assert.equal(config.options.instanceName, undefined);
});

test("classifies login failures separately from network failures", () => {
  const config = buildSqlConfig({ DB_SERVER: "localhost\\SQLEXPRESS", DB_NAME: "crm", DB_USER: "m360", DB_PASSWORD: "secret" });
  assert.equal(classifySqlError({ code: "ELOGIN", message: "Login failed for user 'm360'." }, config).code, "SQL_LOGIN_FAILED");
  assert.equal(classifySqlError({ code: "ESOCKET", message: "Failed to connect to localhost" }, config).code, "SQL_SERVER_UNREACHABLE");
});
