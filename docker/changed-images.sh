#!/usr/bin/env bash
# Read changed repo paths on stdin, one per line.
# Print the images those paths affect: api, web, admin, agent. The extension is not an image.
# Nginx files are reference-only and do not trigger an image rebuild.
set -euo pipefail

api=0
web=0
admin=0
agent=0
while IFS= read -r path || [[ -n "${path}" ]]; do
  [[ -z "${path}" ]] && continue
  case "${path}" in
    # These acorn-backend packages are built into the agent too (model ids, the decision-model client).
    acorn-backend/config/* | acorn-backend/jev/* | acorn-backend/llmhttp/* | acorn-backend/openai/* | acorn-backend/requestid/* | acorn-backend/go.mod)
      api=1
      agent=1
      ;;
    acorn-backend/*)
      api=1
      ;;
    acorn-agent/*)
      agent=1
      ;;
    acorn-frontend/* | acorn/extension/* | tools/extension-release.mjs)
      web=1
      ;;
    acorn-admin/*)
      admin=1
      ;;
    packages/* | acorn/packages/shared/* | package.json | bun.lock | bun.lockb | bunfig.toml)
      web=1
      admin=1
      ;;
    docker/deploy-remote.sh | docker/sync-deploy-env.sh | .github/workflows/docker-publish.yml)
      api=1
      web=1
      admin=1
      agent=1
      ;;
  esac
done

if [[ "${api}" == 1 ]]; then
  printf '%s\n' api
fi
if [[ "${web}" == 1 ]]; then
  printf '%s\n' web
fi
if [[ "${admin}" == 1 ]]; then
  printf '%s\n' admin
fi
if [[ "${agent}" == 1 ]]; then
  printf '%s\n' agent
fi
