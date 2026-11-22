import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "../src/auth";
import { createApp } from "../src/app";
import { readConfig } from "../src/config";
import { internalHandler, migrateInternal } from "../src/internal";

const config = readConfig(process.env);
const rootDatabase = new Pool({ connectionString: config.databaseURL });
const schema = `test_${randomBytes(8).toString("hex")}`;
await rootDatabase.query(`CREATE SCHEMA ${schema}`);
const database = new Pool({
  connectionString: config.databaseURL,
  options: `-c search_path=${schema}`,
  max: 2,
  connectionTimeoutMillis: 3000,
});
const internalSecret = randomBytes(32).toString("hex");
const auth = createAuth(config, database);
const directory = await mkdtemp(join(tmpdir(), "yapper-auth-test-"));
let app: ReturnType<typeof createApp> | undefined;
let accountId: string | undefined;
try {
  const migrations = await getMigrations(auth.options);
  await migrations.runMigrations();
  await migrateInternal(database);
  const name = `probe${randomBytes(6).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  const account = await auth.api.signUpEmail({
    body: { name, username: name, email: `${name}@example.invalid`, password },
  });
  accountId = account.user.id;
  app = createApp(auth, internalHandler(auth, database, internalSecret)).listen({
    port: 0,
    hostname: "127.0.0.1",
  });
  const address = `http://127.0.0.1:${app.server?.port}`;
  const closed = await fetch(`${address}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: config.baseURL },
    body: JSON.stringify({ name, email: "blocked@example.invalid", password }),
  });
  if (closed.status !== 403) throw new Error(`Public signup returned ${closed.status}`);
  const signIn = await fetch(`${address}/api/auth/sign-in/username`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: config.baseURL },
    body: JSON.stringify({ username: name, password }),
  });
  if (!signIn.ok) throw new Error(`Login failed (${signIn.status})`);
  const cookies = signIn.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
  if (!cookies) throw new Error("Login did not issue a session cookie");
  const tokenResponse = await fetch(`${address}/api/auth/token`, {
    headers: { Cookie: cookies, Origin: config.baseURL },
  });
  if (!tokenResponse.ok) throw new Error(`Token issuance failed (${tokenResponse.status})`);
  const { token } = (await tokenResponse.json()) as { token: string };
  const tokenFile = join(directory, "token");
  await writeFile(tokenFile, token, { mode: 0o600 });
  const child = Bun.spawn(
    ["go", "test", "./internal/identity", "-run", "TestExternalAuth", "-count=1", "-v"],
    {
      cwd: new URL("../../../server", import.meta.url).pathname,
      env: {
        ...process.env,
        AUTH_TEST_TOKEN_FILE: tokenFile,
        AUTH_TEST_ISSUER: config.baseURL,
        AUTH_TEST_JWKS: `${address}/api/auth/jwks`,
        AUTH_TEST_SUBJECT: accountId,
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if ((await child.exited) !== 0) throw new Error("Go rejected the Better Auth JWT");
  const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()) as {
    sid: string;
    sub: string;
  };
  const sessionCheck = () =>
    fetch(`${address}/internal/session-check`, {
      method: "POST",
      headers: { Authorization: `Bearer ${internalSecret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: payload.sid, subject: payload.sub }),
    });
  if (!((await (await sessionCheck()).json()) as { active: boolean }).active)
    throw new Error("Active session rejected");
  const provision = (username: string, password: string) =>
    fetch(`${address}/internal/moderators`, {
      method: "POST",
      headers: { Authorization: `Bearer ${internalSecret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(5000),
    });
  if ((await provision("invalid", "é".repeat(6))).status !== 400)
    throw new Error("Provision accepted an under-length Unicode password");
  const unicodeUsername = "unicode_" + "a".repeat(24);
  const unicodePassword = "🔒".repeat(128);
  const lock = await rootDatabase.connect();
  await lock.query("BEGIN");
  await lock.query("SELECT pg_advisory_xact_lock(743211)");
  const primary = provision(unicodeUsername, unicodePassword);
  try {
    const deadline = Date.now() + 2000;
    for (;;) {
      const waiting = await rootDatabase.query(
        "SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND objid=743211",
      );
      if (waiting.rowCount) break;
      if (Date.now() >= deadline)
        throw new Error("The provisioning request did not reach the lock");
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    const concurrent = Promise.all(
      Array.from({ length: 12 }, (_, index) => provision("parallel_" + index, password)),
    );
    const activity = await sessionCheck();
    if (!activity.ok || !((await activity.json()) as { active: boolean }).active)
      throw new Error("Provisioning stalled active-session checks");
    if ((await concurrent).some((response) => response.status !== 503))
      throw new Error("Concurrent provisioning was not rejected while the slot was busy");
  } finally {
    await lock.query("ROLLBACK");
    lock.release();
    await primary;
  }
  if (!(await primary).ok) throw new Error("Unicode provision failed after releasing the lock");
  const unicodeLogin = await fetch(`${address}/api/auth/sign-in/username`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: config.baseURL },
    body: JSON.stringify({ username: unicodeUsername, password: unicodePassword }),
  });
  if (!unicodeLogin.ok) throw new Error("Login rejected valid Unicode credentials");
  console.info(
    "PASS: bounded concurrent provisioning, live session checks and Unicode credentials.",
  );
  const deniedInternal = await fetch(`${address}/internal/session-check`, { method: "POST" });
  if (deniedInternal.status !== 401) throw new Error("Unauthenticated internal request accepted");
  const signOut = await fetch(`${address}/api/auth/sign-out`, {
    method: "POST",
    headers: { Cookie: cookies, Origin: config.baseURL, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!signOut.ok) throw new Error("Logout failed");
  const revoked = await fetch(`${address}/api/auth/token`, {
    headers: { Cookie: cookies, Origin: config.baseURL },
  });
  if (revoked.ok) throw new Error("Logged-out session still issues tokens");
  if (((await (await sessionCheck()).json()) as { active: boolean }).active)
    throw new Error("Revoked session accepted by current-session check");
  console.info(
    "PASS: PostgreSQL migrations, closed public signup, username login, real JWT/JWKS accepted by Go, logout prevents token renewal.",
  );
  console.info("PASS: internal current-session validation denies logged-out sessions.");
} finally {
  if (app) await app.stop();
  if (accountId) await database.query('DELETE FROM "user" WHERE id = $1', [accountId]);
  await database.end();
  await rootDatabase.query(`DROP SCHEMA ${schema} CASCADE`);
  await rootDatabase.end();
  await rm(directory, { recursive: true, force: true });
}
