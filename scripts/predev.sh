#!/bin/sh
# Kill whatever process is holding the port from the last backend run
PORT_FILE=".port"
if [ -f "$PORT_FILE" ]; then
  PORT=$(cat "$PORT_FILE")
  if [ -n "$PORT" ]; then
    fuser -k "${PORT}/tcp" 2>/dev/null || true
    echo "[predev] Cleared port $PORT"
  fi
fi
