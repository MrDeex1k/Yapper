#!/bin/sh
set -eu
base=${YAPPER_URL:-http://127.0.0.1:18088}
curl --fail --silent --show-error "$base/health/live"
curl --fail --silent --show-error "$base/health/ready"
curl --fail --silent --show-error "$base/api/v1/info"
curl --fail --silent --show-error "$base/" >/dev/null
