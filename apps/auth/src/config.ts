export interface AuthConfig {
  databaseURL: string;
  baseURL: string;
  secret: string;
  audience: string;
  port: number;
}

export function readConfig(env: Record<string, string | undefined>): AuthConfig {
  const databaseURL = env.AUTH_DATABASE_URL;
  const baseURL = env.AUTH_BASE_URL;
  const secret = env.AUTH_SECRET;
  if (!databaseURL || !baseURL || !secret || secret.length < 32) {
    throw new Error(
      "AUTH_DATABASE_URL, AUTH_BASE_URL and a 32+ character AUTH_SECRET are required",
    );
  }
  const url = new URL(baseURL);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("AUTH_BASE_URL must be an origin without credentials");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("AUTH_BASE_URL requires HTTPS except on loopback");
  }
  const port = Number(env.AUTH_PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid AUTH_PORT");
  return { databaseURL, baseURL: url.origin, secret, port, audience: "yapper-api" };
}
