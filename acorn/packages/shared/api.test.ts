import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ACORN_HOSTS, ACORN_SOCKET_PATH, acornHosts } from "./api.ts";

describe("acornHosts", () => {
  it("uses the local servers only for development builds", () => {
    assert.equal(acornHosts("development"), ACORN_HOSTS.development);
    assert.equal(acornHosts("production"), ACORN_HOSTS.production);
    assert.equal(acornHosts("staging"), ACORN_HOSTS.production);
  });

  it("sends production to the Acorn API and the Acorn site, with the socket under /acorn", () => {
    assert.equal(acornHosts("production").api, "https://acornapi.remotepairnet.net");
    assert.equal(acornHosts("production").web, "https://acorn.remotepairnet.net");
    assert.equal(acornHosts("development").web, "http://localhost:6005");
    assert.equal(acornHosts("development").agent, "http://127.0.0.1:8090");
    assert.equal(acornHosts("production").agent, "http://127.0.0.1:8090");
    assert.ok(ACORN_SOCKET_PATH.startsWith("/acorn/"));
  });
});
