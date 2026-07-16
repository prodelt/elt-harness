// E2E smoke for S5: stop -> cost_ledger -> `amos cost`; model-policy deny on 3rd spawn.
// Run: node tests/smoke-cost-e2e.js  (isolated AMOS_HOME, exits 0 on success)
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AMOS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-smoke-'));
const env = { ...process.env, AMOS_HOME, AMOS_MODEL_POLICY: '', CLAUDE_CODE_SUBAGENT_MODEL: '' };
delete env.AMOS_MODEL_POLICY;
delete env.CLAUDE_CODE_SUBAGENT_MODEL;
const AMOS = path.join(__dirname, '..', 'bin', 'amos.js');

const tDir = path.join(AMOS_HOME, '.claude');
fs.mkdirSync(tDir, { recursive: true });
const transcript = path.join(tDir, 's1.jsonl');
fs.writeFileSync(transcript, [
  JSON.stringify({ type: 'assistant', message: { model: 'claude-fable-5', usage: { input_tokens: 500, output_tokens: 1200, cache_read_input_tokens: 90000, cache_creation_input_tokens: 3000 } } }),
  JSON.stringify({ type: 'assistant', message: { model: 'claude-fable-5', usage: { input_tokens: 100, output_tokens: 800, cache_read_input_tokens: 95000, cache_creation_input_tokens: 0 } } })
].join('\n'), 'utf8');

function amos(args, input) {
  const r = spawnSync('node', [AMOS, ...args], { input: input || '', encoding: 'utf8', env, timeout: 10000 });
  return (r.stdout || '').trim();
}

const failures = [];
const check = (name, cond, extra) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ' | ' + (extra || '')}`);
  if (!cond) failures.push(name);
};

// 1. Stop writes the ledger
amos(['event', 'stop'], JSON.stringify({ session_id: 'smoke-1', cwd: AMOS_HOME, transcript_path: transcript }));
const costJson = JSON.parse(amos(['cost', '--days', '1', '--json']));
check('ledger row written', costJson.perSession.length === 1, JSON.stringify(costJson));
if (costJson.perSession.length === 1) {
  const row = costJson.perSession[0];
  check('output tokens summed (2000)', row.output_tokens === 2000, JSON.stringify(row));
  check('client inferred = claude', row.client === 'claude', row.client);
  check('model = claude-fable-5', row.model === 'claude-fable-5', row.model);
}

// 2. Human-readable report
const costText = amos(['cost', '--days', '1']);
check('text report shows model line', costText.includes('claude/claude-fable-5'), costText);

// 3. Model policy: spawns 1-2 silent, 3rd denies, cheap model silent
const spawn = (model) => amos(['event', 'pre-tool'], JSON.stringify({ session_id: 'smoke-1', tool_name: 'Task', tool_input: model ? { prompt: 'x', model } : { prompt: 'x' } }));
check('violation #1 silent', spawn() === '');
check('violation #2 silent', spawn() === '');
const third = spawn();
check('violation #3 denies', third.includes('"permissionDecision":"deny"') && third.includes('amos model-policy'), third);
check('haiku spawn silent', spawn('haiku') === '');

// 4. BOM-prefixed stdin still parses (PowerShell 5.1 pipe)
amos(['event', 'stop'], '﻿' + JSON.stringify({ session_id: 'smoke-bom', cwd: AMOS_HOME, transcript_path: transcript }));
const bomJson = JSON.parse(amos(['cost', '--days', '1', '--json']));
check('BOM stdin handled (2 sessions)', bomJson.perSession.length === 2, JSON.stringify(bomJson.perSession.map(s => s.session_id)));

console.log(failures.length === 0 ? '\nSMOKE: ALL PASS' : `\nSMOKE: ${failures.length} FAILURES`);
process.exit(failures.length === 0 ? 0 : 1);
