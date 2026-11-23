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

Use a Linux host with Docker and Compose 2.24.4 or newer. Build for the host architecture with the repository's pinned Dockerfile. The full Stage 3 rehearsal used arm64 in OrbStack. Verify resource capacity on the actual deployment host before putting it into use.

1. Point a trusted domain at the host, set `YAPPER_DOMAIN` and `YAPPER_PUBLIC_IP` in a protected `.env`, and set the distinct credentials listed in [the environment template](../.env.example). `node scripts/setup-dev.ts` generates distinct random values and a setup token with a 24-hour expiry. Set the production domain and media IP before starting Compose. Keep `.env` readable only by the operator.
2. Allow TCP 80/443 and 7881 and UDP 443 and 7882. PostgreSQL 5432, AUTH 3001, Go 8080, and LiveKit signaling 7880 stay on the private Compose network. Use the TURN overlay above for additional ports and certificate requirements.
3. Run `docker compose --env-file .env up -d --build --wait`. PostgreSQL creates two separate databases and roles. Compose runs each service migration before starting its dependent service. Open the configured HTTPS origin and supply the one-time setup token locally. A configured installation rejects reuse of that token.
4. Check `GET /api/v1/health` through the trusted HTTPS origin. Sign in, join as a guest, send a message, and verify voice and any configured TURN path with a real client. Use the diagnostics command below to check dependent services.

Set `YAPPER_AUTH_IMAGE`, `YAPPER_SERVER_IMAGE`, and `YAPPER_INGRESS_IMAGE` to release-specific references and retain the corresponding images or reproducible source. Record the installed source revision and all image IDs. The Web client is served by the same installation.

## Coordinated backup and restore

Run operator commands with Node 26 and the repository checked out. Supply the installed project's name and environment file when backing it up. Use the same profile flag for backup, verification, and restore. Choose `--turn` for an installation using the TURN overlay or `--smoke` for a disposable loopback drill.

```sh
node scripts/operations.ts backup --project yapper --env-file .env /protected/yapper-backup
node scripts/operations.ts verify /protected/yapper-backup
node scripts/operations.ts restore --project yapper-restore /protected/yapper-backup
```

Announce downtime first. Backup stops the running application, auth, ingress and media services, then dumps both databases with writes paused. It resumes the stopped services unless `--leave-stopped` is specified and a complete archive was written. Direct writers outside this stack must also be stopped for the maintenance window. Run mutations from one operator account per project, and check for active commands before clearing a stale host operator lock. The new directory holds both custom-format dumps, the protected environment, Compose files, image inventory, and a SHA-256 manifest. The AUTH dump and its original secret preserve signing and login material. The TURN profile includes its certificate and key. Caddy can reacquire managed HTTPS certificates on the restored host.

Only accept an archive from protected operator storage. Checksums detect corruption. Keep backup copies off the host, restrict their access, and expire them under the installation's retention policy, including copies containing expired chat history. Keep the archive out of version control.

Restore validates the checksums and Compose configuration before provisioning a separate, empty project. On the destination, check out the source used for backup, retain the recorded images, and restore any TURN certificate files to the directory referenced in the archived environment. If import is interrupted, investigate and use a fresh destination project. The command leaves application services stopped until both databases are present. To resume on the clean destination, start the matching images using the archived environment and verify owner login, the prior guest identity, message history, roles, and voice admission.

## Manual update and rollback

1. Announce downtime and take a verified backup with `--leave-stopped`. Record the old and new source revisions and image IDs. The backup timestamp is the recovery point.
2. On the new release checkout, keep the existing project and original environment. Build or load the selected image set. Run `docker compose run --rm --no-deps auth-migrate` and then `docker compose run --rm --no-deps server-migrate` with the same project, environment and overlays. Keep the public services stopped until both commands pass.
3. Run `docker compose up -d --wait` with the same arguments. Check diagnostics, sign-in, guest continuity, chat, and voice before reopening traffic. Monitor for failures during the maintenance window.
4. If a migration fails or the checks require rollback, keep the failed instance stopped. Restore to a clean Compose project using the corresponding old revision and image set. Confirm the restored snapshot before switching the ingress. The restored state omits writes made after the archived recovery point.

A major PostgreSQL version change requires restoring logical dumps into a compatible fresh version. Never point a newer major version at an older version's data directory.

## Owner recovery and signing keys

On the host, stop ingress, Go, AUTH, and LiveKit, leaving PostgreSQL available. Back up the installation first. Supply the replacement password in a private file on stdin, run the host-only command, and remove the temporary file when finished.

```sh
node scripts/operations.ts recover-owner --project yapper --env-file .env < /protected/new-password
docker compose --env-file .env up -d --wait
```

The command changes the bootstrapped owner's credential for the existing account, deletes its existing sessions in the same transaction, and records an operator audit event with the revoked session count. Session protection in Go applies to HTTP, existing WebSockets and voice grants. The stops above prevent concurrent sign-in during the change and disconnect live clients. Other roles, guest identities, and chat history remain intact.

Signing keys rotate lazily on token issuance after a 30-day lifetime. AUTH publishes retired public keys for a further 10 minutes, covering the maximum five-minute JWT lifetime and normal verifier refresh. Migration assigns an expiry to existing keys without one. Preserve the AUTH secret and database together across restore. Test the overlap and retirement against both AUTH and Go. Go refreshes its JWKS on a new key and rate-limits refresh attempts to protect AUTH.

## Diagnostics and request limits

Run `node scripts/operations.ts diagnostics --project yapper --env-file .env` on the host. The structured output contains Compose service state and image references, application database readiness, AUTH readiness, LiveKit reachability, active event streams and unrevoked voice grants. Save the output privately and review it before sharing. The export omits raw logs and credentials.

After origin and ingress-address validation, Go includes a generated `X-Request-ID` on application responses and records the matching ID, route template and status for rejected API POST requests, including media grants and guest admission. Inspect local logs using `docker compose logs --tail 100 server`. The Compose local log driver keeps three files of up to 10 MB per service before compression. Diagnostic HTTP endpoints are private. A grant count measures authenticated approvals and can include a client that has yet to establish media.

Set `YAPPER_GUEST_JOINS_PER_MINUTE` (default 180, by verified client IP) and `YAPPER_MESSAGES_PER_MINUTE` (default 120, by participant). Zero disables the corresponding limit. One installation uses a bounded in-process minute window. A rejected request returns HTTP 429 and `Retry-After`. A shared IP shares its admission budget, so size the limit for the expected network. Keep Go unpublished and the trusted-ingress address configuration in place. Guests' existing messages and request ID deduplication are preserved across retries.

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
