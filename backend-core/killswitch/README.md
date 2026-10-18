# killswitch

Runtime kill switches so staff can turn off risky features without a deploy.

Env is the default. A document in `kill_switches` overrides it. Each process caches Mongo for `KILLSWITCH_CACHE_MS` (default 5s). A Mongo blip keeps the last cache, or env if nothing has been read yet — it does not take features down.

Switches default **on**. `off`, `false`, `0`, `no`, or `disabled` turns one off.

| Name       | Env                   | Wired here              |
| ---------- | --------------------- | ----------------------- |
| `acorn_ai` | `KILLSWITCH_ACORN_AI` | `acornapi` model routes |

Staff (admin-backend, already behind the admin token and staff session):

- `GET /v1/admin/kill-switches`
- `PUT /v1/admin/kill-switches/{name}` body `{ "enabled": false, "note": "…" }` → `{ "switch": {}, "auditId": "" }`

Flips write `admin_audit` (`action` `kill_switch.enable` / `kill_switch.disable`, `subjectType` `kill_switch`). No production flips in this step. No admin UI.

Tests use `killswitch.NewMemory`. Live Mongo tests skip unless `MONGODB_TEST_URI` is set.
