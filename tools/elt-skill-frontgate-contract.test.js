#!/usr/bin/env node
'use strict';
// Контракт `/elt` — единственной инструкции, которую агент читает ПЕРЕД работой.
//
// 020 T011 переадресовал файл. До этого он читал `os.homedir()/.claude/skills/elt/SKILL.md` —
// легаси-развёртку, замороженную на версии 4.0.0. С v5 скил поставляется плагином из
// `skills/elt/SKILL.md`, и домашняя копия больше не обновляется (`sync-bin.js` снят спекой
// 019 T015). Проверка была ложно-зелёной дважды: она стерегла файл, который плагин не
// поставляет, и падала на любой машине без домашнего каталога разработчика — включая обе
// машины CI. Ниже проверяется РЕПОЗИТОРНАЯ копия, поэтому файл герметичен.
//
// Что стерегут утверждения: если из инструкции пропадает маршрут, снаружи его не существует —
// агент пойдёт мимо гейта, а не «догадается».
//
// Граница задачи. Старый контракт требовал ещё двенадцать механизмов (`elt brief`, `elt review`,
// `l0-clean`, `verify:"background"`, `committed-speculative`, `bg-red`, `bg-silent`,
// `backgroundTimeoutMin`, `health.jsonl`, `grill-me`, `elt spec lint`, Mermaid-схему). В рантайме
// они живы — их потерял сам текст v5, и возвращает их T012/T015 (RC от 2026-08-24, пункт 3).
// Дописывать их сюда авансом нельзя: тест стал бы красным на задаче, которая его не трогает.
// Здесь закреплено ровно то, что маршрут v5 обещает сегодня.

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'skills', 'elt', 'SKILL.md');
const TEXT = fs.readFileSync(SOURCE_PATH, 'utf8');

test('скил поставляется репозиторием, а не домашним каталогом', () => {
  assert.ok(fs.existsSync(SOURCE_PATH), `не найден ${SOURCE_PATH}`);
  // Домашняя копия упоминается ровно один раз и только как СНЯТАЯ — в таблице замен. Если
  // она вернётся в маршрут (в цепочку гейта или в режимы), агент снова начнёт править файл,
  // который плагин не поставляет: ровно так и разошлись три копии инструкций (019 T013).
  const route = TEXT.split('## Что снято и чем заменено')[0];
  assert.doesNotMatch(route, /~[/\\]\.claude[/\\]bin/, 'снятая deploy-копия не смеет быть маршрутом');
});

test('frontmatter: name elt и версия, совпадающая с plugin.json', () => {
  assert.match(TEXT, /^---[\s\S]*?name:\s*elt\b[\s\S]*?---/m);
  const version = /^version:\s*(\S+)\s*$/m.exec(TEXT);
  assert.ok(version, 'версия скила объявлена');
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(version[1], plugin.version, 'версия скила и версия плагина расходиться не могут');
});

test('названы все четыре входа плагина', () => {
  for (const entry of ['/elt', '/elt-verify', '/elt-defects', '/elt-doctor']) {
    assert.ok(TEXT.includes(entry), `вход ${entry} не назван — снаружи его нет`);
  }
});

// --- цепочка гейта ---------------------------------------------------------------------
// Три команды одним заходом и `--skip-oracle` в коммите — не стиль, а условие прохождения:
// любая запись в дерево между шагами даёт `stale-tree`, перегон оракула внутри коммита —
// `stale-oracle`. Оба класса стоили полных прогонов оракула (см. реестр дефектов).

test('цепочка гейта: три команды, --skip-oracle в коммите, названы оба stale-класса', () => {
  assert.match(TEXT, /elt\.js" oracle --full/, 'шаг оракула');
  assert.match(TEXT, /elt\.js" judge run --task/, 'шаг судьи');
  assert.match(TEXT, /elt\.js" commit --task/, 'шаг коммита');
  assert.match(TEXT, /--skip-oracle/, 'коммит в цепочке всегда со --skip-oracle');
  assert.match(TEXT, /stale-tree/);
  assert.match(TEXT, /stale-oracle/);
  assert.match(TEXT, /\$\{CLAUDE_PLUGIN_ROOT\}/, 'пути к рантайму — от корня плагина, не абсолютные');
});

test('батч: один план, и правка вне задач батча выносится отдельным слайсом', () => {
  assert.match(TEXT, /--task T001,T002,T003|--task\s+T\d+,T\d+/, 'форма батча показана');
  assert.match(TEXT, /scope creep/i, 'назван механизм, которым судья ловит чужую правку');
  assert.match(TEXT, /отдельным слайсом/i);
});

// --- вердикты --------------------------------------------------------------------------
// Три исхода, не два. Пока третий не назван, агент перезапускает судью по `inconclusive` —
// ровно это и чинила спека 011 T011.

test('описаны ТРИ исхода судьи, включая inconclusive без второго раунда', () => {
  for (const verdict of ['pass', 'block', 'inconclusive']) {
    assert.ok(TEXT.includes(verdict), `исход ${verdict} назван`);
  }
  assert.match(TEXT, /review-queue\.jsonl/, 'названо, куда уходит причина inconclusive');
  assert.match(TEXT, /[Вв]торого раунда судьи нет/, 'сказано, что судью не перезапускают');
});

test('ровно один судья, и писатель не судит свою работу', () => {
  assert.match(TEXT, /[Рр]овно один/, 'судья один');
  assert.match(TEXT, /[Пп]исатель не судит свою работу/);
});

test('ссылок на снятые флаги люка самозаверения не осталось', () => {
  assert.doesNotMatch(TEXT, /--skip-attest/, 'флаг удалён из CLI (011 T011)');
  assert.doesNotMatch(TEXT, /--attested-by/, 'то же для второго флага люка');
});

test('красный оракул: максимум две попытки, тесты не ослаблять', () => {
  assert.match(TEXT, /две узкие попытки/);
  assert.match(TEXT, /[Тт]есты не удалять и не\s+ослаблять/);
});

// --- ревью пятью линзами ----------------------------------------------------------------

test('ревью: пять линз параллельно, оценщик после них, отсечка 80', () => {
  assert.match(TEXT, /ПАРАЛЛЕЛЬНО/, 'линзы не последовательные');
  assert.match(TEXT, /confidence-scorer\.md/);
  assert.match(TEXT, /отсечка 80/);
  assert.match(TEXT, /[Пп]орядок обязателен/, 'сказано, ПОЧЕМУ оценщик идёт после, а не до');
});

// --- владения харнеса --------------------------------------------------------------------
// Второй список владений — это дефекты D9/D15/D19. Инструкция обязана называть единственный.

test('владения харнеса: один список, названо имя функции', () => {
  assert.match(TEXT, /tools\/harness-files\.js/);
  assert.match(TEXT, /isHarnessOwned/);
  assert.match(TEXT, /[Вв]торого списка заводить нельзя/);
});

// --- подпись спеки -----------------------------------------------------------------------

test('подпись спеки живёт в трейлерах коммита, а не в файле', () => {
  assert.match(TEXT, /Spec-Approved:/);
  assert.match(TEXT, /трейлер/i);
  assert.match(TEXT, /approval\.json/, 'сказано, что снято именно оно — иначе агент будет его искать');
  assert.match(TEXT, /elt spec approve/);
});

// --- снятые пути --------------------------------------------------------------------------

test('снятые пути названы поимённо и сказано, чем заменены', () => {
  for (const gone of ['tools/fleet/**', 'sync-bin.js', 'sync-agent-surface.js', 'judge.verify', 'harness-runner', '/pipeline']) {
    assert.ok(TEXT.includes(gone), `снятый путь ${gone} не назван — агент попробует его позвать`);
  }
  assert.match(TEXT, /код(ом)? 64/, 'назван код выхода shim-ов');
});

// --- замыкание -----------------------------------------------------------------------------
// Инструкция ссылается на файлы. Ссылка на несуществующий файл — это тупик посреди маршрута,
// и заметить его иначе нечем: markdown никто не компилирует.

test('каждый файл репозитория, названный инструкцией, существует', () => {
  // Разбор идёт по всему тексту, а не только по backtick-ам: команды цепочки живут в
  // fenced-блоке, где backtick-ов нет. Глобы (`agents/review-*.md`) и плейсхолдеры
  // (`specs/NNN-name/spec.md`) отбрасываются — они не путь. `json` в альтернативе стоит перед
  // `js`, иначе `cases-ingested.json` обрезается до несуществующего `.js`.
  const referenced = new Set();
  for (const m of TEXT.matchAll(/(?:tools|bin|agents|commands|skills|specs)\/[A-Za-z0-9._\-/]+\.(?:json|js|md)/g)) {
    if (m[0].includes('*') || m[0].includes('NNN')) continue;
    referenced.add(m[0]);
  }
  assert.ok(referenced.size >= 5, `в инструкции найдено слишком мало ссылок (${referenced.size}) — разбор сломался`);
  const missing = [...referenced].filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
  assert.deepEqual(missing, [], 'инструкция ведёт в несуществующие файлы');
});
