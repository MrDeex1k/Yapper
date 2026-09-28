# Local deployment

Copy `.env.example` to `.env` and replace the PostgreSQL password with `openssl rand -hex 24`. Run `docker compose up --build -d --wait`. Open http://127.0.0.1:18088 and connect to that same origin.

Database and application backend are private to the Compose network. Only the web origin is exposed on localhost. For Internet hosting put a TLS reverse proxy in front of this origin, supporting HTTP/1.1 WebSocket upgrades. Do not expose PostgreSQL. Use HTTPS outside localhost; media later also needs public UDP and TURN configuration.

`docker compose down` retains data. Never use `down -v` against an instance whose data must survive. Check `docker compose ps` and `docker compose logs server` for readiness and lifecycle signals. At F01 the database is deployed but application persistence starts in F02.

These are source-build instructions, not a claim that Docker Hub releases already exist.

## Prepared release workflow (not yet published)

The owner must merge/review the stack first, configure the `release` environment, set repository variable `DOCKERHUB_NAMESPACE` and environment secrets `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN`. Protect release tags and enable immutable exact-version tags on Docker Hub. The workflow only creates a draft GitHub Release and does not move `latest`.

A `vX.Y.Z` tag must match `VERSION`. Before tagging, run CI for that commit. The packaging script currently publishes Linux amd64 images; local OrbStack verification uses arm64 source builds and does not validate the amd64 distribution.

Download `compose.yaml`, `env.example`, `INSTALL.md`, `manifest.json` and `SHA256SUMS` from the draft. Verify checksums, copy `env.example` to `.env`, set credentials and run `docker compose up -d --wait`. Run the `/health/live`, `/health/ready` and `/api/v1/info` probes, then connect through the UI. Only after testing the exact published digests should the owner publish the draft.

Partial publication stops the script instead of overwriting a version. Compare the remote digest, commit label and manifest; recover the missing steps manually for that same commit. Any code correction gets a new version. Publication was not exercised during the unmerged implementation series because no release was authorized.

## Initial administrator

Generate a separate `BOOTSTRAP_TOKEN` in `.env`, restart the server and use the bootstrap form/API once. Remove this token and restart after creating the administrator. Accounts thereafter require an administrator-created invitation. Never put session or invitation secrets in public URLs or logs.

For development integration tests only: `docker compose -f compose.yaml -f compose.dev.yaml up -d database --wait`, then `python3 scripts/test-server.py`. Tests use isolated temporary schemas and drop only their own schema. The override binds PostgreSQL to localhost:15433; do not include it in public deployments.

## Backup and restore (database-only through F04)

Run `./scripts/backup.sh /secure/path/new-backup.dump`. The script refuses to overwrite a file. Store the dump and a separate protected copy of deployment secrets outside the host; dumps contain private account/chat data and must not enter Git or public release assets.

Restore with `./scripts/restore.sh backup.dump new_database_name`. This creates a new database and refuses live/default names or existing targets. Validate counts and sign-in/history using an isolated server, then point `DATABASE_URL` at the restored database. The standard Compose URL is intentionally fixed to `yapper`; use an explicit environment override when switching. Do not delete the original until recovery is verified.

For upgrades: back up, stop application writers, update images/code, start the server to apply migrations, check readiness and exercise login/history. Rollback after a schema change means the old image plus a compatible backup, not blindly reversing SQL. F01→F02 was locally checked by adding the first migration to the existing Compose PostgreSQL volume. Public release-to-release upgrades remain pending because neither version is published.

## Full instance backup and recovery drill (F04)

`./scripts/backup-instance.sh .backups/new-name` pauses the Go writer, captures a consistent database dump and row inventory, copies deployment configuration/secrets and records the source commit/version. A trap resumes a previously running server, including on failure. The destination must be new. It contains secrets, is created with private permissions and must be encrypted for off-host storage. The `COMPLETE` marker is written only after all checksums exist. Media rooms are transient and clients reconnect after restart.

Run `python3 scripts/verify-recovery.py .backups/new-name` to verify checksums, restore into a uniquely named disposable database, compare counts and remove only that test database. It never switches or drops the live database. This is a recovery drill, not automatic disaster recovery. To recover for real, use `restore.sh` with a new database, restore deployment secrets privately, check out `COMMIT` or use the previously recorded image digests, and explicitly select the recovered database in a Compose override.
