'use strict';
// 011 T004 (AC4) — третий исход судьи.
//
// Зачем он есть: до 011 судья, не нашедший нарушения но и не готовый ручаться, был обязан
// выбрать между `block` (имплементатор переделывает то, что не сломано — осцилляция, из-за
// которой block-rate был 77%) и `pass` (сомнение исчезает бесследно). `inconclusive` — это
// «слайс идёт дальше, но сомнение записано человеку», и второго раунда судейства НЕТ.
//
// Проверяется проводка через РЕАЛЬНЫЙ `elt judge run` + `elt commit` со стаб-мостом: цена
// ошибки здесь — коммит, которого не должно было быть, а его юнит-тестом парсера не поймать.
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
// Стаб моста живёт ВНЕ репо-фикстуры: файл в дереве сдвинул бы treeHash и сделал оракул-пруф
// stale ровно в тот момент, когда на него ссылается judge proof.
function stubInvoke(out) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-inconc-stub-'));
  roots.push(dir);
  const p = path.join(dir, 'stub-invoke.js');
  fs.writeFileSync(p, `process.stdout.write(${JSON.stringify(JSON.stringify(out))});\n`);
  return p;
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-inconc-'));
  roots.push(root);
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL, branchPolicy: 'none',
    judge: { enabled: true, provider: 'agy', model: 'gemini', attest: true },
  }));
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** первый слайс\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git('add', '-A'); git('commit', '-qm', 'seed');
  fs.writeFileSync(path.join(root, 'slice.txt'), 'работа слайса\n');
  assert.equal(run(root, ['oracle']).status, 0, 'оракул-пруф нужен для записи judge proof');
  return root;
}
const judgeOut = (verdict, reasons) => ({
  runOk: true, verdict, reasons, judgeLog: 'log.txt',
  judges: [{ provider: 'agy', model: 'gemini', verdict, reasons, runOk: true }],
  grounding: { filesReviewed: ['slice.txt'] }, redProof: null,
  l0: { triggers: [{ name: 'hot-path', files: ['slice.txt'], reason: 'горячий путь' }], judgeNeeded: true },
});
const queueRows = (root) => {
  const f = path.join(root, '.harness', 'review-queue.jsonl');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const lastCommitMsg = (root) => execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: root, encoding: 'utf8' }).trim();
after(() => { for (const r of roots) try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* windows lock */ } });

test('pass: коммит без метки и без строки в очереди', () => {
  const root = fixture();
  assert.equal(run(root, ['judge', 'run', '--task', 'T001', '--invoke', stubInvoke(judgeOut('pass', ['в границах']))]).status, 0);
  assert.equal(run(root, ['commit', '--task', 'T001', '--skip-oracle']).status, 0);
  assert.doesNotMatch(lastCommitMsg(root), /inconclusive/);
  assert.deepEqual(queueRows(root), [], 'очередь не засоряется чистыми слайсами');
});

test('block: exit 4, коммит не проходит, очередь пуста', () => {
  const root = fixture();
  assert.equal(run(root, ['judge', 'run', '--task', 'T001', '--invoke', stubInvoke(judgeOut('block', ['scope creep']))]).status, 4,
    'block по-прежнему останавливает слайс — третий исход не размывает REJECT-default');
  const c = run(root, ['commit', '--task', 'T001', '--skip-oracle']);
  assert.equal(c.status, 4);
  assert.match(c.stderr, /judge-block/);
  assert.deepEqual(queueRows(root), [], 'block — это не «на ревью», это отказ');
});

test('inconclusive: коммит проходит с меткой + строка в очереди (task/commit/reason/ts)', () => {
  const root = fixture();
  const reason = 'внешний сервис недоступен — поведение не проверить';
  assert.equal(run(root, ['judge', 'run', '--task', 'T001', '--invoke', stubInvoke(judgeOut('inconclusive', [reason]))]).status, 0,
    'exit 0: слайс идёт дальше, а не встаёт');
  const c = run(root, ['commit', '--task', 'T001', '--skip-oracle']);
  assert.equal(c.status, 0, c.stderr);
  assert.match(lastCommitMsg(root), /\[inconclusive\]$/, 'метка в сообщении коммита — видно в git log без чтения журналов');

  const rows = queueRows(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].task, 'T001');
  assert.match(rows[0].commit, /^[0-9a-f]{7,}$/, 'sha реального коммита, а не заглушка');
  assert.equal(rows[0].commit, execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim());
  assert.match(rows[0].reason, /внешний сервис/, 'причина судьи доезжает, а не теряется');
  assert.ok(!Number.isNaN(Date.parse(rows[0].ts)));
});

test('inconclusive: второго раунда судейства НЕТ — мост вызывается ровно один раз', () => {
  const root = fixture();
  // Стаб считает собственные запуски: «не запускается повторно» проверяется счётчиком, а не
  // отсутствием видимых последствий.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-inconc-count-'));
  roots.push(dir);
  const counter = path.join(dir, 'calls.txt');
  const invoke = path.join(dir, 'counting-invoke.js');
  fs.writeFileSync(invoke,
    `require('fs').appendFileSync(${JSON.stringify(counter)}, 'x');\n` +
    `process.stdout.write(${JSON.stringify(JSON.stringify(judgeOut('inconclusive', ['не могу ручаться'])))});\n`);

  assert.equal(run(root, ['judge', 'run', '--task', 'T001', '--invoke', invoke]).status, 0);
  assert.equal(run(root, ['commit', '--task', 'T001', '--skip-oracle']).status, 0);
  assert.equal(fs.readFileSync(counter, 'utf8').length, 1, 'ровно один прогон судьи на слайс');
  assert.match(execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: root, encoding: 'utf8' }), /\[inconclusive\]/);
});

test('очередь не в дереве: строка не двигает treeHash и не попадает в дифф следующего слайса', () => {
  const root = fixture();
  // .gitignore фикстуры повторяет репо-политику: без него строка очереди пришла бы в дифф
  // следующего слайса и «сломала» бы оракул-пруф на ровном месте.
  fs.writeFileSync(path.join(root, '.gitignore'), '.harness/review-queue.jsonl\n');
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['commit', '-qm', 'ignore queue'], { cwd: root, stdio: 'pipe' });
  fs.writeFileSync(path.join(root, 'slice.txt'), 'работа слайса, вторая правка\n'); // предыдущая уже в HEAD
  assert.equal(run(root, ['oracle']).status, 0);
  assert.equal(run(root, ['judge', 'run', '--task', 'T001', '--invoke', stubInvoke(judgeOut('inconclusive', ['сомнение']))]).status, 0);
  assert.equal(run(root, ['commit', '--task', 'T001', '--skip-oracle']).status, 0);
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  assert.doesNotMatch(status, /review-queue/, 'очередь невидима для git — дерево после коммита чистое');
});
