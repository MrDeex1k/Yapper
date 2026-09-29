import { Elysia } from "elysia";
import type { createAuth } from "./auth";

export function createApp(
  auth: ReturnType<typeof createAuth>,
  internal?: (request: Request) => Promise<Response>,
) {
  return new Elysia()
    .get("/healthz", () => ({ status: "ok", service: "auth" }))
    .all("/internal/*", ({ request }) =>
      internal ? internal(request) : new Response(null, { status: 404 }),
    )
    .all("/api/auth/*", ({ request }) => {
      const path = new URL(request.url).pathname;
      // Account creation is reserved for host-authorized provisioning.
      if (
        !new Set([
          "/api/auth/sign-in/username",
          "/api/auth/sign-in/email",
          "/api/auth/sign-out",
          "/api/auth/get-session",
          "/api/auth/token",
          "/api/auth/jwks",
        ]).has(path)
      ) {
        return Response.json({ code: "registration_closed" }, { status: 403 });
      }
      if (!["GET", "POST"].includes(request.method)) {
        return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
      }
      return auth.handler(request);
    });
}
