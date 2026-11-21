# Initial protocol contract

The initial conversation endpoints are implemented in Stage 1. The authoritative HTTP schema is [`packages/api/openapi.json`](../packages/api/openapi.json). `pnpm check:api` checks the generated TypeScript types. The protocol version is `v1`. A successful identity probe does not grant community permissions.

## Implemented HTTP boundary

- `GET /api/v1/health`: public, returns `{ "status": "ok", "service": "yapper", "version": "0.0.0" }`.
- `GET /api/v1/identity`: requires an AUTH bearer token; returns `{ "subject": "..." }`. Missing/invalid token is 401. This is a compatibility probe, not a participant profile or role lookup.
- `/api/auth/*`: Better Auth's pinned HTTP contract. Public sign-up is closed. Host-authorized setup provisions the owner through the private AUTH API.
- Application responses use JSON, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`.

## Stage 1 conversation contract

Go is authoritative for participant IDs, membership state and current roles. An AUTH `(issuer, subject)` binding identifies an account; a JWT role claim never authorizes an operation. A guest uses an opaque HttpOnly cookie in Web. Secrets never enter browser localStorage.

Versioned HTTP resources cover setup state, guest admission, current participant, invitations, channels, messages and media admission. Errors carry a stable `code` translated by clients, never an unfiltered database exception. Validate unknown fields, body sizes, identifier formats and UTF-8 text at ingress. Require an exact trusted Origin for cookie-authenticated mutations and WebSocket upgrades.

A message send includes a client-generated UUID request ID. The unique key is `(participant_id, request_id)`; retries return the original committed message, while reuse with a different payload fails. Persist before returning success or broadcasting. Pagination uses a server-assigned monotonic sequence as a cursor, not timestamps alone.

WebSocket envelopes use `{ "version": 1, "type": "...", "payload": {...} }`. Stage 1 events are `ready` and `message.created`. Stage 2 adds catalog and member invalidation events. Revocation closes the connection. Durable message state is reconciled from HTTP history on reconnect; presence is replaced by a fresh snapshot. Bound frames, write queues and idle time. Disconnect slow consumers instead of accumulating unbounded buffers.

The shared API package exports generated transport types. Web and Go workspace dependencies include the contract in Turbo invalidation. `POST /api/v1/voice/leave` accepts an optional media identity so stale cleanup does not revoke a replacement session.

## Stage 2 admission controls

Only owners may change admission or manage invitations. `POST /api/v1/admission` changes the mode and `GET /api/v1/state` reports it to joining clients. Changing the mode preserves previously admitted identities.

`POST /api/v1/invitations` accepts optional `expiresInHours` and `maxUses` values. An empty request retains the Stage 1 defaults of 24 hours and one use. Zero disables the corresponding limit. Creation returns the opaque code once. The list returns IDs, creation times, expiry, remaining uses, and revocation state. Unlimited fields are `null`.

`POST /api/v1/invitations/{id}/revoke` is idempotent for existing invitations. Revocation prevents future use in closed mode. Open mode admits guests without consuming an invitation, and existing memberships survive revocation and subsequent mode changes.

## Channel catalog

`GET /api/v1/me` includes ordered categories and channels. A channel exposes its category UUID (empty when uncategorized) and archival state. Owners can create and rename categories, move them up/down, and create, rename, move, categorize, and archive text or voice channels. Channel moves are relative to others of the same kind in the same category. Archiving preserves IDs and text history, rejects new messages/grants and revokes live media in that channel.

`catalog.changed` is a version 1 event with an empty payload. Refresh `/api/v1/me` on that event and on `ready` to cover changes while disconnected.

## Membership and moderation

- `POST /api/v1/moderators` provisions a local username/password account for the owner. A retry with the existing credentials preserves its community ID and current role. A conflicting username is 409. Public signup stays disabled.
- Staff can read `GET /api/v1/participants` in UUID-ordered pages of 50 via `after`, or look up a single member via `target`. The newest 100 audit records are at `GET /api/v1/moderation/audit`. These responses contain identity or action metadata without network addresses or credentials.
- `POST /api/v1/participants/{id}/moderate` supports kick, ban, unban, forced mute/unmute and moderator grant/revocation. Only the owner can change roles, and the target needs an existing account. The existing `/ban` endpoint still performs an identity ban.
- Ban with `blockIp: true` also blocks guest traffic observed at the target's last verified IP. An unban releases that identity's associated IP blocks. Other bans on the same address still apply. Signed-in accounts continue to use their identity permissions.
- `members.changed` has an empty payload. Refresh `/api/v1/me` and any open moderation view. `me.account` distinguishes a signed-in account from a guest even after demotion, and `me.participant.micMuted` reports enforced mute.
- A kick increments the participant's connection generation and invalidates earlier WebSocket tickets and the active voice grant. A live WebSocket closes with code `4001`. A fresh ticket is available when the user reconnects. A ban refuses the credential and replayed grants, including admission retries using the banned cookie.
- Forced mute and its removal invalidate the current media session. Rejoining obtains a new grant, with `canPublish: false` while forced mute is active. Those grants retain subscribe permission. The Go signaling gate rejects earlier revoked identities even when self-hosted LiveKit would accept their signed tokens directly.

## Message lifecycle

The original `GET /channels/{id}/messages?after={sequence}` returns live messages. Use `GET /channels/{id}/timeline` for the newest 50 in chronological order. Pass its `before` sequence to load older messages exclusively of that item. A zero `before` means there is no older page. The initial page and its concurrent-safe `revision` are read together.

After the initial page, fetch `/channels/{id}/messages/changes?after={revision}` on `ready`, `message.created`, or `messages.changed` for that channel. The latter event contains only `channelId`. Each change carries the current message or a `null` tombstone. Consume batches of 100 until there are fewer and advance to the last revision. Read older pages and changes in sequence to prevent a stale page from resurrecting a deletion. The feed collapses multiple changes to the same message into its latest state.

Authors edit via `POST /channels/{id}/messages/{message}/edit` with the edited body and the last read revision. Authors and current staff delete via `.../delete`. Archived channels accept authorized deletions and reject edits and new sends. Edits preserve the message ID and creation sequence. An identical send retry after an edit returns the current message with the original ID. A retry after deletion or expiry returns `410 message_gone`. Staff deletions of other participants' messages add an audit record with the target message ID.

The owner reads or sets `/message-retention` with `days` from 0 to 36500. Zero keeps messages indefinitely. The server erases expired bodies across all text channels in bounded batches from startup and once per minute. A change to the limit takes effect on the next pass. IDs, ordering data and retry keys are retained after erasure. Coordinated backups can still contain older content until the backup expires.

## Voice switching and recovery

A manual join sends the channel ID to `POST /api/v1/voice/grant`. The service invalidates the old identity and finishes pending LiveKit removals for that participant before returning the new grant. Leave requests with a media identity affect only that identity.

After an established room's SDK reconnect attempts end with a transient disconnect, clients can attempt one fresh grant with the previous `resumeIdentity` and the same `channelId`. Go checks both against the current unrevoked media session while rotating the grant. A kick, ban, forced mute, archival, stale identity, or manual leave prevents that automatic recovery. Clients use a manual join to return to an available room with current permissions. An automatic replacement starts muted.

## Planned Rust desktop conformance

The Windows and Linux GPUI client uses the same server contract as Web. The Stage 2 prototype verifies origin handling, guest admission and restoration, basic timeline and message writes, and Go-gated LiveKit signaling. The full desktop conformance checks cover AUTH login/logout and versioned WebSocket events and tickets. Preserve browser origin protections and server-side authorization as native coverage expands.
