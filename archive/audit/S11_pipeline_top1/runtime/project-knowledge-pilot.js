#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function readFixture(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function evaluateQuestion(question) {
  const route = String(question.chosenRoute || "").trim();
  const validRoute = ["graphify", "grep", "lightrag"].includes(route);
  const requiredFields = ["question", "grepCost", "graphResult", "ragResult"];
  const missing = requiredFields.filter((field) => !String(question[field] || "").trim());
  return {
    success: validRoute && missing.length === 0,
    route,
    missing,
  };
}

function summarizeRoutes(questions) {
  return questions.reduce(
    (accumulator, question) => {
      const key = String(question.chosenRoute || "").trim();
      accumulator[key] = (accumulator[key] || 0) + 1;
      return accumulator;
    },
    { graphify: 0, grep: 0, lightrag: 0 }
  );
}

function buildMarkdownTable(questions) {
  const header = [
    "| Question | Grep cost | Graph result | RAG result | Chosen route |",
    "|---|---|---|---|---|",
  ];
  const rows = questions.map((item) =>
    [
      item.question,
      item.grepCost,
      item.graphResult,
      item.ragResult,
      item.chosenRoute,
    ]
      .map((value) => String(value).replace(/\|/g, "\\|"))
      .join(" | ")
  );
  return header.concat(rows.map((row) => `| ${row} |`)).join("\n");
}

function evaluatePilot(fixture) {
  const questions = Array.isArray(fixture.questions) ? fixture.questions : [];
  const evaluations = questions.map(evaluateQuestion);
  const invalid = evaluations.filter((item) => !item.success);
  const routes = summarizeRoutes(questions);
  const checklist = Array.isArray(fixture.rollbackChecklist) ? fixture.rollbackChecklist : [];
  return {
    success: invalid.length === 0 && questions.length >= 10 && checklist.length >= 5,
    project: fixture.project || null,
    questionCount: questions.length,
    routes,
    invalid,
    table: buildMarkdownTable(questions),
    rollbackChecklist: checklist,
    storageSplit: fixture.storageSplit || {},
  };
}

function formatText(result) {
  const lines = [
    result.success ? "OK: project knowledge pilot" : "FAIL: project knowledge pilot",
    `project: ${result.project || "unknown"}`,
    `questions: ${result.questionCount}`,
    `routes: graphify=${result.routes.graphify}, lightrag=${result.routes.lightrag}, grep=${result.routes.grep}`,
    "",
    result.table,
    "",
    "Rollback / no-secrets checklist:",
    ...result.rollbackChecklist.map((item) => `- ${item}`),
  ];
  if (result.invalid.length > 0) {
    lines.push("", "Invalid entries:");
    lines.push(...result.invalid.map((item) => `- route=${item.route || "missing"} missing=${item.missing.join(",")}`));
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === "--fixture-file") {
      options.fixtureFile = next;
      index += 1;
    } else if (current === "--json") {
      options.json = true;
    }
  }
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.fixtureFile) {
      throw new Error("Missing --fixture-file.");
    }
    const result = evaluatePilot(readFixture(options.fixtureFile));
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatText(result));
    if (!result.success) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildMarkdownTable,
  evaluatePilot,
  evaluateQuestion,
};
