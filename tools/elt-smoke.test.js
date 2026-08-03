'use strict';
// 011 T010 (AC10) — L2 smoke: запустить то, чем пользуется человек.
//
// Мотив (аудит 2026-07-29, D0): три уехавших регресса жили в рантайме собранного приложения.
// Юнит-оракул их не ловит В ПРИНЦИПЕ — он проверяет функции, а не то, что продукт стартует.
// Тесты гоняют НАСТОЯЩИЙ `elt oracle` дочерним процессом: смысл слоя ровно в том, что он
// исполняет команду, и мок исполнения проверял бы мок.
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const { validateHarnessConfig } = require('./elt-config');

const ELT = path.join(__dirname, 'elt.js');
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
const roots = [];
// Оракул всегда зелёный: под проверкой именно smoke, а не взаимодействие двух красных слоёв
// (для «оракул красный → smoke не зовётся» есть отдельный тест ниже со своим оракулом).
function fixture(smoke, oracle = 'node -e "process.exit(0)"') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-smoke-'));
  roots.push(root);
  const g = (...a) => execFileSync('git', a, { cwd: root, stdio: 'pipe' });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle, shell: SHELL, judge: { enabled: true, model: 'sonnet' },
    ...(smoke === undefined ? {} : { smoke }),
  }));
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  g('add', '-A'); g('commit', '-qm', 'seed');
  return root;
}
const oracle = (root) => spawnSync(process.execPath, [ELT, 'oracle'], { cwd: root, encoding: 'utf8' });
const tail = (root) => fs.readFileSync(path.join(root, '.harness', 'oracle-tail.log'), 'utf8');
const proof = (root) => JSON.parse(fs.readFileSync(path.join(root, '.git', 'elt-oracle-proof.json'), 'utf8'));
after(() => { for (const r of roots) try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* windows lock */ } });

test('поля smoke нет → слоя нет, поведение прежнее', () => {
  const root = fixture(undefined);
  const r = oracle(root);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /elt smoke/, 'ни строки про слой, которого не просили');
  assert.equal(proof(root).exit, 0);
});

test('smoke пустой строкой → тоже слоя нет (пусто = выключено, а не «команда ""»)', () => {
  const root = fixture('   ');
  const r = oracle(root);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /elt smoke/);
});

test('ЗЕЛЁНЫЙ smoke: исполняется, оракул остаётся зелёным, вывод в отчёте', () => {
  const root = fixture('node -e "console.log(\'приложение стартовало\'); process.exit(0)"');
  const r = oracle(root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /elt smoke: exit 0/);
  assert.match(tail(root), /приложение стартовало/, 'вывод команды виден, а не проглочен');
  assert.equal(proof(root).exit, 0, 'зелёный smoke не мешает пруфу оракула');
});

test('КРАСНЫЙ smoke: ненулевой код возврата валит прогон, хвост вывода в отчёте', () => {
  const root = fixture('node -e "console.error(\'приложение не стартует: порт занят\'); process.exit(3)"');
  const r = oracle(root);
  assert.notEqual(r.status, 0, 'красный smoke обязан валить прогон, а не быть замечанием');
  // Точную цифру не ассертим: оболочка (powershell/bash) отдаёт СВОЙ код за упавшего ребёнка.
  // Значим сам факт ненулевого — по нему и блокирует гейт.
  assert.match(r.stderr, /elt smoke: exit [1-9]/);
  assert.match(tail(root), /порт занят/, 'причина в отчёте — иначе «что-то сломалось» без «что»');
  assert.notEqual(proof(root).exit, 0, 'пруф красный ⇒ commit не проведёт слайс');
});

test('красный ОРАКУЛ → smoke не запускается (второй способ узнать то же самое не бесплатен)', () => {
  const root = fixture('node -e "console.log(\'smoke побежал\'); process.exit(0)"', 'node -e "process.exit(1)"');
  const r = oracle(root);
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stderr, /elt smoke/);
  assert.doesNotMatch(tail(root), /smoke побежал/);
});

test('конфиг: кривой тип smoke падает явно, а не выключает слой молча', () => {
  const base = { kind: 'code', oracle: 'x', judge: { enabled: true, model: 'sonnet' } };
  assert.equal(validateHarnessConfig({ ...base }).ok, true, 'без поля — валидно');
  assert.equal(validateHarnessConfig({ ...base, smoke: 'npm start' }).ok, true);
  const bad = validateHarnessConfig({ ...base, smoke: ['npm', 'start'] });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join('; '), /smoke must be a string/);
});

// ──────────────────────────────────────────────────────────────── 011 T021 ───
// L2 smoke в ЭТОМ репо (dogfood §3.1): слой был включён у Ametrin Web (T018), но собственный
// harness.json поля smoke не имел — единственный слой v3, который харнесс не ел сам. Smoke =
// то, чем реально пользуется человек: deploy-копия `~/.claude/bin/elt.js` в проекте БЕЗ
// repo-checkout. Класс отказа — T017 (`MODULE_NOT_FOUND` во ВСЕХ проектах, замыкание разошлось
// с репо), пойманный тогда случайно. Фиктивный HOME, не реальный `~/.claude/bin` этой машины —
// иначе прогон был бы недетерминирован относительно чужой синхронизации.
const { smokeEltDeploy } = require('./smoke-elt-deploy');
const homes = [];
function makeSmokeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-deploy-home-'));
  homes.push(home);
  return home;
}
function withBin(home) {
  const bin = path.join(home, '.claude', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  return bin;
}
after(() => { for (const h of homes) try { fs.rmSync(h, { recursive: true, force: true }); } catch { /* windows lock */ } });

test('smokeEltDeploy: elt.js отсутствует — reason=missing, не крашится', () => {
  const home = makeSmokeHome(); // .claude/bin даже не создан
  const r = smokeEltDeploy({ home });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing');
});

test('smokeEltDeploy: целая копия замыкания — резолвится, exit 0', () => {
  const home = makeSmokeHome();
  const bin = withBin(home);
  for (const name of ['elt.js', 'elt-config.js', 'run-log.js', 'elt-stats.js']) {
    fs.copyFileSync(path.join(__dirname, name), path.join(bin, name));
  }
  const r = smokeEltDeploy({ home });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.reason, 'ok');
});

// T017 живьём: замыкание расходится с репо (недостающий сосед) → require() внутри elt.js
// кидает MODULE_NOT_FOUND ДО того, как процесс успевает дойти до usage/exit-развилки.
test('smokeEltDeploy: неполное замыкание (нет elt-stats.js) — reason=broken, exit≠0, видно MODULE_NOT_FOUND', () => {
  const home = makeSmokeHome();
  const bin = withBin(home);
  for (const name of ['elt.js', 'elt-config.js', 'run-log.js']) { // elt-stats.js НЕ копируем
    fs.copyFileSync(path.join(__dirname, name), path.join(bin, name));
  }
  const r = smokeEltDeploy({ home });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'broken');
  assert.notEqual(r.exit, 0);
  assert.match(r.detail, /MODULE_NOT_FOUND/);
});
