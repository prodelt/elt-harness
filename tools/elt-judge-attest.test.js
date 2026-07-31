'use strict';
// 009 T002: вердикт судьи — шаг КОДА, не проза. `elt judge run` спавнит судью-мост
// (judge-invoke.js) и сам пишет proof с attested:true; при harness.json judge.attest=true
// ручной `judge-proof write --verdict pass` (самозаверение агента, писавшего код) отвергается.
// Мост подменяется стабом через --invoke: тест проверяет проводку elt.js, а не живого судью.
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const ELT = path.join(__dirname, 'elt.js');
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
const roots = [];

function run(root, args) {
  return spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8' });
}
// Стаб судьи-моста: печатает JUDGE_OUT как judge-invoke.js (один JSON в stdout).
// Живёт ВНЕ репо-фикстуры: файл в рабочем дереве изменил бы treeHash и сделал оракул-пруф
// stale — тот же капкан, из-за которого дескриптор судьи пишется в .git/elt/.
function stubInvoke(root, out) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-attest-stub-'));
  roots.push(dir);
  const p = path.join(dir, 'stub-invoke.js');
  fs.writeFileSync(p, `process.stdout.write(process.env.JUDGE_OUT || '${JSON.stringify(out)}');\n`);
  return p;
}
function fixture({ attest = true, circuit = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-attest-'));
  roots.push(root);
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL,
    judge: { enabled: true, provider: 'agy', model: 'gemini', ...(attest ? { attest: true } : {}) },
    ...(circuit ? { redProof: 'on' } : {}),
  }));
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** первый слайс\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git('add', '-A'); git('commit', '-qm', 'seed');
  fs.writeFileSync(path.join(root, 'slice.txt'), 'работа слайса\n');
  assert.equal(run(root, ['oracle']).status, 0, 'оракул-пруф нужен для записи judge proof');
  return root;
}
function proof(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.git', 'elt', 'judge-proof.json'), 'utf8'));
}
function runLogTail(root) {
  const raw = fs.readFileSync(path.join(root, '.git', 'elt', 'run-log.jsonl'), 'utf8').trim().split('\n');
  return JSON.parse(raw[raw.length - 1]);
}
after(() => { for (const r of roots) try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* windows lock */ } });

test('judge run: happy path — proof пишется кодом, с judges/grounding, validate ok', () => {
  const root = fixture();
  const invoke = stubInvoke(root, {
    runOk: true, verdict: 'pass', reasons: ['в границах задачи'], judgeLog: 'log.txt',
    judges: [{ provider: 'agy', model: 'gemini', verdict: 'pass', runOk: true }],
    grounding: { filesReviewed: ['slice.txt'] }, redProof: null,
  });
  const r = run(root, ['judge', 'run', '--task', 'T001', '--invoke', invoke]);
  assert.equal(r.status, 0, r.stderr);
  const p = proof(root);
  assert.equal(p.verdict, 'pass');
  assert.deepEqual(p.reasons, ['в границах задачи'], 'обоснования судьи доезжают, а не теряются');
  assert.deepEqual(p.grounding.filesReviewed, ['slice.txt']);
  assert.equal(p.judges.length, 1);
  assert.equal(run(root, ['judge-proof', 'validate', '--task', 'T001']).status, 0, 'гейт проводит машинный proof');
});

test('judge run: block судьи — exit 4, proof block, гейт не проводит', () => {
  const root = fixture();
  const invoke = stubInvoke(root, { runOk: true, verdict: 'block', reasons: ['scope creep'], judges: [{ provider: 'agy', model: 'gemini', verdict: 'block', runOk: true }], grounding: { filesReviewed: ['slice.txt'] } });
  assert.equal(run(root, ['judge', 'run', '--task', 'T001', '--invoke', invoke]).status, 4);
  assert.equal(proof(root).verdict, 'block');
  assert.equal(run(root, ['judge-proof', 'validate', '--task', 'T001']).status, 4);
});

test('judge run: судья не отработал (runOk:false) — это dead, а не block по умолчанию', () => {
  const root = fixture();
  const invoke = stubInvoke(root, { runOk: false, verdict: null, reasons: [], judges: [{ provider: 'agy', model: 'gemini', verdict: 'block', runOk: false }] });
  assert.equal(run(root, ['judge', 'run', '--task', 'T001', '--invoke', invoke]).status, 4);
  assert.equal(proof(root).verdict, 'dead', 'инфраструктурный сбой отличим от вердикта');
  assert.equal(JSON.parse(run(root, ['judge-proof', 'validate', '--task', 'T001']).stdout).reason, 'judge-dead');
});

test('attest:true — ручной judge-proof write отвергается exit 4 (самозаверение закрыто)', () => {
  const root = fixture();
  const r = run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'я-сам']);
  assert.equal(r.status, 4, r.stdout);
  assert.match(r.stderr, /judge run/, 'ошибка указывает на правильный путь');
  assert.ok(!fs.existsSync(path.join(root, '.git', 'elt', 'judge-proof.json')), 'proof не написан');
});

// 011 T003 (AC3): чистый слайс закрывается БЕЗ судьи, и в run-log это отдельный статус со
// списком триггеров. Стаб-мост отдаёт ровно то, что отдаёт настоящий judge-invoke.js при
// l0-clean; проверяется проводка elt.js — что решение механики доезжает до журнала, а не
// теряется и не выглядит в нём как обычный judge-pass.
test('judge run: l0-clean → в run-log отдельный статус и пустой список триггеров', () => {
  const root = fixture();
  const invoke = stubInvoke(root, {
    runOk: true, verdict: 'pass', reasons: ['l0-clean: риск-триггеров нет, судья не звался'], judgeLog: null,
    judges: [{ provider: 'l0', model: 'triggers', verdict: 'pass', runOk: true }],
    grounding: { filesReviewed: [] }, redProof: null,
    l0: { triggers: [], judgeNeeded: false },
  });
  assert.equal(run(root, ['judge', 'run', '--task', 'T001', '--invoke', invoke]).status, 0);
  const tail = runLogTail(root);
  assert.equal(tail.status, 'l0-clean', 'не judge-pass: судья не звался, и журнал обязан это различать');
  assert.deepEqual(tail.l0, { triggers: [], judgeNeeded: false }, 'пустой список — пруф «проверено и чисто»');
  assert.equal(proof(root).verdict, 'pass', 'слайс при этом реально закрывается');
});

test('judge run: сработали триггеры → статус прежний judge-pass, но триггеры в журнале', () => {
  const root = fixture();
  const invoke = stubInvoke(root, {
    runOk: true, verdict: 'pass', reasons: ['в границах'], judgeLog: 'log.txt',
    judges: [{ provider: 'agy', model: 'gemini', verdict: 'pass', runOk: true }],
    grounding: { filesReviewed: ['slice.txt'] }, redProof: null,
    l0: { triggers: [{ name: 'hot-path', files: ['tools/fleet/gate.js'], reason: 'тронут горячий путь' }], judgeNeeded: true },
  });
  assert.equal(run(root, ['judge', 'run', '--task', 'T001', '--invoke', invoke]).status, 0);
  const tail = runLogTail(root);
  assert.equal(tail.status, 'judge-pass', 'путь к судье не изменился');
  assert.deepEqual(tail.l0.triggers.map((t) => t.name), ['hot-path'], 'видно, ЧЕМ судья был разбужен');
});

// 011 T011 (AC11) — люк самозаверения удалён ЦЕЛИКОМ. Были два флага: `--skip-attest`
// («аварийно») и `--attested-by fleet-gate` («машинный источник»). Оба сводились к строке,
// которую агент с доступом к шеллу набирает сам — то есть к праву заверить собственный код
// своей же подписью. Тесты ниже фиксируют, что СТАРЫЕ ВЫЗОВЫ больше не проводят вердикт.
test('--skip-attest больше не проводит вердикт: отказ и НИКАКОГО proof', () => {
  const root = fixture();
  const r = run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'ручной', '--skip-attest']);
  assert.equal(r.status, 4, 'флаг не распознан — это обычная ручная запись при attest:true');
  assert.match(r.stderr, /elt judge run/, 'отказ показывает единственный законный путь');
  assert.ok(!fs.existsSync(path.join(root, '.git', 'elt', 'judge-proof.json')), 'proof не написан вовсе');
  assert.equal(run(root, ['judge-proof', 'validate', '--task', 'T001']).status, 4, 'проводить нечего');
});

test('--attested-by fleet-gate больше не проводит вердикт: тот же отказ', () => {
  const root = fixture();
  const r = run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'gemini', '--attested-by', 'fleet-gate']);
  assert.equal(r.status, 4);
  assert.ok(!fs.existsSync(path.join(root, '.git', 'elt', 'judge-proof.json')));
});

test('в run-log не остаётся веток люка (attest-skipped / attested-by-*)', () => {
  const root = fixture();
  run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'x', '--skip-attest']);
  run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'x', '--attested-by', 'fleet-gate']);
  const log = fs.readFileSync(path.join(root, '.git', 'elt', 'run-log.jsonl'), 'utf8');
  assert.doesNotMatch(log, /attest-skipped|attested-by-/, 'статусов люка больше не существует');
});

test('proof, написанный `judge run`, проводится БЕЗ поля-пометки происхождения', () => {
  const root = fixture();
  const invoke = stubInvoke(root, {
    runOk: true, verdict: 'pass', reasons: ['в границах'],
    judges: [{ provider: 'agy', model: 'gemini', verdict: 'pass', runOk: true }],
    grounding: { filesReviewed: ['slice.txt'] }, redProof: null,
  });
  assert.equal(run(root, ['judge', 'run', '--task', 'T001', '--invoke', invoke]).status, 0);
  const p = proof(root);
  assert.equal(p.attested, undefined, 'пометка не нужна: иначе proof при attest:true не написать');
  assert.equal(p.attestSkipped, undefined);
  assert.equal(run(root, ['judge-proof', 'validate', '--task', 'T001']).status, 0, 'и он проводит слайс');
});

test('--attested-by с чужим значением не открывает обход attest:true', () => {
  const root = fixture();
  const r = run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'я-сам', '--attested-by', 'я-код-писал']);
  assert.equal(r.status, 4, r.stdout);
  assert.ok(!fs.existsSync(path.join(root, '.git', 'elt', 'judge-proof.json')), 'proof не написан');
});

test('attest:false — старое поведение: ручной write проходит (обратная совместимость)', () => {
  const root = fixture({ attest: false });
  const r = run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'codex']);
  assert.equal(r.status, 0, r.stderr);
  const p = proof(root);
  assert.equal(p.attested, undefined, 'поля-пометки больше не существует ни в одной ветке');
  assert.equal(p.attestSkipped, undefined);
  assert.equal(run(root, ['judge-proof', 'validate', '--task', 'T001']).status, 0);
});

test('judge run: мост не найден — явный отказ, а не тихий пропуск судьи', () => {
  const root = fixture();
  const r = run(root, ['judge', 'run', '--task', 'T001', '--invoke', path.join(root, 'нет-такого.js')]);
  assert.equal(r.status, 4);
  assert.match(r.stderr, /судья-мост/);
});

test('009 T010: мёртвая попытка в judges[] проводится (след перевыдачи), из одних смертей — нет', () => {
  const root = fixture({ circuit: true });
  // Ровно то, что пишет gate.runJudge после перевыдачи: первичный ответил, verify завис
  // (verdict:null, runOk:false), замена ответила. Валидатор обязан спрашивать вердикт с
  // ОТВЕТИВШИХ — иначе гейт с failover не может закоммититься вовсе.
  const withDead = stubInvoke(root, {
    runOk: true, verdict: 'pass', reasons: ['в границах задачи'],
    judges: [
      { provider: 'claude', model: 'sonnet', verdict: 'pass', runOk: true },
      { provider: 'codex', model: 'gpt-5.6-sol', verdict: null, reasons: [], runOk: false },
      { provider: 'agy', model: 'gemini', verdict: 'pass', runOk: true },
    ],
    grounding: { filesReviewed: ['slice.txt'] }, redProof: { status: 'red', reason: 'fails-on-base' },
  });
  assert.equal(run(root, ['judge', 'run', '--task', 'T001', '--invoke', withDead]).status, 0);
  assert.equal(run(root, ['judge-proof', 'validate', '--task', 'T001']).status, 0, 'след перевыдачи не должен рубить гейт');
  assert.equal(proof(root).judges.length, 3, 'мёртвая попытка остаётся в proof, а не вычищается');

  // А proof, где НИКТО не ответил, обязан быть отвергнут: иначе одни смерти проехали бы как pass.
  const allDead = stubInvoke(root, {
    runOk: true, verdict: 'pass', reasons: ['якобы pass'],
    judges: [{ provider: 'codex', model: 'gpt-5.6-sol', verdict: null, runOk: false }],
    grounding: { filesReviewed: ['slice.txt'] }, redProof: { status: 'red', reason: 'fails-on-base' },
  });
  assert.equal(run(root, ['judge', 'run', '--task', 'T001', '--invoke', allDead]).status, 0);
  const v = run(root, ['judge-proof', 'validate', '--task', 'T001']);
  assert.equal(v.status, 4, 'proof из одних мёртвых судей не проводится');
  assert.equal(JSON.parse(v.stdout).reason, 'missing-judges');
});
