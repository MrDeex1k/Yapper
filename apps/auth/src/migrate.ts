import { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "./auth";
import { readConfig } from "./config";
import { migrateInternal } from "./internal";
const config = readConfig(process.env);
const pool = new Pool({ connectionString: config.databaseURL });
try {
  const migrations = await getMigrations(createAuth(config, pool).options);
  await migrations.runMigrations();
  await migrateInternal(pool);
  console.info("AUTH schema migrated.");
} finally {
  await pool.end();
}
