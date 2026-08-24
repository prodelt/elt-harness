'use strict';
// 019 T003 — Модуль для загрузки и валидации пяти линз ревью.
//
// Пять линз запускаются паралельно как субагенты; каждая возвращает массив находок
// в формате {file, line, summary, failure_scenario, confidence}. Этот модуль:
//   1. Загружает YAML-frontmatter из agents/review-*.md
//   2. Парсит metadata (name, description, model, tools)
//   3. Валидирует находки по контракту
//
// Модуль — лист замыкания (нет require, кроме path), чтобы не тащить зависимости
// в deploy-копию судьи.

const fs = require('fs');
const path = require('path');

// Парсит YAML-frontmatter вида:
// ---
// name: Foo
// description: Bar
// model: sonnet
// tools: [Read, Bash]
// ---
function parseFrontmatter(content) {
  // D23: переводы строк нормализуются ДО разбора. Регулярка ждала ровно `\n`, а Windows отдаёт
  // `\r\n` на любом свежем checkout (`core.autocrlf`) — фронтматтер не матчился вовсе, и
  // `loadLenses` падал на первой же линзе с «missing name or description». В рабочем дереве
  // файлы лежат с LF, поэтому локально всё было зелёным, а у нового пользователя ревью не
  // стартовало ни разу. Поймано фоновой верификацией на detached-worktree, не тестом.
  const text = String(content == null ? '' : content).replace(/\r\n/g, '\n');
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm = {};
  const lines = match[1].split('\n');

  for (const line of lines) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;

    const key = m[1];
    let val = m[2].trim();

    // Формат frontmatter — тот же, что у официальных агентов Claude Code
    // (`feature-dev/agents/code-explorer.md`): `tools: Read, Bash` строкой через запятую.
    // Список в скобках тоже принимаем: он встречается в чужих плагинах, и падать на нём
    // из-за формы записи было бы глупо. Наружу в обоих случаях уходит массив.
    if (key === 'tools') {
      val = String(val).replace(/^\[|\]$/g, '').split(',').map((t) => t.trim()).filter(Boolean);
    }

    fm[key] = val;
  }

  return fm;
}

// Загружает все линзы из директории.
// Каждый файл agents/review-*.md должен иметь фронтматтер и содержание.
function loadLenses(dir = './agents') {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('review-') && f.endsWith('.md'))
    .sort();

  const lenses = [];

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const fm = parseFrontmatter(content);

    if (!fm || !fm.name || !fm.description) {
      throw new Error(`Invalid frontmatter in ${file}: missing name or description`);
    }

    // Проверяем, что в содержании есть раздел про ложные спрацывания.
    if (!content.includes('ложн') && !content.includes('false posit')) {
      throw new Error(`Lens ${file} missing false positive section`);
    }

    // Проверяем, что упоминается шкала 0-100.
    if (!content.includes('0') || !content.includes('100')) {
      throw new Error(`Lens ${file} missing confidence scale (0-100)`);
    }

    // Проверяем, что линза не объявляет Write/Edit.
    if (Array.isArray(fm.tools)) {
      if (fm.tools.includes('Write') || fm.tools.includes('Edit') ||
          fm.tools.includes('NotebookEdit')) {
        throw new Error(`Lens ${file} must not declare write tools`);
      }
    }

    lenses.push({
      name: fm.name,
      description: fm.description,
      model: fm.model || 'sonnet',
      tools: Array.isArray(fm.tools) ? fm.tools : [],
      file,
    });
  }

  return lenses;
}

// Список имен линз.
const LENS_NAMES = [
  'review-claude-md',
  'review-bugs',
  'review-history',
  'review-prior-comments',
  'review-code-comments',
];

// Валидирует одну находку по контракту.
// Ожидает: {file, line, summary, failure_scenario, confidence: 0-100}
function validateFinding(obj) {
  if (!obj || typeof obj !== 'object') {
    throw new Error('Finding must be an object');
  }

  if (typeof obj.file !== 'string' || !obj.file) {
    throw new Error('Finding must have file (string)');
  }

  if (typeof obj.line !== 'number' || obj.line < 1) {
    throw new Error('Finding must have line (number >= 1)');
  }

  if (typeof obj.summary !== 'string' || !obj.summary) {
    throw new Error('Finding must have summary (string)');
  }

  if (typeof obj.failure_scenario !== 'string' || !obj.failure_scenario) {
    throw new Error('Finding must have failure_scenario (string)');
  }

  if (typeof obj.confidence !== 'number') {
    throw new Error('Finding must have confidence (number)');
  }

  if (obj.confidence < 0 || obj.confidence > 100) {
    throw new Error('Finding confidence must be 0-100');
  }

  return true;
}

module.exports = {
  loadLenses,
  LENS_NAMES,
  validateFinding,
  parseFrontmatter, // экспортируем для тестов
};
