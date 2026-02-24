#!/usr/bin/env bash
set -euo pipefail

APP_BIN="${OMMAPIN_BIN:-$HOME/.local/bin/ommapin}"

if [ ! -x "$APP_BIN" ]; then
  echo "ommapin binary not found at $APP_BIN"
  echo "Set OMMAPIN_BIN or install ommapin to ~/.local/bin/ommapin"
  exit 1
fi

# Relaunching a single-instance Tauri app focuses the existing window.
"$APP_BIN" >/dev/null 2>&1 &
