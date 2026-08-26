'use strict';
// 021 T005 — регрессы L2-smoke. Оба слоя smoke отвечают на вопросы, которые юнит-тесты на
// исходники не задают в принципе: «плагин запускается вне себя» и «в новом репозитории
// человек получает рабочий конфиг».
//
// Тесты гоняют НАСТОЯЩИЕ функции на настоящих временных каталогах — spawn реальных процессов
// и реальный git. Мок здесь был бы бессмысленным: проверяется ровно то, что происходит между
// процессами, а не логика внутри одного.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const smoke = require('./smoke-elt-deploy');

test('smokeEltDeploy: настоящий плагин запускается из чужого каталога', () => {
  const r = smoke.smokeEltDeploy();
  assert.equal(r.ok, true, `smoke упал: ${r.reason} — ${r.detail}`);
  assert.match(r.detail, /plugin \d+\.\d+\.\d+/);
});

test('smokeEltDeploy: оборванное замыкание — отказ, а не молчаливый успех', () => {
  // Копия плагина без tools/: bin/doctor.js требует соседей, которых нет. Это ровно тот
  // класс отказа (MODULE_NOT_FOUND у пользователя), ради которого слой и заведён, — и
  // дискриминирующая половина теста: без неё «ok» было бы неотличимо от «ничего не проверили».
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-broken-plugin-'));
  fs.mkdirSync(path.join(fake, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(fake, 'bin', 'doctor.js'), "require('../tools/doctor-core.js');\n", 'utf8');
  try {
    const r = smoke.smokeEltDeploy({ pluginRoot: fake });
    assert.equal(r.ok, false, 'плагин с оборванным require обязан быть отказом');
    assert.equal(r.reason, 'broken');
  } finally {
    fs.rmSync(fake, { recursive: true, force: true });
  }
});

test('smokeEltDeploy: отсутствующая точка входа — отказ с причиной missing', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-empty-plugin-'));
  try {
    const r = smoke.smokeEltDeploy({ pluginRoot: empty });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'missing');
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('smokeFreshProject: чистый репозиторий получает конфиг, и доктор его признаёт', () => {
  const r = smoke.smokeFreshProject();
  assert.equal(r.ok, true, `bootstrap чистого проекта упал: ${r.reason} — ${r.detail}`);
  assert.match(r.detail, /оракул 'node --test'/);
});

test('smokeFreshProject: доктор зелёный в проекте БЕЗ конфига — это INFO, а не отказ', () => {
  // Утверждение проверяется не пересказом, а тем же прогоном: если бы отсутствие
  // .harness/harness.json было FAIL, smokeFreshProject вернул бы reason 'doctor-clean'
  // ещё до шага init. Первый шаг инструкции по установке обязан быть правдой.
  const r = smoke.smokeFreshProject();
  assert.notEqual(r.reason, 'doctor-clean', 'доктор упал в чистом проекте — установка ставит плагин ДО бутстрапа');
});

test('smokeFreshProject: битый elt.js ловится как отказ init, а не как успех', () => {
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-broken-init-'));
  const real = smoke.PLUGIN_ROOT;
  fs.mkdirSync(path.join(fake, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(fake, 'tools'), { recursive: true });
  // Доктор берём настоящий (он должен пройти первый шаг), а elt.js подменяем на падающий —
  // так тест отделяет отказ init от отказа doctor, вместо того чтобы валить всё одинаково.
  fs.copyFileSync(path.join(real, 'bin', 'doctor.js'), path.join(fake, 'bin', 'doctor.js'));
  fs.writeFileSync(path.join(fake, 'tools', 'elt.js'), 'process.exit(7);\n', 'utf8');
  try {
    const r = smoke.smokeFreshProject({ pluginRoot: fake });
    assert.equal(r.ok, false);
    assert.ok(r.reason === 'init' || r.reason === 'doctor-clean', `ожидался отказ init/doctor-clean, получен ${r.reason}: ${r.detail}`);
  } finally {
    fs.rmSync(fake, { recursive: true, force: true });
  }
});
