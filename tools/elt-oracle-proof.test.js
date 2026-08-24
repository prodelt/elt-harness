'use strict';
// F-P1-2: --skip-oracle trust-hole. Драйвер утверждал «оракул был зелёным», elt commit
// верил на слово. Теперь commit сверяет хеш дерева на момент оракула с текущим —
// совпал → доверяем (реальный оракул не гонится ещё раз); не совпал/нет пруфа → гоним реально.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ELT = path.join(__dirname, 'elt.js');
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';

const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-proof-repo-'));
const COUNTER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-proof-counter-'));
const COUNTER = path.join(COUNTER_DIR, 'counter.txt');

const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
const eltRun = (args) => spawnSync('node', [ELT, ...args], { cwd: REPO, encoding: 'utf8' });
function counterValue() { try { return Number(fs.readFileSync(COUNTER, 'utf8')); } catch { return 0; } }
function writeProof(taskId) {
  const proof = eltRun(['judge-proof', 'write', '--task', taskId, '--verdict', 'pass', '--model', 'test']);
  assert.equal(proof.status, 0, proof.stderr.toString());
}
function commitCount() { return Number(git(['rev-list', '--count', 'HEAD'])); }

before(() => {
  git(['init', '-q']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  // "оракул", который на каждый реальный прогон тикает внешний (вне репо) счётчик —
  // так видно, был ли он реально вызван, независимо от состояния дерева.
  fs.writeFileSync(path.join(REPO, 'oracle-check.js'),
    "const fs=require('fs');const p=process.argv[2];let c=0;" +
    "try{c=Number(fs.readFileSync(p,'utf8'))||0}catch(e){}" +
    "fs.writeFileSync(p,String(c+1));process.exit(0);\n");
  fs.mkdirSync(path.join(REPO, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(REPO, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code',
    oracle: `node oracle-check.js ${COUNTER}`,
    shell: SHELL,
    branchPolicy: 'feature',
    push: false,
    judge: { enabled: true, model: 'sonnet' },
  }));
  fs.mkdirSync(path.join(REPO, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(REPO, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** first\n- [ ] **T002** second\n- [ ] **T003** third\n');
  fs.writeFileSync(path.join(REPO, 'seed.txt'), 'seed\n');
  git(['add', '-A']); git(['commit', '-q', '-m', 'seed']);
  git(['checkout', '-q', '-b', 'work']); // не main — авто-ветка elt.js не срабатывает, проще ассерты
});
after(() => {
  try { fs.rmSync(REPO, { recursive: true, force: true }); } catch { /* noop */ }
  try { fs.rmSync(COUNTER_DIR, { recursive: true, force: true }); } catch { /* noop */ }
});

test('skip-oracle: дерево не менялось с зелёного оракула → пруф доверен, реальный оракул НЕ перезапускается', () => {
  fs.writeFileSync(path.join(REPO, 'a.txt'), 'v1\n');
  const before1 = counterValue();
  assert.equal(eltRun(['oracle']).status, 0);
  const afterOracle = counterValue();
  assert.equal(afterOracle, before1 + 1, 'оракул реально прогнан один раз');

  writeProof('T001');
  const r = eltRun(['commit', '--task', 'T001', '--skip-oracle', '-m', 'test commit A']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(counterValue(), afterOracle, 'commit --skip-oracle НЕ перезапустил оракул — пруф был валиден');
});

test('skip-oracle: дерево изменилось ПОСЛЕ зелёного оракула → пруф не доверен, оракул реально перезапускается', () => {
  fs.writeFileSync(path.join(REPO, 'b.txt'), 'v1\n');
  assert.equal(eltRun(['oracle']).status, 0);
  const afterOracle = counterValue();

  writeProof('T002');
  fs.writeFileSync(path.join(REPO, 'b.txt'), 'v2 — правка ПОСЛЕ зелёного оракула\n'); // сама дыра

  const beforeCommit = commitCount();
  const r = eltRun(['commit', '--task', 'T002', '--skip-oracle', '-m', 'test commit B']);
  assert.notEqual(r.status, 0, r.stderr);
  assert.equal(counterValue(), afterOracle + 1, 'хеш разошёлся → elt commit не поверил флагу, прогнал оракул реально');
  assert.equal(commitCount(), beforeCommit, 'rerun oracle cannot make a stale judge proof commit');
});

// ── 020 T009: treeHash не имеет права молчать ────────────────────────────────────────────
// Дефолтный maxBuffer у spawnSync — 1 МиБ, и при переполнении процесс УБИВАЕТСЯ: status=null,
// stdout ОБРЕЗАН. До T009 `git()` этого не замечал, и `treeHash` считал хеш от обрезанного
// диффа: два разных дерева давали один хеш, то есть `--skip-oracle` мог провести коммит по
// пруфу от ЧУЖОГО состояния. Ниже — прямая проверка на диффе заведомо больше 1 МиБ.
test('T009: дифф >1 МиБ не ломает treeHash — разные деревья дают РАЗНЫЕ хеши', () => {
  const big = path.join(REPO, 'big.txt');
  fs.writeFileSync(big, 'a'.repeat(3 * 1024 * 1024) + '\n');
  assert.equal(eltRun(['oracle']).status, 0, 'оракул обязан отработать на большом дереве');
  const proof1 = JSON.parse(fs.readFileSync(path.join(REPO, '.git', 'elt-oracle-proof.json'), 'utf8'));
  assert.ok(proof1.hash && proof1.hash.length === 64);

  fs.writeFileSync(big, 'b'.repeat(3 * 1024 * 1024) + '\n');
  assert.equal(eltRun(['oracle']).status, 0);
  const proof2 = JSON.parse(fs.readFileSync(path.join(REPO, '.git', 'elt-oracle-proof.json'), 'utf8'));
  assert.notEqual(proof2.hash, proof1.hash,
    'обрезанный дифф дал бы ОДИН хеш на два разных дерева — пруф перестал бы быть привязан к дереву');
  fs.unlinkSync(big);
});

test('T009: git, который не отработал, — громкий отказ, а не пустой хеш', () => {
  // Настоящий git ломается указанием на несуществующий GIT_DIR: каждый вызов отдаёт 128 и
  // ПУСТОЙ stdout. Это в точности то состояние, которое treeHash раньше принимал за «дерево
  // чистое» и хешировал — то есть выдавал валидный на вид пруф ни о чём.
  const r = spawnSync('node', [ELT, 'oracle'], {
    cwd: REPO, encoding: 'utf8',
    env: { ...process.env, GIT_DIR: path.join(os.tmpdir(), 'elt-no-such-git-dir') },
  });
  assert.notEqual(r.status, 0, 'сломанный git обязан валить команду, а не давать хеш пустого дерева');
  assert.match(`${r.stdout || ''}${r.stderr || ''}`, /treeHash|не git-репозиторий/,
    'отказ обязан называть причину, иначе он неотличим от красного оракула');
});

test('skip-oracle: пруфа вообще нет на этом дереве → тоже реальный прогон, не слепое доверие', () => {
  // пруф живёт в .git/ (per-worktree через --git-dir), НЕ в .harness/ — см. elt.js oracleProofPath()
  try { fs.unlinkSync(path.join(REPO, '.git', 'elt-oracle-proof.json')); } catch { /* noop */ }
  fs.writeFileSync(path.join(REPO, 'c.txt'), 'v1\n');
  const before1 = counterValue();
  const beforeCommit = commitCount();

  const r = eltRun(['commit', '--task', 'T003', '--skip-oracle', '-m', 'test commit C']);
  assert.notEqual(r.status, 0, r.stderr);
  assert.equal(counterValue(), before1 + 1, 'нет пруфа → elt commit прогнал оракул реально');
  assert.equal(commitCount(), beforeCommit, 'a fresh oracle alone cannot replace judge proof');
});
