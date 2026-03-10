#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
EXAMPLE_FILE="$ROOT_DIR/.env.example"

if [[ ! -f "$EXAMPLE_FILE" ]]; then
  echo "Missing .env.example"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$EXAMPLE_FILE" "$ENV_FILE"
fi

ask() {
  local prompt="$1"
  local default="${2:-}"
  local value
  if [[ -n "$default" ]]; then
    read -r -p "$prompt [$default]: " value
    echo "${value:-$default}"
  else
    read -r -p "$prompt: " value
    echo "$value"
  fi
}

ask_secret() {
  local prompt="$1"
  local value
  read -r -s -p "$prompt: " value
  echo
  echo "$value"
}

set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

echo "Mission Control setup"
AUTH_USER=$(ask "Username" "admin")

while true; do
  PASS1=$(ask_secret "Password")
  PASS2=$(ask_secret "Confirm password")
  if [[ "$PASS1" == "$PASS2" && -n "$PASS1" ]]; then
    break
  fi
  echo "Passwords do not match or empty. Try again."
done

OPENCLAW_HOST=$(ask "OpenClaw server IP/host" "127.0.0.1")
PORT_INPUT=$(ask "Mission Control port (leave blank for 3000)" "3000")
MC_PORT="${PORT_INPUT:-3000}"

set_env AUTH_USER "$AUTH_USER"
set_env AUTH_PASS "$PASS1"
set_env NEXT_PUBLIC_GATEWAY_HOST "$OPENCLAW_HOST"
set_env NEXT_PUBLIC_GATEWAY_PORT "18789"
set_env PORT "$MC_PORT"

echo ""
echo "Setup complete."
echo "- .env updated"
echo "- Run: pnpm install && pnpm dev"
echo "- Open: http://localhost:${MC_PORT}"
