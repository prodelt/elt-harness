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

// 019 T011 — оракул обязан видеть тесты точек входа плагина. Без этого корня новый код
// харнеса живёт вне гейта, которым сам же харнес всех и меряет: `node --test bin/` был бы
// зелёным, а полный оракул его просто не гонял бы.
test('TEST_ROOTS: bin/ входит в оракул наравне с tools/', () => {
  const { TEST_ROOTS } = require('./elt-oracle-runner');
  assert.ok(TEST_ROOTS.includes('tools'), 'tools/ остаётся корнем');
  assert.ok(TEST_ROOTS.includes('bin'), 'bin/ добавлен корнем');

  const root = path.join(__dirname, '..');
  const found = TEST_ROOTS
    .map((d) => path.join(root, d))
    .filter((d) => fs.existsSync(d))
    .flatMap((d) => discover(d))
    .map((f) => path.relative(root, f).split(path.sep).join('/'));

  for (const rel of ['bin/doctor.test.js', 'bin/l0.test.js', 'bin/ledger.test.js', 'bin/oracle.test.js']) {
    assert.ok(found.includes(rel), `${rel} попадает в выборку оракула`);
  }
  assert.ok(found.some((f) => f.startsWith('tools/')), 'tools/ не потерялся');
});

// 020 T011 — third-party Actions в CI прибиты к неизменяемому SHA.
//
// `uses: actions/checkout@v4` — это не версия, а указатель, который владелец репозитория
// вправе передвинуть на любой коммит. Шаг, который поднимает код перед гейтом, обязан быть
// воспроизводимым: иначе гейт стережёт нас кодом, который мы не выбирали. Проверка читает
// сам workflow, потому что заметить сдвиг тега иначе нечем.
test('CI: каждый third-party Action прибит к 40-символьному SHA с комментарием-версией', () => {
  const wf = path.join(__dirname, '..', '.github', 'workflows', 'test.yml');
  const text = fs.readFileSync(wf, 'utf8');
  const uses = [...text.matchAll(/^\s*-?\s*uses:\s*(\S+)(.*)$/gm)].map((m) => ({ ref: m[1], rest: m[2] }));
  assert.ok(uses.length >= 2, `в workflow найдено ${uses.length} шагов uses — разбор сломался`);
  for (const { ref, rest } of uses) {
    // Локальные (`./…`) и docker-шаги пином не закрываются — их содержимое лежит в репозитории.
    if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
    const at = ref.split('@');
    assert.equal(at.length, 2, `${ref} — нет ссылки после @`);
    assert.match(at[1], /^[0-9a-f]{40}$/, `${ref} прибит к плавающему тегу, а не к SHA`);
    assert.match(rest, /#\s*v?\d+\.\d+\.\d+/, `${ref} — рядом с SHA нет комментария с версией, обновлять его вслепую нельзя`);
  }
});

// Герметичность: named oracle обязан гонять хост-поверхность на фикстурах, а не читать
// домашний каталог машины. Файл, который делал это, был ровно один на две машины CI.
test('CI: шаг герметичности стоит ДО оракула и хост-проверка в оракуле есть', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'test.yml'), 'utf8');
  const hermetic = text.indexOf('host-surface.js --expect-absent');
  const oracle = text.indexOf('elt-oracle-runner.js --full');
  assert.ok(hermetic > 0, 'шаг герметичности в workflow есть');
  assert.ok(oracle > 0, 'шаг оракула в workflow есть');
  assert.ok(hermetic < oracle, 'герметичность утверждается ДО оракула, иначе зелёный оракул нечем интерпретировать');
  assert.ok(fs.existsSync(path.join(__dirname, 'host-surface.test.js')), 'фикстурный контракт хост-поверхности гоняется оракулом');
});
