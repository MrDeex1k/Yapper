#!/bin/sh
set -eu
: "${1:?Usage: scripts/restore.sh backup.dump new_database_name}"
: "${2:?Choose a NEW database name}"
case "$2" in ''|*[!a-z0-9_]*) echo 'Use lowercase letters, digits and underscores.' >&2; exit 1;; esac
case "$2" in yapper|postgres|template0|template1) echo 'Refusing to overwrite a standard/live database.' >&2; exit 1;; esac
test -s "$1"
# createdb fails if the target already exists. Never drop an existing database.
docker compose exec -T database createdb -U yapper "$2"
docker compose exec -T database pg_restore -U yapper -d "$2" --no-owner --exit-on-error --single-transaction < "$1"
echo 'Restore completed into the new database. Verify before switching DATABASE_URL.'
