# Operations plan

These are requirements for future operational tooling. No executable installation, recovery, or deployment commands exist yet.

## Installation

The baseline operator has a Linux VPS/publicly reachable server, a domain, and Docker Compose. One Compose project hosts one community. A setup workflow must:

1. Validate required configuration, supported CPU/OS, domain resolution, certificates, public address, and firewall/media ports.
2. Generate distinct secrets and persistent signing/identity material; store them outside committed source.
3. Initialize application and AUTH databases with separate roles and service-owned migrations.
4. Start ingress, Go, AUTH, PostgreSQL, and LiveKit, with readiness checks and persistent volumes.
5. Provide the owner setup token through a host-side channel and invalidate it after setup.
6. Verify a real client connection and media path, including TURN fallback where configured.

Use private networking for internal services. Document all exposed ports and any additional media/TURN domain requirements. A healthy HTTP endpoint does not prove voice connectivity.

The deployed Web application is served locally by the installation. No central Yapper website is necessary for client login or normal operation.

## Updates and backups

Updates are manual and may disconnect conversations. Use versioned images and a release manifest tying AUTH, Go, Web, Electron protocol compatibility, and schema versions together.

Before updating, announce maintenance, stop new writes or use a documented coordinated consistency method, and back up both databases plus configuration, secrets, and signing material. Apply migrations in a defined order and run post-update smoke checks before returning to service.

Store backups separately from the live volume and restrict access; an archive contains private data and credentials. Define retention, verification, and the operator's responsibility to move backups off-host. Message-retention expiry does not automatically purge older backups.

Rollback across an incompatible migration restores the corresponding backup and configuration together. It may lose writes after the backup point. Merely starting an older image is not a complete rollback procedure.

Restore drills must use a clean environment and verify owner access, existing identities, history, permissions, and voice. Host-side owner recovery must revoke replaced credentials/sessions and produce a local audit event without printing reusable secrets into routine logs.

## Diagnostics

Provide local health/readiness, service versions, active connection counts, media/admission failures, and bounded logs with request identifiers. Exclude message bodies, passwords, session cookies, bearer tokens, and private signing keys.

A diagnostic export is operator-triggered, reviewed/redacted locally, and shared only deliberately. No automatic external telemetry or crash upload is enabled.

## Client distribution

Private distribution to friends comes first. Prepare Windows and macOS packages with manual update instructions and explicit signing status. Apple signing access exists; configuring credentials and signing artifacts is implementation work. Windows signing is not available at planning time.

Before public distribution, revisit installer signing/notarization, update trust, artifact integrity, supported architectures, and license selection. License selection is deferred because the current scope is private testing; do not invent a license or describe the project as open source without one.

Reference: [Electron packaging and signing](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging).

## Repository history reset

**Approved intent:** keep `MrDeex1k/Yapper` on GitHub and start a completely new Git history. **Current status:** documentation-only local folder; no `.git` initialization, push, branch deletion, tag deletion, or remote settings change has been performed by this documentation task.

Execute this as a dedicated operation at the start of implementation, not as an incidental documentation edit:

1. Inspect the remote's current default branch, branch/tag refs, protections, active PRs, and any attached worktrees. Preserve the new approved documents. Record the intended ref changes before applying them.
2. Initialize a fresh local repository with a root commit containing the new baseline; ensure it has no parent from the old history. Keep credentials, generated output, and backups out of that commit.
3. Replace the remote default branch with the new root using an explicit expected-old-ref guard. If the remote changed since inspection, inspect again rather than overwriting unexpected work.
4. Remove obsolete project-owned branch and tag refs retaining the old history according to the recorded reset scope. Identify any PR or protected-ref blocker instead of assuming the default-branch rewrite removes every reference.
5. Verify a fresh clone has the intended new root and only the intended branches/tags, and that repository identity/settings remain intact. Restore any temporarily adjusted protection and apply the squash-only workflow.

Repository deletion is excluded. Git history replacement does not guarantee physical erasure from GitHub retention, PR refs, forks, cached objects, or other people's clones. Releases, Actions artifacts, and packages are separate resources; inspect and address their scope explicitly during the reset instead of assuming a force-push removes them.

This procedure records the approved future operation. It is not evidence that the remote history has already been replaced.
