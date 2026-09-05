#!/usr/bin/env bash
# macOS CLI Runner
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/run_mac.command" "$@"
