# Operations plan

The local Compose smoke installation has passed. A temporary Cloudflare Tunnel test also verified public HTTPS, login and chat over WSS. The tunnel was removed after testing. Public media and production recovery remain pending. See the [Stage 1 evidence and remaining checks](evidence/stage-1.md#current-status). `compose.yaml` provides Caddy, Go, AUTH, PostgreSQL and LiveKit. Use `compose.smoke.yaml` only for loopback HTTP testing.

The base Compose configuration requires `YAPPER_DOMAIN` (trusted public domain), `YAPPER_PUBLIC_IP` (advertised media address), and the distinct secrets/database settings in `.env.example`. Ingress uses TCP 80/443; media uses TCP 7881 and UDP 7882. Internal signaling port 7880 must remain private so clients cannot bypass Go admission/revocation. The optional [TURN overlay](#turntls-on-one-public-ipv4-address) adds restrictive-network fallback. Generated development settings are not a production installation procedure.

## TURN/TLS on one public IPv4 address

`compose.turn.yaml` adds embedded LiveKit TURN/TLS. HAProxy routes the TURN hostname's TLS stream to LiveKit and other TLS streams to Caddy, sharing public TCP 443. TLS terminates at each service; HAProxy does not receive certificate private keys. This is an IPv4, single-host deployment option. Public network and real-device acceptance remain required before claiming reliable fallback.

Requirements:

- Docker Compose 2.24.4 or newer, including support for `!override`.
- Distinct `YAPPER_DOMAIN` and `YAPPER_TURN_DOMAIN` DNS names resolving directly to `YAPPER_PUBLIC_IP`. Do not put an HTTP-only CDN/proxy in front of the TURN hostname. TURN clients must send TLS SNI; encrypted ClientHello routing is not supported by this configuration.
- A trusted certificate chain and matching private key for the TURN hostname, in `fullchain.pem` and `privkey.pem` inside `YAPPER_TURN_CERT_DIR`. Use an absolute directory, restrict host access, and mount the directory read-only. Files under `deploy/certs/` are ignored by Git. Missing directories fail startup instead of being created implicitly.
- A nonoverlapping private subnet for HAProxy's TURN connection. Defaults are `YAPPER_TURN_PROXY_SUBNET=172.30.244.0/29` and `YAPPER_TURN_PROXY_IP=172.30.244.2`; change both consistently if they overlap host/VPN/Docker routes. Only that proxy address is trusted to supply PROXY headers to both Caddy and LiveKit on the private subnet. The router starts first to reserve its configured address. Signaling still uses the private application network and Go admission.

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

See the [LiveKit 1.13.11 TURN listener and peer policy](https://github.com/livekit/livekit/blob/v1.13.11/pkg/service/turn.go), the [LiveKit 1.13.11 configuration](https://github.com/livekit/livekit/blob/v1.13.11/config-sample.yaml), and the [HAProxy 3.4 configuration](https://docs.haproxy.org/3.4/configuration.html).

## Guest IP blocks

The standard Compose stack configures Go to accept the client-address field set by Caddy on the private application network. Keep the Go HTTP listener unpublished. Caddy overwrites `X-Yapper-Client-IP` with its connection peer address. With the TURN overlay, HAProxy supplies the original TCP peer address to Caddy via PROXY v2. Direct Go runs use the socket peer. See the [Caddy PROXY protocol listener configuration](https://caddyserver.com/docs/caddyfile/options#proxy-protocol).

If an additional proxy or tunnel is placed in front of Caddy, the connection peer may represent multiple users. Verify address handling for that ingress path before using the IP block option. Go stores the last observed address of guest identities and addresses explicitly blocked by staff. An identity unban removes that identity's associated address blocks. Restrict database/backup access as for other membership data.

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

Updates are manual and may disconnect conversations. Use versioned images and a release manifest tying AUTH, Go, Web, desktop package versions, protocol compatibility, and schema versions together.

Stage 1 starts PostgreSQL 19 with fresh volumes because there is no existing Yapper database to migrate. If upgrading a separate PostgreSQL 18 installation, keep the original volume and migrate both databases to a fresh PostgreSQL 19 volume before switching. Test the coordinated backup and restore with both database roles and verify owners, guest identities, and message history before promotion.

Before updating, announce maintenance, stop new writes or use a documented coordinated consistency method, and back up both databases plus configuration, secrets, and signing material. Apply migrations in a defined order and run post-update smoke checks before returning to service.

Store backups separately from the live volume and restrict access; an archive contains private data and credentials. Define retention, verification, and the operator's responsibility to move backups off-host. Message-retention expiry does not automatically purge older backups.

Rollback across an incompatible migration restores the corresponding backup and configuration together. It may lose writes after the backup point. Merely starting an older image is not a complete rollback procedure.

Restore drills must use a clean environment and verify owner access, existing identities, history, permissions, and voice. Host-side owner recovery must revoke replaced credentials/sessions and produce a local audit event without printing reusable secrets into routine logs.

## Diagnostics

Provide local health/readiness, service versions, active connection counts, media/admission failures, and bounded logs with request identifiers. Exclude message bodies, passwords, session cookies, bearer tokens, and private signing keys.

A diagnostic export is operator-triggered, reviewed/redacted locally, and shared only deliberately. No automatic external telemetry or crash upload is enabled.

## Client distribution

Private distribution to friends comes first. Prepare Rust/GPUI packages for Windows and Linux. macOS users access the first release through Web. Provide manual update instructions and record package signing or integrity verification by platform. Document how users of Stage 1 development builds can sign in or rejoin, including the treatment of saved servers and guest identities. Select supported Linux distributions and package formats during release preparation. Windows signing is not available at planning time.

Before public distribution, revisit installer signing/notarization, update trust, artifact integrity, supported architectures, and license selection. License selection is deferred because the current scope is private testing; do not invent a license or describe the project as open source without one.

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
