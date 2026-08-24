'use strict';
// 019 T011 — контракт гейта L0 как точки входа плагина.
//
// Проверяется транспорт, а не правила: правила уже под тестами в `tools/elt-gate-l0.test.js`,
// и дублировать их здесь значило бы завести второй источник правды. Здесь важно ровно три
// вещи: дифф собирается из ЦЕЛЕВОГО проекта, вердикт доезжает наружу неискажённым, и
// `block` отличим по коду возврата от собственного падения гейта.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const l0bin = require('./l0');

function repo() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-l0-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(cwd, 'seed.js'), 'module.exports = 1;\n');
  git('add', '-A');
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'seed');
  return { cwd, git };
}

test('чистое дерево — триггеров нет, вердикт pass', () => {
  const { cwd } = repo();
  const res = l0bin.evaluateProject({ cwd });
  assert.equal(res.verdict, 'pass');
  assert.deepEqual(res.triggers, []);
  assert.equal(res.judgeNeeded, false);
});

test('новый прод-код без чека будит судью, а не проходит молча', () => {
  const { cwd } = repo();
  fs.writeFileSync(path.join(cwd, 'feature.js'), 'function f() { return 2; }\nmodule.exports = f;\n');
  execFileSync('git', ['add', '-A'], { cwd });

  const res = l0bin.evaluateProject({ cwd });
  assert.ok(res.triggers.some((t) => t.name === 'new-code-no-check'), JSON.stringify(res.triggers));
  assert.equal(res.judgeNeeded, true);
  assert.equal(res.verdict, 'judge-needed');
});

test('новый внешний импорт без пруфа ctx7 даёт block и код возврата 3', () => {
  const { cwd } = repo();
  fs.writeFileSync(path.join(cwd, 'uses-dep.js'), "const lodash = require('lodash');\nmodule.exports = lodash;\n");
  execFileSync('git', ['add', '-A'], { cwd });

  const res = l0bin.evaluateProject({ cwd });
  assert.equal(res.verdict, 'block');

  const out = [];
  const code = l0bin.main(['--cwd', cwd], { write: (s) => out.push(s) });
  assert.equal(code, 3, 'block отличается от падения гейта (1) и от прохода (0)');
  assert.match(out.join(''), /external-import-no-ctx7/);
});

test('дифф собирается из целевого проекта, а не из дома плагина', () => {
  const { cwd } = repo();
  fs.writeFileSync(path.join(cwd, 'seed.js'), 'module.exports = 2;\n');
  const { diff, status } = l0bin.collect(cwd);
  assert.match(diff, /seed\.js/);
  assert.match(status, /seed\.js/);
  assert.ok(!diff.includes('elt-gate-l0.js'), 'дом плагина в дифф не попадает');
});

test('--json печатает разбираемый вердикт', () => {
  const { cwd } = repo();
  const out = [];
  const code = l0bin.main(['--cwd', cwd, '--json'], { write: (s) => out.push(s) });
  assert.equal(code, 0);
  const parsed = JSON.parse(out.join(''));
  assert.equal(parsed.verdict, 'pass');
  assert.ok(Array.isArray(parsed.triggers));
});

test('не-git каталог не роняет гейт: пустой дифф, вердикт pass', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-nogit-'));
  const res = l0bin.evaluateProject({ cwd });
  assert.equal(res.verdict, 'pass');
});
