#!/bin/sh
set -eu
umask 077
: "${1:?Usage: scripts/backup.sh /path/to/new-backup.dump}"
if [ -e "$1" ]; then echo 'Refusing to overwrite an existing backup.' >&2; exit 1; fi
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT HUP INT TERM
docker compose exec -T database pg_dump -U yapper -d yapper -Fc > "$tmp"
test -s "$tmp"
(set -C; cat "$tmp" > "$1")
echo 'Backup written. Store it encrypted outside this host.'
