#!/bin/sh
set -eu

repo=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo/crates/voice-policy"

case "${1:-}" in
    geiger)
        # Geiger cleans Cargo outputs before scanning the files used in a build.
        if [ "$#" -eq 1 ]; then
            export CARGO_TARGET_DIR="$repo/.tmp/geiger/voice-policy"
            exec cargo +1.100.0 geiger --locked
        fi
        if [ "$#" -eq 2 ]; then
            cd "$repo/apps/desktop-gpui"
            export CARGO_TARGET_DIR="$repo/.tmp/geiger/gpui"
            exec cargo +1.100.0 geiger --locked --target "$2"
        fi
        ;;
    miri)
        if [ "$#" -eq 1 ]; then
            exec cargo +nightly-2026-11-23 miri test --locked
        fi
        ;;
    mutants)
        if [ "$#" -eq 1 ]; then
            exec cargo +1.100.0 mutants --output "$repo/.tmp/voice-policy"
        fi
        ;;
    kani)
        if [ "$#" -eq 1 ]; then
            exec cargo +1.100.0 kani
        fi
        ;;
esac

echo "Usage: $0 geiger [GPUI target triple] | miri | mutants | kani" >&2
exit 2
