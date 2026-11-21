import { randomBytes, randomUUID } from "node:crypto";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import type { components } from "../packages/api/src/generated.ts";
type Schemas = components["schemas"];
type Guest = { id: string; cookie: string };
type SmokeState = { channel: string; guest: Guest };
type RequestOptions = { body?: unknown; cookie?: string; token?: string; clientIpHeader?: string };
await mkdir(".tmp", { recursive: true });
const base = "http://127.0.0.1:8090";
const password = randomBytes(24).toString("hex");
const call = async <T = Record<string, unknown>>(
  path: string,
  { body, cookie, token, clientIpHeader }: RequestOptions = {},
) => {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: base,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(clientIpHeader ? { "X-Yapper-Client-IP": clientIpHeader } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return {
    response,
    get data(): T {
      assert(data !== null && typeof data === "object", `Missing JSON response for ${path}`);
      return data as T;
    },
  };
};
const expect = (actual: unknown, expected: unknown, label: string) => {
  if (actual !== expected) throw new Error(`${label}: ${actual} != ${expected}`);
};
const waitForEvent = (socket: WebSocket, type: string) =>
  new Promise<void>((resolve, reject) => {
    const controller = new AbortController();
    const { signal } = controller;
    const timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`WebSocket event timeout: ${type}`));
    }, 5000);
    socket.addEventListener(
      "message",
      (event) => {
        const envelope = JSON.parse(String(event.data)) as { type?: string };
        if (envelope.type !== type) return;
        clearTimeout(timeout);
        controller.abort();
        resolve();
      },
      { signal },
    );
    socket.addEventListener(
      "close",
      () => {
        clearTimeout(timeout);
        controller.abort();
        reject(new Error(`WebSocket closed before ${type}`));
      },
      { signal },
    );
  });
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
  const saved = JSON.parse(await readFile(".tmp/container-smoke-state.json", "utf8")) as SmokeState;
  const me = await call<Schemas["Me"]>("/api/v1/me", { cookie: saved.guest.cookie });
  expect(me.response.status, 200, "restored guest");
  expect(me.data.participant.id, saved.guest.id, "restored identity");
  const history = await call<{ messages: Schemas["Message"][] }>(
    `/api/v1/channels/${saved.channel}/messages`,
    {
      cookie: saved.guest.cookie,
    },
  );
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
const token = (await call<{ token: string }>("/api/auth/token", { cookie: ownerCookie })).data
  .token;
const me = (await call<Schemas["Me"]>("/api/v1/me", { token })).data;
const textChannel = me.channels.find((c) => c.kind === "text");
assert(textChannel, "Default text channel is required");
const channel = textChannel.id;
const guests: Guest[] = [];
for (const nickname of ["Guest One", "Guest Two"]) {
  const invitation = (await call<{ token: string }>("/api/v1/invitations", { body: {}, token }))
    .data.token;
  const joined = await call<{ id: string }>("/api/v1/guests", { body: { nickname, invitation } });
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
const [firstGuest, secondGuest] = guests;
assert(firstGuest && secondGuest, "Two admitted guests are required");
expect(
  (await call("/api/v1/invitations", { body: {}, cookie: firstGuest.cookie })).response.status,
  403,
  "guest admin boundary",
);
expect(
  (await call("/api/v1/invitations", { cookie: firstGuest.cookie })).response.status,
  403,
  "guest cannot list invitations",
);
expect(
  (await call("/api/v1/admission", { body: { openAdmission: true }, cookie: firstGuest.cookie }))
    .response.status,
  403,
  "guest cannot open admission",
);
expect(
  (await call("/api/v1/invitations", { body: { maxUses: -1 }, token })).response.status,
  400,
  "negative invitation limit",
);
const unlimited = await call<Schemas["Invitation"]>("/api/v1/invitations", {
  body: { expiresInHours: 0, maxUses: 0 },
  token,
});
expect(unlimited.response.status, 201, "create unlimited invitation");
const list = await call<Schemas["Invitations"]>("/api/v1/invitations", { token });
expect(list.response.status, 200, "list invitations");
const invitation = list.data.invitations.find(
  (item) => item.remaining === null && item.expiresAt === null,
);
assert(invitation, "Unlimited invitation is listed");
assert(!("token" in invitation), "Invitation codes are never listed");
const revokePath = `/api/v1/invitations/${invitation.id}/revoke`;
expect(
  (await call(revokePath, { body: {}, cookie: firstGuest.cookie })).response.status,
  403,
  "guest revoke denied",
);
const invited = await call("/api/v1/guests", {
  body: { nickname: "Invited guest", invitation: unlimited.data.token },
});
expect(invited.response.status, 201, "unlimited invitation accepted");
expect(
  (await call(revokePath, { body: {}, token })).response.status,
  200,
  "owner revoked invitation",
);
expect(
  (
    await call("/api/v1/guests", {
      body: { nickname: "Late guest", invitation: unlimited.data.token },
    })
  ).response.status,
  403,
  "revoked invitation denied",
);
expect(
  (await call("/api/v1/admission", { body: { openAdmission: true }, token })).response.status,
  200,
  "open admission",
);
expect(
  (await call<Schemas["State"]>("/api/v1/state")).data.openAdmission,
  true,
  "open mode is public",
);
const walkIn = await call<Schemas["Participant"]>("/api/v1/guests", {
  body: { nickname: "Walk-in guest" },
});
expect(walkIn.response.status, 201, "open admission without a code");
expect(
  (await call("/api/v1/admission", { body: { openAdmission: false }, token })).response.status,
  200,
  "close admission",
);
const walkInCookie = walkIn.response.headers
  .getSetCookie()
  .map((cookie) => cookie.split(";")[0])
  .join("; ");
expect(
  (await call<Schemas["Me"]>("/api/v1/me", { cookie: walkInCookie })).data.participant.id,
  walkIn.data.id,
  "existing membership survives closing",
);
expect(
  (await call("/api/v1/guests", { body: { nickname: "Blocked guest" } })).response.status,
  403,
  "closed admission requires a code again",
);
console.info(
  "PASS: owner-only admission settings, invitation listing and revocation, preserved memberships.",
);
const catalogPath = "/api/v1/categories";
expect(
  (await call(catalogPath, { body: { name: "Bad" }, cookie: firstGuest.cookie })).response.status,
  403,
  "guest catalog write",
);
expect(
  (await call(catalogPath, { body: { name: "Community" }, token })).response.status,
  200,
  "owner category",
);
const catalog = (await call<Schemas["Me"]>("/api/v1/me", { cookie: firstGuest.cookie })).data;
const category = catalog.categories.find((item) => item.name === "Community");
assert(category, "Connected member can fetch changed catalog");
expect(
  (
    await call("/api/v1/channels", {
      body: { name: "updates", kind: "text", categoryId: category.id },
      token,
    })
  ).response.status,
  200,
  "owner channel",
);
const added = (await call<Schemas["Me"]>("/api/v1/me", { token })).data.channels.find(
  (item) => item.name === "updates",
);
assert(added && added.categoryId === category.id);
expect(
  (await call(`/api/v1/channels/${added.id}/archive`, { body: {}, token })).response.status,
  200,
  "archive channel",
);
expect(
  (
    await call(`/api/v1/channels/${added.id}/messages`, {
      body: { requestId: randomUUID(), body: "Blocked" },
      cookie: firstGuest.cookie,
    })
  ).response.status,
  403,
  "reject archived write",
);
console.info(
  "PASS: authorized category and channel writes, preserved default channel, read-only archival.",
);
const send = { requestId: randomUUID(), body: "Persisted through the container stack." };
const results = await Promise.all(
  Array.from({ length: 5 }, () =>
    call<Schemas["Message"]>(`/api/v1/channels/${channel}/messages`, {
      body: send,
      cookie: firstGuest.cookie,
    }),
  ),
);
for (const r of results) expect(r.response.status, 200, "send retry");
expect(new Set(results.map((r) => r.data.id)).size, 1, "deduplication");
const history = (
  await call<{ messages: Schemas["Message"][] }>(`/api/v1/channels/${channel}/messages`, {
    cookie: secondGuest.cookie,
  })
).data.messages;
expect(history.length, 1, "shared history");
expect(
  (await call<Schemas["Me"]>("/api/v1/me", { cookie: firstGuest.cookie })).data.participant.id,
  firstGuest.id,
  "identity persistence",
);
const provision = "/api/v1/moderators";
const moderatorCredentials = { username: "smokemod", password: randomBytes(24).toString("hex") };
expect(
  (await call(provision, { body: moderatorCredentials, cookie: firstGuest.cookie })).response
    .status,
  403,
  "guest cannot provision",
);
expect(
  (await call(provision, { body: moderatorCredentials, token })).response.status,
  200,
  "owner provisioned moderator",
);
expect(
  (await call(provision, { body: moderatorCredentials, token })).response.status,
  200,
  "provision retry",
);
expect(
  (await call(provision, { body: { ...moderatorCredentials, password }, token })).response.status,
  409,
  "conflicting credentials",
);
expect(
  (await call(provision, { body: { username: setup.username, password }, token })).response.status,
  409,
  "owner account cannot be rebound",
);
const moderatorLogin = await call("/api/auth/sign-in/username", { body: moderatorCredentials });
expect(moderatorLogin.response.status, 200, "moderator login");
const moderatorCookie = moderatorLogin.response.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
const modToken = (await call<{ token: string }>("/api/auth/token", { cookie: moderatorCookie }))
  .data.token;
const mod = (await call<Schemas["Me"]>("/api/v1/me", { token: modToken })).data.participant;
expect(mod.role, "moderator", "moderator binding");
const moderate = (id: string, body: Schemas["ModerationAction"], authToken: string) =>
  call(`/api/v1/participants/${id}/moderate`, { body, token: authToken });
expect(
  (await moderate(me.participant.id, { action: "kick" }, modToken)).response.status,
  403,
  "moderator protection of owner",
);
expect(
  (await moderate(secondGuest.id, { action: "grant_moderator" }, modToken)).response.status,
  403,
  "moderator cannot assign roles",
);
expect(
  (await call("/api/v1/participants", { cookie: firstGuest.cookie })).response.status,
  403,
  "guest cannot list members",
);
expect(
  (await call("/api/v1/moderation/audit", { cookie: firstGuest.cookie })).response.status,
  403,
  "guest cannot read audit",
);
const issued = await call<{ ticket: string }>("/api/v1/events/ticket", {
  body: {},
  token: modToken,
});
// Node's WebSocket supports request headers for a non-browser smoke probe.
const NodeWebSocket = WebSocket as typeof WebSocket & {
  new (url: string, options: { protocols: string[]; headers: HeadersInit }): WebSocket;
};
const moderatorSocket = new NodeWebSocket("ws://127.0.0.1:8090/api/v1/events", {
  protocols: ["yapper.v1", `yapper.ticket.${issued.data.ticket}`],
  headers: { Origin: base },
});
try {
  await waitForEvent(moderatorSocket, "ready");
  const [, revoked] = await Promise.all([
    waitForEvent(moderatorSocket, "members.changed"),
    moderate(mod.id, { action: "revoke_moderator" }, token),
  ]);
  expect(revoked.response.status, 200, "revoke moderator");
  expect(
    (await call("/api/v1/participants", { token: modToken })).response.status,
    403,
    "old JWT lost privileges",
  );
  expect(
    (await call<Schemas["Me"]>("/api/v1/me", { token: modToken })).data.participant.role,
    "participant",
    "demoted account can still use its identity",
  );
  const [, restored] = await Promise.all([
    waitForEvent(moderatorSocket, "members.changed"),
    moderate(mod.id, { action: "grant_moderator" }, token),
  ]);
  expect(restored.response.status, 200, "restore moderator role");
} finally {
  moderatorSocket.close();
}
expect(
  (await moderate(secondGuest.id, { action: "mute" }, modToken)).response.status,
  200,
  "forced mute",
);
expect(
  (await call<Schemas["Me"]>("/api/v1/me", { cookie: secondGuest.cookie })).data.participant
    .micMuted,
  true,
  "moderation visible to target",
);
expect(
  (await moderate(secondGuest.id, { action: "unmute" }, modToken)).response.status,
  200,
  "lift forced mute",
);
const timelinePath = `/api/v1/channels/${channel}/timeline`;
const latest = (await call<Schemas["HistoryPage"]>(timelinePath, { cookie: firstGuest.cookie }))
  .data;
expect(latest.messages.length, 1, "initial timeline");
const lifecycleInput = { requestId: randomUUID(), body: "Message lifecycle smoke" };
const draftMessage = (
  await call<Schemas["Message"]>(`/api/v1/channels/${channel}/messages`, {
    body: lifecycleInput,
    cookie: firstGuest.cookie,
  })
).data;
const mutation = `/api/v1/channels/${channel}/messages/${draftMessage.id}`;
const edit = { body: "Edited lifecycle smoke", revision: draftMessage.revision };
expect(
  (await call(`${mutation}/edit`, { body: edit, token: modToken })).response.status,
  403,
  "moderator cannot edit someone else's message",
);
expect(
  (await call(`${mutation}/edit`, { body: edit, cookie: firstGuest.cookie })).response.status,
  200,
  "author edit",
);
const changesPath = `/api/v1/channels/${channel}/messages/changes?after=${latest.revision}`;
const updates = (await call<Schemas["MessageChanges"]>(changesPath, { cookie: secondGuest.cookie }))
  .data.changes;
expect(updates.at(-1)?.message?.body, edit.body, "edited message reconciles");
const retry = (
  await call<Schemas["Message"]>(`/api/v1/channels/${channel}/messages`, {
    body: lifecycleInput,
    cookie: firstGuest.cookie,
  })
).data;
expect(retry.id, draftMessage.id, "retry after edit keeps identifier");
expect(
  (await call(`${mutation}/delete`, { body: {}, token: modToken })).response.status,
  200,
  "moderator deletion",
);
const deletions = (
  await call<Schemas["MessageChanges"]>(changesPath, { cookie: secondGuest.cookie })
).data.changes;
expect(deletions.at(-1)?.message, null, "reconcile deletion without body");
expect(
  (
    await call(`/api/v1/channels/${channel}/messages`, {
      body: lifecycleInput,
      cookie: firstGuest.cookie,
    })
  ).response.status,
  410,
  "deleted send retry",
);
expect(
  (await call<Schemas["HistoryPage"]>(timelinePath, { cookie: firstGuest.cookie })).data.messages
    .length,
  1,
  "deleted body absent from history",
);
expect(
  (await call("/api/v1/message-retention", { body: { days: 30 }, token: modToken })).response
    .status,
  403,
  "moderator cannot set retention",
);
expect(
  (
    await call<Schemas["MessageRetention"]>("/api/v1/message-retention", {
      body: { days: 30 },
      token,
    })
  ).data.days,
  30,
  "set retention",
);
expect(
  (
    await call<Schemas["MessageRetention"]>("/api/v1/message-retention", {
      body: { days: 0 },
      token,
    })
  ).data.days,
  0,
  "disable retention",
);
console.info(
  "PASS: timeline, send retry after edit, owner retention and moderator deletion with durable reconciliation.",
);
const listMembers = (await call<Schemas["MemberPage"]>("/api/v1/participants", { token: modToken }))
  .data;
assert(listMembers.members.some((member) => member.id === secondGuest.id && member.canBlockIp));
expect(
  (await moderate(secondGuest.id, { action: "ban", blockIp: true }, modToken)).response.status,
  200,
  "ban with IP",
);
expect(
  (
    await call<Schemas["Error"]>("/api/v1/me", {
      cookie: firstGuest.cookie,
      clientIpHeader: "192.0.2.19",
    })
  ).data.code,
  "ip_blocked",
  "Caddy overwrites untrusted IP header and denies other guests at the same IP",
);
expect(
  (
    await call<Schemas["Error"]>("/api/v1/guests", {
      body: { nickname: "Fresh guest", invitation: "unused" },
      clientIpHeader: "192.0.2.19",
    })
  ).data.code,
  "ip_blocked",
  "IP block also denies fresh identities",
);
expect(
  (await call("/api/v1/me", { token: modToken })).response.status,
  200,
  "IP block does not disable signed-in staff",
);
const audit = (await call<Schemas["ModerationAudit"]>("/api/v1/moderation/audit", { token })).data
  .events;
assert(
  audit.some(
    (event) =>
      event.action === "ban" &&
      event.targetId === secondGuest.id &&
      event.actorId === mod.id &&
      event.ipBlocked,
  ),
);
expect(
  audit.filter((event) => event.action === "provision_moderator").length,
  1,
  "provision audit deduplication",
);
expect(
  (await moderate(secondGuest.id, { action: "unban" }, modToken)).response.status,
  200,
  "lift ban and associated address block",
);
expect(
  (await call("/api/v1/me", { cookie: firstGuest.cookie })).response.status,
  200,
  "shared address restored",
);
expect(
  (await call(`/api/v1/participants/${secondGuest.id}/ban`, { body: {}, token })).response.status,
  200,
  "legacy identity ban",
);
expect(
  (
    await call(`/api/v1/channels/${channel}/messages`, {
      body: { requestId: randomUUID(), body: "denied" },
      cookie: secondGuest.cookie,
    })
  ).response.status,
  403,
  "banned write",
);
expect(
  (
    await call<Schemas["Error"]>("/api/v1/guests", {
      body: { nickname: "Retry" },
      cookie: secondGuest.cookie,
    })
  ).data.code,
  "participant_banned",
  "banned cookie cannot be replaced",
);
console.info(
  "PASS: moderator provisioning, role changes with an existing token, mute/unmute, identity/IP moderation, and audit.",
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
await writeFile(".tmp/container-smoke-state.json", JSON.stringify({ channel, guest: firstGuest }), {
  mode: 0o600,
});
console.info(
  "PASS: complete container setup/login, two guest identities, invitations, shared durable chat, concurrent retry deduplication, ban, revoked JWT and private ingress.",
);
