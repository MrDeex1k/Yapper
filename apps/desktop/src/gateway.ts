import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
  type OutgoingHttpHeaders,
  type ClientRequest,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import type { Duplex } from "node:stream";
import { CookieJar, type SerializedCookieJar } from "tough-cookie";

export interface SavedState {
  selected: string | null;
  jars: Record<string, SerializedCookieJar>;
}
export function normalizeServer(value: string, allowLoopbackHTTP = false): string {
  const url = new URL(value.includes("://") ? value : `https://${value}`);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(allowLoopbackHTTP && loopback && url.protocol === "http:"))
  )
    throw new Error("invalid_server");
  return url.origin;
}
export async function createGateway(options: {
  assets: string;
  state: SavedState;
  save: (state: SavedState) => Promise<void>;
  allowLoopbackHTTP: boolean;
}) {
  const secret = randomBytes(32).toString("hex");
  let selected = options.state.selected;
  if (selected) selected = normalizeServer(selected, options.allowLoopbackHTTP);
  const jars = new Map<string, CookieJar>();
  for (const [origin, jar] of Object.entries(options.state.jars))
    jars.set(origin, CookieJar.deserializeSync(jar));
  const sockets = new Set<Duplex>();
  const pending = new Set<ClientRequest>();
  let generation = 0;
  let origin = "";
  let saving = Promise.resolve();
  const serialize = (jar: CookieJar) => {
    const value = jar.serializeSync();
    if (!value) throw new Error("cookie_serialization_failed");
    return value;
  };
  const persist = () => {
    const state: SavedState = {
      selected,
      jars: Object.fromEntries([...jars].map(([key, jar]) => [key, serialize(jar)])),
    };
    saving = saving.then(() => options.save(state));
    return saving;
  };
  const authorized = (req: IncomingMessage) => {
    const supplied = req.headers["x-yapper-desktop"];
    if (typeof supplied !== "string" || Buffer.byteLength(supplied) !== Buffer.byteLength(secret))
      return false;
    return (
      timingSafeEqual(Buffer.from(supplied), Buffer.from(secret)) &&
      (!req.headers.origin || req.headers.origin === origin)
    );
  };
  const jarFor = (key: string) => {
    let jar = jars.get(key);
    if (!jar) {
      jar = new CookieJar();
      jars.set(key, jar);
    }
    return jar;
  };
  const problem = (res: ServerResponse, status: number, code: string) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ code }));
  };
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) problem(res, 502, "service_unavailable");
      else res.destroy();
    });
  });
  function headersFor(req: IncomingMessage, target: URL) {
    const headers: OutgoingHttpHeaders = {
      ...req.headers,
      host: target.host,
      origin: target.origin,
      cookie: jarFor(target.origin).getCookieStringSync(target.href),
    };
    delete headers["accept-encoding"];
    delete headers["x-yapper-desktop"];
    delete headers["referer"];
    delete headers["forwarded"];
    delete headers["x-forwarded-host"];
    delete headers["x-forwarded-for"];
    delete headers["x-forwarded-proto"];
    return headers;
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!authorized(req)) {
      problem(res, 403, "access_denied");
      return;
    }
    const path = new URL(req.url ?? "/", origin);
    if (path.pathname.startsWith("/api/") || path.pathname.startsWith("/livekit/")) {
      if (!selected) {
        problem(res, 409, "server_required");
        return;
      }
      if (!["GET", "POST"].includes(req.method ?? "")) {
        problem(res, 405, "invalid_request");
        return;
      }
      const requestGeneration = generation;
      const target = new URL(path.pathname + path.search, selected);
      const jar = jarFor(target.origin);
      const upstream = (target.protocol === "https:" ? httpsRequest : httpRequest)(
        target,
        { method: req.method, headers: headersFor(req, target), timeout: 12000 },
        (remote) => {
          void (async () => {
            if (requestGeneration !== generation) throw new Error("server_changed");
            if ((remote.statusCode ?? 0) >= 300 && (remote.statusCode ?? 0) < 400)
              throw new Error("redirect_denied");
            for (const cookie of remote.headers["set-cookie"] ?? [])
              jar.setCookieSync(cookie, target.href);
            if (remote.headers["set-cookie"]) await persist();
            if (requestGeneration !== generation) throw new Error("server_changed");
            const headers = { ...remote.headers };
            delete headers["set-cookie"];
            delete headers["access-control-allow-origin"];
            headers["cache-control"] = "no-store";
            if (path.pathname === "/api/v1/voice/grant" && remote.statusCode === 201) {
              const chunks: Buffer[] = [];
              let size = 0;
              for await (const chunk of remote) {
                size += chunk.length;
                if (size > 16384) throw new Error("invalid_response");
                chunks.push(Buffer.from(chunk));
              }
              const grant = JSON.parse(Buffer.concat(chunks).toString()) as { url: string };
              const signal = new URL(grant.url);
              if (signal.host !== target.host || signal.pathname !== "/livekit")
                throw new Error("invalid_media_origin");
              grant.url = origin.replace("http:", "ws:") + "/livekit";
              delete headers["content-length"];
              res.writeHead(remote.statusCode, headers);
              res.end(JSON.stringify(grant));
            } else {
              res.writeHead(remote.statusCode ?? 502, headers);
              remote.pipe(res);
            }
          })().catch(() => {
            remote.destroy();
            if (!res.headersSent) problem(res, 502, "service_unavailable");
            else res.destroy();
          });
        },
      );
      pending.add(upstream);
      upstream.on("close", () => pending.delete(upstream));
      upstream.on("timeout", () => upstream.destroy());
      upstream.on("error", () => {
        if (!res.headersSent) problem(res, 502, "service_unavailable");
        else res.destroy();
      });
      res.on("close", () => upstream.destroy());
      req.pipe(upstream);
      return;
    }
    if (req.method !== "GET") {
      problem(res, 405, "invalid_request");
      return;
    }
    const relative = decodeURIComponent(path.pathname);
    const root = resolve(options.assets);
    let file = resolve(root, "." + relative);
    if (file !== root && !file.startsWith(root + "/")) {
      problem(res, 404, "not_found");
      return;
    }
    if (relative === "/" || !extname(relative)) file = resolve(root, "index.html");
    let content: Buffer;
    try {
      content = await readFile(file);
    } catch {
      problem(res, 404, "not_found");
      return;
    }
    const mime: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".woff2": "font/woff2",
    };
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${origin.replace("http:", "ws:")}; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
    });
    res.end(content);
  }
  server.on("upgrade", (req, client, head) => {
    if (!authorized(req) || !selected) {
      client.destroy();
      return;
    }
    const path = new URL(req.url ?? "/", origin);
    if (path.pathname !== "/api/v1/events" && !path.pathname.startsWith("/livekit/")) {
      client.destroy();
      return;
    }
    const requestGeneration = generation;
    const target = new URL(path.pathname + path.search, selected);
    const upstream = (target.protocol === "https:" ? httpsRequest : httpRequest)(target, {
      headers: headersFor(req, target),
      timeout: 10000,
    });
    upstream.on("upgrade", (response, remote, remoteHead) => {
      if (requestGeneration !== generation) {
        client.destroy();
        remote.destroy();
        return;
      }
      upstream.setTimeout(0);
      sockets.add(client);
      sockets.add(remote);
      const lines = [`HTTP/1.1 ${response.statusCode} ${response.statusMessage}`];
      for (let i = 0; i < response.rawHeaders.length; i += 2) {
        if (response.rawHeaders[i]?.toLowerCase() === "set-cookie") continue;
        lines.push(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}`);
      }
      client.write(lines.join("\r\n") + "\r\n\r\n");
      if (remoteHead.length) client.write(remoteHead);
      if (head.length) remote.write(head);
      client.pipe(remote);
      remote.pipe(client);
      const close = () => {
        sockets.delete(client);
        sockets.delete(remote);
        client.destroy();
        remote.destroy();
      };
      client.on("close", close);
      remote.on("close", close);
      client.on("error", close);
      remote.on("error", close);
    });
    pending.add(upstream);
    upstream.on("close", () => pending.delete(upstream));
    upstream.on("response", () => client.destroy());
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
    upstream.end();
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("gateway_start_failed");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    secret,
    getServer: () => selected,
    setServer: async (value: string) => {
      const next = normalizeServer(value, options.allowLoopbackHTTP);
      generation++;
      for (const request of pending) request.destroy();
      pending.clear();
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      selected = next;
      await persist();
      return next;
    },
    close: () => {
      for (const request of pending) request.destroy();
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      server.close();
    },
  };
}
