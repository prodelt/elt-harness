'use strict';

const test = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const AMOS_DIR = process.env.AMOS_HOME || path.join(os.homedir(), '.amos');
const AMOS_JS = path.join(AMOS_DIR, 'bin', 'amos.js');

const preflight = require('../lib/preflight.js');
const {
  detectDomain,
  withRouterRelevance,
  runSkillgrab,
  context7Hint,
  codemapHint,
  buildPreflight,
  formatPreflightContext,
  checkPreflightArtifact,
  evaluatePreflightBenchmarks,
  PREFLIGHT_BENCHMARKS,
  PREFLIGHT_BUDGET_BYTES,
} = preflight;

const REGISTRY_AVAILABLE =
  fs.existsSync(path.join(os.homedir(), '.claude', 'hooks', 'skill-ranker.js')) &&
  fs.existsSync(path.join(os.homedir(), '.claude', 'skill-registry', 'digests.jsonl'));

function runAmos(args, cwd) {
  const env = { ...process.env };
  delete env.AMOS_PROFILE;
  delete env.AMOS_DISABLE;
  const result = cp.spawnSync('node', [AMOS_JS, ...args], { env, cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// ── detectDomain ──────────────────────────────────────────────────────────────

test('detectDomain: coding terms route to coding', () => {
  assert.equal(detectDomain('add npm package dependency and refactor module code'), 'coding');
  assert.equal(detectDomain('fix bug in javascript function and write unit tests'), 'coding');
});

test('detectDomain: marketing terms route to marketing', () => {
  assert.equal(detectDomain('create marketing landing page copy and design review'), 'marketing');
});

test('detectDomain: planning terms route to planning', () => {
  assert.equal(detectDomain('plan sprint retro and roadmap review'), 'planning');
  assert.equal(detectDomain('design ceo strategy review for product roadmap'), 'planning');
});

test('detectDomain: no matches falls back to general', () => {
  assert.equal(detectDomain('zzzzzz low confidence nonsense'), 'general');
});

// ── gstack domain hints ──────────────────────────────────────────────────────

test('withRouterRelevance: boosts gstack/landing-report for marketing+landing query', () => {
  const ranked = withRouterRelevance('create marketing landing page copy', [
    { name: 'gstack/landing-report', score: 0.1, breakdown: { relevance: 0.1 } },
    { name: 'other-skill', score: 0.2, breakdown: { relevance: 0.2 } },
  ]);
  assert.equal(ranked[0].name, 'gstack/landing-report');
  assert.equal(ranked[0].breakdown.relevance, 0.9);
  assert.ok(ranked[0].breakdown.routerHint.includes('gstack'));
});

test('withRouterRelevance: boosts gstack/retro for sprint+retro query', () => {
  const ranked = withRouterRelevance('plan sprint retro', [
    { name: 'gstack/retro', score: 0.1, breakdown: { relevance: 0.1 } },
  ]);
  assert.equal(ranked[0].breakdown.relevance, 0.9);
});

test('withRouterRelevance: leaves unrelated skills unchanged', () => {
  const ranked = withRouterRelevance('totally unrelated query', [
    { name: 'gstack/landing-report', score: 0.1, breakdown: { relevance: 0.1 } },
  ]);
  assert.equal(ranked[0].breakdown.relevance, 0.1);
  assert.ok(!ranked[0].breakdown.routerHint);
});

// ── skillgrab — cached + fail-soft ──────────────────────────────────────────

test('runSkillgrab: success shape is cached and reused within TTL', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-preflight-'));
  const cachePath = path.join(dir, 'skillgrab-cache.json');
  let calls = 0;
  const runner = () => {
    calls++;
    return {
      status: 0,
      stdout: JSON.stringify({ plan: [{ skillName: 'content-strategy' }, { skillName: 'compliance-tracking' }, { skillName: 'extra' }] }),
      stderr: '',
    };
  };

  const first = runSkillgrab('/some/project', { cachePath, now: () => 1000, runner });
  assert.equal(first.status, 'ok');
  assert.deepEqual(first.plan, ['content-strategy', 'compliance-tracking']);
  assert.equal(calls, 1);

  const second = runSkillgrab('/some/project', { cachePath, now: () => 1500, runner });
  assert.equal(second.status, 'ok');
  assert.equal(calls, 1, 'second call within TTL must hit cache, not re-run skillgrab');

  const third = runSkillgrab('/some/project', { cachePath, now: () => 1000 + 61 * 60 * 1000, runner });
  assert.equal(calls, 2, 'call past TTL must re-run skillgrab');
  assert.equal(third.status, 'ok');
});

test('runSkillgrab: failure is fail-soft and cached', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-preflight-'));
  const cachePath = path.join(dir, 'skillgrab-cache.json');
  const runner = () => ({ status: 1, stdout: '', stderr: 'skillgrab: command not found' });

  const result = runSkillgrab('/some/project', { cachePath, now: () => 1000, runner });
  assert.equal(result.status, 'error');
  assert.deepEqual(result.plan, []);
  assert.match(result.error, /not found/);

  const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'))['/some/project'];
  assert.equal(cached.status, 'error');
});

test('runSkillgrab: thrown runner is fail-soft', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-preflight-'));
  const cachePath = path.join(dir, 'skillgrab-cache.json');
  const runner = () => { throw new Error('spawn EPERM'); };

  const result = runSkillgrab('/some/project', { cachePath, now: () => 1000, runner });
  assert.equal(result.status, 'error');
  assert.match(result.error, /EPERM/);
});

// ── context7 / codemap hints ─────────────────────────────────────────────────

test('context7Hint: fires for library/package/sdk terms', () => {
  assert.ok(context7Hint('add npm package dependency for date formatting library'));
  assert.equal(context7Hint('plan sprint retro session'), null);
});

test('codemapHint: reports not-initialized when graphify-out is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-preflight-'));
  assert.match(codemapHint(dir), /not initialized/);
});

test('codemapHint: reports ready when graphify-out/graph.json exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-preflight-'));
  fs.mkdirSync(path.join(dir, 'graphify-out'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'graphify-out', 'graph.json'), '{}', 'utf8');
  assert.match(codemapHint(dir), /ready/);
});

// ── buildPreflight / formatPreflightContext ──────────────────────────────────

test('buildPreflight: returns full record shape and stays under 1.5KB', { skip: !REGISTRY_AVAILABLE && 'skill registry not available on this machine' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-preflight-'));
  const record = buildPreflight('research competitor market analysis', { root: dir });

  assert.equal(record.kind, 'preflight');
  assert.equal(record.query, 'research competitor market analysis');
  assert.ok(['coding', 'marketing', 'planning', 'general'].includes(record.domain));
  assert.ok(typeof record.selected === 'string');
  assert.ok(Array.isArray(record.local));
  assert.ok(Array.isArray(record.gstack));
  assert.ok(record.skillgrab && typeof record.skillgrab.status === 'string');
  assert.ok(record.codemap);
  assert.ok(record.ts);

  const text = formatPreflightContext(record);
  assert.ok(Buffer.byteLength(text, 'utf8') <= PREFLIGHT_BUDGET_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(record), 'utf8') <= PREFLIGHT_BUDGET_BYTES);
});

test('buildPreflight: degrades gracefully when registry is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-preflight-'));
  const record = buildPreflight('some task', {
    root: dir,
    rankerPath: path.join(dir, 'no-such-ranker.js'),
    digestPath: path.join(dir, 'no-such-digests.jsonl'),
  });
  assert.equal(record.selected, 'no skill');
  assert.deepEqual(record.local, []);
});

// ── checkPreflightArtifact ────────────────────────────────────────────────────

test('checkPreflightArtifact: missing artifact reports ok=false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-preflight-'));
  const result = checkPreflightArtifact(dir, new Date());
  assert.equal(result.ok, false);
});

test('checkPreflightArtifact: fresh artifact is not stale', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-preflight-'));
  fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
  const now = new Date('2026-06-11T00:00:00Z');
  fs.writeFileSync(path.join(dir, '.planning', 'preflight-latest.json'), JSON.stringify({ ts: now.toISOString() }), 'utf8');
  const result = checkPreflightArtifact(dir, now);
  assert.equal(result.ok, true);
  assert.equal(result.stale, false);
});

test('checkPreflightArtifact: artifact older than 24h is stale', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-preflight-'));
  fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
  const old = new Date('2026-06-01T00:00:00Z');
  fs.writeFileSync(path.join(dir, '.planning', 'preflight-latest.json'), JSON.stringify({ ts: old.toISOString() }), 'utf8');
  const result = checkPreflightArtifact(dir, new Date('2026-06-11T00:00:00Z'));
  assert.equal(result.ok, true);
  assert.equal(result.stale, true);
});

// ── benchmark — 15/15 (10 ported + 5 new) ────────────────────────────────────

test('PREFLIGHT_BENCHMARKS: 15 cases, 10 ported + 5 new', () => {
  assert.equal(PREFLIGHT_BENCHMARKS.length, 15);
});

test('evaluatePreflightBenchmarks: 15/15 PASS', { skip: !REGISTRY_AVAILABLE && 'skill registry not available on this machine' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-preflight-'));
  const records = {};
  for (const b of PREFLIGHT_BENCHMARKS) {
    records[b.query] = buildPreflight(b.query, { root: dir });
  }
  const report = evaluatePreflightBenchmarks(records);
  const failed = report.results.filter(r => r.status !== 'pass');
  assert.deepEqual(failed, []);
  assert.equal(report.status, 'pass');
});

// ── CLI ───────────────────────────────────────────────────────────────────────

test('amos preflight: text output under budget and <5s', { skip: !REGISTRY_AVAILABLE && 'skill registry not available on this machine' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-preflight-'));
  const t0 = Date.now();
  const res = runAmos(['preflight', 'research competitor market analysis'], dir);
  const elapsed = Date.now() - t0;
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes('AMOS Preflight'));
  assert.ok(Buffer.byteLength(res.stdout.trimEnd(), 'utf8') <= PREFLIGHT_BUDGET_BYTES);
  assert.ok(elapsed < 5000, `preflight took ${elapsed}ms, expected <5000ms`);
});

test('amos preflight --json: valid JSON record', { skip: !REGISTRY_AVAILABLE && 'skill registry not available on this machine' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-preflight-'));
  const res = runAmos(['preflight', '--json', 'create feature branch commit push pr'], dir);
  assert.equal(res.status, 0);
  const record = JSON.parse(res.stdout);
  assert.equal(record.kind, 'preflight');
  assert.equal(record.selected, 'git-flow');
});

test('amos preflight --benchmark --json: 15/15 PASS, exit 0', { skip: !REGISTRY_AVAILABLE && 'skill registry not available on this machine' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-preflight-'));
  const res = runAmos(['preflight', '--benchmark', '--json'], dir);
  const report = JSON.parse(res.stdout);
  assert.equal(report.status, 'pass');
  assert.equal(res.status, 0);
});

test('amos preflight --write: writes .planning/preflight-latest.json', { skip: !REGISTRY_AVAILABLE && 'skill registry not available on this machine' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-preflight-'));
  const res = runAmos(['preflight', '--write', 'create feature branch commit push pr'], dir);
  assert.equal(res.status, 0);

  const artifactPath = path.join(dir, '.planning', 'preflight-latest.json');
  assert.ok(fs.existsSync(artifactPath));
  const value = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(value.kind, 'preflight');
  assert.equal(value.selected, 'git-flow');

  const check = checkPreflightArtifact(dir, new Date());
  assert.equal(check.ok, true);
  assert.equal(check.stale, false);
});

test('amos preflight: no query exits silently (exit 0, no stdout)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-preflight-'));
  const res = runAmos(['preflight'], dir);
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});
