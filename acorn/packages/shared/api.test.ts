import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACORN_HOSTS,
  ACORN_PRODUCTION_API_ORIGIN,
  ACORN_PRODUCTION_WEB_ORIGIN,
  ACORN_PRODUCTION_WEB_WWW_ORIGIN,
  ACORN_SOCKET_PATH,
  acornHosts,
  acornWebOrigins,
} from "./api.ts";

describe("acornHosts", () => {
  it("uses the local servers only for development builds", () => {
    assert.equal(acornHosts("development"), ACORN_HOSTS.development);
    assert.equal(acornHosts("production"), ACORN_HOSTS.production);
    assert.equal(acornHosts("staging"), ACORN_HOSTS.production);
  });

  it("sends production to the Acorn API and the Acorn site, with the socket under /acorn", () => {
    assert.equal(acornHosts("production").api, ACORN_PRODUCTION_API_ORIGIN);
    assert.equal(acornHosts("production").web, ACORN_PRODUCTION_WEB_ORIGIN);
    assert.equal(acornHosts("production").api, "https://api.acornapply.com");
    assert.equal(acornHosts("production").web, "https://acornapply.com");
    assert.equal(acornHosts("development").web, "http://localhost:6005");
    assert.equal(acornHosts("development").agent, "http://127.0.0.1:8090");
    assert.equal(acornHosts("production").agent, "http://127.0.0.1:8090");
    assert.ok(ACORN_SOCKET_PATH.startsWith("/acorn/"));
  });

  it("treats www as the same production website for support handoff", () => {
    const origins = acornWebOrigins();
    assert.ok(origins.includes(ACORN_PRODUCTION_WEB_ORIGIN));
    assert.ok(origins.includes(ACORN_PRODUCTION_WEB_WWW_ORIGIN));
  });
});
