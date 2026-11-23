import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { jwt, username } from "better-auth/plugins";
import type { Jwk } from "better-auth/plugins/jwt";
import type { Pool } from "pg";
import type { AuthConfig } from "./config";

export const signingKeyLifetimeSeconds = 30 * 24 * 60 * 60;
const signingKeyGraceSeconds = 10 * 60;

export function createAuth(config: AuthConfig, database: Pool) {
  return betterAuth({
    database,
    baseURL: config.baseURL,
    secret: config.secret,
    trustedOrigins: [config.baseURL],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 256,
      autoSignIn: false,
    },
    session: { expiresIn: 60 * 60 * 24, updateAge: 60 * 60 },
    plugins: [
      username({ maxUsernameLength: 32 }),
      jwt({
        adapter: {
          // The default adapter reads a bounded page before filtering expired keys.
          async getJwks() {
            const { rows } = await database.query<Jwk>(
              `SELECT * FROM jwks WHERE "expiresAt" IS NULL
               OR "expiresAt" > now() - ($1::integer * interval '1 second')`,
              [signingKeyGraceSeconds],
            );
            return rows;
          },
          async createJwk(data) {
            const connection = await database.connect();
            try {
              await connection.query("BEGIN");
              await connection.query("SET LOCAL lock_timeout = '3s'");
              // Concurrent first issuance and rotation share one live key per algorithm.
              await connection.query("SELECT pg_advisory_xact_lock(743212)");
              const { rows: active } = await connection.query<Jwk>(
                `SELECT * FROM jwks WHERE coalesce(alg, 'EdDSA') = $1
                 AND ("expiresAt" IS NULL OR "expiresAt" > now())
                 ORDER BY "createdAt" DESC LIMIT 1`,
                [data.alg ?? "EdDSA"],
              );
              let key = active[0];
              if (!key) {
                const { rows } = await connection.query<Jwk>(
                  `INSERT INTO jwks (id, "publicKey", "privateKey", "createdAt", "expiresAt", alg, crv)
                   VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                  [
                    randomUUID(),
                    data.publicKey,
                    data.privateKey,
                    data.createdAt,
                    data.expiresAt,
                    data.alg,
                    data.crv,
                  ],
                );
                key = rows[0]!;
              }
              await connection.query("COMMIT");
              return key;
            } catch (error) {
              await connection.query("ROLLBACK");
              throw error;
            } finally {
              connection.release();
            }
          },
        },
        jwt: {
          issuer: config.baseURL,
          audience: config.audience,
          expirationTime: "5m",
          definePayload: ({ session }) => ({ sid: session.id }),
        },
        jwks: {
          keyPairConfig: { alg: "EdDSA", crv: "Ed25519" },
          rotationInterval: signingKeyLifetimeSeconds,
          gracePeriod: signingKeyGraceSeconds,
        },
      }),
    ],
  });
}
