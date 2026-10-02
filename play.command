#!/bin/bash
# play.command: double-click to play. Serves this folder on http://localhost:8770/ and opens it in the
# default browser; closing this Terminal window (or Ctrl+C) stops the server.
cd "$(dirname "$0")" || exit 1

PORT="${PORT:-8770}"
export PORT

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required: install it from https://nodejs.org/ and try again."
  read -r -p "Press Return to close." _
  exit 1
fi

node tools/serve.mjs &
SERVER_PID=$!

cleanup() {
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
}
trap cleanup EXIT
trap 'exit 0' INT TERM HUP

# Wait (up to ~5 s) for the server to answer before opening the browser.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s -o /dev/null "http://127.0.0.1:${PORT}/"; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "The server did not start (is port ${PORT} already in use?)."
    exit 1
  fi
  sleep 0.5
done

open "http://localhost:${PORT}/"
echo "Playing at http://localhost:${PORT}/  (close this window or press Ctrl+C to stop)"
wait "$SERVER_PID"
