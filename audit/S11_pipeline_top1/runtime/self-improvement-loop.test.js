const assert = require("assert");
const path = require("path");

const { evaluateLoop } = require("./self-improvement-loop");

const fixture = require(path.join(__dirname, "self-improvement-loop.fixture.json"));

const passResult = evaluateLoop(fixture);
assert.strictEqual(passResult.success, true);
assert.strictEqual(passResult.events.success, true);
assert.strictEqual(passResult.dryRun.success, true);
assert.strictEqual(passResult.batchPolicy.success, true);

const failingFixture = JSON.parse(JSON.stringify(fixture));
failingFixture.dryRun.generatedProposal.autoPromote = true;
const failResult = evaluateLoop(failingFixture);
assert.strictEqual(failResult.success, false);
assert.strictEqual(failResult.dryRun.success, false);

process.stdout.write("self-improvement-loop.test.js PASS\n");
