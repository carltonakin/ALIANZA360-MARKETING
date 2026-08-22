import process from "node:process";
import { testSqlConnection } from "../social/sql-connection.mjs";

try {
  const result = await testSqlConnection(process.env);
  console.log("SQL Server connection test: PASS");
  console.log(`Target: ${result.target}`);
  console.log(`Database: ${result.database}`);
  console.log(`SQL Server: ${result.serverName || "unknown"}`);
  process.exitCode = 0;
} catch (error) {
  console.error(`SQL Server connection test: FAIL [${error.code || "SQL_CONNECTION_FAILED"}]`);
  console.error(error.message);
  if (error.detail) console.error(`Driver detail: ${error.detail}`);
  process.exitCode = 1;
}
