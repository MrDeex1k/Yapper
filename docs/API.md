# HTTP and event contract (protocol 1, development)

Base path: `/api/v1`. Bodies are UTF-8 JSON objects, at most 64 KiB. Mutations require `Content-Type: application/json`; unknown and duplicate fields, multiple values and compressed bodies are rejected before effects. Errors have `{ "error": { "code": "...", "message": "..." } }`. Authentication uses `Authorization: Bearer <session>`; never put a token in a URL. Responses must not be shared-cacheable when authenticated.

`GET /info` returns name, version and protocol. `/health/live` does not depend on PostgreSQL; `/health/ready` checks admission and PostgreSQL with a bounded timeout. Startup applies checksummed SQL migrations inside an advisory-locked transaction. Changed applied migrations fail startup; add a new migration instead.

Planned route families are `/auth`, `/channels`, `/messages` and `/events`; their implementation is tracked by the corresponding stages. Message history uses monotonically increasing decimal string IDs as cursors, never JavaScript floating-point IDs. History is bounded to 50 messages per page, newest first. A reconnect refetches authoritative data; it does not assume delivery of every notification.

## Migration recovery

Before upgrading, back up PostgreSQL. Migrations are additive where possible and have no automatic down path. If a new schema cannot run with the old binary, restore the pre-upgrade backup into a fresh database and run the previous image. Never edit an already applied migration or reuse a failed published version number.
