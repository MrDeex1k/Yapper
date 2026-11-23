import { Pool } from "pg";
import { createAuth } from "./auth";
import { readConfig } from "./config";

const config = readConfig(process.env);
const database = new Pool({ connectionString: config.databaseURL, connectionTimeoutMillis: 3000 });

async function recoverOwner() {
  const input = (await Bun.stdin.text()).replace(/\r?\n$/, "");
  const length = Array.from(input).length;
  if (length < 12 || length > 128)
    throw new Error("Replacement password must be 12–128 characters");
  const { password } = await createAuth(config, database).$context;
  const hash = await password.hash(input);
  const connection = await database.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SET LOCAL lock_timeout = '3s'");
    const owner = await connection.query<{ subject: string }>(
      "SELECT subject FROM yapper_bootstrap WHERE singleton FOR UPDATE",
    );
    const subject = owner.rows[0]?.subject;
    if (!subject) throw new Error("No bootstrapped owner exists");
    const updated = await connection.query(
      `UPDATE "account" SET password = $1, "updatedAt" = now()
       WHERE "providerId" = 'credential' AND "userId" = $2`,
      [hash, subject],
    );
    if (updated.rowCount !== 1) throw new Error("Expected one owner credential account");
    const revoked = await connection.query('DELETE FROM "session" WHERE "userId" = $1', [subject]);
    await connection.query(
      "INSERT INTO yapper_operator_audit(action, revoked_sessions) VALUES ('recover_owner', $1)",
      [revoked.rowCount],
    );
    await connection.query("COMMIT");
    console.info("Owner credential replaced and previous sessions revoked.");
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}

try {
  await recoverOwner();
} catch {
  console.error("Owner recovery failed. Verify the installation and replacement password.");
  process.exitCode = 1;
} finally {
  await database.end();
}
