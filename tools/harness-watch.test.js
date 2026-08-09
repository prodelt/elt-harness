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
// elt-loop.ps1 — `result` (см. Append-RunLog в tools/elt-loop.ps1). Детектор, слепой на
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
  const first = runOnce(root);
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
  assert.equal(runOnce(root).actions.length, 3, 'неподтверждённое действие не теряется');
  require('./harness-watch').ack(root, first.actions.map((a) => a.key));
  assert.deepEqual(runOnce(root).actions, [], 'после подтверждения — ни разу больше');

  const health = fs.readFileSync(path.join(root, '.harness', 'health.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(health.filter((r) => r.action).length, 3, 'каждое действие записано один раз');
  assert.equal(health.filter((r) => r.applied).length, 3, 'и подтверждено один раз');
});

// Остывает СЕРЕДИНА цепочки — единственный случай, где «маршрут в действии» и реальный
// выбор fleet расходятся. Проверяем ФАКТИЧЕСКИЙ следующий выбор роутера после применения
// решения настоящим fleet.applyWatchdog, а не поле действия: поле можно заполнить чем
// угодно, оно на выбор не влияет.
test('cooldown воркера: следующий выбор делает router.pick по приоритету цепочки', () => {
  const root = fixture();
  const router = require('./fleet/router');
  const { applyWatchdog } = require('./fleet/fleet');
  fs.mkdirSync(path.join(root, '.harness', 'fleet'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'fleet', 'fleet.json'),
    JSON.stringify({ policy: { S: ['agy', 'codex', 'claude'] }, default: ['agy', 'codex', 'claude'] }));
  runlog(root, [
    { tid: 'T001', provider: 'codex', limitHit: true },
    { tid: 'T002', provider: 'codex', limitHit: true },
  ]);
  const [action] = runOnce(root).actions;
  assert.equal(action.action, 'cooldown');
  assert.equal(action.from, 'codex');

  const routerState = router.makeState();
  const policy = router.loadPolicy(root);
  applyWatchdog([action], { cwd: root, routerState, policy, judgeProvider: 'agy', judgeModel: 'x', parked: new Set() });

  const chain = router.chainFor('S', policy);
  assert.deepEqual(chain, ['agy', 'codex', 'claude'], 'цепочка размера слайса, а не default');
  assert.equal(router.pick(chain, routerState), 'agy',
    'остывшая середина уступает ГОЛОВЕ цепочки: agy приоритетнее и здоров — «следующий по цепочке» здесь был бы ложью');
  router.cool(routerState, 'agy', policy.cooldownSec);
  assert.equal(router.pick(chain, routerState), 'claude', 'остыли двое — выбор идёт дальше по приоритету');
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
  const [action] = runOnce(root).actions;
  assert.equal(action.action, 'cooldown');
  assert.equal(action.subject, 'judge');
  assert.equal(action.to, 'claude', 'fallback judge не зависит от legacy verify или worker-цепочки');
  assert.equal(action.toModel, 'sonnet');
});

test('fallback судьи пропускает отсутствующий CLI и не выдумывает маршрут', () => {
  const root = fixture();
  const providers = require('./fleet/providers');
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

// ── T008: проводка. Детекторы без потребителя бесполезны, поэтому оба консьюмера
// проверяются на РЕАЛЬНОМ коде: fleet — своей функцией применения, драйвер — прогоном.

test('fleet уважает все три решения: cooldown, park, judge-fallback', () => {
  const root = fixture();
  const router = require('./fleet/router');
  const { applyWatchdog } = require('./fleet/fleet');
  const routerState = router.makeState();
  const policy = router.loadPolicy(root);
  const parked = new Set();
  const judge = applyWatchdog([
    { action: 'cooldown', subject: 'worker', reason: 'limit-streak', from: 'agy', to: null },
    { action: 'park', subject: 'task', reason: 'red-repeat', from: 'T003', to: 'parked' },
    { action: 'judge-fallback', reason: 'judge-dead-streak', from: 'agy', to: 'codex', toModel: 'gpt-5.6-sol' },
  ], { cwd: root, routerState, policy, judgeProvider: 'agy', judgeModel: 'gemini-3.6-flash-high', parked });

  assert.ok(router.inCooldown(routerState, 'agy'), 'провайдер ушёл в cooldown');
  // Не только флаг состояния: СЛЕДУЮЩИЙ реальный выбор роутера обязан уйти по цепочке.
  assert.notEqual(router.pick(['agy', 'codex', 'claude'], routerState), 'agy');
  assert.ok(parked.has('T003'), 'задача выпала из батчей');
  assert.equal(judge.provider, 'codex', 'судья переключён на остаток прогона');
  assert.equal(judge.model, 'gpt-5.6-sol', 'вместе с моделью — чужая модель у нового провайдера = fatal config');

  const events = fs.readFileSync(path.join(root, '.harness', 'fleet', 'events.jsonl'), 'utf8')
    .trim().split('\n').map(JSON.parse).map((e) => e.event);
  assert.deepEqual(events, ['watchdog-cooldown', 'watchdog-park', 'watchdog-judge-fallback']);
});

// Живой fleet-цикл, а не только helper: все три решения применяются САМИМ циклом между
// батчами. Слайс с двумя красными прогонами не получает третьей попытки (и парковка
// переживает прогон), лимитированный воркер уходит в cooldown, а судья, дважды мёртвый
// В ФОРМАТЕ FLEET-LEDGER, заменяется — и заменённый провайдер виден в следующей записи фазы.
test('fleet между батчами: park + cooldown + judge-fallback применяются живым циклом', { timeout: 120000 }, async () => {
  const fleet = require('./fleet/fleet');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-watch-fleet-'));
  roots.push(root);
  const g = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'tasks.md'),
    '- [ ] **T1** пишет a [P] [files:a*]\n- [ ] **T2** пишет b [P] [files:b*]\n');
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node --version', shell: process.platform === 'win32' ? 'powershell' : 'bash',
    branchPolicy: 'feature', push: false, judge: { enabled: true, model: 'sonnet' },
  }));
  const judgeStub = path.join(root, 'judge-pass.js');
  fs.writeFileSync(judgeStub, "console.log('{\"verdict\":\"pass\",\"reasons\":[\"stub\"]}');");
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']);
  runlog(root, [
    { task: 'T1', result: 'red-stop', oracle: { exit: 1 } },
    { task: 'T1', result: 'red-stop', oracle: { exit: 1 } },
    { tid: 'T0', provider: 'agy', limitHit: true },
    { tid: 'T0', provider: 'agy', limitHit: true },
    // Именно fleet-формат мёртвого судьи — как его пишет logSpawn, а не синтетика драйвера.
    { tid: 'T0', phase: 'judge', provider: 'claude', verdict: 'judge-unavailable' },
    { tid: 'T0', phase: 'judge', provider: 'claude', verdict: 'judge-unavailable' },
  ]);

  const touched = [];
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', judgeStub]);
  process.env.FLEET_BIN_CODEX = JSON.stringify(['node', judgeStub]); // судья после фолбэка
  try {
    await fleet.run({
      cwd: root, tasksPath: path.join(root, 'specs', 'tasks.md'), integration: 'main', workers: 1,
      // 009 T009: стаб отвечает по контракту воркера (заявка о файлах), иначе attest
      // режет его как no-attestation и цикл до watchdog-решений не доходит.
      worker: async (slice, wtPath) => {
        touched.push(slice.id);
        fs.writeFileSync(path.join(wtPath, `${slice.id}.txt`), 'x\n');
        return { ok: true, exit: 0, stdout: JSON.stringify({ filesChanged: [`${slice.id}.txt`], testsAdded: [] }) };
      },
    });
  } finally { delete process.env.FLEET_BIN_CLAUDE; delete process.env.FLEET_BIN_CODEX; }

  assert.ok(!touched.includes('T1'), `T1 не должен получить третью попытку, а получил: ${touched.join(',')}`);
  const events = fs.readFileSync(path.join(root, '.harness', 'fleet', 'events.jsonl'), 'utf8');
  assert.match(events, /"watchdog-park"/);
  assert.match(events, /"watchdog-cooldown"/, 'лимит воркера обязан применяться самим циклом');
  assert.match(events, /"watchdog-judge-fallback"/, 'мёртвый в fleet-формате судья обязан быть заменён циклом');
  const parkedFile = path.join(root, '.harness', 'parked.json');
  assert.ok(fs.existsSync(parkedFile), 'парковка обязана пережить прогон, а не жить в памяти');
  assert.equal(JSON.parse(fs.readFileSync(parkedFile, 'utf8'))[0].tid, 'T1');

  // Фолбэк не просто объявлен: СЛЕДУЮЩИЙ реальный вызов судьи в этом прогоне уходит новому
  // провайдеру — видно в ledger-записи фазы judge, которую пишет сам цикл.
  const ledger = fs.readFileSync(path.join(root, '.git', 'elt', 'run-log.jsonl'), 'utf8')
    .trim().split('\n').map(JSON.parse).filter((e) => e.phase === 'judge' && e.verdict !== 'judge-unavailable');
  assert.ok(ledger.length && ledger.every((e) => e.provider === 'codex'),
    `судья прогона обязан стать фолбэк-провайдером: ${JSON.stringify(ledger)}`);
});

test('драйвер паркует задачу по решению watchdog, не запуская имплементатора', { timeout: 120000 }, () => {
  const root = fixture({ specApproval: false, codegraphGuard: false, judge: { enabled: true, provider: 'agy', model: 'gemini-3.6-flash-high' } });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: root });
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** первая\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'seed'], { cwd: root });
  // Два красных прогона T001 → red-repeat → park; два лимита agy (судья драйвера) →
  // limit-streak → cooldown, который драйвер применяет к СУДЬЕ (цепочки имплементатора у
  // него нет). Оба решения обязаны отработать в одном проходе.
  runlog(root, [
    { task: 'T001', result: 'red-stop', oracle: { exit: 1 } },
    { task: 'T001', result: 'red-stop', oracle: { exit: 1 } },
    { tid: 'T002', provider: 'agy', limitHit: true },
    { tid: 'T003', provider: 'agy', limitHit: true },
  ]);

  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'elt-loop.ps1'), '-Project', root, '-Slices', '1', '-WriterProvider', 'claude'], { encoding: 'utf8', timeout: 110000 });
  const parkedFile = path.join(root, '.harness', 'parked.json');
  assert.ok(fs.existsSync(parkedFile), 'драйвер обязан припарковать задачу по решению watchdog');
  const list = JSON.parse(fs.readFileSync(parkedFile, 'utf8'));
  assert.equal(list[0].tid, 'T001');
  assert.equal(list[0].reason, 'red-repeat');
  assert.ok(!fs.existsSync(path.join(root, '.harness', 'loop-logs')) ||
    !fs.readdirSync(path.join(root, '.harness', 'loop-logs')).some((f) => f.endsWith('-impl.log')),
    `имплементатор не должен запускаться на припаркованной задаче; вывод: ${r.stdout}`);

  // Ассерт по run-log, не по stdout: PowerShell отдаёт консоль в OEM-кодировке.
  const log = fs.readFileSync(path.join(root, '.git', 'elt', 'run-log.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  const cooled = log.find((e) => e.result === 'watchdog-judge-cooldown');
  assert.ok(cooled, `драйвер обязан увести судью с лимитированного провайдера; вывод: ${r.stdout}`);
  assert.equal(cooled.from, 'agy');
  assert.ok(cooled.to && cooled.to !== 'agy' && cooled.model, 'новый судья приходит парой provider+model');
});

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
  const byStatic = Object.fromEntries(runOnce(root).actions.map((a) => [a.action, a]));
  assert.equal(byStatic.cooldown.subject, 'worker', 'claude не судья этого прогона');
  assert.equal(byStatic['judge-fallback'].from, 'agy');

  // Тот же run-log, но прогон запущен с `-JudgeProvider claude`: теперь лимит claude —
  // это лимит СУДЬИ, и уводить надо его.
  const byRuntime = Object.fromEntries(runOnce(root, { judgeProvider: 'claude' }).actions.map((a) => [a.action, a]));
  assert.equal(byRuntime.cooldown.from, 'claude');
  assert.equal(byRuntime.cooldown.subject, 'judge');
  assert.ok(byRuntime.cooldown.to && byRuntime.cooldown.to !== 'claude',
    'лимит фактического судьи обязан дать маршрут, а не молчаливый noop');
  assert.equal(byRuntime['judge-fallback'].from, 'claude', 'откат заявляется от того, кто судит сейчас');

  // И после первого фолбэка (судья уже codex в памяти прогона) — от codex, не от agy.
  const after = runOnce(root, { judgeProvider: 'codex' }).actions.find((a) => a.action === 'judge-fallback');
  assert.equal(after.from, 'codex');
  assert.ok(after.to !== 'codex' && after.toModel, 'новый судья приходит парой provider+model');
});

// Обратная ветка драйвера: cooldown относится к ИМПЛЕМЕНТАТОРУ, у которого цепочки нет.
// Решение неприменимо — драйвер обязан сказать это вслух и НЕ подтверждать его, иначе
// ack молча похоронит инцидент, который никто не лечил.
test('драйвер: cooldown не своего судьи — явный noop без ack', { timeout: 120000 }, () => {
  const root = fixture({ specApproval: false, codegraphGuard: false, oracle: 'node -e "0"',
    judge: { enabled: true, provider: 'agy', model: 'gemini-3.6-flash-high' } });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: root });
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  // Две задачи: второму прогону (с runtime-override ниже) нужна своя открытая.
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** первая\n- [ ] **T002** вторая\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'seed'], { cwd: root });
  // Лимит у claude — это имплементатор драйвера, а не его судья (судья фикстуры — agy).
  runlog(root, [
    { tid: 'T002', provider: 'claude', limitHit: true },
    { tid: 'T003', provider: 'claude', limitHit: true },
  ]);

  const stub = path.join(root, 'impl-stub.js');
  fs.writeFileSync(stub, "console.log('stub worker');");
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'elt-loop.ps1'), '-Project', root, '-Slices', '1', '-WriterProvider', 'claude'],
    { encoding: 'utf8', timeout: 110000, env: { ...process.env, FLEET_BIN_CLAUDE: JSON.stringify(['node', stub]) } });

  const log = fs.readFileSync(path.join(root, '.git', 'elt', 'run-log.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  const noop = log.find((e) => e.result === 'watchdog-cooldown-noop');
  assert.ok(noop, `неприменимое решение обязано быть записано, а не проглочено; вывод: ${r.stdout}`);
  assert.equal(noop.provider, 'claude');
  assert.ok(!log.some((e) => e.result === 'watchdog-judge-cooldown'), 'судью этот cooldown не касается');
  // Не подтверждено → watchdog выдаёт решение снова: инцидент не «вылечен» записью.
  assert.ok(runOnce(root).actions.some((a) => a.action === 'cooldown' && a.from === 'claude'),
    'неприменённое решение не должно быть подтверждено ack');

  // Тот же run-log, но прогон запущен с `-JudgeProvider claude`: тот же лимит теперь
  // относится к судье прогона, и драйвер обязан увести его, а не повторить noop.
  const r2 = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'elt-loop.ps1'), '-Project', root, '-Slices', '1', '-WriterProvider', 'agy', '-JudgeProvider', 'claude'],
    { encoding: 'utf8', timeout: 110000, env: { ...process.env, FLEET_BIN_AGY: JSON.stringify(['node', stub]), FLEET_BIN_CLAUDE: JSON.stringify(['node', stub]) } });
  const log2 = fs.readFileSync(path.join(root, '.git', 'elt', 'run-log.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  const cooled = log2.find((e) => e.result === 'watchdog-judge-cooldown');
  assert.ok(cooled, `с runtime-override судья обязан уехать по цепочке судей; вывод: ${r2.stdout}`);
  assert.equal(cooled.from, 'claude');
  assert.ok(cooled.to && cooled.to !== 'claude' && cooled.model);
});

// Парковка ОДНОЙ задачи батча не должна выбрасывать остальные: они ни в чём не виноваты,
// а пропуск тихо съедал бы план (Batch=1 этот отказ не ловит).
test('батч сужается на припаркованную задачу, остальные исполняются', { timeout: 180000 }, () => {
  const root = fixture({ specApproval: false, codegraphGuard: false, batch: 2, oracle: 'node -e "0"', judge: { enabled: true, provider: 'claude', model: 'sonnet' } });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: root });
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** первая\n- [ ] **T002** вторая\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'seed'], { cwd: root });
  runlog(root, [
    { task: 'T001', result: 'red-stop', oracle: { exit: 1 } },
    { task: 'T001', result: 'red-stop', oracle: { exit: 1 } },
  ]);

  const stub = path.join(root, 'impl-stub.js');
  fs.writeFileSync(stub, "console.log('stub worker');");
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'elt-loop.ps1'), '-Project', root, '-Slices', '2', '-Batch', '2'],
    { encoding: 'utf8', timeout: 170000, env: { ...process.env, FLEET_BIN_AGY: JSON.stringify(['node', stub]), FLEET_BIN_CLAUDE: JSON.stringify(['node', stub]) } });

  // Ассерт по run-log, а не по loop-logs: последующая парковка делает `git stash -u`,
  // который уносит untracked-логи прогона. Записи run-log лежат в .git и переживают его.
  const parked = JSON.parse(fs.readFileSync(path.join(root, '.harness', 'parked.json'), 'utf8'));
  assert.equal(parked.find((p) => p.tid === 'T001').reason, 'red-repeat');
  const log = fs.readFileSync(path.join(root, '.git', 'elt', 'run-log.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(log.some((e) => e.task === 'T002' && (e.status || e.result)),
    `T002 обязана исполниться после сужения батча, а не выпасть вместе с T001; вывод: ${r.stdout}`);
  assert.ok(!log.some((e) => e.task === 'T001' && ['judge-block', 'judge-dead', 'judge-pass'].includes(e.status || e.result)),
    'припаркованная задача до гейта не доходит');
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
