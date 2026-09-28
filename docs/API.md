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

## Channels and messages (F02-E03)

`GET /channels` returns `{channels}` filtered by access. Administrators create channels with `POST /channels` and `{name,kind:"text",private}`. Private channels require membership except for administrators.

`GET /channels/{id}/messages?before={cursor}` returns `{messages,next_cursor}` (newest first, max 50). `POST` to the same path accepts `{content,client_id}` and returns the saved message. Retry an uncertain send with the same client ID and content. Reusing an ID for different content returns 409. IDs are strings. Message content is displayed as text, not injected HTML.

## Realtime and membership (F02-E04)

`GET /events` upgrades to WebSocket. Within five seconds send `{token,channel_id}`. The server verifies the current session and membership, sends `sync`, then channel notifications. Queues hold at most 32 events; slow clients disconnect and resynchronize. Limits are 2048 connections per process and eight per user. Every delivered event rechecks access; a 15-second heartbeat also rechecks idle connections. The initial auth frame is limited to 4 KiB. Origin must match the web host.

Administrator-only `PUT /channels/{channel}/members/{user}` grants membership; `DELETE` revokes it and disconnects the user's channel subscriptions immediately. Subsequent HTTP reads and WebSocket authentication also reject that access. The client reconnects with bounded exponential backoff and refreshes the latest page; older history remains accessible by cursor.

## Moderation and desktop (F04)

`GET /admin/users` lists up to 500 users for administrators/moderators. `PATCH /admin/users/{id}` accepts `{role?,banned?}`. Only administrators change roles or manage privileged accounts; moderators can ban/unban members. The last active administrator cannot be demoted/banned, and self-ban is forbidden. Mutations revoke all target sessions, cancel WebSockets and remove media access (SFU failures return `disconnect_pending` for reconciliation). `DELETE /channels/{channel}/messages/{id}` allows the author or a moderator/admin with channel access, then emits `message.deleted`.

The packaged desktop origin `yapper://app` is explicitly accepted for CORS/WebSocket; other browser origins retain the same-origin restriction. Saved servers contain only validated origins. Bearer tokens live in memory and are never reused when selecting a different instance.

## Attachments (F05-E01)

`POST /channels/{id}/files` accepts exactly one multipart field named `file`. It returns `{id,channel_id,filename,bytes}`. The server validates current access before and after receiving the body, bounds concurrent uploads to four, streams into an opaque local object and serializes quota accounting. `MAX_FILE_BYTES` defaults to 16 MiB and `FILE_QUOTA_BYTES` to 1 GiB of tracked payload bytes (filesystem overhead/crash orphans require disk monitoring). JSON requests remain limited to 64 KiB. Upload duration is also bounded by the HTTP server's read timeout.

`POST /channels/{id}/messages` additionally accepts `file_id`; the attachment must belong to the sender and channel. Include it unchanged on idempotent retries. `GET /files/{id}/info` returns metadata; `GET /files/{id}` authorizes against current channel membership and returns an attachment with `nosniff`, sandbox CSP and no-store caching. Files have no public static URL. The web/desktop client downloads through authenticated fetch; it does not preview active HTML/SVG content.

## Search, edits and read state (F05-E02)

`GET /search?q=...&before=...` searches indexed PostgreSQL `simple` lexemes using web-search syntax, filters channel permissions in SQL and returns up to 50 newest results with a next cursor. Queries are 2–200 characters. Search is lexical, not fuzzy matching or semantic search.

`PATCH /channels/{channel}/messages/{id}` accepts `{content}` for the author or a moderator/admin with access. It records `edited_at` and emits `message.updated`; concurrent edits use last-write-wins. The original send content is retained separately so retries after an edit return the existing edited message without reverting it.

`PUT /channels/{channel}/read-state` accepts `{last_message_id}` belonging to that channel. Updates only advance the cursor. `GET /channels` adds unread counts excluding one's own messages. Counts are stored per user/instance and visible across sessions; the UI refreshes channels every 15 seconds and on focus. Read state advances only when the end marker is visible in a visible tab.
