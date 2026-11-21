# Stage 3 implementation plan

**Status** Proposed implementation. The isolated verification branch `test/verify-stage-3` uses the accepted Stage 2 PR revision while that PR is open. Start production implementation from `main` after the Stage 2 merge. The goal is to make one self-hosted Yapper installation reproducible, recoverable, and measurable. See the [automated evidence](evidence/stage-3-automated.md).

The [implementation roadmap](implementation-plan.md#stage-3--operational-reliability-and-capacity), [operations plan](operations.md), and [validation criteria](validation.md#capacity-gate) define the scope. The current baseline includes Docker Compose, separate PostgreSQL databases for AUTH and the application, local ingress and persistence smoke tests, and an isolated TURN/TLS test. The production restore, failed-update drill, and capacity run are Stage 3 deliverables.

## 1. Coordinated backup and clean restore

Suggested branch `feat/implement-backup-restore`.

- Use a documented maintenance window to stop writes across the two databases while taking a coordinated backup. Include both databases, deployment configuration, secrets, and the identity and signing material required for recovery. Record the source versions and verification checksums in a manifest. Define who can access, retain, and move the archive off-host.
- Provide an operator procedure to verify an archive and restore it into a clean Compose project with separate volumes. Seed a disposable source instance with an owner, moderator, guest, text history, and voice channels. Document the recovery point and the writes made after the backup that a restore can lose.
- **Acceptance** An additional host or isolated clean environment restores the archive. The owner can sign in, the existing guest credential resolves to the same participant, and roles, history, and voice admission survive. A damaged or incomplete archive is rejected before import. The archive is accessible only to the operator.

## 2. Installation and local diagnostics

Suggested branch `feat/implement-diagnostics`.

- Document the Linux host, supported architecture, Compose, DNS/TLS, public and internal ports, media configuration, and optional TURN/TLS. Define distinct service credentials, migration order, host-side owner setup, and post-install smoke checks. Reuse the existing Compose setup and smoke tooling.
- Define liveness and readiness for the relevant services and document degraded behavior. Record versions, active connection counts, request IDs, and media/admission failures. Limit local log size and provide an operator-triggered diagnostic export. Redact credentials and message content from both logs and exports.
- **Acceptance** An operator can install a clean instance from the guide and complete setup, chat, and a real voice join. The diagnostics distinguish a stopped service from an unavailable dependency, stay within the documented log limits, and expose no credentials, signing keys, or message bodies.

## 3. Owner recovery and access controls

Suggested branch `feat/recover-owner-access`.

- Provide host-side owner account recovery with a local audit record and revocation of replaced sessions. Define account and session revocation behavior across HTTP, active WebSockets, and voice grants. Exercise signing-key rotation with a bounded overlap and verification of retired and unknown keys.
- Apply configurable limits to relevant admission and messaging routes. Verify address-based limits through the trusted ingress and account for guests sharing a network. Keep any new client-facing errors actionable in English and Polish.
- **Acceptance** A lost owner credential can be replaced from the host. Superseded credentials and revoked sessions lose access under the documented policy. Rotation accepts the expected keys during overlap and retires old keys on schedule. Rate-limit tests cover normal traffic, bursts, and recovery after throttling.

## 4. Manual updates and failure recovery

Suggested branch `feat/document-upgrade-recovery`.

- Define the release manifest, maintenance order, pre-update backup verification, migration sequence, and post-update smoke steps. Upgrade a populated instance from a named previous test revision. Induce a failed migration or update and apply the documented restore procedure to the staging environment.
- Interrupt AUTH, Go, PostgreSQL, LiveKit, and the client network separately. Check expired TLS and unavailable JWKS or media endpoints. Verify that the client reports the failure accurately, existing guest sessions behave as documented during AUTH downtime, and registered-user access follows token expiry and cached-key rules.
- **Acceptance** A successful update preserves accounts, guest identities, roles, and messages. A failed update has a repeatable recovery path with an observed recovery point. The tested interruptions recover as documented without duplicate acknowledged sends, duplicate voice sessions, or unauthorized publication.

## 5. Capacity and final acceptance

Suggested branch `test/verify-capacity-and-recovery`.

- Build a repeatable load scenario around the real server contract and LiveKit. Use 100 persisted participant records, 30 simultaneous online participants, and 20 simultaneous voice participants across at least two channels, with at most 10 per channel. Exercise concurrent text sends, voice joins and leaves, and reconnects. Run for 30 minutes after warm-up by default and include repeated join/leave cycles.
- Record the target host, CPU architecture, memory, storage, software versions, network conditions, and idle baseline. Use the existing Stage 1 scenarios to establish a baseline on that environment. Set numeric pass thresholds for text acknowledgement latency, voice join and recovery time, and resource growth before the acceptance run. Record actual CPU, memory, disk, bandwidth, packet loss, and jitter.
- **Acceptance** The declared workload meets the recorded thresholds with no crash, out-of-memory event, lost acknowledged message, duplicate committed send, or unauthorized access. Confirm real two-way audio on the agreed devices alongside the load run. Recheck the restore and failed-upgrade evidence against the final revision and document bottlenecks and platform/network limits.

## Boundaries and evidence

- Use a disposable Compose instance for destructive drills and load. Record the source revision, service and image versions, host, conditions, results, and unverified cases in a linked Stage 3 evidence report. Keep backups and raw diagnostic data out of Git.
- Keep the current Compose and application stack. Add TanStack Table only if the participant directory or moderation audit needs sortable and filterable columns. Define server-side filtering and stable ordering across the entire result set before connecting a paginated table.
- Stage 4 owns full GPUI/Web parity, desktop packages, and the release device matrix.

The first deliverable is a backup and restore drill with one populated source and one clean destination. The update work reuses that procedure. Final Stage 3 acceptance requires the clean restore, the demonstrated recovery from a failed update, the access-control checks, and the measured capacity run.
