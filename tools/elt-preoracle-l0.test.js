'use strict';
// 011 T017 (в) — L0 стоит ПЕРЕД оракулом, а не после него.
//
// Схема гейта (specs/011-elt-v3-gate/spec.md) — `S → L0 → L1`. Фактически `evaluate` звалась
// только внутри `runJudge`, то есть ПОСЛЕ прогона оракула: триггер, который выносит вердикт сам
// (`external-import-no-ctx7` — «API внешней либы не подтверждён», судья к этому ничего не
// добавит), успевал стоить полного прогона в ~150 c ровно перед тем, как его отменить.
//
// Меряем не текст, а факт: оракул — команда, которая ОСТАВЛЯЕТ СЛЕД на диске. Нет следа →
// оракул не запускался. Стаба не нужно, спавнится настоящий elt.js.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ELT = path.join(__dirname, 'elt.js');
const MARK = 'oracle-ran.mark';
const tmpDirs = [];

// Оракул-маркер: пишет файл ВНЕ рабочего дерева (иначе сам меняет treeHash и дифф) и выходит 0.
function makeRepo({ withCtx7Proof }) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-preoracle-'));
  tmpDirs.push(repo);
  const mark = path.join(os.tmpdir(), `${path.basename(repo)}-${MARK}`);
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git(['init', '-q']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(repo, 'seed.js'), 'module.exports = 1;\n');
  fs.mkdirSync(path.join(repo, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code',
    oracle: `node -e "require('fs').writeFileSync(process.env.ORACLE_MARK,'1')"`,
    shell: process.platform === 'win32' ? 'powershell' : 'bash',
    branchPolicy: 'feature',
    push: false,
    judge: { enabled: true, provider: 'claude', model: 'sonnet' },
  }));
  if (withCtx7Proof) {
    fs.writeFileSync(path.join(repo, '.harness', 'ctx7-proof.jsonl'),
      JSON.stringify({ library: 'left-pad', libraryId: '/npm/left-pad', query: 'usage', ts: new Date().toISOString() }) + '\n');
  }
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  return { repo, mark };
}

function runEltOracle(repo, mark) {
  const r = spawnSync(process.execPath, [ELT, 'oracle'], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, ORACLE_MARK: mark },
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, oracleRan: fs.existsSync(mark) };
}

// Новый внешний импорт без пруфа ctx7 — вердикт-несущий триггер L0. Оракулу тут делать нечего.
function testBlockingTriggerStopsBeforeOracle() {
  const { repo, mark } = makeRepo({ withCtx7Proof: false });
  fs.writeFileSync(path.join(repo, 'seed.js'), "const pad = require('left-pad');\nmodule.exports = pad;\n");
  const r = runEltOracle(repo, mark);
  assert.equal(r.oracleRan, false, 'L0 заблокировал — оракул НЕ запускался (в этом вся экономия)');
  assert.notEqual(r.code, 0, 'блок обязан быть ненулевым выходом, иначе цепочка поедет дальше');
  assert.match(r.out, /external-import-no-ctx7/, 'причина названа правилом, а не «что-то не так»');
}

// Тот же импорт, но пруф есть — триггер молчит, оракул гоняется как обычно.
function testCleanSliceStillRunsOracle() {
  const { repo, mark } = makeRepo({ withCtx7Proof: true });
  fs.writeFileSync(path.join(repo, 'seed.js'), "const pad = require('left-pad');\nmodule.exports = pad;\n");
  const r = runEltOracle(repo, mark);
  assert.equal(r.oracleRan, true, 'нет блокирующего триггера → L1 гоняется');
  assert.equal(r.code, 0);
}

// Главная граница: L0 решает про СУДЬЮ (judgeNeeded), а не про оракул. Рисковый слайс без
// вердикт-несущего триггера обязан пройти оракул — иначе «рискованный» стал бы «запрещённым».
function testRiskyButNonBlockingSliceRunsOracle() {
  const { repo, mark } = makeRepo({ withCtx7Proof: false });
  fs.writeFileSync(path.join(repo, 'seed.test.js'), "require('node:assert').ok(require('./seed'));\n");
  execFileSync('git', ['add', '-A'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-q', '-m', 'test'], { cwd: repo, stdio: 'ignore' });
  fs.writeFileSync(path.join(repo, 'seed.test.js'), "require('node:assert').ok(true);\n"); // ослаблен = риск-триггер
  const r = runEltOracle(repo, mark);
  assert.equal(r.oracleRan, true, 'риск-триггер зовёт СУДЬЮ после зелёного оракула, а не отменяет оракул');
  assert.equal(r.code, 0);
}

function main() {
  try {
    testBlockingTriggerStopsBeforeOracle();
    testCleanSliceStillRunsOracle();
    testRiskyButNonBlockingSliceRunsOracle();
  } finally {
    for (const dir of tmpDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* windows lock */ }
      try { fs.rmSync(path.join(os.tmpdir(), `${path.basename(dir)}-${MARK}`), { force: true }); } catch { /* noop */ }
    }
  }
  process.stdout.write('elt pre-oracle L0 tests: PASS\n');
}

main();
