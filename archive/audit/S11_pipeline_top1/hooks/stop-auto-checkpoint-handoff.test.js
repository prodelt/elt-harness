#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { main } = require('./stop-auto-checkpoint');
const GENERATOR = path.join(__dirname, 'handoff-sync.js');

function mkProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-handoff-'));
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(root, 'audit', 'S11_pipeline_top1', 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'audit', 'S11_pipeline_top1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'audit', 'S11_pipeline_top1', 'PLAN.md'), '### [ ] ЗАДАЧА 47 | pending\n');
  fs.writeFileSync(path.join(root, 'MEMORY.md'), 'Current next action: ЗАДАЧА 47\n');
  fs.writeFileSync(path.join(root, 'audit', 'S11_pipeline_top1', 'NEXT_SESSION_PROMPT.md'), 'Default next action: **ЗАДАЧА 47**.\n');
  fs.writeFileSync(path.join(root, '.claude', 'handoff-automation.json'), JSON.stringify({
    generatorScript: path.relative(path.join(root, '.claude'), GENERATOR),
    planFile: 'audit/S11_pipeline_top1/PLAN.md',
    memoryFile: 'MEMORY.md',
    trackedPromptFile: 'audit/S11_pipeline_top1/NEXT_SESSION_PROMPT.md',
    generatedPromptFile: '.planning/AUTO_NEXT_SESSION_PROMPT.md',
    statusFile: '.planning/AUTO_HANDOFF_STATUS.md'
  }, null, 2));
  return root;
}

function runHook(root, transcriptText, checkpointDir) {
  const transcriptPath = path.join(root, 'session.jsonl');
  fs.writeFileSync(transcriptPath, transcriptText, 'utf8');
  process.env.CLAUDE_AUTO_CHECKPOINT_DIR = checkpointDir;
  main({
    cwd: root,
    session_id: 'session-test',
    transcript_path: transcriptPath
  });
}

{
  const root = mkProject();
  const checkpointDir = path.join(root, 'auto-checkpoints');
  const result = runHook(
    root,
    JSON.stringify({ message: { role: 'user', content: '/checkpoint' } }) + '\n',
    checkpointDir
  );
  assert.ok(fs.existsSync(path.join(root, '.planning', 'AUTO_NEXT_SESSION_PROMPT.md')));
  assert.ok(fs.existsSync(path.join(root, '.planning', 'AUTO_HANDOFF_STATUS.md')));
  assert.equal(fs.existsSync(checkpointDir), false);
}

{
  const root = mkProject();
  const checkpointDir = path.join(root, 'auto-checkpoints');
  const result = runHook(
    root,
    JSON.stringify({ message: { role: 'user', content: 'continue' } }) + '\n',
    checkpointDir
  );
  assert.ok(fs.existsSync(path.join(root, '.planning', 'AUTO_NEXT_SESSION_PROMPT.md')));
  assert.ok(fs.existsSync(path.join(root, '.planning', 'AUTO_HANDOFF_STATUS.md')));
  const files = fs.readdirSync(checkpointDir).filter(name => name.endsWith('.md'));
  assert.equal(files.length, 1);
}

console.log('stop-auto-checkpoint-handoff.test.js PASS');
