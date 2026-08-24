'use strict';
// 019 T011/T015 — контракт диагностики плагина.
//
// Этот тест — прямая замена побайтной сверки `~/.claude/bin` из `doctor.test.js`. Та сверка
// ловила один класс: развёрнутая копия отстала от исходника (D16, D18). У плагина копии нет,
// поэтому проверяется другое: замыкание цело и два манифеста не разошлись версиями.
//
// Отдельно закреплено требование T015: в ЧИСТОМ проекте (без `.harness/`) доктор ЗЕЛЁНЫЙ.
// Иначе плагин нельзя поставить до бутстрапа, а бутстрап нельзя запустить без плагина.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const doctor = require('./doctor');

function statusOf(report, name) {
  const c = report.checks.find((x) => x.name === name);
  assert.ok(c, `в отчёте есть проверка "${name}"`);
  return c.status;
}

test('в чистом проекте доктор зелёный — конфига нет, но это INFO, а не FAIL', () => {
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-clean-'));
  const report = doctor.runDoctor({ cwd: clean });
  assert.equal(report.summary.fail, 0, JSON.stringify(report.checks.filter((c) => c.status === 'FAIL'), null, 2));
  assert.equal(statusOf(report, 'проект: .harness/harness.json'), 'INFO');
});

test('замыкание bin/ резолвится целиком, а не только компилируется', () => {
  const report = doctor.runDoctor();
  assert.equal(statusOf(report, 'замыкание bin/ резолвится'), 'PASS');
  for (const entry of doctor.BIN_ENTRIES) {
    assert.ok(fs.existsSync(path.join(doctor.PLUGIN_ROOT, 'bin', entry)), `${entry} на месте`);
  }
});

test('вся объявленная поверхность плагина существует', () => {
  const report = doctor.runDoctor();
  const missing = doctor.SURFACE.filter((f) => !fs.existsSync(path.join(doctor.PLUGIN_ROOT, f)));
  assert.deepEqual(missing, [], 'команды, скилл и агенты на месте');
  assert.equal(statusOf(report, 'поверхность плагина на месте'), 'PASS');
});

test('версии двух манифестов совпадают', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(doctor.PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const market = JSON.parse(fs.readFileSync(path.join(doctor.PLUGIN_ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const entry = market.plugins.find((p) => p.name === 'elt');
  assert.equal(plugin.name, 'elt');
  assert.equal(entry.version, plugin.version, 'дрейф версий валит релиз через `claude plugin tag`');
  assert.equal(statusOf(doctor.runDoctor(), 'marketplace.json согласован с plugin.json'), 'PASS');
});

// Дискриминирующий регресс: проверка обязана ПАДАТЬ на разошедшихся версиях. Без него
// «PASS» ничего не значит — он был бы PASS и на сломанном сравнении.
test('разошедшиеся версии манифестов дают FAIL, а не тихий PASS', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-drift-'));
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'elt', version: '5.0.0' }));
  fs.writeFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'elt', plugins: [{ name: 'elt', version: '4.9.0' }] }));

  // runDoctor читает манифесты от PLUGIN_ROOT, поэтому подменяем корень через отдельный
  // процесс: копируем doctor.js в фикстуру и зовём его там.
  fs.copyFileSync(path.join(doctor.PLUGIN_ROOT, 'bin', 'doctor.js'), path.join(root, 'bin', 'doctor.js'));
  const drifted = require(path.join(root, 'bin', 'doctor.js'));
  const report = drifted.runDoctor({ root });
  const c = report.checks.find((x) => x.name === 'marketplace.json согласован с plugin.json');
  assert.equal(c.status, 'FAIL');
  assert.match(c.detail, /версии разошлись/);
});

test('formatText печатает итог с числом отказов', () => {
  const text = doctor.formatText(doctor.runDoctor());
  assert.match(text, /elt-doctor/);
  assert.match(text, /FAIL=\d+/);
});
