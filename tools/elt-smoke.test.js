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
// L2 smoke в ЭТОМ репо (dogfood §3.1). 019 T015: цель сменилась с deploy-копии
// `~/.claude/bin/elt.js` на сам плагин — копии больше нет, но класс отказа тот же: замыкание
// оборвано, и снаружи это выглядит как «команда не работает». Прогон идёт ИЗ ЧУЖОГО каталога,
// иначе относительные require() резолвятся случайно и smoke ничего не доказывает.
const { smokeEltDeploy } = require('./smoke-elt-deploy');
const smokeRoots = [];
after(() => { for (const d of smokeRoots) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* windows lock */ } });

function brokenPlugin(omit = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-plugin-'));
  smokeRoots.push(root);
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  for (const name of ['doctor.js', 'oracle.js', 'l0.js', 'ledger.js']) {
    if (omit.includes(name)) continue;
    fs.copyFileSync(path.join(__dirname, '..', 'bin', name), path.join(root, 'bin', name));
  }
  return root;
}

test('smokeEltDeploy: плагина нет — reason=missing, не крашится', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-noplugin-'));
  smokeRoots.push(root);
  const r = smokeEltDeploy({ pluginRoot: root });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing');
});

test('smokeEltDeploy: целая установка — доктор зелёный из чужого каталога', () => {
  const r = smokeEltDeploy();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.reason, 'ok');
});

// T017 живьём: замыкание расходится (недостающий сосед) → smoke обязан покраснеть. Без этого
// случая «ok» ничего не значил бы — он был бы «ok» и на битой установке.
test('smokeEltDeploy: оборванное замыкание (нет ledger.js) — reason=broken, exit≠0', () => {
  const root = brokenPlugin(['ledger.js']);
  const r = smokeEltDeploy({ pluginRoot: root });
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.reason, 'broken');
  assert.notEqual(r.exit, 0);
});
