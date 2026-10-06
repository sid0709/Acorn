#!/usr/bin/env bash
# Recreate the Acorn API and website containers. Host nginx is left as it is.
set -euo pipefail

API_IMAGE_DEFAULT="${ACORN_API_IMAGE:-omnimuh730/acorn-api}"
WEB_IMAGE_DEFAULT="${ACORN_WEB_IMAGE:-omnimuh730/acorn-web}"
TAG_OR_REF="${1:-latest}"
DEPLOY_ENV="${DEPLOY_ENV:-/opt/acorn/deploy.env}"
API_CONTAINER="${API_CONTAINER:-acorn-api}"
WEB_CONTAINER="${WEB_CONTAINER:-acorn-web}"
NETWORK="${ACORN_NETWORK:-acorn}"
API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:8083/health}"
WEB_URL="${WEB_URL:-http://127.0.0.1:6005/}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-36}"
HEALTH_SLEEP_SEC="${HEALTH_SLEEP_SEC:-5}"

[[ -f "$DEPLOY_ENV" ]] || { echo "Missing deploy env file: $DEPLOY_ENV" >&2; exit 1; }

# Argument is a tag (sha-abc, latest), not a full image reference.
API_REF="${API_IMAGE_DEFAULT}:${TAG_OR_REF}"
WEB_REF="${WEB_IMAGE_DEFAULT}:${TAG_OR_REF}"

docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK"

echo "Pulling $API_REF"
docker pull "$API_REF"
echo "Pulling $WEB_REF"
docker pull "$WEB_REF"

docker rm -f "$API_CONTAINER" "$WEB_CONTAINER" >/dev/null 2>&1 || true

docker run -d \
  --name "$API_CONTAINER" \
  --restart unless-stopped \
  --network "$NETWORK" \
  --add-host=host.docker.internal:host-gateway \
  --env-file "$DEPLOY_ENV" \
  -p 127.0.0.1:8083:8083 \
  "$API_REF"

docker run -d \
  --name "$WEB_CONTAINER" \
  --restart unless-stopped \
  --network "$NETWORK" \
  -e "ACORN_API_URL=http://${API_CONTAINER}:8083" \
  -e PORT=3000 \
  -e HOSTNAME=0.0.0.0 \
  -p 127.0.0.1:6005:3000 \
  "$WEB_REF"

wait_for_url() {
  local url="$1"
  local attempt
  for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++)); do
    if curl -fsS -o /dev/null "$url"; then
      return 0
    fi
    sleep "$HEALTH_SLEEP_SEC"
  done
  echo "Health check failed: $url" >&2
  docker logs --tail 80 "$API_CONTAINER" || true
  docker logs --tail 80 "$WEB_CONTAINER" || true
  return 1
}

wait_for_url "$API_HEALTH_URL"
wait_for_url "$WEB_URL"
echo "Deploy OK: $API_REF and $WEB_REF"
