import { readdir, readFile } from "node:fs/promises";
import process from "node:process";
import { openSqlConnection, describeSqlTarget } from "../social/sql-connection.mjs";

let connection;
try {
  connection = await openSqlConnection(process.env);
  const { pool, config } = connection;
  console.log(`Connected to SQL Server: ${describeSqlTarget(config)}`);
  console.log(`Database: ${config.database}`);

  const identity = await pool.request().query("SELECT DB_NAME() AS databaseName, @@SERVERNAME AS serverName");
  console.log(`SQL Server instance: ${identity.recordset?.[0]?.serverName || "unknown"}`);

  const sqlDirectory = new URL("../sql/", import.meta.url);
  const migrationFiles = (await readdir(sqlDirectory))
    .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
    .sort((left, right) => left.localeCompare(right, "en"));
  if (!migrationFiles.length) throw new Error("No SQL migrations were found in the sql directory.");

  for (const migrationFile of migrationFiles) {
    const file = `sql/${migrationFile}`;
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    for (const batch of source.split(/^\s*GO\s*$/gim).map((x) => x.trim()).filter(Boolean)) {
      await pool.request().batch(batch);
    }
    console.log(`Applied ${file}`);
  }
  await pool.request().query("SELECT CAST(1 AS INT) AS ok");
  console.log("SQL Server schema is ready.");
} catch (error) {
  console.error(`\nSQL Server setup failed [${error.code || "SQL_CONNECTION_FAILED"}].`);
  console.error(error.message);
  if (error.detail && error.detail !== error.message) console.error(`Driver detail: ${error.detail}`);
  process.exitCode = 1;
} finally {
  if (connection?.pool) await connection.pool.close().catch(() => {});
}
