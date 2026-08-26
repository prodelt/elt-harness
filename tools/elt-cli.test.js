'use strict';
// 021 T004 — контракт того, что CLI говорит о СЕБЕ.
//
// Мотивирующий факт, а не гипотеза: `elt` без аргументов два релиза печатал «ядро ELT v3»,
// хотя рантайм давно v5 и распространяется плагином. Первое, что видит новый пользователь,
// сообщало ему неверную версию продукта, и ни одна проверка на это не смотрела — версия
// жила в строке справки и больше нигде.
//
// Проверка идёт по РЕАЛЬНОМУ запуску процесса, а не по чтению исходника регуляркой: строка
// справки собирается в рантайме, и тест, читающий файл, остался бы зелёным на сломанном
// выводе.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, 'elt.js');
const PLUGIN = path.join(__dirname, '..', '.claude-plugin', 'plugin.json');

function runHelp() {
  const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8', timeout: 60000 });
  return `${r.stdout || ''}${r.stderr || ''}`;
}

test('справка называет текущий рантайм v5, а не исторический v3', () => {
  const out = runHelp();
  assert.match(out, /ядро ELT v5/, 'справка обязана называть текущую мажорную версию');
  assert.doesNotMatch(out, /ядро ELT v3/, 'старый заголовок не должен пережить обновление');
});

test('мажор в справке совпадает с версией плагина — расходиться им нечем', () => {
  const version = JSON.parse(fs.readFileSync(PLUGIN, 'utf8')).version;
  const major = String(version).split('.')[0];
  const out = runHelp();
  // Дискриминирующая часть: сверка идёт с plugin.json, а не с литералом «5». Тест с литералом
  // остался бы зелёным после выхода 6.0.0 и снова пропустил бы ровно тот же дрейф.
  assert.match(out, new RegExp(`ядро ELT v${major}\\b`), `справка отстала от plugin.json ${version}`);
});

test('справка перечисляет живые входы гейта, а не снятые команды', () => {
  const out = runHelp();
  for (const cmd of ['elt oracle', 'elt judge run', 'elt commit', 'elt spec approve']) {
    assert.ok(out.includes(cmd), `справка обязана называть ${cmd}`);
  }
  for (const dead of ['harness sync-all', 'harness propose', 'judge.verify']) {
    assert.ok(!out.includes(dead), `снятая команда ${dead} не должна оставаться в справке`);
  }
});

test('вызов без аргументов — код 0: это справка, а не ошибка', () => {
  const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0);
});

test('неизвестная команда — код 1 и та же справка', () => {
  const r = spawnSync(process.execPath, [CLI, 'no-such-command'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1, 'неизвестная команда обязана падать, иначе опечатка молча ничего не делает');
  assert.match(`${r.stdout || ''}${r.stderr || ''}`, /ядро ELT v5/);
});
