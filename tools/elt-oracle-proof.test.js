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
    oracle: `node oracle-check.js ${COUNTER}`,
    shell: SHELL,
    branchPolicy: 'feature',
    push: false,
  }));
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

  const r = eltRun(['commit', '--skip-oracle', '-m', 'test commit A']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(counterValue(), afterOracle, 'commit --skip-oracle НЕ перезапустил оракул — пруф был валиден');
});

test('skip-oracle: дерево изменилось ПОСЛЕ зелёного оракула → пруф не доверен, оракул реально перезапускается', () => {
  fs.writeFileSync(path.join(REPO, 'b.txt'), 'v1\n');
  assert.equal(eltRun(['oracle']).status, 0);
  const afterOracle = counterValue();

  fs.writeFileSync(path.join(REPO, 'b.txt'), 'v2 — правка ПОСЛЕ зелёного оракула\n'); // сама дыра

  const r = eltRun(['commit', '--skip-oracle', '-m', 'test commit B']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(counterValue(), afterOracle + 1, 'хеш разошёлся → elt commit не поверил флагу, прогнал оракул реально');
});

test('skip-oracle: пруфа вообще нет на этом дереве → тоже реальный прогон, не слепое доверие', () => {
  // пруф живёт в .git/ (per-worktree через --git-dir), НЕ в .harness/ — см. elt.js oracleProofPath()
  try { fs.unlinkSync(path.join(REPO, '.git', 'elt-oracle-proof.json')); } catch { /* noop */ }
  fs.writeFileSync(path.join(REPO, 'c.txt'), 'v1\n');
  const before1 = counterValue();

  const r = eltRun(['commit', '--skip-oracle', '-m', 'test commit C']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(counterValue(), before1 + 1, 'нет пруфа → elt commit прогнал оракул реально');
});
