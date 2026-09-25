import { readdir, readFile } from "node:fs/promises";
import process from "node:process";
import { openSqlConnection, describeSqlTarget } from "../social/sql-connection.mjs";

const migrationFile = String(process.argv[2] || "").trim();
if (!/^\d+_[a-z0-9_-]+\.sql$/i.test(migrationFile)) {
  throw new Error("Supply one numbered SQL migration filename, for example 029_apollo_access_compliance.sql.");
}

const sqlDirectory = new URL("../sql/", import.meta.url);
const available = await readdir(sqlDirectory);
if (!available.includes(migrationFile)) throw new Error(`SQL migration was not found: ${migrationFile}`);

let connection;
try {
  connection = await openSqlConnection(process.env);
  const { pool, config } = connection;
  console.log(`Connected to SQL Server: ${describeSqlTarget(config)}`);
  console.log(`Database: ${config.database}`);
  const source = await readFile(new URL(`../sql/${migrationFile}`, import.meta.url), "utf8");
  for (const batch of source.split(/^\s*GO\s*$/gim).map((value) => value.trim()).filter(Boolean)) {
    await pool.request().batch(batch);
  }
  await pool.request().query("SELECT CAST(1 AS INT) AS ok");
  console.log(`Applied sql/${migrationFile}`);
} catch (error) {
  console.error(`SQL Server migration failed [${error.code || "SQL_MIGRATION_FAILED"}].`);
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (connection?.pool) await connection.pool.close().catch(() => {});
}
