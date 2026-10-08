# Acorn production deploy

GitHub Actions workflow [`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml) builds Docker images and runs [`docker/deploy-remote.sh`](../docker/deploy-remote.sh) on the VPS.

## Images

| Service        | Default image            | Host port                                                       |
| -------------- | ------------------------ | --------------------------------------------------------------- |
| acorn-backend  | `omnimuh730/acorn-api`   | `127.0.0.1:8083`                                                |
| acorn-frontend | `omnimuh730/acorn-web`   | `127.0.0.1:6005` (includes packed Chrome extension on **Apps**) |
| acorn-admin    | `omnimuh730/acorn-admin` | `127.0.0.1:6011`                                                |

Port `6010` on the VPS is reserved for JoinedHQ admin; do not point Acorn admin there.

## VPS layout

- App secrets: `/opt/acorn/deploy.env` (see [`docker/deploy.env.example`](../docker/deploy.env.example))
- Deploy script: `/opt/acorn/deploy-remote.sh`
- nginx site files: `deploy/nginx/*.conf` → `/etc/nginx/sites-available/`

## GitHub Environment `Production` (branch `main`)

Secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`. Optional: `VPS_SSH_PORT`, `ACORN_ADMIN_SESSION_SECRET`, vars `ACORN_API_IMAGE`, `ACORN_WEB_IMAGE`, `ACORN_ADMIN_IMAGE`, `ACORN_ADMIN_USERNAME`, `ACORN_ADMIN_PWD`, and optionally `VITE_ACORN_API_URL` / `VITE_ACORN_WEB_URL` (same names as `acorn/.env`; baked into the extension zip at website image build; defaults match production hosts).

When the website image builds, it runs `tools/extension-release.mjs`: production `acorn/.env` from those vars, `bun run build:acorn`, zip to `/downloads/acorn-chrome.zip`, and sets `NEXT_PUBLIC_ACORN_EXTENSION_VERSION` for the Apps page. Bump `acorn/extension/package.json` version with extension changes so deploy shows the new number.

Each deploy run writes `ACORN_ADMIN_USERNAME` / `ACORN_ADMIN_PWD` into `/opt/acorn/deploy.env` as `ACORN_ADMIN_EMAIL` / `ACORN_ADMIN_PASSWORD`, sets `ACORN_ADMIN_DEMO=off`, and restarts the API container so acorn-admin sign-in uses that staff account. The bootstrap user is created only when `acorn_admin_users` is empty; change the password in Mongo or clear that collection if you rotate credentials later.

## Domains

| Host                           | Upstream                                      |
| ------------------------------ | --------------------------------------------- |
| `acorn.remotepairnet.net`      | frontend (`6005`) and `/acorn` → API (`8083`) |
| `acornapi.remotepairnet.net`   | API (`8083`)                                  |
| `acornadmin.remotepairnet.net` | acorn-admin (`6011`)                          |

Issue or renew TLS with certbot on the server after DNS points at the VPS.
