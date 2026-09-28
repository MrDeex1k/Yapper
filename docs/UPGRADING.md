# Upgrade and rollback runbook

All versions in this implementation stack are prepared candidates, not published releases. Never point a production instance at a moving branch or overwrite a released version.

1. Record the current Git commit/image digests, Compose overrides, environment and media configuration. Announce downtime. Verify sufficient space for a second database and the backup.
2. Run `backup-instance.sh` with a new directory, then `verify-recovery.py`. Keep an encrypted copy on another host. The backup briefly stops writers and resumes the existing server container; the drill uses a separate database.
3. Stop web and Go services during the actual upgrade. Keep PostgreSQL data and media configuration. Deploy the reviewed target images by digest (or build the exact candidate commit in development). Preserve `.env` privately; compare newly required configuration against `.env.example`.
4. Start database, media if enabled, Go and web. Go runs checksummed migrations before readiness. A migration failure leaves the server unready; inspect structured logs without publishing secrets. Do not edit applied SQL files.
5. Run `scripts/smoke.sh`, sign in, inspect old history, send a new message, reconnect a second client, join/leave voice and inspect admin status. Test a member account as well as an administrator. Preserve the backup until these checks and the group pilot pass.

If a pre-migration startup/configuration error occurs, restore the previous configuration and image. If the database schema has changed incompatibly, keep the failed database for investigation, restore the pre-upgrade dump with `restore.sh` into a NEW database, and use an explicit override for `DATABASE_URL` plus the previous image digest. Start this combination in isolation and verify it before switching traffic. Messages written after the backup are absent from a rollback; retain the newer database if selective recovery is required. Do not run automatic down migrations or `docker compose down -v`.

For source builds, `COMMIT` in the backup identifies the corresponding code; the backup is not a source archive. The sample Compose URL names `yapper`, so switching database requires an explicit environment override. Never restore deployment secrets from an untrusted backup. `verify-recovery.py` verifies consistency and row counts; it does not prove real-device voice behavior or every application invariant.

F04 local evidence: writer pause/resume and full bundle succeeded, checksums verified, a fresh database restored successfully, and user/channel/message counts matched. No production release was upgraded or rolled back.
