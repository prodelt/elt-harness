#!/usr/bin/env node
'use strict';
// 014 T001 (фаза A) — кэш оракула по хешу транзитивного замыкания.
//
// Оракул p50 175 c при слайсе в 4 файла и 82 тест-файлах — перезапускаются тесты, чьи входы
// не менялись. Замыкание теста — ЗЕРКАЛЬНОЕ направление относительно elt-oracle-select.js:
// там от изменённых файлов ищутся тесты, которые их упоминают (`dependents`); здесь — от
// ОДНОГО теста ищутся файлы, которые упоминает ОН (что при их правке инвалидирует кэш).
// Переиспользуются те же примитивы обхода (`needlesFor`, `walkJs`, `INERT`) без нового обхода
// файловой системы — своя только сторона сравнения текста.
//
// Правило безопасности (R3 спеки 014): любая неуверенность → промах, не попадание. Кэш хранит
// только зелёные вердикты — красный никогда не считается «неизменным» (см. elt-oracle-runner.js).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { needlesFor, walkJs, INERT } = require('./elt-oracle-select');

const CACHE_REL = path.join('.harness', 'oracle-cache.json');
const MAX_ROUNDS = 2; // тот же порог, что в elt-oracle-select.js (011 T006)

const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

// Замыкание одного теста: файлы из `sources`, чей текст он упоминает — транзитивно, глубина
// MAX_ROUNDS. `readFile` может вернуть null/пусто (файл не читается) — такой источник просто
// не попадёт в замыкание, а не сломает обход.
function closureFor(testFile, sources, readFile) {
  const t = norm(testFile);
  const closure = new Set();
  let frontier = [t];
  for (let round = 0; round < MAX_ROUNDS && frontier.length; round += 1) {
    const next = [];
    for (const f of frontier) {
      const text = readFile(f) || '';
      for (const s of sources) {
        if (closure.has(s) || s === t) continue;
        if (needlesFor(s).some((n) => text.includes(n))) { closure.add(s); next.push(s); }
      }
    }
    frontier = next;
  }
  return [...closure].sort();
}

// Ключ = sha256(версия раннера + команда + отсортированный [тест, ...замыкание] + их содержимое).
function cacheKey({ testFile, closureFiles, readFile, runnerVersion, cmd }) {
  const h = crypto.createHash('sha256');
  h.update(runnerVersion).update('\n').update(cmd);
  for (const f of [norm(testFile), ...closureFiles].sort()) {
    h.update('\n\0').update(f).update('\0').update(readFile(f) || '');
  }
  return h.digest('hex');
}

function loadCache(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, CACHE_REL), 'utf8')); }
  catch { return {}; }
}

function saveCache(root, cache) {
  const full = path.join(root, CACHE_REL);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(cache, null, 2));
}

// Один тест: сканирует source-каталоги (walkJs — тот же обход, что и в elt-oracle-select.js),
// считает замыкание и ключ.
function computeEntry({ root, testFile, scanDirs = ['tools'], runnerVersion, cmd, readFile }) {
  const sources = scanDirs
    .flatMap((d) => walkJs(path.join(root, d), root))
    .filter((f) => !INERT.test(f));
  const closureFiles = closureFor(testFile, sources, readFile);
  const key = cacheKey({ testFile, closureFiles, readFile, runnerVersion, cmd });
  return { key, closureFiles };
}

module.exports = { closureFor, cacheKey, loadCache, saveCache, computeEntry, CACHE_REL, norm, MAX_ROUNDS };
