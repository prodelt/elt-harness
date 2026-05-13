const assert = require("assert");
const path = require("path");

const { evaluatePilot } = require("./browser-automation-pilot");

const fixture = require(path.join(__dirname, "browser-automation-pilot.fixture.json"));

const passResult = evaluatePilot(fixture);
assert.strictEqual(passResult.success, true);
assert.strictEqual(passResult.requiredOptionCoverage, true);
assert.strictEqual(passResult.defaultOk, true);
assert.strictEqual(passResult.fallbackOk, true);
assert.ok(passResult.ranking[0].name === "playwright-cli");

const failingFixture = JSON.parse(JSON.stringify(fixture));
failingFixture.selection.default = "browser-harness";
const failResult = evaluatePilot(failingFixture);
assert.strictEqual(failResult.success, false);
assert.strictEqual(failResult.defaultOk, false);

process.stdout.write("browser-automation-pilot.test.js PASS\n");
