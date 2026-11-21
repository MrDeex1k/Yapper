# Stage 2 message lifecycle evidence

Validated locally on macOS arm64 and disposable OrbStack containers using Go 1.27.4, PostgreSQL 19, the pinned LiveKit 1.13.11 server and Electron 45.4.1.

- The PostgreSQL integration restored a message from the earlier schema with its original message and request IDs. It verified author-only edits, concurrent edit conflict detection, moderator deletion and audit, deduplication after editing, and rejection of retries after a deletion.
- Paging tests loaded the newest 50 messages and older history without duplicates or skipped live rows while an additional message arrived. The Web test applied durable edits and deletion from reconnect without changing the newly selected channel after a stale refresh.
- PostgreSQL retention erased eligible bodies in an archived channel. With retention disabled, the same eligible row was preserved. The HTTP Compose smoke covered retention authorization and the edit/delete/changes endpoints with real guest and moderator identities. It also verified persistence after restart and native Electron guest restore.
- The owner retention setting is off by default. Enabling it affects existing history across all channels on the next sweep. Erasure leaves identifiers and ordering data for retries and sync. Backups retain earlier bodies until the backup expires.

Repository formatting, lint, generated API, type, package test and build checks passed.

Manual browser checks for keyboard focus, responsive layout and scrolling in a long thread remain part of acceptance.
