# ADR 0001: independent instances and a modular server

Status: accepted for implementation, 2026-09-28.

Each Yapper instance owns its accounts and data. There is no mandatory central identity service. The client may remember several instance origins, but credentials must never cross origins.

Go owns authentication, authorization, channels, messages and moderation in one process, with PostgreSQL as durable storage. HTTP commands and bounded WebSocket notifications share server-side authorization. Clients resynchronize authoritative state after reconnect.

WebRTC media belongs to an independently deployed SFU. The application authorizes room admission; the SFU transports audio/video. LiveKit is the candidate, subject to F03 verification. TURN connectivity needs deployment-specific validation.

MVP ends at F04: web, Windows/Linux Electron, durable text and voice, basic moderation, backup and update instructions. F05 adds files, search, unread state, camera and screen sharing. Native clients follow later.

A stage is a stacked pull request in this implementation series. No PR is merged and no release is published by the implementation agent. Prepared workflows are not evidence of published releases.
