#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hookPath = path.join(__dirname, 'memory-discipline.js');
process.env.CLAUDE_MEMORY_DISCIPLINE_EXPORTS_ONLY = '1';
const {
  buildBlockMessage,
  buildWarnResponse,
  countLines,
  evaluateLineCount,
  readLineCount
} = require(hookPath);

function writeMemoryFile(tempRoot, fileName, lineCount, withTrailingNewline = true) {
  const memoryPath = path.join(tempRoot, fileName);
  const body = Array.from({ length: lineCount }, (_, index) => `line ${index + 1}`).join('\n');
  const content = withTrailingNewline && body ? `${body}\n` : body;
  fs.writeFileSync(memoryPath, content, 'utf8');
  return memoryPath;
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-discipline-test-'));

  try {
    const memory80 = writeMemoryFile(tempRoot, 'memory-80.md', 80, true);
    const memory81 = writeMemoryFile(tempRoot, 'memory-81.md', 81, true);
    const memory100 = writeMemoryFile(tempRoot, 'memory-100.md', 100, true);
    const memory101 = writeMemoryFile(tempRoot, 'memory-101.md', 101, true);

    assert.equal(countLines('alpha\nbeta\n'), 2, 'trailing newline must not inflate line count');
    assert.equal(readLineCount(memory80), 80, '80-line file should read as 80');
    assert.equal(readLineCount(memory81), 81, '81-line file should read as 81');

    const result80 = evaluateLineCount(readLineCount(memory80));
    assert.deepEqual(result80, { kind: 'silent', exitCode: 0 });

    const result81 = evaluateLineCount(readLineCount(memory81));
    const advisory81 = JSON.parse(result81.stdout).hookSpecificOutput.additionalContext;
    assert.equal(result81.kind, 'warn');
    assert.equal(result81.exitCode, 0);
    assert.match(advisory81, /81 lines/i);
    assert.match(advisory81, /\/learn/i);

    const result100 = evaluateLineCount(readLineCount(memory100));
    const advisory100 = JSON.parse(result100.stdout).hookSpecificOutput.additionalContext;
    assert.equal(result100.kind, 'warn');
    assert.equal(result100.exitCode, 0);
    assert.match(advisory100, /100 lines/i);

    const result101 = evaluateLineCount(readLineCount(memory101));
    assert.equal(result101.kind, 'block');
    assert.equal(result101.exitCode, 2);
    assert.match(result101.stderr || '', /101 lines/i);
    assert.match(result101.stderr || '', /\/learn/i);
    assert.match(buildBlockMessage(101), /session start blocked/i);
    assert.match(buildWarnResponse(81).hookSpecificOutput.additionalContext, /Run \/learn now/i);

    console.log('PASS memory-discipline.test.js');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
