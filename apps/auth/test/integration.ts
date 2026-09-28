import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "../src/auth";
import { createApp } from "../src/app";
import { readConfig } from "../src/config";

const config = readConfig(process.env);
const database = new Pool({ connectionString: config.databaseURL });
const auth = createAuth(config, database);
const directory = await mkdtemp(join(tmpdir(), "yapper-auth-test-"));
let app: ReturnType<typeof createApp> | undefined;
let accountId: string | undefined;
try {
  const migrations = await getMigrations(auth.options);
  await migrations.runMigrations();
  const name = `probe${randomBytes(6).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  const account = await auth.api.signUpEmail({
    body: { name, username: name, email: `${name}@example.invalid`, password },
  });
  accountId = account.user.id;
  app = createApp(auth).listen({ port: 0, hostname: "127.0.0.1" });
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
  console.info(
    "PASS: PostgreSQL migrations, closed public signup, username login, real JWT/JWKS accepted by Go, logout prevents token renewal.",
  );
  console.info("Existing JWT revocation remains a Stage 1 integration requirement.");
} finally {
  if (app) await app.stop();
  if (accountId) await database.query('DELETE FROM "user" WHERE id = $1', [accountId]);
  await database.end();
  await rm(directory, { recursive: true, force: true });
}
