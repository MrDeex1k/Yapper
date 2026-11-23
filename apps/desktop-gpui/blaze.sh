#!/bin/sh
set -eu

version=0.20261029.7
blaze=${BLAZE_BIN:-blaze}

if [ "$#" -ne 1 ] || [ "$1" != lock-native ]; then
  printf '%s\n' 'Usage: ./blaze.sh lock-native' >&2
  exit 2
fi

cd "$(dirname -- "$0")"
if ! installed=$("$blaze" --version); then
  printf 'Install Blaze %s and put it on PATH or set BLAZE_BIN to its absolute path.\n' "$version" >&2
  exit 1
fi
case "$installed" in
  "blaze $version "*) ;;
  *)
    printf 'Expected Blaze %s for the native lock. Found:\n%s\n' "$version" "$installed" >&2
    exit 1
    ;;
esac

exec "$blaze" lock --fetches \
  --target aarch64-unknown-linux-gnu \
  --target x86_64-unknown-linux-gnu \
  --target x86_64-pc-windows-msvc
