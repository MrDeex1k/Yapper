import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32, posix } from "node:path";
import { createGateway, normalizeServer, isWithinDirectory, type SavedState } from "./gateway.js";

async function upstream(name: string) {
  const server = createServer((req, res) => {
    if (req.url === "/api/set")
      res.setHeader("Set-Cookie", `guest=${name}; Path=/; HttpOnly; SameSite=Strict`);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        cookie: req.headers.cookie ?? "",
        origin: req.headers.origin,
        leakedSecret: req.headers["x-yapper-desktop"],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}
const stop = (server: Server) =>
  new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => (error ? reject(error) : resolve()));
  });
test("server addresses require TLS except explicit development loopback", () => {
  assert.equal(normalizeServer("voice.example.com:8443"), "https://voice.example.com:8443");
  for (const address of [
    "http://evil.example",
    "https://user:pass@example.com",
    "https://example.com/path",
    "file:///etc/passwd",
    "https://example.com?next=x",
  ])
    assert.throws(() => normalizeServer(address, true));
  assert.throws(() => normalizeServer("http://127.0.0.1:5173"));
  assert.equal(normalizeServer("http://127.0.0.1:5173", true), "http://127.0.0.1:5173");
});
test("gateway rejects other origins and keeps cookies out of renderer and other servers", async () => {
  const assets = await mkdtemp(join(tmpdir(), "yapper-gateway-"));
  await writeFile(join(assets, "index.html"), "<h1>Bundled client</h1>");
  const a = await upstream("a"),
    b = await upstream("b");
  let saved: SavedState = { selected: null, jars: {} };
  const gateway = await createGateway({
    assets,
    state: saved,
    save: async (value) => {
      saved = value;
    },
    allowLoopbackHTTP: true,
  });
  try {
    assert.equal((await fetch(gateway.origin)).status, 403);
    const headers = { "X-Yapper-Desktop": gateway.secret, Origin: gateway.origin };
    assert.equal(
      (await fetch(gateway.origin, { headers: { ...headers, Origin: "https://evil.invalid" } }))
        .status,
      403,
    );
    assert.equal((await fetch(gateway.origin, { headers })).status, 200);
    await gateway.setServer(a.origin);
    const set = await fetch(gateway.origin + "/api/set", { headers });
    assert.equal(set.headers.get("set-cookie"), null);
    let response = (await (await fetch(gateway.origin + "/api/echo", { headers })).json()) as {
      cookie: string;
      origin: string;
      leakedSecret?: string;
    };
    assert.equal(response.cookie, "guest=a");
    assert.equal(response.origin, a.origin);
    assert.equal(response.leakedSecret, undefined);
    await gateway.setServer(b.origin);
    response = (await (
      await fetch(gateway.origin + "/api/echo", { headers })
    ).json()) as typeof response;
    assert.equal(response.cookie, "");
    await fetch(gateway.origin + "/api/set", { headers });
    await gateway.setServer(a.origin);
    response = (await (
      await fetch(gateway.origin + "/api/echo", { headers })
    ).json()) as typeof response;
    assert.equal(response.cookie, "guest=a");
    assert.ok(saved.jars[a.origin]);
    assert.ok(saved.jars[b.origin]);
    const restored = await createGateway({
      assets,
      state: saved,
      save: async () => {},
      allowLoopbackHTTP: true,
    });
    try {
      const response = (await (
        await fetch(restored.origin + "/api/echo", {
          headers: { "X-Yapper-Desktop": restored.secret, Origin: restored.origin },
        })
      ).json()) as { cookie: string };
      assert.equal(response.cookie, "guest=a");
    } finally {
      restored.close();
    }
  } finally {
    gateway.close();
    await stop(a.server);
    await stop(b.server);
    await rm(assets, { recursive: true, force: true });
  }
});

test("a failed save is reported without poisoning later saves or nested assets", async () => {
  const assets = await mkdtemp(join(tmpdir(), "yapper-gateway-retry-"));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(assets, "assets"));
  await writeFile(join(assets, "index.html"), "client");
  await writeFile(join(assets, "assets", "app.js"), "nested asset");
  let calls = 0;
  const gateway = await createGateway({
    assets,
    state: { selected: null, jars: {} },
    allowLoopbackHTTP: false,
    save: async () => {
      calls++;
      if (calls === 1) throw new Error("temporary storage error");
    },
  });
  try {
    await assert.rejects(gateway.setServer("https://one.example"), /temporary storage/);
    await gateway.setServer("https://two.example");
    assert.equal(calls, 2);
    assert.equal(gateway.getServer(), "https://two.example");
    const headers = { "X-Yapper-Desktop": gateway.secret, Origin: gateway.origin };
    assert.equal(
      await (await fetch(gateway.origin + "/assets/app.js", { headers })).text(),
      "nested asset",
    );
    assert.equal((await fetch(gateway.origin + "/..%2f..%2fsecret.js", { headers })).status, 404);
  } finally {
    gateway.close();
    await rm(assets, { recursive: true, force: true });
  }
});

test("asset containment accepts Windows and POSIX descendants only", () => {
  for (const paths of [win32, posix]) {
    const root = paths.resolve("renderer");
    assert.equal(isWithinDirectory(root, paths.resolve(root, "assets", "app.js"), paths), true);
    assert.equal(isWithinDirectory(root, paths.resolve(root, "..", "secret.js"), paths), false);
    assert.equal(isWithinDirectory(root, paths.resolve(root + "-other", "app.js"), paths), false);
  }
  assert.equal(isWithinDirectory("C:\\renderer", "D:\\renderer\\app.js", win32), false);
});
