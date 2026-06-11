const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate the DB before db.js computes AMOS_DIR at require time
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-s7-test-'));
process.env.AMOS_HOME = TMP_HOME;

const db = require('../lib/db.js');
const { extractCommandsFromTranscript } = require('../lib/cost.js');
const { extractInstincts } = require('../lib/instincts.js');

function writeTranscript(lines) {
  const p = path.join(TMP_HOME, `t-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(p, lines.join('\n'), 'utf8');
  return p;
}

const toolUse = (name, command) => JSON.stringify({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', name, input: { command } }] }
});

test('cost.js — extractCommandsFromTranscript', async (t) => {
  await t.test('pulls Bash and PowerShell commands, ignores other tools', () => {
    const p = writeTranscript([
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      toolUse('Bash', 'npm test'),
      toolUse('PowerShell', 'Get-ChildItem'),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'x' } }] } }),
      'not-json',
      toolUse('Bash', 'npm test')
    ]);
    const cmds = extractCommandsFromTranscript(p);
    assert.deepStrictEqual(cmds, ['npm test', 'Get-ChildItem', 'npm test']);
  });

  await t.test('unreadable file -> []', () => {
    assert.deepStrictEqual(extractCommandsFromTranscript(path.join(TMP_HOME, 'nope.jsonl')), []);
  });
});

test('db.js — instinct ledger upsert + confidence', async (t) => {
  await t.test('confidence recomputes against the NEW cumulative uses', () => {
    db.recordInstinct('foo', 3);
    let row = db.getInstincts().find(r => r.pattern === 'foo');
    assert.strictEqual(row.uses, 3);
    assert.ok(Math.abs(row.confidence - 0.6) < 1e-9, `expected 0.6, got ${row.confidence}`);

    db.recordInstinct('foo', 3);
    row = db.getInstincts().find(r => r.pattern === 'foo');
    assert.strictEqual(row.uses, 6, 'uses must accumulate across upserts');
    assert.strictEqual(row.confidence, 1, 'confidence caps at 1.0 for the new total, not the stale value');
  });

  await t.test('getInstincts filters by minUses and minConfidence', () => {
    db.recordInstinct('low', 1);
    const high = db.getInstincts({ minUses: 5, minConfidence: 0.8 });
    assert.ok(high.every(r => r.uses >= 5 && r.confidence >= 0.8));
    assert.ok(!high.some(r => r.pattern === 'low'));
  });
});

test('S7 e2e — repeated session command graduates to an evolvable instinct', async (t) => {
  await t.test('transcript with a 5x-repeated command crosses the evolve bar', () => {
    const p = writeTranscript(Array(5).fill(toolUse('Bash', 'node tools/doctor.js')));
    const commands = extractCommandsFromTranscript(p);
    const candidates = extractInstincts(commands).filter(i => i.uses >= 2);
    for (const c of candidates) db.recordInstinct(`cmd:${c.pattern}`, c.uses);

    const evolvable = db.getInstincts({ minUses: 5, minConfidence: 0.8 });
    const hit = evolvable.find(r => r.pattern === 'cmd:node tools/doctor.js');
    assert.ok(hit, 'the repeated command should appear among evolvable instincts');
    assert.strictEqual(hit.uses, 5);
    assert.strictEqual(hit.confidence, 1);
  });
});
