const assert = require("assert");
const path = require("path");

const { evaluateSpike } = require("./hermes-architecture-spike");

const fixture = require(path.join(__dirname, "hermes-architecture-spike.fixture.json"));

const passResult = evaluateSpike(fixture);
assert.strictEqual(passResult.success, true);
assert.strictEqual(passResult.windowsOk, true);
assert.strictEqual(passResult.patterns.success, true);
assert.strictEqual(passResult.guardrailsOk, true);

const failingFixture = JSON.parse(JSON.stringify(fixture));
failingFixture.windowsSupport.nativeWindows = "supported";
const failResult = evaluateSpike(failingFixture);
assert.strictEqual(failResult.success, false);
assert.strictEqual(failResult.windowsOk, false);

process.stdout.write("hermes-architecture-spike.test.js PASS\n");
