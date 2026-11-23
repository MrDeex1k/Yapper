import { timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import type { createAuth } from "./auth";

export async function migrateInternal(database: Pool) {
  await database.query(`CREATE TABLE IF NOT EXISTS yapper_bootstrap (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    subject text NOT NULL REFERENCES "user"(id)
  )`);
  await database.query(`CREATE TABLE IF NOT EXISTS yapper_operator_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    action text NOT NULL,
    revoked_sessions integer NOT NULL
  )`);
}

export function internalHandler(
  auth: ReturnType<typeof createAuth>,
  database: Pool,
  secret: string,
) {
  let provisioning = false;
  return async (request: Request): Promise<Response> => {
    const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    if (
      secret.length < 32 ||
      Buffer.byteLength(supplied) !== Buffer.byteLength(secret) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))
    ) {
      return Response.json({ code: "unauthorized" }, { status: 401 });
    }
    if (request.method !== "POST" || request.headers.get("content-type") !== "application/json") {
      return Response.json({ code: "invalid_request" }, { status: 400 });
    }
    const text = await request.text();
    if (text.length > 8192) return new Response(null, { status: 413 });
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return Response.json({ code: "invalid_request" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return new Response(null, { status: 400 });
    const path = new URL(request.url).pathname;
    if (path === "/internal/session-check") {
      if (typeof body.subject !== "string" || typeof body.sessionId !== "string")
        return new Response(null, { status: 400 });
      const result = await database.query(
        'SELECT 1 FROM "session" WHERE id = $1 AND "userId" = $2 AND "expiresAt" > now()',
        [body.sessionId, body.subject],
      );
      return Response.json({ active: result.rowCount === 1 });
    }
    if (path !== "/internal/bootstrap" && path !== "/internal/moderators")
      return new Response(null, { status: 404 });
    if (
      typeof body.username !== "string" ||
      !/^[a-zA-Z0-9_]{3,32}$/.test(body.username) ||
      typeof body.password !== "string" ||
      !validPassword(body.password)
    ) {
      return Response.json({ code: "invalid_credentials" }, { status: 400 });
    }
    // Take the process slot before acquiring a connection. Better Auth may
    // need a second connection while the transaction holds its advisory lock.
    if (provisioning) {
      return Response.json({ code: "provision_failed" }, { status: 503 });
    }
    provisioning = true;
    try {
      const provision = path === "/internal/moderators" ? provisionModerator : bootstrapOwner;
      return await provision(auth, database, body.username, body.password);
    } catch {
      return Response.json({ code: "provision_failed" }, { status: 503 });
    } finally {
      provisioning = false;
    }
  };
}

function validPassword(password: string) {
  const length = Array.from(password).length;
  return length >= 12 && length <= 128;
}

async function bootstrapOwner(
  auth: ReturnType<typeof createAuth>,
  database: Pool,
  username: string,
  password: string,
): Promise<Response> {
  const connection = await database.connect();
  let created: string | undefined;
  try {
    await connection.query("BEGIN");
    await connection.query("SET LOCAL lock_timeout = '3s'");
    await connection.query("SELECT pg_advisory_xact_lock(743211)");
    const existing = await connection.query<{ subject: string }>(
      "SELECT subject FROM yapper_bootstrap WHERE singleton = true",
    );
    if (existing.rows[0]) {
      await connection.query("COMMIT");
      return Response.json({ subject: existing.rows[0].subject });
    }
    const account = await auth.api.signUpEmail({
      body: {
        name: username,
        username: username,
        email: `${username.toLowerCase()}@owner.invalid`,
        password: password,
      },
    });
    created = account.user.id;
    await connection.query("INSERT INTO yapper_bootstrap (subject) VALUES ($1)", [created]);
    await connection.query("COMMIT");
    return Response.json({ subject: created });
  } catch {
    await connection.query("ROLLBACK");
    if (created)
      await database.query(
        'DELETE FROM "user" WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM yapper_bootstrap WHERE subject = $1)',
        [created],
      );
    return Response.json({ code: "bootstrap_failed" }, { status: 409 });
  } finally {
    connection.release();
  }
}

async function provisionModerator(
  auth: ReturnType<typeof createAuth>,
  database: Pool,
  username: string,
  password: string,
): Promise<Response> {
  const connection = await database.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SET LOCAL lock_timeout = '3s'");
    await connection.query("SELECT pg_advisory_xact_lock(743211)");
    const email = `${username.toLowerCase()}@moderator.invalid`;
    const existing = await connection.query<{ id: string; email: string; password: string | null }>(
      `SELECT u.id, u.email, a.password FROM "user" u LEFT JOIN "account" a
       ON a."userId"=u.id AND a."providerId"='credential' WHERE lower(u.username)=$1`,
      [username.toLowerCase()],
    );
    const user = existing.rows[0];
    if (user) {
      const authContext = await auth.$context;
      const sameCredentials =
        user.email === email &&
        user.password &&
        (await authContext.password.verify({ hash: user.password, password }));
      await connection.query("COMMIT");
      return sameCredentials
        ? Response.json({ subject: user.id })
        : Response.json({ code: "account_conflict" }, { status: 409 });
    }
    const account = await auth.api.signUpEmail({
      body: { name: username, username, email, password },
    });
    await connection.query("COMMIT");
    return Response.json({ subject: account.user.id });
  } catch {
    await connection.query("ROLLBACK");
    return Response.json({ code: "provision_failed" }, { status: 503 });
  } finally {
    connection.release();
  }
}
