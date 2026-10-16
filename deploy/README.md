# Acorn production deploy

GitHub Actions workflow [`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml) builds Docker images tagged with `github.sha` and runs [`docker/deploy-remote.sh`](../docker/deploy-remote.sh) on the VPS as the non-root deploy user. First-time server work is [`server-setup.md`](server-setup.md). Nginx files in this folder are [reference copies](nginx/README.md); CI never installs them.

## Images

| Service        | Default image            | Host port                                                       |
| -------------- | ------------------------ | --------------------------------------------------------------- |
| acorn-backend  | `omnimuh730/acorn-api`   | `127.0.0.1:8083`                                                |
| acorn-frontend | `omnimuh730/acorn-web`   | `127.0.0.1:6005` (includes packed Chrome extension on **Apps**) |
| acorn-admin    | `omnimuh730/acorn-admin` | `127.0.0.1:6011`                                                |

Port `6010` on the VPS is reserved for JoinedHQ admin; do not point Acorn admin there.

Images are tagged with the full commit SHA (`github.sha`) and optionally `latest`. Deploy always pulls the SHA tag, never `latest`. `workflow_dispatch` input `image_sha` redeploys that SHA's existing images (rollback) without rebuilding.

## VPS layout

- App secrets: `/opt/acorn/deploy.env` (see [`docker/deploy.env.example`](../docker/deploy.env.example)), owned by the deploy user, mode `600`
- Deploy script: `/opt/acorn/deploy-remote.sh` (docker group; sudo only for `nginx -t` and `systemctl reload nginx`)
- nginx: already on the host; see [`nginx/README.md`](nginx/README.md)

## GitHub Environment `Production`

Secrets (`secrets.*`): `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`. Optional: `VPS_SSH_PORT`, `ACORN_ADMIN_SESSION_SECRET`.

Variables (`vars.*`): `ACORN_ADMIN_USERNAME`, `ACORN_ADMIN_PWD`, and optionally `ACORN_API_IMAGE`, `ACORN_WEB_IMAGE`, `ACORN_ADMIN_IMAGE`, `VITE_ACORN_API_URL`, `VITE_ACORN_WEB_URL` (same names as `acorn/.env`; baked into the extension zip at website image build; defaults match production hosts).

When the website image builds, it runs `tools/extension-release.mjs`: production `acorn/.env` from those vars, `bun run build:acorn`, zip to `/downloads/acorn-chrome.zip`, and sets `NEXT_PUBLIC_ACORN_EXTENSION_VERSION` for the Apps page. Bump `acorn/extension/package.json` version with extension changes so deploy shows the new number.

Each deploy run writes `ACORN_ADMIN_USERNAME` / `ACORN_ADMIN_PWD` into `/opt/acorn/deploy.env` as `ACORN_ADMIN_EMAIL` / `ACORN_ADMIN_PASSWORD`, sets `ACORN_ADMIN_DEMO=off`, and restarts the API container so acorn-admin sign-in uses that staff account. The bootstrap user is created only when `acorn_admin_users` is empty; change the password in Mongo or clear that collection if you rotate credentials later.

## Same-host traffic

- The API reaches MongoDB on the VPS itself: `MONGO_URI=mongodb://host.docker.internal:27017/` (the container's host gateway). Keep it off the public interface.
- The website and admin call the API from their servers by container name, `http://acorn-api:8083`, on the `acorn` Docker network (override with `ACORN_INTERNAL_API_URL`). Only browsers and the extension use `https://api.acornapply.com`.

## Domains

| Host                   | Upstream                |
| ---------------------- | ----------------------- |
| `acornapply.com`       | frontend (`6005`)       |
| `www.acornapply.com`   | frontend (`6005`)       |
| `api.acornapply.com`   | API (`8083`), WebSocket |
| `admin.acornapply.com` | acorn-admin (`6011`)    |

Issue or renew TLS with certbot on the server after DNS points at the VPS. After a deploy, CI curls `https://api.acornapply.com/health` (`GET /health` on the API process).
