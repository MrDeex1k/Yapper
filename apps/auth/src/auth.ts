import { betterAuth } from "better-auth";
import { jwt, username } from "better-auth/plugins";
import type { Pool } from "pg";
import type { AuthConfig } from "./config";

export function createAuth(config: AuthConfig, database: Pool) {
  return betterAuth({
    database,
    baseURL: config.baseURL,
    secret: config.secret,
    trustedOrigins: [config.baseURL],
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    session: { expiresIn: 60 * 60 * 24, updateAge: 60 * 60 },
    plugins: [
      username(),
      jwt({
        jwt: {
          issuer: config.baseURL,
          audience: config.audience,
          expirationTime: "5m",
          definePayload: ({ session }) => ({ sid: session.id }),
        },
        jwks: { keyPairConfig: { alg: "EdDSA", crv: "Ed25519" } },
      }),
    ],
  });
}
