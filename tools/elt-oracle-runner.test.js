'use strict';
// Тесты оракульного раннера. Раннер — тот, кто решает «зелено/красно» для КАЖДОГО слайса,
// а собственного теста у него не было. Критично после перевода на параллель: параллельный
// пул не имеет права потерять падение (иначе гейт молча пропустит красный слайс).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { jobsFrom, runFile, runAll, discover } = require('./elt-oracle-runner');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-runner-'));
const write = (name, body) => { const p = path.join(TMP, name); fs.writeFileSync(p, body); return name; };

const GREEN = write('a.test.js', 'console.log("ok");');
const GREEN2 = write('b.test.js', 'console.log("ok2");');
const RED = write('c.test.js', 'console.error("бум"); process.exit(1);');
const SLOW = write('d.test.js', 'setTimeout(() => console.log("late"), 300);');

test('jobsFrom: --serial=1, --jobs N, env, дефолт по CPU', () => {
  assert.equal(jobsFrom(['--serial']), 1);
  assert.equal(jobsFrom(['--jobs', '3']), 3);
  assert.equal(jobsFrom(['--serial', '--jobs', '9']), 1, '--serial сильнее --jobs');
  assert.equal(jobsFrom([], { ELT_ORACLE_JOBS: '5' }), 5);
  assert.equal(jobsFrom([], { ELT_ORACLE_JOBS: 'мусор' }) > 0, true, 'кривой env → живой дефолт');
  assert.ok(jobsFrom([], {}) <= 8);
});

test('runFile: зелёный ok=true, красный ok=false + вывод сохранён', async () => {
  const g = await runFile(GREEN, TMP);
  assert.equal(g.ok, true);
  assert.equal(g.code, 0);
  const r = await runFile(RED, TMP);
  assert.equal(r.ok, false);
  assert.equal(r.code, 1);
  assert.match(r.out, /бум/, 'вывод упавшего файла обязан дойти до отчёта');
});

test('runAll: параллель не теряет падение и прогоняет каждый файл ровно раз', async () => {
  const files = [GREEN, RED, GREEN2, SLOW];
  const seen = [];
  const results = await runAll(files, 4, TMP, (r) => seen.push(r.file));
  assert.equal(results.length, files.length);
  assert.equal(seen.length, files.length);
  assert.deepEqual([...results.map((r) => r.file)].sort(), [...files].sort(), 'ни один файл не потерян и не продублирован');
  assert.equal(results.filter((r) => !r.ok).length, 1);
  assert.equal(results.find((r) => r.file === RED).ok, false);
});

test('runAll: jobs=1 (serial) даёт тот же вердикт, что параллель', async () => {
  const files = [GREEN, RED, GREEN2];
  const par = await runAll(files, 3, TMP);
  const ser = await runAll(files, 1, TMP);
  const verdict = (rs) => rs.filter((r) => !r.ok).map((r) => r.file).sort();
  assert.deepEqual(verdict(par), verdict(ser));
});

test('discover: находит только *.test.js и игнорит node_modules', () => {
  const nested = path.join(TMP, 'sub', 'node_modules');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'evil.test.js'), 'process.exit(1);');
  fs.writeFileSync(path.join(TMP, 'sub', 'e.test.js'), 'console.log("ok");');
  fs.writeFileSync(path.join(TMP, 'sub', 'notatest.js'), 'process.exit(1);');
  const found = discover(TMP).map((f) => path.basename(f));
  assert.ok(found.includes('e.test.js'));
  assert.ok(!found.includes('evil.test.js'), 'node_modules должен быть пропущен');
  assert.ok(!found.includes('notatest.js'));
});
