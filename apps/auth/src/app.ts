import { Elysia } from "elysia";
import type { createAuth } from "./auth";

export function createApp(auth: ReturnType<typeof createAuth>) {
  return new Elysia()
    .get("/healthz", () => ({ status: "ok", service: "auth" }))
    .all("/api/auth/*", ({ request }) => {
      const path = new URL(request.url).pathname;
      // Account creation is reserved for host-authorized provisioning.
      if (path.startsWith("/api/auth/sign-up")) {
        return Response.json({ code: "registration_closed" }, { status: 403 });
      }
      if (!["GET", "POST"].includes(request.method)) {
        return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
      }
      return auth.handler(request);
    });
}
