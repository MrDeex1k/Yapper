import { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { createAuth, signingKeyLifetimeSeconds } from "./auth";
import { readConfig } from "./config";
import { migrateInternal } from "./internal";
const config = readConfig(process.env);
const pool = new Pool({ connectionString: config.databaseURL });
try {
  const migrations = await getMigrations(createAuth(config, pool).options);
  await migrations.runMigrations();
  await migrateInternal(pool);
  await pool.query(
    `UPDATE jwks SET "expiresAt" = now() + ($1::integer * interval '1 second')
     WHERE "expiresAt" IS NULL`,
    [signingKeyLifetimeSeconds],
  );
  console.info("AUTH schema migrated.");
} finally {
  await pool.end();
}
