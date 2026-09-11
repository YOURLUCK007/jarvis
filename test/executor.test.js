const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveUserPath, dangerousSystemPath } = require("../src/core/executor");

test("resolves common folder aliases", () => {
  assert.match(resolveUserPath("Downloads"), /Downloads$/);
});

test("protects system locations", () => {
  assert.equal(dangerousSystemPath("/etc"), true);
  assert.equal(dangerousSystemPath("/tmp/jarvis-safe"), false);
});