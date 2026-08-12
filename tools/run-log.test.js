'use strict';
// 016 T009 — run-log обязан писать или громко отказываться. Основание: AWE4 накопил коммиты
// `chore: elt slice` и `.fleet-wt/T105..T106`, но `.git/elt/` там нет ни в основном gitdir, ни
// в gitdir'ах worktree — работа велась, харнес её не видит.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const { appendRunLog } = require('./run-log');
const roots = [];
after(() => { for (const r of roots) try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* windows lock */ } });

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-runlog-'));
  roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

test('пишет запись в .git/elt/run-log.jsonl', () => {
  const root = repo();
  const file = appendRunLog(root, { task: 'T001', status: 'ok' });
  assert.equal(fs.existsSync(file), true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8').trim()).task, 'T001');
});

test('путь недоступен для записи — ненулевая ошибка с названной причиной, а не тихий null', () => {
  const root = repo();
  // Файл там, где нужен каталог: mkdir детерминированно падает и на Windows, и на POSIX.
  fs.writeFileSync(path.join(root, '.git', 'elt'), 'занято');
  assert.throws(() => appendRunLog(root, { task: 'T001' }), /run-log: запись в .* не удалась/);
});

test('вне git-репозитория — ошибка, а не молчание', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-nogit-'));
  roots.push(root);
  assert.throws(() => appendRunLog(root, { task: 'T001' }), /не удалось определить git-dir/);
});
