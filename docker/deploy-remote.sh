#!/usr/bin/env bash
# Recreate the Acorn API, website, admin, and agent containers as a docker-group user.
# Sudo is used only for nginx -t and systemctl reload nginx.
# Usage: deploy-remote.sh <commit-sha> [api,web,admin,agent]
# The first argument is the image tag (github.sha). Deploy by SHA, not latest.
# The second argument lists which images this release built. Omitted means all four.
# A service that is not listed keeps the container already running.
set -euo pipefail

API_IMAGE_DEFAULT="${ACORN_API_IMAGE:-omnimuh730/acorn-api}"
WEB_IMAGE_DEFAULT="${ACORN_WEB_IMAGE:-omnimuh730/acorn-web}"
ADMIN_IMAGE_DEFAULT="${ACORN_ADMIN_IMAGE:-omnimuh730/acorn-admin}"
AGENT_IMAGE_DEFAULT="${ACORN_AGENT_IMAGE:-omnimuh730/acorn-agent}"
TAG_OR_REF="${1:-}"
SERVICES="${2:-api,web,admin,agent}"
DEPLOY_ENV="${DEPLOY_ENV:-/opt/acorn/deploy.env}"
API_CONTAINER="${API_CONTAINER:-acorn-api}"
WEB_CONTAINER="${WEB_CONTAINER:-acorn-web}"
ADMIN_CONTAINER="${ADMIN_CONTAINER:-acorn-admin}"
AGENT_CONTAINER="${AGENT_CONTAINER:-acorn-agent}"
NETWORK="${ACORN_NETWORK:-acorn}"
# The website and admin call the API from their servers. All three run on this
# host in the same Docker network, so they reach it by container name: no public
# DNS, TLS, or nginx hop on every page load. Browsers still use the public host.
INTERNAL_API_URL="${ACORN_INTERNAL_API_URL:-http://${API_CONTAINER}:8083}"
API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:8083/health}"
WEB_URL="${WEB_URL:-http://127.0.0.1:6005/}"
ADMIN_URL="${ADMIN_URL:-http://127.0.0.1:6011/}"
AGENT_HEALTH_URL="${AGENT_HEALTH_URL:-http://127.0.0.1:8090/agent/v1/health}"
# A rollback to a commit from before the agent existed has no agent image: leave the running one.
AGENT_PULL_OPTIONAL="${AGENT_PULL_OPTIONAL:-false}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-36}"
HEALTH_SLEEP_SEC="${HEALTH_SLEEP_SEC:-5}"
NGINX_BIN="${NGINX_BIN:-/usr/sbin/nginx}"
SYSTEMCTL_BIN="${SYSTEMCTL_BIN:-/usr/bin/systemctl}"

if [[ -z "$TAG_OR_REF" || "$TAG_OR_REF" == "latest" ]]; then
  echo "Usage: deploy-remote.sh <commit-sha> [api,web,admin,agent]" >&2
  echo "Deploy by commit SHA, not latest." >&2
  exit 1
fi

[[ -f "$DEPLOY_ENV" ]] || { echo "Missing deploy env file: $DEPLOY_ENV" >&2; exit 1; }

# Argument is a tag (full github.sha), not a full image reference.
API_REF="${API_IMAGE_DEFAULT}:${TAG_OR_REF}"
WEB_REF="${WEB_IMAGE_DEFAULT}:${TAG_OR_REF}"
ADMIN_REF="${ADMIN_IMAGE_DEFAULT}:${TAG_OR_REF}"
AGENT_REF="${AGENT_IMAGE_DEFAULT}:${TAG_OR_REF}"

want_api=false
want_web=false
want_admin=false
want_agent=false
IFS=',' read -ra requested <<< "$SERVICES"
for name in "${requested[@]}"; do
  case "$name" in
    api) want_api=true ;;
    web) want_web=true ;;
    admin) want_admin=true ;;
    agent) want_agent=true ;;
    "") ;;
    *)
      echo "Unknown service: $name" >&2
      exit 1
      ;;
  esac
done
if [[ "$want_api" == false && "$want_web" == false && "$want_admin" == false && "$want_agent" == false ]]; then
  echo "No services to deploy" >&2
  exit 1
fi

docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK"

if [[ "$want_api" == true ]]; then
  if [[ "${API_RECREATE_ONLY:-}" == true ]]; then
    if docker inspect "$API_CONTAINER" >/dev/null 2>&1; then
      API_REF="$(docker inspect --format='{{.Config.Image}}' "$API_CONTAINER")"
      echo "Recreating $API_CONTAINER from $API_REF (no pull)"
    else
      echo "Pulling $API_REF"
      docker pull "$API_REF"
    fi
  else
    echo "Pulling $API_REF"
    docker pull "$API_REF"
  fi
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
  # The privacy and terms pages show this address; it comes from deploy.env, empty when unset.
  contact_email="$(grep -E '^ACORN_CONTACT_EMAIL=' "$DEPLOY_ENV" | tail -n 1 | cut -d= -f2- || true)"
  docker run -d \
    --name "$WEB_CONTAINER" \
    --restart unless-stopped \
    --network "$NETWORK" \
    -e ACORN_API_URL="$INTERNAL_API_URL" \
    -e ACORN_CONTACT_EMAIL="$contact_email" \
    -e PORT=3000 \
    -e HOSTNAME=0.0.0.0 \
    -p 127.0.0.1:6005:3000 \
    "$WEB_REF"
fi

if [[ "$want_admin" == true ]]; then
  echo "Pulling $ADMIN_REF"
  docker pull "$ADMIN_REF"
  docker rm -f "$ADMIN_CONTAINER" >/dev/null 2>&1 || true
  docker run -d \
    --name "$ADMIN_CONTAINER" \
    --restart unless-stopped \
    --network "$NETWORK" \
    -e ACORN_API_URL="$INTERNAL_API_URL" \
    -e PORT=3000 \
    -e HOSTNAME=0.0.0.0 \
    -p 127.0.0.1:6011:3000 \
    "$ADMIN_REF"
fi

if [[ "$want_agent" == true ]]; then
  echo "Pulling $AGENT_REF"
  if ! docker pull "$AGENT_REF"; then
    if [[ "$AGENT_PULL_OPTIONAL" == true ]]; then
      echo "No agent image at ${TAG_OR_REF}; leaving the running agent as it is"
      want_agent=false
    else
      exit 1
    fi
  fi
fi

if [[ "$want_agent" == true ]]; then
  # The agent gets only its own settings from deploy.env, never the API's secrets (the database,
  # Google). It reads each person's profile and Library from the API, over the Docker network,
  # with that person's own session, and writes nothing: no traces.
  agent_env="$(mktemp)"
  trap 'rm -f "$agent_env"' EXIT
  grep -E '^(ACORN_AGENT_[A-Z_]+|OPENROUTER_API_KEY)=' "$DEPLOY_ENV" > "$agent_env" || true
  docker rm -f "$AGENT_CONTAINER" >/dev/null 2>&1 || true
  docker run -d \
    --name "$AGENT_CONTAINER" \
    --restart unless-stopped \
    --network "$NETWORK" \
    --env-file "$agent_env" \
    -e HTTP_ADDR=0.0.0.0:8090 \
    -e ACORN_AGENT_BACKEND_URL="$INTERNAL_API_URL" \
    -e ACORN_AGENT_TRACE=false \
    -p 127.0.0.1:8090:8090 \
    "$AGENT_REF"
  rm -f "$agent_env"
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
if [[ "$want_admin" == true ]]; then
  wait_for_url "$ADMIN_URL" "$ADMIN_CONTAINER"
fi
if [[ "$want_agent" == true ]]; then
  wait_for_url "$AGENT_HEALTH_URL" "$AGENT_CONTAINER"
fi

sudo "$NGINX_BIN" -t
sudo "$SYSTEMCTL_BIN" reload nginx

echo "Deploy OK: services ${SERVICES} at ${TAG_OR_REF}"
