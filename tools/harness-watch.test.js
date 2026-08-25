'use strict';
// 009 T007 — watchdog. Тест на КАЖДЫЙ детектор поверх синтетического run-log, плюс два
// свойства, ради которых он вообще пишет файл: идемпотентность по key и exit-код `--once`.
// Синтетика здесь честная: записи ровно того формата, что пишет `appendRunLog` в elt.js
// (limitHit/provider — из fleet-роутера, status:'red-stop'/'judge-dead' — из гейта).

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const WATCH = path.join(__dirname, 'harness-watch.js');
const ELT = path.join(__dirname, 'elt.js');
const { detect, runOnce, fallbackJudge } = require('./harness-watch');

// 020 T011 — доступность judge-CLI задаётся ФИКСТУРОЙ, а не машиной.
// `fallbackJudge` спрашивает `providers.available`, то есть реально ли установлен CLI. Три
// теста ниже проверяют маршрут фолбэка, и на машине разработчика они были зелёными только
// потому, что claude/codex там стоят: на CI (и на любой чистой машине) фолбэку некуда идти,
// действие `judge-fallback` не появляется, и тесты краснеют — не из-за кода, а из-за окружения.
// Приём тот же, что уже применён ниже в «fallback судьи пропускает отсутствующий CLI».
function withAvailable(installed, fn) {
  const providers = require('./providers');
  const original = providers.available;
  providers.available = (provider) => installed.includes(provider);
  try { return fn(); } finally { providers.available = original; }
}
const roots = [];

function fixture(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-watch-'));
  roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "0"', judge: { enabled: true, provider: 'agy', model: 'gemini-3.6-flash-high', verify: { provider: 'codex', model: 'gpt-5.6-sol' } },
    redProof: 'on', ...config,
  }));
  return root;
}

function runlog(root, entries) {
  const dir = path.join(root, '.git', 'elt');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-log.jsonl'),
    entries.map((e, i) => JSON.stringify({ ts: new Date(Date.UTC(2026, 6, 27, 10, i)).toISOString(), ...e })).join('\n') + '\n');
}

function kinds(root, options) { return detect(root, options).map((i) => i.kind); }

after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

test('limit-streak: два limitHit одного провайдера — инцидент, по одному на провайдера — нет', () => {
  const root = fixture();
  runlog(root, [
    { tid: 'T001', provider: 'agy', limitHit: true },
    { tid: 'T002', provider: 'codex', limitHit: false },
    { tid: 'T003', provider: 'agy', limitHit: true },
  ]);
  const hit = detect(root).filter((i) => i.kind === 'limit-streak');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].provider, 'agy');

  const single = fixture();
  runlog(single, [{ tid: 'T001', provider: 'agy', limitHit: true }, { tid: 'T002', provider: 'codex', limitHit: true }]);
  assert.deepEqual(kinds(single).filter((k) => k === 'limit-streak'), []);
});

test('red-repeat: два red-stop по одной задаче — инцидент; task:null не склеивается', () => {
  const root = fixture();
  runlog(root, [
    { task: 'T007', status: 'red-stop', oracle: { exit: 1 } },
    { task: 'T007', status: 'red-stop', oracle: { exit: 1 } },
  ]);
  const hit = detect(root).filter((i) => i.kind === 'red-repeat');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].task, 'T007');

  const anon = fixture();
  runlog(anon, [
    { task: null, status: 'red-stop', oracle: { exit: 1 } },
    { task: null, status: 'red-stop', oracle: { exit: 1 } },
  ]);
  assert.deepEqual(kinds(anon).filter((k) => k === 'red-repeat'), [],
    'красный оракул вне слайса — не «повтор по задаче»');
});

// Два продюсера пишут одно и то же событие в РАЗНЫЕ поля: elt.js — `status`, драйвер
// PowerShell-драйвер (снят 019/T007) — `result` (см. Append-RunLog в PowerShell-драйвер (снят 019/T007)). Детектор, слепой на
// формат драйвера, бесполезен ровно в автономном прогоне.
test('формат драйвера (result) распознаётся наравне с форматом elt.js (status)', () => {
  const root = fixture();
  runlog(root, [
    { task: 'T007', oracle: { exit: 1 }, result: 'red-stop' },
    { task: 'T007', oracle: { exit: 1 }, result: 'red-stop' },
    { task: 'T008', result: 'judge-dead', judgeLog: 'x.log' },
    { task: 'T009', result: 'judge-dead', judgeLog: 'y.log' },
  ]);
  const found = kinds(root);
  assert.ok(found.includes('red-repeat'), 'red-stop драйвера должен ловиться');
  assert.ok(found.includes('judge-dead-streak'), 'judge-dead драйвера должен ловиться');
});

// Третий продюсер — fleet-ledger (`logSpawn` в tools/fleet/fleet.js): недоступный судья
// пишется НЕ как status/result, а строкой фазы `{phase:'judge', verdict:'judge-unavailable'}`.
// Детектор, знающий только формат драйвера, слеп ровно на fleet.
test('формат fleet-ledger (phase:judge/verdict) распознаётся наравне с судьёй драйвера', () => {
  const root = fixture();
  runlog(root, [
    { tid: 'T1', phase: 'judge', provider: 'agy', verdict: 'judge-unavailable' },
    { tid: 'T2', phase: 'judge', provider: 'agy', verdict: 'judge-unavailable' },
  ]);
  assert.ok(kinds(root).includes('judge-dead-streak'), 'судья, умерший в fleet, обязан считаться мёртвым');

  // И тот же формат рвёт стрик успешным вердиктом — иначе «подряд» считалось бы не по судье.
  const ok = fixture();
  runlog(ok, [
    { tid: 'T1', phase: 'judge', verdict: 'judge-unavailable' },
    { tid: 'T2', phase: 'judge', verdict: 'pass' },
    { tid: 'T3', phase: 'judge', verdict: 'judge-unavailable' },
  ]);
  assert.ok(!kinds(ok).includes('judge-dead-streak'));
});

test('judge-dead-streak: два подряд — инцидент; pass между ними рвёт стрик', () => {
  const root = fixture();
  runlog(root, [{ task: 'T001', status: 'judge-dead' }, { task: 'T002', status: 'judge-dead' }]);
  assert.equal(detect(root).filter((i) => i.kind === 'judge-dead-streak').length, 1);

  const broken = fixture();
  runlog(broken, [
    { task: 'T001', status: 'judge-dead' },
    { task: 'T002', status: 'judge-pass' },
    { task: 'T003', status: 'judge-dead' },
  ]);
  assert.deepEqual(kinds(broken).filter((k) => k === 'judge-dead-streak'), []);
});

test('oracle-slow: выброс выше медианы ×3; ровный ряд молчит', () => {
  const root = fixture();
  runlog(root, [
    ...[10, 10, 12, 10, 11].map((d) => ({ task: 'T00x', oracle: { exit: 0, durationSec: d } })),
    { task: 'T009', oracle: { exit: 0, durationSec: 90 } },
  ]);
  const hit = detect(root).filter((i) => i.kind === 'oracle-slow');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].task, 'T009');

  const flat = fixture();
  runlog(flat, [10, 10, 12, 10, 11, 14].map((d) => ({ task: 'T00x', oracle: { exit: 0, durationSec: d } })));
  assert.deepEqual(kinds(flat).filter((k) => k === 'oracle-slow'), []);
});

test('block-pattern: 3 judge-block с одним источником — инцидент, 2 — нет; разные источники не склеиваются', () => {
  const root = fixture();
  runlog(root, [
    { task: 'T001', status: 'judge-block', reasons: ['red-proof: green'] },
    { task: 'T002', status: 'judge-block', reasons: ['red-proof green на новом тесте'] },
    { task: 'T003', status: 'judge-block', reasons: ['grounding no-reasons'] },
    { task: 'T004', status: 'judge-block', reasons: ['red-proof: green'] },
  ]);
  const hits = detect(root).filter((i) => i.kind === 'block-pattern');
  assert.equal(hits.length, 1, 'red-proof×3 — инцидент; grounding×1 ниже порога — молчит');
  assert.equal(hits[0].reasonKey, 'judge:red-proof');
  assert.equal(hits[0].count, 3);
  assert.deepEqual(hits[0].examples, ['T001', 'T002', 'T004']);
});

test('block-pattern: l0-block группируется по имени триггера, а не по тексту причины', () => {
  const root = fixture();
  const trig = (name) => ({ triggers: [{ name, reason: `${name} у файла x${Math.random()}` }], judgeNeeded: true, verdict: 'block' });
  runlog(root, [
    { task: 'T001', status: 'l0-block', l0: trig('hot-path') },
    { task: 'T002', status: 'l0-block', l0: trig('hot-path') },
    { task: 'T003', status: 'l0-block', l0: trig('out-of-scope') },
    { task: 'T004', status: 'l0-block', l0: trig('hot-path') },
  ]);
  const hits = detect(root).filter((i) => i.kind === 'block-pattern');
  assert.equal(hits.length, 1, 'hot-path×3 — инцидент; out-of-scope×1 — нет');
  assert.equal(hits[0].reasonKey, 'l0:hot-path');
});

test('T026: elt commit реально зовёт watchdog — 3 judge-block той же причины дают block-pattern в health.jsonl', () => {
  const root = fixture({ oracle: 'node -e "process.exit(0)"', shell: process.platform === 'win32' ? 'powershell' : 'bash', branchPolicy: 'none', redProof: 'off' });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: root });
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** слайс\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'seed'], { cwd: root });
  fs.writeFileSync(path.join(root, 'slice.txt'), 'работа слайса\n');
  assert.equal(spawnSync(process.execPath, [ELT, 'oracle'], { cwd: root, encoding: 'utf8' }).status, 0);

  const stubInvoke = (out) => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'harness-watch-stub-')), 'stub-invoke.js');
    fs.writeFileSync(p, `process.stdout.write(${JSON.stringify(JSON.stringify(out))});\n`);
    return p;
  };
  const judgeOut = (verdict, reasons) => ({
    runOk: true, verdict, reasons, judgeLog: 'log.txt',
    judges: [{ provider: 'agy', model: 'gemini', verdict, reasons, runOk: true }],
    grounding: { filesReviewed: ['slice.txt'] }, redProof: { status: 'skipped' },
    l0: { triggers: [{ name: 'hot-path', files: ['slice.txt'], reason: 'горячий путь' }], judgeNeeded: true },
  });
  const runElt = (args) => spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8' });

  for (let i = 0; i < 3; i++) {
    const r = runElt(['judge', 'run', '--task', 'T001', '--invoke', stubInvoke(judgeOut('block', ['scope creep']))]);
    assert.equal(r.status, 4, r.stderr);
  }
  assert.equal(runElt(['judge', 'run', '--task', 'T001', '--invoke', stubInvoke(judgeOut('pass', ['в границах']))]).status, 0);
  const c = runElt(['commit', '--task', 'T001', '--skip-oracle']);
  assert.equal(c.status, 0, c.stderr);

  const health = path.join(root, '.harness', 'health.jsonl');
  assert.ok(fs.existsSync(health), 'commit обязан вызвать watchdog хотя бы раз');
  const rows = fs.readFileSync(health, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const bp = rows.find((r) => r.kind === 'block-pattern');
  assert.ok(bp, 'три judge-block с одной причиной обязаны дать block-pattern');
  assert.equal(bp.reasonKey, 'judge:судья');
  assert.equal(bp.count, 3);
});

// --- 014 T008 (AC6): тихая смерть фона --------------------------------------------

// `runlog()` ставит записи по минуте на индекс от 2026-07-27T10:00Z, поэтому `now` ниже —
// это «через час с лишним после коммита», т.е. заведомо больше дефолтных 20 минут.
const BG_NOW = Date.parse('2026-07-27T12:00:00.000Z');

test('bg-silent: спекулятивный коммит без фонового вердикта дольше порога — инцидент', () => {
  const root = fixture();
  runlog(root, [
    { task: 'T007', commit: 'aaa111', status: 'committed-speculative' },
    { task: 'T008', commit: 'bbb222', status: 'committed-speculative' },
    // Вердикт пришёл ровно по одному из двух — второй молчит.
    { task: 'T008', commit: 'bbb222', status: 'background-verify-pass', background: { layer: 'suite', exit: 0 } },
  ]);
  const hit = detect(root, { now: BG_NOW }).filter((i) => i.kind === 'bg-silent');
  assert.deepEqual(hit.map((i) => i.commit), ['aaa111'], 'молчание видно, отработавший фон — нет');
  assert.match(hit[0].detail, /без фонового вердикта/);
});

test('bg-silent: КРАСНЫЙ фон — не молчание (вердикт есть, он в очереди bg-red)', () => {
  const root = fixture();
  runlog(root, [
    { task: 'T007', commit: 'aaa111', status: 'committed-speculative' },
    { task: 'T007', commit: 'aaa111', status: 'background-verify-red', background: { layer: 'suite', exit: 1 } },
  ]);
  assert.deepEqual(detect(root, { now: BG_NOW }).filter((i) => i.kind === 'bg-silent'), []);
});

test('bg-silent: внутри порога молчания нет — фон ещё имеет право работать', () => {
  const root = fixture();
  runlog(root, [{ task: 'T007', commit: 'aaa111', status: 'committed-speculative' }]);
  const soon = Date.parse('2026-07-27T10:05:00.000Z'); // 5 минут < дефолтных 20
  assert.deepEqual(detect(root, { now: soon }).filter((i) => i.kind === 'bg-silent'), []);
});

test('bg-silent: порог берётся из harness.json (backgroundTimeoutMin), дефолт 20', () => {
  const root = fixture({ backgroundTimeoutMin: 1 });
  runlog(root, [{ task: 'T007', commit: 'aaa111', status: 'committed-speculative' }]);
  const soon = Date.parse('2026-07-27T10:05:00.000Z');
  assert.equal(detect(root, { now: soon }).filter((i) => i.kind === 'bg-silent').length, 1,
    'проект с быстрым сьютом вправе считать молчанием и 5 минут');
  assert.equal(detect(fixture(), { now: soon }).filter((i) => i.kind === 'bg-silent').length, 0);
});

test('bg-silent: повторный прогон не плодит дублей (идемпотентно по key)', () => {
  const root = fixture();
  runlog(root, [{ task: 'T007', commit: 'aaa111', status: 'committed-speculative' }]);
  runOnce(root, { now: BG_NOW });
  runOnce(root, { now: BG_NOW + 3600000 }); // час спустя — тот же коммит, тот же key
  const rows = fs.readFileSync(path.join(root, '.harness', 'health.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.kind === 'bg-silent');
  assert.equal(rows.length, 1, 'один коммит — одна строка, сколько бы раз watchdog ни бегал');
});

test('stale-park: парковка старше окна — инцидент, свежая — нет', () => {
  const root = fixture();
  const now = Date.parse('2026-07-27T12:00:00.000Z');
  fs.writeFileSync(path.join(root, '.harness', 'parked.json'), JSON.stringify([
    { tid: 'T004', reason: 'judge-block', ts: '2026-07-25T12:00:00.000Z', attempts: 1 },
    { tid: 'T005', reason: 'red-stop', ts: '2026-07-27T11:00:00.000Z', attempts: 1 },
  ]));
  const hit = detect(root, { now }).filter((i) => i.kind === 'stale-park');
  assert.deepEqual(hit.map((i) => i.task), ['T004']);
});

test('circuit-off: код без verify и с redProof:off — инцидент; включённый контур — нет', () => {
  const off = fixture({ judge: { enabled: true, provider: 'agy', model: 'gemini-3.6-flash-high' }, redProof: 'off' });
  runlog(off, [{ task: 'T001', commit: 'abc' }]);
  assert.deepEqual(kinds(off).filter((k) => k === 'circuit-off'), ['circuit-off']);

  const on = fixture();
  runlog(on, [{ task: 'T001', commit: 'abc' }]);
  assert.deepEqual(kinds(on).filter((k) => k === 'circuit-off'), []);
});

test('health.jsonl: запись на инцидент, повторный прогон на тех же данных не дублирует', () => {
  const root = fixture();
  runlog(root, [
    { tid: 'T001', provider: 'agy', limitHit: true },
    { tid: 'T002', provider: 'agy', limitHit: true },
  ]);
  const first = runOnce(root);
  assert.equal(first.fresh.length, 1);
  const second = runOnce(root);
  assert.equal(second.fresh.length, 0, 'идемпотентность по key');
  assert.equal(second.found.length, 1, 'инцидент никуда не делся — просто уже записан');
  assert.equal(second.actions.length, 1, 'запись инцидента однократна, а действие ждёт ack');
  // Две строки: сам инцидент и вытекающее из него действие (T008) — обе по одному разу.
  const lines = fs.readFileSync(path.join(root, '.harness', 'health.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.kind, 'limit-streak');
  assert.ok(Date.parse(rec.ts), 'у записи есть время');
  assert.equal(spawnSync('git', ['check-ignore', '.harness/health.jsonl'], { cwd: root }).status, 0,
    'health.jsonl обязан игнорироваться git — иначе рантайм-артефакт попадёт в дифф слайса');
});

// Замыкание продюсер→потребитель: без oracle.durationSec в run-log детектор oracle-slow
// работает только на синтетике. Гоняем НАСТОЯЩИЙ `elt oracle` в tmp-репо.
test('elt oracle пишет в run-log длительность — иначе oracle-slow нечего измерять', () => {
  const root = fixture({ oracle: 'node -e "0"', shell: process.platform === 'win32' ? 'powershell' : 'bash' });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: root });
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'seed'], { cwd: root });

  const r = spawnSync(process.execPath, [path.join(__dirname, 'elt.js'), 'oracle'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const last = JSON.parse(fs.readFileSync(path.join(root, '.git', 'elt', 'run-log.jsonl'), 'utf8').trim().split('\n').pop());
  assert.equal(last.oracle.exit, 0);
  assert.equal(typeof last.oracle.durationSec, 'number');
});

// ── T008: авто-фиксы ─────────────────────────────────────────────────────────

test('действия из закрытого списка: cooldown / park / judge-fallback, и ровно по разу', () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, '.harness', 'fleet'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'fleet', 'fleet.json'),
    JSON.stringify({ default: ['agy', 'codex', 'claude'] }));
  runlog(root, [
    // claude здесь — воркер (судья фикстуры — agy), поэтому cooldown ниже проверяется
    // именно как решение про воркера, без маршрута.
    { tid: 'T001', provider: 'claude', limitHit: true },
    { tid: 'T002', provider: 'claude', limitHit: true },
    { task: 'T003', result: 'red-stop', oracle: { exit: 1 } },
    { task: 'T003', result: 'red-stop', oracle: { exit: 1 } },
    { task: 'T004', status: 'judge-dead' },
    { task: 'T005', status: 'judge-dead' },
  ]);
  const first = withAvailable(['claude', 'codex'], () => runOnce(root));
  const byAction = Object.fromEntries(first.actions.map((a) => [a.action, a]));
  assert.deepEqual(Object.keys(byAction).sort(), ['cooldown', 'judge-fallback', 'park']);
  assert.equal(byAction.cooldown.from, 'claude');
  assert.equal(byAction.cooldown.subject, 'worker');
  assert.equal(byAction.cooldown.to, null,
    'у cooldown воркера поле есть, но маршрута нет: назвать «следующего» значило бы подать как решение то, чем fleet не пользуется');
  assert.equal(byAction.park.from, 'T003');
  assert.equal(byAction.park.to, 'parked', 'у парковки `to` — состояние задачи, не провайдер');
  assert.equal(byAction['judge-fallback'].from, 'agy');
  assert.equal(byAction['judge-fallback'].to, 'claude', 'фолбэк берётся из закрытого списка judge-провайдеров');
  assert.equal(byAction['judge-fallback'].toModel, 'sonnet', 'фолбэк всегда несёт совместимую provider+model пару');
  for (const a of first.actions) assert.ok(a.reason && a.from, '{action, reason, from}');

  // Пока применение не подтверждено — действие выдаётся снова: падение потребителя между
  // записью и применением иначе теряло бы решение навсегда.
  assert.equal(withAvailable(['claude', 'codex'], () => runOnce(root)).actions.length, 3, 'неподтверждённое действие не теряется');
  require('./harness-watch').ack(root, first.actions.map((a) => a.key));
  assert.deepEqual(withAvailable(['claude', 'codex'], () => runOnce(root)).actions, [], 'после подтверждения — ни разу больше');

  const health = fs.readFileSync(path.join(root, '.harness', 'health.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(health.filter((r) => r.action).length, 3, 'каждое действие записано один раз');
  assert.equal(health.filter((r) => r.applied).length, 3, 'и подтверждено один раз');
});


// Судья маршрутизируется по цепочке СУДЕЙ, а не воркеров: он в конфиге один и сам себя
// не заменит, поэтому здесь маршрут обязан быть — из закрытого списка judge-провайдеров.
test('cooldown судьи: маршрут из цепочки судей, парой provider+model', () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, '.harness', 'fleet'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'fleet', 'fleet.json'),
    JSON.stringify({ policy: { S: ['agy', 'claude'] }, default: ['agy', 'claude'] }));
  runlog(root, [
    { tid: 'T001', provider: 'agy', limitHit: true }, // agy = judge.provider фикстуры
    { tid: 'T002', provider: 'agy', limitHit: true },
  ]);
  const [action] = withAvailable(['claude'], () => runOnce(root)).actions;
  assert.equal(action.action, 'cooldown');
  assert.equal(action.subject, 'judge');
  assert.equal(action.to, 'claude', 'fallback judge не зависит от legacy verify или worker-цепочки');
  assert.equal(action.toModel, 'sonnet');
});

test('fallback судьи пропускает отсутствующий CLI и не выдумывает маршрут', () => {
  const root = fixture();
  const providers = require('./providers');
  const original = providers.available;
  try {
    providers.available = (provider) => provider === 'codex';
    assert.deepEqual(fallbackJudge(root, null, 'agy'), { to: 'codex', toModel: 'gpt-5.6-sol' });
    providers.available = () => false;
    assert.equal(fallbackJudge(root, null, 'agy'), null);
  } finally {
    providers.available = original;
  }
});

test('классы вне закрытого списка действий не дают — только запись', () => {
  const root = fixture();
  const now = Date.parse('2026-07-27T12:00:00.000Z');
  fs.writeFileSync(path.join(root, '.harness', 'parked.json'),
    JSON.stringify([{ tid: 'T004', reason: 'judge-block', ts: '2026-07-25T12:00:00.000Z', attempts: 1 }]));
  runlog(root, [10, 10, 12, 10, 11, 90].map((d) => ({ task: 'T00x', oracle: { exit: 0, durationSec: d } })));
  const res = runOnce(root, { now });
  assert.ok(res.found.some((i) => i.kind === 'stale-park') && res.found.some((i) => i.kind === 'oracle-slow'));
  assert.deepEqual(res.actions, [], 'stale-park/oracle-slow — только запись, никаких действий');
});

// 019 T007: три сквозных теста, гонявшие PowerShell-драйвер (парковка по решению
// watchdog, cooldown чужого судьи, сужение батча), сняты вместе с ним, а fleet-консьюмер —
// ещё в T006. Детекторы и решения проверяются напрямую тестами выше: они и есть несущая
// часть, потребителя им вернёт T012. Побочный эффект замерен: файл шёл 133 с, стал 6,4 с.
// ── T008: проводка. Детекторы без потребителя бесполезны, поэтому оба консьюмера
// проверяются на РЕАЛЬНОМ коде: fleet — своей функцией применения, драйвер — прогоном.

// Судья прогона задаётся флагом запуска и меняется фолбэком — оба раза мимо harness.json.
// Решение, посчитанное по статическому конфигу, промахнётся: лимит настоящего судьи уйдёт
// в noop, а фолбэк будет заявлен от провайдера, который уже не судит.
test('судья берётся из ФАКТИЧЕСКОГО прогона (override и после фолбэка), а не из harness.json', () => {
  const root = fixture(); // judge.provider = agy, verify = codex
  fs.mkdirSync(path.join(root, '.harness', 'fleet'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'fleet', 'fleet.json'),
    JSON.stringify({ default: ['agy', 'codex', 'claude'] }));
  runlog(root, [
    { tid: 'T001', provider: 'claude', limitHit: true },
    { tid: 'T002', provider: 'claude', limitHit: true },
    { task: 'T003', status: 'judge-dead' },
    { task: 'T004', status: 'judge-dead' },
  ]);

  // Без override claude — обычный воркер: маршрута нет, судья в фолбэке — agy из конфига.
  const byStatic = Object.fromEntries(withAvailable(['claude', 'codex'], () => runOnce(root)).actions.map((a) => [a.action, a]));
  assert.equal(byStatic.cooldown.subject, 'worker', 'claude не судья этого прогона');
  assert.equal(byStatic['judge-fallback'].from, 'agy');

  // Тот же run-log, но прогон запущен с `-JudgeProvider claude`: теперь лимит claude —
  // это лимит СУДЬИ, и уводить надо его.
  const byRuntime = Object.fromEntries(withAvailable(['claude', 'codex'], () => runOnce(root, { judgeProvider: 'claude' })).actions.map((a) => [a.action, a]));
  assert.equal(byRuntime.cooldown.from, 'claude');
  assert.equal(byRuntime.cooldown.subject, 'judge');
  assert.ok(byRuntime.cooldown.to && byRuntime.cooldown.to !== 'claude',
    'лимит фактического судьи обязан дать маршрут, а не молчаливый noop');
  assert.equal(byRuntime['judge-fallback'].from, 'claude', 'откат заявляется от того, кто судит сейчас');

  // И после первого фолбэка (судья уже codex в памяти прогона) — от codex, не от agy.
  const after = withAvailable(['claude', 'codex'], () => runOnce(root, { judgeProvider: 'codex' })).actions.find((a) => a.action === 'judge-fallback');
  assert.equal(after.from, 'codex');
  assert.ok(after.to !== 'codex' && after.toModel, 'новый судья приходит парой provider+model');
});

test('--once: exit 1 пока инцидент в окне (в т.ч. на повторе), exit 0 на здоровом проекте', () => {
  const root = fixture();
  runlog(root, [
    { tid: 'T001', provider: 'agy', limitHit: true },
    { tid: 'T002', provider: 'agy', limitHit: true },
  ]);
  const run = () => spawnSync(process.execPath, [WATCH, '--once'], { cwd: root, encoding: 'utf8' });
  assert.equal(run().status, 1);
  assert.equal(run().status, 1, 'уже записанный инцидент не становится здоровьем');

  const healthy = fixture();
  runlog(healthy, [{ task: 'T001', commit: 'abc' }]);
  assert.equal(spawnSync(process.execPath, [WATCH, '--once'], { cwd: healthy, encoding: 'utf8' }).status, 0);
});


// 019 T006: снято три кейса — они проверяли fleet.applyWatchdog (cooldown воркера, park,
// judge-fallback между батчами). Оркестратор удалён вместе с fleet/, предмета проверки
// больше нет. Сами решения watchdog (что он их ВЫДАЁТ) проверяются кейсами выше — снят
// только слой «как их применял оркестратор».