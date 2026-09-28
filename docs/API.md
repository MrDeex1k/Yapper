# HTTP and event contract (protocol 1, development)

Base path: `/api/v1`. Bodies are UTF-8 JSON objects, at most 64 KiB. Mutations require `Content-Type: application/json`; unknown and duplicate fields, multiple values and compressed bodies are rejected before effects. Errors have `{ "error": { "code": "...", "message": "..." } }`. Authentication uses `Authorization: Bearer <session>`; never put a token in a URL. Responses must not be shared-cacheable when authenticated.

`GET /info` returns name, version and protocol. `/health/live` does not depend on PostgreSQL; `/health/ready` checks admission and PostgreSQL with a bounded timeout. Startup applies checksummed SQL migrations inside an advisory-locked transaction. Changed applied migrations fail startup; add a new migration instead.

Planned route families are `/auth`, `/channels`, `/messages` and `/events`; their implementation is tracked by the corresponding stages. Message history uses monotonically increasing decimal string IDs as cursors, never JavaScript floating-point IDs. History is bounded to 50 messages per page, newest first. A reconnect refetches authoritative data; it does not assume delivery of every notification.

## Migration recovery

Before upgrading, back up PostgreSQL. Migrations are additive where possible and have no automatic down path. If a new schema cannot run with the old binary, restore the pre-upgrade backup into a fresh database and run the previous image. Never edit an already applied migration or reuse a failed published version number.

WebSocket notifications use `{ "protocol": 1, "id": "opaque", "type": "message.created", "channel_id": "opaque" }`. Clients ignore unknown event types and refetch on reconnect. Unsupported protocol versions require a client update. Events carry no message body: permission checks remain on the authoritative HTTP read. WebSocket authentication is the first frame, not a query parameter; transport implementation follows in F02-E04.

## Authentication (implemented in F02-E02)

- `POST /auth/bootstrap`: `{username,password,token}` creates the only initial administrator and general channel. Requires the configured `BOOTSTRAP_TOKEN`; a database lock prevents two initial admins.
- `POST /auth/login`: `{username,password}` returns `{token,expires_at,user}`. Sessions expire after seven days. Only SHA-256 digests of random session/invitation tokens are stored.
- `POST /auth/invites`: administrator-only, creates a single-use invitation valid for 24 hours.
- `POST /auth/register`: `{username,password,invite}` consumes the invitation atomically with account creation and returns a session.
- `GET /auth/me`: returns the active user. `POST /auth/logout` revokes the current session.

Passwords require 12–72 bytes and are hashed with bcrypt cost 10. Usernames use lowercase ASCII letters, digits, `_` and `-` (3–32 characters). Auth work is limited to four concurrent hash operations and 20 attempts/minute per direct peer. Behind the bundled proxy this is a shared limit; untrusted forwarding headers are never used as identity. External per-client throttling can be added at a trusted edge.
