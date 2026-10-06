#!/usr/bin/env bash
# Recreate the Acorn API and website containers. Host nginx is left as it is.
# Usage: deploy-remote.sh <image-tag> [api,web]
# The second argument lists which images this release built. Omitted means both.
# A service that is not listed keeps the container already running.
set -euo pipefail

API_IMAGE_DEFAULT="${ACORN_API_IMAGE:-omnimuh730/acorn-api}"
WEB_IMAGE_DEFAULT="${ACORN_WEB_IMAGE:-omnimuh730/acorn-web}"
TAG_OR_REF="${1:-latest}"
SERVICES="${2:-api,web}"
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

want_api=false
want_web=false
IFS=',' read -ra requested <<< "$SERVICES"
for name in "${requested[@]}"; do
  case "$name" in
    api) want_api=true ;;
    web) want_web=true ;;
    "") ;;
    *)
      echo "Unknown service: $name" >&2
      exit 1
      ;;
  esac
done
if [[ "$want_api" == false && "$want_web" == false ]]; then
  echo "No services to deploy" >&2
  exit 1
fi

docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK"

if [[ "$want_api" == true ]]; then
  echo "Pulling $API_REF"
  docker pull "$API_REF"
  docker rm -f "$API_CONTAINER" >/dev/null 2>&1 || true
  docker run -d \
    --name "$API_CONTAINER" \
    --restart unless-stopped \
    --network "$NETWORK" \
    --add-host=host.docker.internal:host-gateway \
    --env-file "$DEPLOY_ENV" \
    -p 127.0.0.1:8083:8083 \
    "$API_REF"
fi

if [[ "$want_web" == true ]]; then
  echo "Pulling $WEB_REF"
  docker pull "$WEB_REF"
  docker rm -f "$WEB_CONTAINER" >/dev/null 2>&1 || true
  docker run -d \
    --name "$WEB_CONTAINER" \
    --restart unless-stopped \
    --network "$NETWORK" \
    -e ACORN_API_URL=https://acornapi.remotepairnet.net \
    -e PORT=3000 \
    -e HOSTNAME=0.0.0.0 \
    -p 127.0.0.1:6005:3000 \
    "$WEB_REF"
fi

wait_for_url() {
  local url="$1"
  local container="$2"
  local attempt
  for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++)); do
    if curl -fsS -o /dev/null "$url"; then
      return 0
    fi
    sleep "$HEALTH_SLEEP_SEC"
  done
  echo "Health check failed: $url" >&2
  docker logs --tail 80 "$container" || true
  return 1
}

if [[ "$want_api" == true ]]; then
  wait_for_url "$API_HEALTH_URL" "$API_CONTAINER"
fi
if [[ "$want_web" == true ]]; then
  wait_for_url "$WEB_URL" "$WEB_CONTAINER"
fi
echo "Deploy OK: services ${SERVICES} at ${TAG_OR_REF}"
