import { createServer } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export async function startPreview(assets: string, apiOrigin = "http://127.0.0.1:8080") {
  const api = new URL(apiOrigin);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(api.hostname);
  if (
    (api.protocol !== "https:" && !(api.protocol === "http:" && loopback)) ||
    api.username ||
    api.password ||
    api.pathname !== "/" ||
    api.search ||
    api.hash
  )
    throw new Error("Desktop API must be an HTTPS origin or a loopback HTTP origin");
  // Only bundled regular files are served; symlinks and arbitrary filesystem paths are excluded.
  const files = new Map<string, { body: Buffer; type: string }>();
  async function collect(directory: string, prefix: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const route = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await collect(path, route);
      else if (entry.isFile())
        files.set(route, {
          body: await readFile(path),
          type: contentTypes[extname(entry.name)] ?? "application/octet-stream",
        });
    }
  }
  await collect(assets, "");
  if (!files.has("/index.html")) throw new Error("Build the Web client before starting Electron");
  let origin = "";
  const server = createServer((request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
    );
    if (
      request.headers.host !== new URL(origin).host ||
      (request.headers.origin && request.headers.origin !== origin)
    ) {
      response.writeHead(403).end();
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405).end();
      return;
    }
    if (request.url === "/api/v1/health") {
      // This foundation proxy exposes only the public health probe, never credentials or other APIs.
      void fetch(new URL("/api/v1/health", api), {
        signal: AbortSignal.timeout(4000),
        redirect: "error",
      })
        .then(async (upstream) => {
          await upstream.body?.cancel();
          response.writeHead(upstream.ok ? 200 : 502, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ status: upstream.ok ? "ok" : "unavailable" }));
        })
        .catch(() => {
          response.writeHead(502).end();
        });
      return;
    }
    const file = files.get(request.url === "/" ? "/index.html" : (request.url ?? ""));
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": file.type }).end(file.body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing preview address");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
