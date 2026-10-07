#!/usr/bin/env bash
# Upsert selected keys in /opt/acorn/deploy.env from the process environment.
# GitHub Actions passes ACORN_ADMIN_USERNAME and ACORN_ADMIN_PWD (environment variables).
# Optional: ACORN_ADMIN_SESSION_SECRET (GitHub secret) for signing admin sessions.
set -euo pipefail

DEPLOY_ENV="${DEPLOY_ENV:-/opt/acorn/deploy.env}"
RESTART_FLAG="${RESTART_FLAG:-/tmp/acorn-api-restart-needed}"

install -d -m 700 "$(dirname "$DEPLOY_ENV")"
touch "$DEPLOY_ENV"
chmod 600 "$DEPLOY_ENV"

upsert() {
  local key="$1"
  local value="$2"
  python3 - "$DEPLOY_ENV" "$key" "$value" <<'PY'
import sys

path, key, value = sys.argv[1], sys.argv[2], sys.argv[3]
lines: list[str] = []
found = False
try:
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if line.startswith(key + "="):
                lines.append(f"{key}={value}\n")
                found = True
            else:
                lines.append(line)
except FileNotFoundError:
    pass
if not found:
    lines.append(f"{key}={value}\n")
with open(path, "w", encoding="utf-8") as fh:
    fh.writelines(lines)
PY
  chmod 600 "$DEPLOY_ENV"
}

changed=false

admin_user="$(printf '%s' "${ACORN_ADMIN_USERNAME:-}" | tr -d '\r\n')"
admin_pwd="$(printf '%s' "${ACORN_ADMIN_PWD:-}" | tr -d '\r\n')"

if [[ -n "$admin_user" && -n "$admin_pwd" ]]; then
  upsert ACORN_ADMIN_EMAIL "$admin_user"
  upsert ACORN_ADMIN_PASSWORD "$admin_pwd"
  upsert ACORN_ADMIN_DEMO off
  changed=true

  session_secret="$(printf '%s' "${ACORN_ADMIN_SESSION_SECRET:-}" | tr -d '\r\n')"
  if [[ -z "$session_secret" ]]; then
    session_secret="$(grep -E '^ACORN_ADMIN_SESSION_SECRET=' "$DEPLOY_ENV" 2>/dev/null | cut -d= -f2- || true)"
  fi
  if [[ -z "$session_secret" ]]; then
    session_secret="$(openssl rand -hex 32)"
  fi
  upsert ACORN_ADMIN_SESSION_SECRET "$session_secret"
fi

if [[ "$changed" == true ]]; then
  touch "$RESTART_FLAG"
  echo "Updated admin credentials in ${DEPLOY_ENV}"
fi
