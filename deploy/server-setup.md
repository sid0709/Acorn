# Non-root deploy user on the VPS

Run these steps as root over an existing session **before** turning off root SSH. GitHub Actions SSHs as `secrets.VPS_USER@secrets.VPS_HOST` with `secrets.VPS_SSH_KEY`. Optional `secrets.VPS_SSH_PORT` defaults to 22. The deploy user must be in the `docker` group, own `/opt/acorn`, and have passwordless sudo for exactly `nginx -t` and `systemctl reload nginx`.

Do not print private keys, tokens, or passwords while you work.

## 1. Create the deploy user

```bash
DEPLOY_USER=acorn-deploy
useradd --create-home --shell /bin/bash "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
```

`docker` group membership applies on the next login. Confirm later with `id` over SSH.

## 2. Give it `/opt/acorn`

```bash
install -d -m 700 /opt/acorn
chown -R "$DEPLOY_USER:$DEPLOY_USER" /opt/acorn
```

Keep `deploy.env` mode `600` and owned by this user. The API container reads it through `--env-file`.

## 3. NOPASSWD sudo for nginx only

Find the binaries this host uses:

```bash
command -v nginx
command -v systemctl
```

On Ubuntu they are `/usr/sbin/nginx` and `/usr/bin/systemctl`. Write `/etc/sudoers.d/acorn-deploy` with visudo so the rule cannot lock you out:

```bash
visudo -f /etc/sudoers.d/acorn-deploy
```

Contents (adjust paths only if `command -v` differed):

```
acorn-deploy ALL=(root) NOPASSWD: /usr/sbin/nginx -t, /usr/bin/systemctl reload nginx
```

Mode `0440`. Validate before you log out:

```bash
chmod 0440 /etc/sudoers.d/acorn-deploy
visudo -c
visudo -c -f /etc/sudoers.d/acorn-deploy
```

`deploy-remote.sh` calls only:

```bash
sudo /usr/sbin/nginx -t
sudo /usr/bin/systemctl reload nginx
```

No other sudo. Docker commands run as the user via the `docker` group.

## 4. Authorize the deploy key

On your laptop, generate an ed25519 key used only for this user (not a personal key). The private half is GitHub secret `VPS_SSH_KEY`. Copy the public half onto the VPS:

```bash
install -d -m 700 /home/acorn-deploy/.ssh
# paste acorn_deploy.pub, then:
cat acorn_deploy.pub >> /home/acorn-deploy/.ssh/authorized_keys
chown -R acorn-deploy:acorn-deploy /home/acorn-deploy/.ssh
chmod 600 /home/acorn-deploy/.ssh/authorized_keys
```

## 5. SSH test (required before touching sshd)

From a second terminal, as the key owner:

```bash
ssh -i acorn_deploy -o IdentitiesOnly=yes acorn-deploy@<VPS_HOST> 'id; docker ps >/dev/null && echo docker_ok; sudo /usr/sbin/nginx -t'
```

Replace `<VPS_HOST>` with the host from GitHub secret `VPS_HOST`. Do not embed that host in the repo. The session must show `acorn-deploy` in group `docker`, `docker_ok`, and a successful `nginx -t`. Keep the original root session open until this works.

## 6. Disable root SSH login and password auth

Only after the test in step 5 succeeds. In `/etc/ssh/sshd_config` or a drop-in under `/etc/ssh/sshd_config.d/`:

```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

Then:

```bash
sshd -t
systemctl reload ssh
```

Confirm a new `acorn-deploy` key login still works, then close the root session.

## GitHub Environment `Production`

Secrets (all `secrets.*`): `DOCKERHUB_TOKEN`, `DOCKERHUB_USERNAME`, `VPS_HOST`, `VPS_SSH_KEY`, `VPS_USER` (this deploy user). Optional: `VPS_SSH_PORT`, `ACORN_ADMIN_SESSION_SECRET`.

Variables (`vars.*`): `ACORN_ADMIN_USERNAME`, `ACORN_ADMIN_PWD`, `VITE_ACORN_API_URL`, `VITE_ACORN_WEB_URL`. Optional image names: `ACORN_API_IMAGE`, `ACORN_WEB_IMAGE`, `ACORN_ADMIN_IMAGE`.

## The agent route (one time, before the first deploy that includes acorn-agent)

The agent is a fourth container but has no host name of its own: it is served on `api.acornapply.com` under `/agent/v1/`, and reaches the API privately as `http://acorn-api:8083`. The deploy itself does not touch nginx files, so do this once by hand:

1. **nginx limit zone.** Make sure `/etc/nginx/conf.d/acorn-common.conf` has the `limit_req_zone ... zone=acorn_agent` line (see `deploy/nginx/conf.d/acorn-common.conf`).
2. **nginx route.** In `/etc/nginx/sites-available/api.acornapply.com` add the `location /agent/v1/ { ... }` block from `deploy/nginx/api.acornapply.com.conf` before `location /`, then `sudo nginx -t` and `sudo systemctl reload nginx`. No DNS record or certificate is needed.
3. **Settings (optional).** In `/opt/acorn/deploy.env` add `ACORN_AGENT_MAX_MODEL_CALLS` to bound concurrent steps. No AI key is needed: each person's own OpenRouter key is read from their profile. The default résumé offered when a page shows no job description is the one each person marked default ("Make default") in their Library on the website, so there is nothing to set here.
4. **Check.** After the first deploy: `curl https://api.acornapply.com/agent/v1/health` should answer `{"ok":true,...,"source":"backend"}`. The Chrome extension build already points at that address.
