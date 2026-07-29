'use strict';
// 008 T002: двойной судья (verify-on-pass). `pass` первичного судьи — заявка, не вердикт:
// её подтверждает второй судья из `harness.json.judge.verify`. block любого = итоговый block;
// block первичного второго НЕ зовёт (цена платится только на pass); второй судья мёртв
// (runOk=false) → итог runOk:false — тот же judge-dead/парковка путь, что и у мёртвого
// первичного (T021 downstream уже умеет его парковать без изменений).
// 009 T010: «мёртвый» теперь значит «мёртв И заменить некем» — verify перевыдаётся следующему
// доступному CLI. Поэтому стабить надо ВСЕ три CLI: незастабленный провайдер считается живым
// (providers.available видит его в PATH) и тест спавнил бы реальный codex.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gate = require('./fleet/gate');

const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-verify-'));
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
const stub = (name, body) => { const p = path.join(REPO, name); fs.writeFileSync(p, body); return p; };
const judgeStub = (verdict) => `console.log(JSON.stringify({verdict:${JSON.stringify(verdict)},reasons:['стаб-${verdict}']}));`;

function writeHarness(verify) {
  const cfg = { kind: 'code', oracle: 'node --version', shell: process.platform === 'win32' ? 'powershell' : 'bash', branchPolicy: 'feature', push: false, judge: { enabled: true, model: 'sonnet' } };
  if (verify) cfg.judge.verify = verify;
  fs.writeFileSync(path.join(REPO, '.harness', 'harness.json'), JSON.stringify(cfg));
}

before(() => {
  git(['init', '-q']); git(['config', 'user.email', 't@t']); git(['config', 'user.name', 't']);
  fs.mkdirSync(path.join(REPO, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(REPO, 'specs', 'tasks.md'), '- [ ] **T1** демо-слайс\n');
  fs.writeFileSync(path.join(REPO, 'seed.txt'), 'seed\n');
  git(['add', '-A']); git(['commit', '-q', '-m', 'seed']);
  fs.mkdirSync(path.join(REPO, '.harness'), { recursive: true });
});
after(() => { try { fs.rmSync(REPO, { recursive: true, force: true }); } catch { /* noop */ } });
beforeEach(() => { fs.writeFileSync(path.join(REPO, 'slice.txt'), 'work-' + Date.now() + '\n'); }); // непустой дифф на каждый тест

function setBins({ claude, agy, codex }) {
  if (claude) process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', claude]);
  if (agy) process.env.FLEET_BIN_AGY = JSON.stringify(['node', agy]);
  if (codex) process.env.FLEET_BIN_CODEX = JSON.stringify(['node', codex]);
}
function clearBins() { delete process.env.FLEET_BIN_CLAUDE; delete process.env.FLEET_BIN_AGY; delete process.env.FLEET_BIN_CODEX; }

test('pass+pass → итоговый pass, judges[] несёт оба вердикта/модели', async () => {
  writeHarness({ provider: 'agy', model: 'agy-model' });
  setBins({ claude: stub('p1.js', judgeStub('pass')), agy: stub('s1.js', judgeStub('pass')) });
  const r = await gate.runJudge({ cwd: REPO, tid: 'T1', taskText: 'демо', model: 'sonnet' });
  clearBins();
  assert.equal(r.runOk, true);
  assert.equal(r.verdict, 'pass');
  assert.equal(r.judges.length, 2);
  assert.deepEqual(r.judges.map((j) => [j.provider, j.model, j.verdict]), [['claude', 'sonnet', 'pass'], ['agy', 'agy-model', 'pass']]);
});

test('pass+block → итоговый block (второй судья ловит то, что пропустил первый)', async () => {
  writeHarness({ provider: 'agy', model: 'agy-model' });
  setBins({ claude: stub('p2.js', judgeStub('pass')), agy: stub('s2.js', judgeStub('block')) });
  const r = await gate.runJudge({ cwd: REPO, tid: 'T1', taskText: 'демо', model: 'sonnet' });
  clearBins();
  assert.equal(r.runOk, true);
  assert.equal(r.verdict, 'block');
  assert.ok(r.reasons.includes('стаб-block'), 'причина второго судьи обязана попасть в итоговые reasons');
});

test('block первичного — второй судья НЕ зовётся (короткое замыкание, нет лишней траты)', async () => {
  writeHarness({ provider: 'agy', model: 'agy-model' });
  const marker = path.join(REPO, 'secondary-called.marker');
  try { fs.rmSync(marker); } catch { /* нет от прошлого прогона */ }
  setBins({
    claude: stub('p3.js', judgeStub('block')),
    agy: stub('s3.js', `require('fs').writeFileSync(${JSON.stringify(marker)}, '1');\n${judgeStub('pass')}`),
  });
  const r = await gate.runJudge({ cwd: REPO, tid: 'T1', taskText: 'демо', model: 'sonnet' });
  clearBins();
  assert.equal(r.verdict, 'block');
  assert.equal(fs.existsSync(marker), false, 'второй судья не должен был запуститься на block первичного');
});

test('второй судья мёртв и заменить некем → runOk:false, НЕ молчаливый pass', async () => {
  writeHarness({ provider: 'agy', model: 'agy-model' });
  // Оба возможных verify-CLI мертвы (пустой stdout → providers ok:false): перевыдавать некому,
  // значит второй слой честно не отработал — это judge-dead, а не тихий pass одного судьи.
  const dead = stub('s4.js', 'process.exit(0);');
  setBins({ claude: stub('p4.js', judgeStub('pass')), agy: dead, codex: dead });
  const r = await gate.runJudge({ cwd: REPO, tid: 'T1', taskText: 'демо', model: 'sonnet' });
  clearBins();
  assert.equal(r.runOk, false, 'мёртвый второй судья не должен маскироваться под pass');
});

test('judge.verify не задан → старое однопроходное поведение (обратная совместимость)', async () => {
  writeHarness(null);
  setBins({ claude: stub('p5.js', judgeStub('pass')) });
  const r = await gate.runJudge({ cwd: REPO, tid: 'T1', taskText: 'демо', model: 'sonnet' });
  clearBins();
  assert.equal(r.verdict, 'pass');
  assert.equal(r.judges, undefined, 'без verify — контур ведёт себя как раньше, без второго вердикта');
});
