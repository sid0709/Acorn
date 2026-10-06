#!/usr/bin/env bash
# Read changed repo paths on stdin, one per line.
# Print the images those paths affect: api, web, or both. The extension is not an image.
set -euo pipefail

api=0
web=0
while IFS= read -r path || [[ -n "${path}" ]]; do
  [[ -z "${path}" ]] && continue
  case "${path}" in
    acorn-backend/* | backend-core/*)
      api=1
      ;;
    acorn-frontend/* | packages/* | acorn/packages/shared/* | package.json | bun.lock | bun.lockb | bunfig.toml)
      web=1
      ;;
  esac
done

if [[ "${api}" == 1 ]]; then
  printf '%s\n' api
fi
if [[ "${web}" == 1 ]]; then
  printf '%s\n' web
fi
