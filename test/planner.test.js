const test = require("node:test");
const assert = require("node:assert/strict");
const { fallbackPlan } = require("../src/core/planner");

test("plans a harmless URL action", () => {
  const plan = fallbackPlan("Could you open https://example.com?");
  assert.equal(plan.steps[0].tool, "open_url");
  assert.equal(plan.requiresConfirmation, false);
});

test("requires confirmation before deletion", () => {
  const plan = fallbackPlan("delete old-report.pdf");
  assert.equal(plan.steps[0].tool, "delete_file");
  assert.equal(plan.requiresConfirmation, true);
});

test("understands a stop command", () => {
  assert.equal(fallbackPlan("never mind").type, "cancel");
});