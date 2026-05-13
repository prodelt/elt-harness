const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { evaluatePilot, evaluateQuestion } = require("./project-knowledge-pilot");

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "project-knowledge-pilot.fixture.json"), "utf8")
);

const result = evaluatePilot(fixture);
assert.strictEqual(result.success, true);
assert.strictEqual(result.project, "Pipeline-setupper");
assert.strictEqual(result.questionCount, 10);
assert.ok(result.routes.graphify >= 1);
assert.ok(result.routes.lightrag >= 1);
assert.ok(result.routes.grep >= 1);
assert.ok(result.table.includes("| Question | Grep cost |"));
assert.ok(result.rollbackChecklist.includes("exclude raw secrets, .env files, auth tokens, and unrelated repos"));

const invalidQuestion = evaluateQuestion({
  question: "Broken row",
  grepCost: "",
  graphResult: "",
  ragResult: "",
  chosenRoute: "unknown",
});
assert.strictEqual(invalidQuestion.success, false);
assert.ok(invalidQuestion.missing.includes("grepCost"));

process.stdout.write("project-knowledge-pilot.test.js PASS\n");
