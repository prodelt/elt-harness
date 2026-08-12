'use strict';
// 016 T010 — документный коммит проходит через `elt commit` без `--task`, коммит с кодом без
// `--task` по-прежнему отклоняется. Причина слайса: раньше документный коммит выгонял из
// харнеса в ручной `git commit`, то есть мимо run-log.
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const ELT = path.join(__dirname, 'elt.js');
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
const roots = [];
after(() => { for (const r of roots) try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* windows lock */ } });

function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
function run(root, args) { return spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8' }); }
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-docs-commit-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL, branchPolicy: 'feature', judge: { enabled: true, model: 'codex' },
  }));
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  git(root, ['checkout', '-qb', 'work']);
  return root;
}

test('только документы — коммит без --task проходит и пишет run-log', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'NOTES.md'), '# заметка\n');
  const r = run(root, ['commit', '-m', 'docs: заметка']);
  assert.equal(r.status, 0, r.stderr.toString());
  assert.equal(git(root, ['log', '-1', '--format=%s']), 'docs: заметка');
  const log = fs.readFileSync(path.join(root, '.git', 'elt', 'run-log.jsonl'), 'utf8').trim().split('\n');
  const last = JSON.parse(log[log.length - 1]);
  assert.equal(last.status, 'docs-commit');
  assert.equal(last.task, null);
});

test('есть код — без --task по-прежнему отказ, ничего не закоммичено', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'NOTES.md'), '# заметка\n');
  fs.writeFileSync(path.join(root, 'app.js'), 'module.exports = 1;\n');
  const before = git(root, ['rev-parse', 'HEAD']);
  const r = run(root, ['commit', '-m', 'feat: код']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr.toString(), /--task Txxx обязателен для коммита с кодом/);
  assert.match(r.stderr.toString(), /app\.js/);
  assert.equal(git(root, ['rev-parse', 'HEAD']), before);
});
