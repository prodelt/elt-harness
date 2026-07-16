const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate the DB before db.js computes AMOS_DIR at require time
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-cost-test-'));
process.env.AMOS_HOME = TMP_HOME;

const db = require('../lib/db.js');
const { extractUsageFromTranscript, inferClient } = require('../lib/cost.js');
const { evaluateSubagentModel, isCheapModel, DEFAULT_MODEL_POLICY } = require('../lib/policy.js');

function writeTranscript(lines) {
  const p = path.join(TMP_HOME, `transcript-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(p, lines.join('\n'), 'utf8');
  return p;
}

const asst = (model, usage) => JSON.stringify({ type: 'assistant', message: { model, usage } });

test('cost.js — transcript usage extraction', async (t) => {
  await t.test('sums usage across assistant turns and keeps last model', () => {
    const p = writeTranscript([
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      asst('claude-haiku-4-5', { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 }),
      'not-json-garbage',
      asst('claude-fable-5', { input_tokens: 10, output_tokens: 40, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 })
    ]);
    const u = extractUsageFromTranscript(p);
    assert.strictEqual(u.input_tokens, 110);
    assert.strictEqual(u.output_tokens, 90);
    assert.strictEqual(u.cache_read_tokens, 3000);
    assert.strictEqual(u.cache_creation_tokens, 200);
    assert.strictEqual(u.turns, 2);
    assert.strictEqual(u.model, 'claude-fable-5');
    assert.strictEqual(u.partial, 0);
  });

  await t.test('tail-reads oversized transcripts and flags partial', () => {
    const filler = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(200) } });
    const lines = Array(50).fill(filler);
    lines.push(asst('claude-haiku-4-5', { input_tokens: 5, output_tokens: 7 }));
    const p = writeTranscript(lines);
    const u = extractUsageFromTranscript(p, { maxBytes: 2048 });
    assert.strictEqual(u.partial, 1);
    assert.strictEqual(u.output_tokens, 7);
  });

  await t.test('unreadable file -> null', () => {
    assert.strictEqual(extractUsageFromTranscript(path.join(TMP_HOME, 'nope.jsonl')), null);
  });

  await t.test('inferClient from transcript path', () => {
    assert.strictEqual(inferClient({ transcript_path: 'C:\\Users\\x\\.claude\\projects\\p\\s.jsonl' }), 'claude');
    assert.strictEqual(inferClient({ transcript_path: '/home/x/.codex/sessions/s.jsonl' }), 'codex');
    assert.strictEqual(inferClient({ transcript_path: '/home/x/.gemini/tmp/s.jsonl' }), 'gemini');
    assert.strictEqual(inferClient({}), 'unknown');
  });
});

test('db.js — cost ledger + policy events', async (t) => {
  await t.test('logCost + getCostSummary aggregates MAX per session', () => {
    const sid = 'cost-sess-' + Date.now();
    db.logCost({ session_id: sid, client: 'claude', model: 'claude-fable-5', input_tokens: 100, output_tokens: 200, cache_read_tokens: 10, cache_creation_tokens: 5, turns: 3 });
    // Second Stop later in the same session — cumulative counters grew
    db.logCost({ session_id: sid, client: 'claude', model: 'claude-fable-5', input_tokens: 150, output_tokens: 300, cache_read_tokens: 20, cache_creation_tokens: 5, turns: 5 });

    const summary = db.getCostSummary({ days: 1, sessionId: sid });
    assert.strictEqual(summary.perSession.length, 1);
    assert.strictEqual(summary.perSession[0].output_tokens, 300);
    assert.strictEqual(summary.byModel.length, 1);
    assert.strictEqual(summary.byModel[0].sessions, 1);
    assert.strictEqual(summary.byModel[0].output_tokens, 300);
    assert.strictEqual(summary.byModel[0].input_tokens, 150);
  });

  await t.test('policy events counter is per session+kind', () => {
    const sid = 'pol-sess-' + Date.now();
    assert.strictEqual(db.countPolicyEvents(sid, 'model-policy'), 0);
    db.logPolicyEvent(sid, 'model-policy', 'opus');
    db.logPolicyEvent(sid, 'model-policy', '(inherit)');
    db.logPolicyEvent(sid, 'other-kind', 'x');
    assert.strictEqual(db.countPolicyEvents(sid, 'model-policy'), 2);
  });
});

test('policy.js — subagent model policy', async (t) => {
  const mp = { ...DEFAULT_MODEL_POLICY };
  const env = {}; // no CLAUDE_CODE_SUBAGENT_MODEL, no AMOS_MODEL_POLICY

  await t.test('isCheapModel matches substrings case-insensitively', () => {
    assert.strictEqual(isCheapModel('claude-haiku-4-5-20251001', mp.cheapModels), true);
    assert.strictEqual(isCheapModel('Sonnet', mp.cheapModels), true);
    assert.strictEqual(isCheapModel('claude-fable-5', mp.cheapModels), false);
    assert.strictEqual(isCheapModel('', mp.cheapModels), false);
  });

  await t.test('non-subagent tools are ignored', () => {
    assert.strictEqual(evaluateSubagentModel('Bash', { model: '' }, { modelPolicy: mp, env }), null);
  });

  await t.test('cheap explicit model -> allow', () => {
    assert.strictEqual(evaluateSubagentModel('Task', { model: 'haiku' }, { modelPolicy: mp, env }), null);
    assert.strictEqual(evaluateSubagentModel('Agent', { model: 'sonnet' }, { modelPolicy: mp, env }), null);
  });

  await t.test('expensive explicit model -> violation', () => {
    const v = evaluateSubagentModel('Task', { model: 'opus' }, { modelPolicy: mp, env });
    assert.ok(v && v.violation);
    assert.strictEqual(v.model, 'opus');
  });

  await t.test('missing model inherits orchestrator -> violation unless env default is cheap', () => {
    const v = evaluateSubagentModel('Agent', {}, { modelPolicy: mp, env });
    assert.ok(v && v.violation);
    assert.strictEqual(v.model, '(inherit)');
    assert.strictEqual(
      evaluateSubagentModel('Agent', {}, { modelPolicy: mp, env: { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' } }),
      null
    );
  });

  await t.test('escape hatches: AMOS_MODEL_POLICY=off and enabled=false', () => {
    assert.strictEqual(evaluateSubagentModel('Task', {}, { modelPolicy: mp, env: { AMOS_MODEL_POLICY: 'off' } }), null);
    assert.strictEqual(evaluateSubagentModel('Task', {}, { modelPolicy: { ...mp, enabled: false }, env }), null);
  });
});
