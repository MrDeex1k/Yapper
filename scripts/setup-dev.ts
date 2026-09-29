import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const secret = () => randomBytes(32).toString("hex");
const admin = secret();
const auth = secret();
const app = secret();
const content = [
  `POSTGRES_PASSWORD=${admin}`,
  `AUTH_DB_PASSWORD=${auth}`,
  `APP_DB_PASSWORD=${app}`,
  `AUTH_DATABASE_URL=postgres://yapper_auth:${auth}@127.0.0.1:55439/yapper_auth`,
  `DATABASE_URL=postgres://yapper_app:${app}@127.0.0.1:55439/yapper_app`,
  "AUTH_BASE_URL=http://127.0.0.1:5173",
  "AUTH_ISSUER=http://127.0.0.1:5173",
  "AUTH_JWKS_URL=http://127.0.0.1:3001/api/auth/jwks",
  `AUTH_SECRET=${secret()}`,
  `AUTH_INTERNAL_SECRET=${secret()}`,
  `SETUP_TOKEN=${secret()}`,
  `SETUP_TOKEN_EXPIRES_AT=${new Date(Date.now() + 86400000).toISOString()}`,
  "AUTH_INTERNAL_URL=http://127.0.0.1:3001",
  "LIVEKIT_INTERNAL_URL=http://127.0.0.1:7880",
  `LIVEKIT_API_KEY=${secret().slice(0, 16)}`,
  `LIVEKIT_API_SECRET=${secret()}`,
  "AUTH_PORT=3001",
  "HTTP_ADDR=127.0.0.1:8080",
  "",
].join("\n");
try {
  writeFileSync(new URL("../.env", import.meta.url), content, { flag: "wx", mode: 0o600 });
  console.info(
    "Created .env with fresh development credentials. Existing files are never overwritten.",
  );
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "EEXIST")
    console.info("Keeping existing .env.");
  else throw error;
}
