import { randomBytes, randomUUID } from "node:crypto";
import { writeFile, readFile, mkdir } from "node:fs/promises";
await mkdir(".tmp", { recursive: true });
const base = "http://127.0.0.1:8090";
const password = randomBytes(24).toString("hex");
const call = async (path, { body, cookie, token } = {}) => {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: base,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { response, data };
};
const expect = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label}: ${actual} != ${expected}`);
};
// Restart returns before PostgreSQL and dependent services are necessarily ready.
const deadline = Date.now() + 30_000;
for (;;) {
  try {
    const response = await fetch(base + "/api/v1/state", { signal: AbortSignal.timeout(2000) });
    if (response.ok) break;
  } catch {
    /* Retry only during the bounded startup window. */
  }
  if (Date.now() >= deadline) throw new Error("Container installation did not become ready");
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (process.argv.includes("--verify-persistence")) {
  const saved = JSON.parse(await readFile(".tmp/container-smoke-state.json", "utf8"));
  const me = await call("/api/v1/me", { cookie: saved.guest.cookie });
  expect(me.response.status, 200, "restored guest");
  expect(me.data.participant.id, saved.guest.id, "restored identity");
  const history = await call(`/api/v1/channels/${saved.channel}/messages`, {
    cookie: saved.guest.cookie,
  });
  expect(history.data.messages.length, 1, "restored history");
  console.info("PASS: guest identity and committed message survived container restart.");
  process.exit(0);
}
const setup = {
  token: process.env.SETUP_TOKEN,
  username: "smokeowner",
  password,
  name: "Container smoke",
};
let result = await call("/api/v1/setup", { body: setup });
expect(result.response.status, 201, "setup");
await writeFile(
  ".tmp/container-smoke-credentials.json",
  JSON.stringify({ username: "smokeowner", password }),
  { mode: 0o600 },
);
expect((await call("/api/v1/setup", { body: setup })).response.status, 409, "reused setup");
result = await call("/api/auth/sign-in/username", { body: { username: "smokeowner", password } });
expect(result.response.status, 200, "owner login");
const ownerCookie = result.response.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
const token = (await call("/api/auth/token", { cookie: ownerCookie })).data.token;
const me = (await call("/api/v1/me", { token })).data;
const channel = me.channels.find((c) => c.kind === "text").id;
const guests = [];
for (const nickname of ["Guest One", "Guest Two"]) {
  const invitation = (await call("/api/v1/invitations", { body: {}, token })).data.token;
  const joined = await call("/api/v1/guests", { body: { nickname, invitation } });
  expect(joined.response.status, 201, "guest admission");
  guests.push({
    id: joined.data.id,
    cookie: joined.response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  });
  expect(
    (await call("/api/v1/guests", { body: { nickname: "replay", invitation } })).response.status,
    403,
    "invite replay",
  );
}
expect(
  (await call("/api/v1/invitations", { body: {}, cookie: guests[0].cookie })).response.status,
  403,
  "guest admin boundary",
);
const send = { requestId: randomUUID(), body: "Persisted through the container stack." };
const results = await Promise.all(
  Array.from({ length: 5 }, () =>
    call(`/api/v1/channels/${channel}/messages`, { body: send, cookie: guests[0].cookie }),
  ),
);
for (const r of results) expect(r.response.status, 200, "send retry");
expect(new Set(results.map((r) => r.data.id)).size, 1, "deduplication");
const history = (await call(`/api/v1/channels/${channel}/messages`, { cookie: guests[1].cookie }))
  .data.messages;
expect(history.length, 1, "shared history");
expect(
  (await call("/api/v1/me", { cookie: guests[0].cookie })).data.participant.id,
  guests[0].id,
  "identity persistence",
);
expect(
  (await call(`/api/v1/participants/${guests[1].id}/ban`, { body: {}, token })).response.status,
  200,
  "ban",
);
expect(
  (
    await call(`/api/v1/channels/${channel}/messages`, {
      body: { requestId: randomUUID(), body: "denied" },
      cookie: guests[1].cookie,
    })
  ).response.status,
  403,
  "banned write",
);
expect(
  (await call("/api/auth/sign-out", { body: {}, cookie: ownerCookie })).response.status,
  200,
  "logout",
);
expect((await call("/api/v1/me", { token })).response.status, 403, "revoked session JWT");
expect(
  (await call("/internal/session-check", { body: {} })).response.status,
  404,
  "private auth ingress",
);
await writeFile(".tmp/container-smoke-state.json", JSON.stringify({ channel, guest: guests[0] }), {
  mode: 0o600,
});
console.info(
  "PASS: complete container setup/login, two guest identities, invitations, shared durable chat, concurrent retry deduplication, ban, revoked JWT and private ingress.",
);
