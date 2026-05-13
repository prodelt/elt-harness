const assert = require("assert");
const path = require("path");

const {
  buildCommandPlan,
  chooseTransport,
  evaluateRegistry,
  loadDescriptors,
} = require("./cli-capability-registry");

const directoryPath = path.join(__dirname, "cli-capabilities");
const fixtureFile = path.join(__dirname, "cli-capability-registry.fixture.json");

const descriptors = loadDescriptors(directoryPath);
assert.strictEqual(descriptors.length, 6);

const gh = descriptors.find((descriptor) => descriptor.info.name === "gh");
assert.ok(gh);
assert.strictEqual(chooseTransport(gh, "repository discovery"), "cli");

const context7 = descriptors.find((descriptor) => descriptor.info.name === "context7");
assert.ok(context7);
assert.strictEqual(chooseTransport(context7, "official API docs"), "mcp");

const plan = buildCommandPlan(gh, "search-repos", {
  query: "lightrag graph rag",
  limit: "5",
});
assert.strictEqual(plan.command, "gh search repos \"lightrag graph rag\" --limit 5");
assert.strictEqual(plan.destructive, false);

const result = evaluateRegistry({ directoryPath, fixtureFile });
assert.strictEqual(result.success, true);
assert.strictEqual(result.scenarios.length, 3);
assert.ok(result.scenarios.every((item) => item.commandPlan && item.commandPlan.destructive === false));
assert.ok(result.preferences.every((item) => item.success));

process.stdout.write("cli-capability-registry.test.js PASS\n");
