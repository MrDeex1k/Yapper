# Initial protocol contract

Status: initial conversation endpoints are implemented for Stage 1 review. The authoritative HTTP schema is [`packages/api/openapi.json`](../packages/api/openapi.json); generated TypeScript types are checked with `pnpm check:api`. Protocol version is `v1`. A successful identity probe does not grant community permissions.

## Implemented HTTP boundary

- `GET /api/v1/health`: public, returns `{ "status": "ok", "service": "yapper", "version": "0.0.0" }`.
- `GET /api/v1/identity`: requires an AUTH bearer token; returns `{ "subject": "..." }`. Missing/invalid token is 401. This is a compatibility probe, not a participant profile or role lookup.
- `/api/auth/*`: Better Auth's pinned HTTP contract. Public sign-up is closed. Host-authorized setup provisions the owner through the private AUTH API.
- Application responses use JSON, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`.

## Stage 1 conversation contract

Go is authoritative for participant IDs, membership state and current roles. An AUTH `(issuer, subject)` binding identifies an account; a JWT role claim never authorizes an operation. A guest uses an opaque HttpOnly cookie in Web. Secrets never enter browser localStorage.

Versioned HTTP resources cover setup state, guest admission, current participant, invitations, channels, messages and media admission. Errors carry a stable `code` translated by clients, never an unfiltered database exception. Validate unknown fields, body sizes, identifier formats and UTF-8 text at ingress. Require an exact trusted Origin for cookie-authenticated mutations and WebSocket upgrades.

A message send includes a client-generated UUID request ID. The unique key is `(participant_id, request_id)`; retries return the original committed message, while reuse with a different payload fails. Persist before returning success or broadcasting. Pagination uses a server-assigned monotonic sequence as a cursor, not timestamps alone.

WebSocket envelopes use `{ "version": 1, "type": "...", "payload": {...} }`. Implemented events are `ready` and `message.created`; revocation closes the connection. Participant-change events remain planned. Durable message state is reconciled from HTTP history on reconnect; presence is replaced by a fresh snapshot. Bound frames, write queues and idle time. Disconnect slow consumers instead of accumulating unbounded buffers.

The shared API package exports generated transport types. Web and Go workspace dependencies include the contract in Turbo invalidation. `POST /api/v1/voice/leave` accepts an optional media identity so stale cleanup does not revoke a replacement session.
