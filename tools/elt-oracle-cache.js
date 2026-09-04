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
const { execFileSync } = require('node:child_process');
const { needlesFor, walkJs, INERT } = require('./elt-oracle-select');

// 024 T004: кэш переехал из рабочего дерева в git-каталог. В `.harness/` он был гитигнорен,
// то есть НЕВИДИМ для `treeHash()` (тот строится из `git status`, `git diff HEAD` и содержимого
// untracked — игнорируемого файла нет ни в одном источнике). Записать туда ключи, посчитанные
// на СЛОМАННОМ дереве, значило получить `65/65 passed in 0.0s`, exit 0 и зелёный пруф, не
// исполнив ни одного теста. В `.git/` он по крайней мере не притворяется частью проекта и
// живёт по worktree, как и оракул-пруф. Одного переезда мало — вторая половина фикса
// (`ran`/`cached` в пруфе) в elt-oracle-runner.js и elt.js.
const CACHE_LEGACY_REL = path.join('.harness', 'oracle-cache.json');
const CACHE_BASENAME = 'oracle-cache.json';
const MAX_ROUNDS = 2; // тот же порог, что в elt-oracle-select.js (011 T006)

// Корни оракула. Держится ЗДЕСЬ, потому что дефолт `scanDirs` обязан совпадать с тем, что
// реально обходит раннер: рассинхрон этих двух списков и был дефектом — дефолт знал только
// `tools`, а корней три, поэтому замыкание теста НИКОГДА не содержало исходников из `bin/` и
// `benchmarks/`, и правка точки входа плагина не сдвигала ключ его собственного теста.
// `elt-oracle-runner.js` импортирует этот список, а не объявляет свой.
const SCAN_DIRS = ['tools', 'bin', 'benchmarks'];

function gitDirOf(root) {
  try {
    const out = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: root, encoding: 'utf8' }).trim();
    if (out) return out;
  } catch { /* не git-репо или git недоступен — падать нельзя, кэш всего лишь оптимизация */ }
  return path.join(root, '.git');
}
function cachePath(root) {
  return path.join(gitDirOf(root), 'elt', CACHE_BASENAME);
}

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
  try { return JSON.parse(fs.readFileSync(cachePath(root), 'utf8')); }
  catch { return {}; }
}

function saveCache(root, cache) {
  const full = cachePath(root);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(cache, null, 2));
  // Старая копия в рабочем дереве больше не читается — снимаем её, чтобы она не осталась
  // лежать вечным мусором в каждом проекте, прошедшем через прежнюю версию.
  try { fs.rmSync(path.join(root, CACHE_LEGACY_REL), { force: true }); } catch { /* уже нет */ }
}

// Один тест: сканирует source-каталоги (walkJs — тот же обход, что и в elt-oracle-select.js),
// считает замыкание и ключ.
function computeEntry({ root, testFile, scanDirs = SCAN_DIRS, runnerVersion, cmd, readFile }) {
  const sources = scanDirs
    .flatMap((d) => walkJs(path.join(root, d), root))
    .filter((f) => !INERT.test(f));
  const closureFiles = closureFor(testFile, sources, readFile);
  const key = cacheKey({ testFile, closureFiles, readFile, runnerVersion, cmd });
  return { key, closureFiles };
}

module.exports = {
  closureFor, cacheKey, loadCache, saveCache, computeEntry, cachePath, gitDirOf,
  CACHE_LEGACY_REL, SCAN_DIRS, norm, MAX_ROUNDS,
};
