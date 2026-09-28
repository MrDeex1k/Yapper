#!/bin/sh
set -eu
case "${1:-}" in ''|--apply) ;; *) echo 'Usage: scripts/cleanup-files.sh [--apply]' >&2; exit 1;; esac
was_running=$(docker compose ps --status running --services | sed -n '/^server$/p')
resume() { if [ "$was_running" = server ]; then docker compose start server >/dev/null; fi; }
trap resume EXIT HUP INT TERM
if [ "$was_running" = server ]; then docker compose stop server >/dev/null; fi
if [ "${1:-}" = --apply ]; then
 docker compose run --rm --no-deps server --files-gc --apply
else
 docker compose run --rm --no-deps server --files-gc
fi
