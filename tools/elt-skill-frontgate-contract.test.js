#!/usr/bin/env node
'use strict';
// T008 (specs/006-elt-front-gate): контракт-тест наличия/структуры elt SKILL.md Режим 0 v2.
// Скилл живёт ВНЕ этого репо (~/.claude/skills/elt/SKILL.md — глобальный), тест читает реальный
// домашний каталог — тот же паттерн, что tools/skills-frontgate-contract.test.js (T007).

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const SOURCE_PATH = path.join(os.homedir(), '.claude', 'skills', 'elt', 'SKILL.md');
const MIRRORS = [
  path.join(os.homedir(), '.codex', 'skills', 'elt', 'SKILL.md'),
  path.join(os.homedir(), '.gemini', 'skills', 'elt', 'SKILL.md'),
];

function read(p) { return fs.readFileSync(p, 'utf8'); }

test('elt SKILL.md существует', () => {
  assert.ok(fs.existsSync(SOURCE_PATH), `не найден ${SOURCE_PATH}`);
});

test('elt SKILL.md: grill-me обязателен в 3 случаях (новый проект / нет решений / UI)', () => {
  const text = read(SOURCE_PATH);
  assert.match(text, /grill-me.{0,20}обязателен/s);
  assert.match(text, /новый\s*проект/);
  assert.match(text, /нет зафиксированных решений/);
  assert.match(text, /UI\/дизайн-задача|UI-задач/);
});

test('elt SKILL.md: шаблон spec.md = секции elt spec lint + Mermaid-схема', () => {
  const text = read(SOURCE_PATH);
  assert.match(text, /elt spec lint/);
  assert.match(text, /Mermaid-схема/);
});

test('elt SKILL.md: судейская рубрика += «спека утверждена?»', () => {
  const text = read(SOURCE_PATH);
  assert.match(text, /[Сс]пека утверждена\?/);
});

// --- 011 T013: скилл описывает НОВЫЙ гейт, а не прошлый ------------------------------
// Скилл — единственная инструкция, которую агент читает перед работой. Пока в нём живёт
// ссылка на удалённый флаг, агент будет его набирать и получать exit 4, а пока в нём нет
// третьего исхода — будет перезапускать судью по `inconclusive`, которого не должно быть.

test('elt SKILL.md: ссылок на удалённые флаги люка не осталось', () => {
  const text = read(SOURCE_PATH);
  assert.doesNotMatch(text, /--skip-attest/, 'флаг удалён из CLI (011 T011) — в инструкции его быть не может');
  assert.doesNotMatch(text, /--attested-by/, 'то же самое для второго флага люка');
});

test('elt SKILL.md: описаны ТРИ исхода судьи, включая inconclusive без второго раунда', () => {
  const text = read(SOURCE_PATH);
  assert.match(text, /inconclusive/, 'третий исход назван');
  assert.match(text, /[Вв]торого раунда.{0,20}нет/s, 'сказано, что судью не перезапускают');
  assert.match(text, /review-queue\.jsonl/, 'названо, куда уходит причина');
});

test('elt SKILL.md: описаны очередь ревью и её команды', () => {
  const text = read(SOURCE_PATH);
  assert.match(text, /elt review\b/);
  assert.match(text, /elt review close --task/);
  assert.match(text, /неблокирующ/i, 'очередь не стопорит работу — это часть контракта, не деталь');
});

test('elt SKILL.md: сказано, что судью могут не позвать вовсе (L0 / l0-clean)', () => {
  const text = read(SOURCE_PATH);
  assert.match(text, /l0-clean/);
  assert.match(text, /триггер/i, 'объяснено, ЧЕМ решается вызов судьи');
});

test('elt SKILL.md: зеркала codex/gemini побайтово идентичны источнику', () => {
  const source = read(SOURCE_PATH);
  for (const mirror of MIRRORS) {
    assert.ok(fs.existsSync(mirror), `зеркало не найдено: ${mirror}`);
    assert.equal(read(mirror), source, `зеркало разошлось с источником: ${mirror}`);
  }
});
