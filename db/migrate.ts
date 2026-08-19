import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL or POSTGRES_TEST_DATABASE_URL is required");

const migrationUrl = new URL("./migrations/0001_core_persistence.sql", import.meta.url);
const migration = await readFile(fileURLToPath(migrationUrl), "utf8");
const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 });

try {
  await sql.begin((tx) => tx.unsafe(migration));
  console.log("Applied db/migrations/0001_core_persistence.sql");
} finally {
  await sql.end({ timeout: 5 });
}
