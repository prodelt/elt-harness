#!/usr/bin/env node
'use strict';
// T007 (specs/006-elt-front-gate): контракт-тест наличия/структуры grill-me v2.
// Скилл живёт ВНЕ этого репо (~/.claude/skills/grill-me/SKILL.md — глобальный, не per-project),
// поэтому тест читает реальный домашний каталог (прецедент: tools/doctor.test.js:768,
// tools/harness-checklist.test.js:293 уже проверяют живые файлы через os.homedir()).

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const SOURCE_PATH = path.join(os.homedir(), '.claude', 'skills', 'grill-me', 'SKILL.md');
const MIRRORS = [
  path.join(os.homedir(), '.codex', 'skills', 'grill-me', 'SKILL.md'),
  path.join(os.homedir(), '.gemini', 'skills', 'grill-me', 'SKILL.md'),
];

function read(p) { return fs.readFileSync(p, 'utf8'); }

test('grill-me SKILL.md существует', () => {
  assert.ok(fs.existsSync(SOURCE_PATH), `не найден ${SOURCE_PATH}`);
});

test('grill-me SKILL.md: frontmatter name: grill-me', () => {
  const text = read(SOURCE_PATH);
  assert.match(text, /^---[\s\S]*?name:\s*grill-me[\s\S]*?---/m);
});

test('grill-me SKILL.md: протокол v2 — разведка кода ДО вопросов', () => {
  const text = read(SOURCE_PATH);
  assert.match(text, /[Пп]ротокол v2/);
  assert.match(text, /[Рр]азведка кода/);
});

test('grill-me SKILL.md: ≥2 раунда AskUserQuestion по всем 4 категориям', () => {
  const text = read(SOURCE_PATH);
  assert.match(text, /AskUserQuestion/);
  assert.match(text, /2\s*раунд/, 'минимум 2 раунда явно указан');
  for (const category of ['пользователи/сценарии', 'данные/интеграции', 'риски/edge cases', 'не-цели/приоритет MVP']) {
    assert.ok(text.includes(category), `категория «${category}» отсутствует в протоколе`);
  }
});

test('grill-me SKILL.md: раунд с вариантами концепции для UI-задач', () => {
  const text = read(SOURCE_PATH);
  assert.match(text, /UI-задач/);
  assert.match(text, /2[–\-]3\s*вариант/);
});

test('grill-me SKILL.md: выход = секция «## Решения (зафиксированы с пользователем <дата>)»', () => {
  const text = read(SOURCE_PATH);
  assert.match(text, /## Решения \(зафиксированы с пользователем/);
});

test('grill-me SKILL.md: зеркала codex/gemini побайтово идентичны источнику', () => {
  const source = read(SOURCE_PATH);
  for (const mirror of MIRRORS) {
    assert.ok(fs.existsSync(mirror), `зеркало не найдено: ${mirror}`);
    assert.equal(read(mirror), source, `зеркало разошлось с источником: ${mirror}`);
  }
});
