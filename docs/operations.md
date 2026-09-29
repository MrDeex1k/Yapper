# Operations plan

A complete local container smoke installation exists; public production installation and recovery remain unverified. See [Stage 1 evidence](evidence/stage-1.md). `compose.yaml` provides Caddy/Go/AUTH/PostgreSQL/LiveKit topology, and `compose.smoke.yaml` restricts the smoke ingress to loopback HTTP. Do not use that override for public deployment.

The base Compose configuration requires `YAPPER_DOMAIN` (trusted public domain), `YAPPER_PUBLIC_IP` (advertised media address), and the distinct secrets/database settings in `.env.example`. Ingress uses TCP 80/443; media uses TCP 7881 and UDP 7882. Internal signaling port 7880 must remain private so clients cannot bypass Go admission/revocation. The optional [TURN overlay](#turntls-on-one-public-ipv4-address) adds restrictive-network fallback. Generated development settings are not a production installation procedure.

## TURN/TLS on one public IPv4 address

`compose.turn.yaml` adds embedded LiveKit TURN/TLS. HAProxy routes the TURN hostname's TLS stream to LiveKit and other TLS streams to Caddy, sharing public TCP 443. TLS terminates at each service; HAProxy does not receive certificate private keys. This is an IPv4, single-host deployment option. Public network and real-device acceptance remain required before claiming reliable fallback.

Requirements:

- Docker Compose 2.24.4 or newer, including support for `!override`.
- Distinct `YAPPER_DOMAIN` and `YAPPER_TURN_DOMAIN` DNS names resolving directly to `YAPPER_PUBLIC_IP`. Do not put an HTTP-only CDN/proxy in front of the TURN hostname. TURN clients must send TLS SNI; encrypted ClientHello routing is not supported by this configuration.
- A trusted certificate chain and matching private key for the TURN hostname, in `fullchain.pem` and `privkey.pem` inside `YAPPER_TURN_CERT_DIR`. Use an absolute directory, restrict host access, and mount the directory read-only. Files under `deploy/certs/` are ignored by Git. Missing directories fail startup instead of being created implicitly.
- A nonoverlapping private subnet for HAProxy's TURN connection. Defaults are `YAPPER_TURN_PROXY_SUBNET=172.30.244.0/29` and `YAPPER_TURN_PROXY_IP=172.30.244.2`; change both consistently if they overlap host/VPN/Docker routes. Only that proxy address is trusted to supply PROXY protocol headers. Signaling still uses the private application network and Go admission.

Start with the same protected environment file used by the base installation:

```sh
docker compose --env-file .env -f compose.yaml -f compose.turn.yaml up -d --build
```

Use both files on subsequent `up`, `restart`, `logs` and `down` commands. Do not combine the public overlay with `compose.smoke.yaml`. Keep database volumes when stopping an installation.

| Host port           | Purpose                                    |
| ------------------- | ------------------------------------------ |
| TCP 80              | Caddy HTTP/ACME                            |
| TCP 443             | HAProxy TLS passthrough for HTTPS and TURN |
| UDP 443             | Caddy HTTP/3                               |
| TCP 7881 / UDP 7882 | Direct LiveKit media                       |
| UDP 30000–30127     | TURN relay allocations                     |

Open these server firewall ports and preserve the port numbers through any host NAT. Clients using TURN/TLS need outbound TCP 443; the server still needs UDP connectivity for relayed traffic. The 128-port relay pool is an initial operational bound, not a capacity claim. The overlay allows four concurrent allocations per participant; revisit pool size, matching port mappings and the per-participant quota during measured capacity/reconnect testing. Private, loopback, link-local and multicast TURN peers retain LiveKit's default denial policy.

Caddy manages the application hostname's certificate as before. The operator must obtain and renew the separate TURN certificate; no automatic TURN certificate renewal is implemented. Replace both PEM files in the mounted directory and restart LiveKit during the documented maintenance window to load them. Active voice connections are interrupted. Test renewed certificate validity and a relay connection before returning the server to service. Never disable client TLS validation to accommodate an invalid certificate.

References checked against the pinned versions: [LiveKit 1.13.7 TURN listener and peer policy](https://github.com/livekit/livekit/blob/v1.13.7/pkg/service/turn.go), [LiveKit configuration](https://github.com/livekit/livekit/blob/v1.13.7/config-sample.yaml), and [HAProxy 3.2 configuration](https://docs.haproxy.org/3.2/configuration.html). Context7 returned LiveKit master documentation; the versioned source was checked to resolve that coverage gap.

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

**Approved intent:** keep `MrDeex1k/Yapper` on GitHub and start a completely new Git history. **Current status:** reset executed on 2026-09-29; see [evidence and remaining limitations](evidence/stage-0.md#repository-reset).

Execute this as a dedicated operation at the start of implementation, not as an incidental documentation edit:

1. Inspect the remote's current default branch, branch/tag refs, protections, active PRs, and any attached worktrees. Preserve the new approved documents. Record the intended ref changes before applying them.
2. Initialize a fresh local repository with a root commit containing the new baseline; ensure it has no parent from the old history. Keep credentials, generated output, and backups out of that commit.
3. Replace the remote default branch with the new root using an explicit expected-old-ref guard. If the remote changed since inspection, inspect again rather than overwriting unexpected work.
4. Remove obsolete project-owned branch and tag refs retaining the old history according to the recorded reset scope. Identify any PR or protected-ref blocker instead of assuming the default-branch rewrite removes every reference.
5. Verify a fresh clone has the intended new root and only the intended branches/tags, and that repository identity/settings remain intact. Restore any temporarily adjusted protection and apply the squash-only workflow.

Repository deletion is excluded. Git history replacement does not guarantee physical erasure from GitHub retention, PR refs, forks, cached objects, or other people's clones. Releases, build artifacts, and packages are separate resources; inspect and address their scope explicitly during the reset instead of assuming a force-push removes them.

The procedure above is retained for audit; the linked evidence records what was actually executed.

## Database connection credentials

Compose passes `AUTH_DB_PASSWORD` and `APP_DB_PASSWORD` as separate `AUTH_DATABASE_PASSWORD` and `DATABASE_PASSWORD` service environment values. Do not URI-encode those raw password variables manually. AUTH encodes its URL password component and Go supplies the pgx password field; reserved URL characters remain password data. When setting Compose environment files, quote literal dollar signs according to Compose environment-file syntax. Local development URLs remain supported when the separate password override is absent.
