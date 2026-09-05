#!/bin/bash
# Double-clickable launcher for macOS Finder.
cd "$(dirname "$0")"
if [ -f "./run_mac.command" ]; then
  exec ./run_mac.command "$@"
else
  exec ./run.sh "$@"
fi
