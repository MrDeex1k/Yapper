#!/bin/sh
set -eu
umask 077
: "${1:?Usage: scripts/backup-instance.sh new_bundle_directory}"
mkdir "$1"
backup_dir=$(cd "$1" && pwd)
was_running=$(docker compose ps --status running --services | sed -n '/^server$/p')
resume() { if [ "$was_running" = server ]; then docker compose start server >/dev/null; fi; }
trap resume EXIT HUP INT TERM
if [ "$was_running" = server ]; then docker compose stop server >/dev/null; fi
./scripts/backup.sh "$backup_dir/database.dump"
cp .env "$backup_dir/deployment.env"
cp compose.yaml "$backup_dir/compose.source.yaml"
cp VERSION "$backup_dir/VERSION"
git rev-parse HEAD > "$backup_dir/COMMIT"
docker compose exec -T database psql -U yapper -d yapper -At -c "SELECT json_build_object('users',(SELECT count(*) FROM users),'channels',(SELECT count(*) FROM channels),'messages',(SELECT count(*) FROM messages))" > "$backup_dir/counts.json"
(cd "$backup_dir" && shasum -a 256 database.dump deployment.env compose.source.yaml VERSION COMMIT counts.json > SHA256SUMS)
printf 'Complete backup. Contains private data and deployment secrets. Keep encrypted and outside Git.\n' > "$backup_dir/COMPLETE"
echo 'Instance backup completed; writers are resuming.'
