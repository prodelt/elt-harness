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

test('elt SKILL.md: зеркала codex/gemini побайтово идентичны источнику', () => {
  const source = read(SOURCE_PATH);
  for (const mirror of MIRRORS) {
    assert.ok(fs.existsSync(mirror), `зеркало не найдено: ${mirror}`);
    assert.equal(read(mirror), source, `зеркало разошлось с источником: ${mirror}`);
  }
});
