# Nginx reference for acornapply.com

These files document the site layout on the VPS. They are **reference copies only**.

The server already has `/etc/nginx/sites-available/acornapply.com`, plus `snippets/acorn-proxy.conf` and `conf.d/acorn-common.conf` (the `$connection_upgrade` map). GitHub Actions must **not** install or overwrite any Nginx site file. A deploy only runs `sudo nginx -t` and `sudo systemctl reload nginx`.

| File                        | Hosts                                  | Upstream                                                                 |
| --------------------------- | -------------------------------------- | ------------------------------------------------------------------------ |
| `acornapply.com.conf`       | `acornapply.com`, `www.acornapply.com` | website on `127.0.0.1:6005`                                              |
| `api.acornapply.com.conf`   | `api.acornapply.com`                   | API on `127.0.0.1:8083`, including `/acorn/socket.io` WebSocket upgrades |
| `admin.acornapply.com.conf` | `admin.acornapply.com`                 | admin on `127.0.0.1:6011`                                                |

Shared pieces:

- `conf.d/acorn-common.conf` — `$connection_upgrade` map and `limit_req_zone`
- `snippets/acorn-proxy.conf` — proxy headers, including the WebSocket upgrade
- `snippets/acorn-security-headers.conf` — HSTS and the other security headers
- `snippets/acorn-admin-allowlist.conf` — optional admin allowlist (`allow` / `deny all`)

Every HTTPS server sets `client_max_body_size 40m` and `limit_req`. Copy a file onto the VPS by hand only when you intend to change the live site, then `sudo nginx -t` and `sudo systemctl reload nginx`.
