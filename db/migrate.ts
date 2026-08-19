import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL or POSTGRES_TEST_DATABASE_URL is required");

const migrationsUrl = new URL("./migrations/", import.meta.url);
const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 });

try {
  const files = (await readdir(fileURLToPath(migrationsUrl))).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const migration = await readFile(fileURLToPath(new URL(file, migrationsUrl)), "utf8");
    await sql.begin((tx) => tx.unsafe(migration));
    console.log(`Applied db/migrations/${file}`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
