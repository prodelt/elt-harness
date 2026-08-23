#!/usr/bin/env node
'use strict';
// 011 T006 (L1) — какие тест-файлы реально задеты диффом.
//
// Зачем: замер 2026-07-31 на двух живых слайсах — оракул 196–213 c из ~230 c всего гейта
// (~90% времени слайса), и он гонял ВСЕ 63 тест-файла независимо от того, что тронуто.
//
// Два источника, объединяются:
//  1) обратный обход упоминаний по диску (точный для CommonJS — весь этот репо такой);
//  2) `codegraph affected` — механизм, названный в спеке.
// ЗАМЕР 2026-07-31: (2) в этом репо возвращает ПУСТО для каждого файла (`affectedTests: []`,
// 43 import-узла на 288 файлов — рёбра `require()` не проиндексированы). Один codegraph как
// источник дал бы «тестов не задето» → оракул не гонял бы ничего и был бы зелёным всегда.
// Поэтому он не источник правды, а добавка: в проекте, где его граф импортов полон, он
// доложит то, чего не видит скан; здесь он молча добавляет ноль.
//
// ПЕРЕПРОВЕРЕНО 2026-08-09 (014 T003): полный `codegraph index --force` (313 файлов, edges
// 5475→9144) не сдвинул счётчик import-узлов (43, тот же) и не заполнил `affectedTests` даже
// для `tools/elt-oracle-select.js` — файла с ЗАВЕДОМО существующими зависимыми (`elt-gate-l0.js`,
// `elt-oracle-runner.js`, `elt-oracle-cache.js` и их тесты — все требуют его через `require()`).
// Вывод: не «граф не построен», а «резолвер CommonJS-рёбер этой версии codegraph не связывает
// require()-импорты в edges графа» — инфраструктурный отказ индексатора, не конфигурации этого
// репо. Числа до/после — в `.planning/CHECKPOINT-2026-08-09-T003-codegraph-infra.md` (014).
// Слайс закрыт КАК инфраструктурный отказ: codegraph не переписывался (решение задачи T003).
//
// Почему обход именно ОБРАТНЫЙ (кто упоминает изменённый файл), а не разбор `require()`
// в тестах: половина связей в этом репо — не require. Тест спавнит CLI
// (`path.join(__dirname,'elt.js')`), а конфиг фикстуры несёт команду строкой
// (`"oracle": "node tools/elt-oracle-runner.js"`) — парсер импортов слеп на обеих, и
// пропущенный тест в гейте стоит дороже, чем лишний.
//
// Правило безопасности: ЛЮБАЯ неуверенность → «гнать все» с явной причиной в отчёте.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Файлы, которые ничего не исполняют: их правка не может сломать тест. Всё остальное
// (`.json`, `.ps1`, конфиги) считается «не разобрать» → гоним все.
const INERT = /\.(md|txt|jsonl|log|html|png|jpe?g|svg|gitignore)$/i;
// Бумага самого гейта: `spec.md`/`tasks.md`. Ни один тест её не читает — проверено по всему
// `tools/**.test.js`. Без этого исключения правка плана в каждом слайсе считалась бы «не
// разобрать» и уводила выборку в «гнать все» ВСЕГДА, то есть слой был бы мёртв. С 018/T004
// подпись живёт в истории, поэтому в дифф слайса она вообще больше не попадает.
const INERT_PATH = /^specs\//i;
const CODE = /\.(js|cjs|mjs)$/i;
const TEST = /\.test\.js$/i;
// Глубина транзитивности. ЗАМЕР 2026-07-31 на этом репо (63 тест-файла), выбранных файлов:
//   глубина 2 → select 1, red-proof 18, gate 49, elt 45, doctor-core 6
//   глубина 3 → 7 / 49 / 57 / 55 / 10
//   глубина 6 → 58 / 58 / 58 / 58 / 57  (вырождается в «гнать все»)
// Два шага покрывают «тест → модуль → изменённый файл» — дальше связность репо съедает выборку
// целиком, и слой перестаёт что-либо экономить.
// ponytail: константа, а не поле конфига. Цифру никто ещё не оспаривал, а аварийный выход из
// выборки уже есть и он крупнее — `oracleSelect: "all"`.
const MAX_ROUNDS = 2;

const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

function walkJs(dir, root, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(full, root, out);
    else if (CODE.test(e.name)) out.push(norm(path.relative(root, full)));
  }
  return out;
}

// Чем файл «зовётся» в чужом тексте: репо-путь целиком и имя без расширения. Имя даёт
// попадания и там, где путь написан иначе (`require('./judge-core')`, `'node tools/x.js'`).
function needlesFor(rel) {
  const base = path.basename(rel).replace(CODE, '');
  // Голое имя без ограничителя не годится: `elt` встречается в тексте почти каждого файла и
  // мгновенно вырождает выборку во «все». Берём имя с расширением (`elt.js`, так пишут пути
  // и команды) и имя, упирающееся в закрывающую кавычку (`require('./judge-core')`).
  return [rel, `${base}.js`, `${base}'`, `${base}"`, `${base}\``];
}

// Обратное замыкание: от изменённых файлов вверх по упоминаниям.
function dependents(changed, files, readFile) {
  const texts = new Map();
  const textOf = (rel) => {
    if (!texts.has(rel)) texts.set(rel, readFile(rel) || '');
    return texts.get(rel);
  };
  const affected = new Set(changed);
  let frontier = [...changed];
  for (let round = 0; round < MAX_ROUNDS && frontier.length; round += 1) {
    const needles = frontier.flatMap(needlesFor);
    const next = [];
    for (const candidate of files) {
      if (affected.has(candidate)) continue;
      const text = textOf(candidate);
      if (needles.some((n) => text.includes(n))) { affected.add(candidate); next.push(candidate); }
    }
    frontier = next;
  }
  return affected;
}

// Источник 2. Недоступен/пуст — не ошибка: причина уезжает в отчёт, решение принимает caller.
function codegraphAffected(root, changed) {
  const r = spawnSync('codegraph', ['affected', ...changed, '--json'],
    { cwd: root, encoding: 'utf8', timeout: 30000, shell: process.platform === 'win32' });
  if (r.error || r.status !== 0) return { files: [], reason: `codegraph недоступен (${r.error ? r.error.code : `exit ${r.status}`})` };
  try {
    const out = JSON.parse(r.stdout);
    const files = Array.isArray(out.affectedTests) ? out.affectedTests.map(norm) : [];
    return { files, reason: files.length ? '' : 'codegraph: affectedTests пуст (граф импортов не покрывает проект)' };
  } catch { return { files: [], reason: 'codegraph: ответ не разобран' }; }
}

// allTests — репо-относительные пути от discover(); changedFiles — из git.
function selectTests({ cwd, changedFiles = [], allTests = [], mode = 'all', useCodegraph = true, scanDirs = ['tools'] } = {}) {
  const all = allTests.map(norm);
  const every = (reason) => ({ files: all, mode: 'all', reason, selected: all.length, total: all.length });
  if (mode !== 'impact') return every(`oracleSelect=${mode || 'all'}`);

  const changed = changedFiles.map(norm).filter((f) => !INERT.test(f) && !INERT_PATH.test(f));
  if (!changed.length) return every('в диффе нет исполняемых файлов');
  // Файл, про который нечего рассуждать (конфиг, шелл-скрипт, бинарь), может влиять на любой
  // тест — такой слайс гоним целиком, а не угадываем.
  const opaque = changed.filter((f) => !CODE.test(f));
  if (opaque.length) return every(`не JS в диффе: ${opaque.slice(0, 3).join(', ')}`);

  const sources = scanDirs.flatMap((d) => walkJs(path.join(cwd, d), cwd));
  const readFile = (rel) => { try { return fs.readFileSync(path.join(cwd, rel), 'utf8'); } catch { return ''; } };
  const affected = dependents(changed, [...new Set([...sources, ...all])], readFile);
  const byScan = all.filter((t) => affected.has(t));

  const cg = useCodegraph ? codegraphAffected(cwd, changed) : { files: [], reason: 'codegraph отключён' };
  const picked = [...new Set([...byScan, ...cg.files.filter((f) => all.includes(f))])].sort();
  // Пусто — значит источники не разобрались, а не «работа ничего не задела»: гоним все.
  if (!picked.length) return every('impact-выборка пуста — источники ничего не разобрали');

  const note = cg.reason ? `; ${cg.reason}` : `; codegraph +${cg.files.length}`;
  return {
    files: picked,
    mode: 'impact',
    reason: `обратный скан: ${byScan.length}${note}`,
    selected: picked.length,
    total: all.length,
  };
}

module.exports = { selectTests, dependents, needlesFor, walkJs, INERT, INERT_PATH, TEST };
