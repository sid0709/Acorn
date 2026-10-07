# Acorn production deploy

GitHub Actions workflow [`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml) builds Docker images and runs [`docker/deploy-remote.sh`](../docker/deploy-remote.sh) on the VPS.

## Images

| Service        | Default image            | Host port        |
| -------------- | ------------------------ | ---------------- |
| acorn-backend  | `omnimuh730/acorn-api`   | `127.0.0.1:8083` |
| acorn-frontend | `omnimuh730/acorn-web`   | `127.0.0.1:6005` |
| acorn-admin    | `omnimuh730/acorn-admin` | `127.0.0.1:6011` |

Port `6010` on the VPS is reserved for JoinedHQ admin; do not point Acorn admin there.

## VPS layout

- App secrets: `/opt/acorn/deploy.env` (see [`docker/deploy.env.example`](../docker/deploy.env.example))
- Deploy script: `/opt/acorn/deploy-remote.sh`
- nginx site files: `deploy/nginx/*.conf` → `/etc/nginx/sites-available/`

## GitHub Environment `Production` (branch `main`)

Secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`. Optional: `VPS_SSH_PORT`, vars `ACORN_API_IMAGE`, `ACORN_WEB_IMAGE`, `ACORN_ADMIN_IMAGE`.

## Domains

| Host                           | Upstream                                      |
| ------------------------------ | --------------------------------------------- |
| `acorn.remotepairnet.net`      | frontend (`6005`) and `/acorn` → API (`8083`) |
| `acornapi.remotepairnet.net`   | API (`8083`)                                  |
| `acornadmin.remotepairnet.net` | acorn-admin (`6011`)                          |

Issue or renew TLS with certbot on the server after DNS points at the VPS.
