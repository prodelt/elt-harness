#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runHandoffSync } = require('./handoff-sync');

function mkProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-sync-'));
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(root, 'audit', 'S11_pipeline_top1'), { recursive: true });
  fs.mkdirSync(path.join(root, '.planning'), { recursive: true });
  return root;
}

function writeProjectFiles(root, options = {}) {
  const nextTask = options.nextTask || '47';
  fs.writeFileSync(path.join(root, 'audit', 'S11_pipeline_top1', 'PLAN.md'), [
    '### [x] ЗАДАЧА 46 | done',
    `### [ ] ЗАДАЧА ${nextTask} | pending`,
    '### [ ] ЗАДАЧА 48 | pending',
    ''
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'MEMORY.md'), options.memoryText || `Current next action: ЗАДАЧА ${nextTask}`);
  fs.writeFileSync(
    path.join(root, 'audit', 'S11_pipeline_top1', 'NEXT_SESSION_PROMPT.md'),
    options.promptText || `Default next action: **ЗАДАЧА ${nextTask}**.`
  );
  fs.writeFileSync(path.join(root, '.claude', 'handoff-automation.json'), JSON.stringify({
    planFile: 'audit/S11_pipeline_top1/PLAN.md',
    memoryFile: 'MEMORY.md',
    trackedPromptFile: 'audit/S11_pipeline_top1/NEXT_SESSION_PROMPT.md',
    generatedPromptFile: '.planning/AUTO_NEXT_SESSION_PROMPT.md',
    statusFile: '.planning/AUTO_HANDOFF_STATUS.md',
    readFirst: [
      'MEMORY.md',
      'audit/S11_pipeline_top1/PLAN.md',
      'audit/S11_pipeline_top1/NEXT_SESSION_PROMPT.md'
    ]
  }, null, 2));
}

function run(root) {
  return runHandoffSync(root, path.join(root, '.claude', 'handoff-automation.json'));
}

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

{
  const root = mkProject();
  writeProjectFiles(root);
  const result = run(root);
  assert.equal(result.success, true);
  assert.match(result.nextTask, /ЗАДАЧА 47/);
  const prompt = read(root, '.planning/AUTO_NEXT_SESSION_PROMPT.md');
  const status = read(root, '.planning/AUTO_HANDOFF_STATUS.md');
  assert.match(prompt, /Focus: закрыть ЗАДАЧА 47/);
  assert.match(prompt, /Memory references next task: yes/);
  assert.match(status, /Tracked prompt references next task: yes/);
}

{
  const root = mkProject();
  writeProjectFiles(root, {
    memoryText: 'Current next action: ЗАДАЧА 46',
    promptText: 'Default next action: **ЗАДАЧА 46**.'
  });
  const result = run(root);
  assert.equal(result.success, true);
  const prompt = read(root, '.planning/AUTO_NEXT_SESSION_PROMPT.md');
  const status = read(root, '.planning/AUTO_HANDOFF_STATUS.md');
  assert.match(prompt, /Warnings/);
  assert.match(prompt, /MEMORY\.md does not mention next task 47/);
  assert.match(status, /tracked NEXT_SESSION_PROMPT does not mention next task 47/);
}

console.log('handoff-sync.test.js PASS');
