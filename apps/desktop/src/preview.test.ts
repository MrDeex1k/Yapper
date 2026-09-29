import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPreview } from "./preview.js";

test("desktop renderer and health share an origin with no general API proxy", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "yapper-preview-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "index.html"), '<script src="/app.js"></script>');
  await writeFile(join(directory, "app.js"), 'fetch("/api/v1/health")');
  let status = 200;
  let calls = 0;
  const upstream = createServer((req, res) => {
    calls++;
    assert.equal(req.url, "/api/v1/health");
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.authorization, undefined);
    res.writeHead(status, { Location: "/elsewhere" }).end();
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const preview = await startPreview(directory, `http://127.0.0.1:${address.port}`);
  t.after(preview.close);
  assert.match(await (await fetch(preview.origin)).text(), /app.js/);
  assert.match(await (await fetch(preview.origin + "/app.js")).text(), /api\/v1\/health/);
  const health = () =>
    fetch(preview.origin + "/api/v1/health", {
      headers: { Origin: preview.origin, Cookie: "secret=value", Authorization: "Bearer secret" },
    });
  assert.equal((await health()).status, 200);
  status = 503;
  assert.equal((await health()).status, 502);
  status = 302;
  assert.equal((await health()).status, 502);
  assert.equal(calls, 3);
  assert.equal((await fetch(preview.origin + "/api/v1/identity")).status, 404);
  assert.equal((await fetch(preview.origin + "/api/v1/health", { method: "POST" })).status, 405);
  assert.equal(
    (
      await fetch(preview.origin + "/api/v1/health", {
        headers: { Origin: "https://attacker.example" },
      })
    ).status,
    403,
  );
  const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(preview.origin, { headers: { Host: "attacker.example" } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject).end();
  });
  assert.equal(wrongHost, 403);
  assert.equal(calls, 3);
  for (const origin of [
    "http://example.com",
    "https://user:password@example.com",
    "https://example.com/path",
  ]) {
    await assert.rejects(startPreview(directory, origin));
  }
});
