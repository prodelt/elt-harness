'use strict';
// 019 T001 — ЕДИНЫЙ ответ на вопрос «этот файл написал человек или его написал сам харнес?».
//
// До этого модуля ответ был размазан по двум копиям, которые разошлись: `elt-gate-l0.js`
// (зона слайса) и `judge-core.js` (нормализация worktree) держали по своему `isHarnessOwned`,
// а мерка diff-size и промпт судьи не знали про владение вовсе. Именно расхождение копий —
// корень трёх дефектов реестра:
//   D9  — `package-lock.json` считался в diff-size (694 строки при пороге 400), а перечислить
//         его в `[files:]` нельзя: он генерируется всегда.
//   D15 — файл, который харнес пишет сам (`approval.json` тогда, `review-queue.jsonl` сейчас),
//         объявлялся нарушением зоны.
//   D19 — судья считал scope creep'ом ровно те файлы, которые гейт уже признал своими:
//         знание о владении жило в гейте и не доезжало до судьи.
//
// Поэтому здесь ДВЕ разные категории, а не одна:
//   `isHarnessOwned` — файлы, которые пишет сам харнес. Их правка не может быть нарушением
//                      зоны, потому что слайс её не делал.
//   `isGenerated`    — файлы, которые пишет инструмент (lock-файлы, кеши). Их содержание не
//                      ревьюируется и не считается в объёме диффа.
// Объединение — `isIgnoredForReview`: то, о чём вердикт не выносится ни при каких условиях.
//
// Файл — ЛИСТ замыкания (никаких require), потому что входит в deploy-копию судьи вместе с
// `elt-gate-l0.js`: любой его импорт пришлось бы тащить в каждое место, куда едет судья.

const norm = (rel) => String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '');

// Пишет САМ харнес: [X]-марку в tasks.md ставит оркестратор после merge, всё остальное —
// состояние прогонов. Слайс их не выбирал, судить тут нечего.
// ГРАНИЦА, которую нельзя размывать: конфиг гейта — НЕ владение харнеса. `.harness/harness.json`
// задаёт сами правила проверки (redProof, hotPaths, пороги L0), и слайс, который его ослабляет,
// обязан получать полновесный block. Поймано судьёй на батче A 2026-08-23: пока весь `.harness/`
// считался владением, барьерный слайс с `[files: .harness/harness.json]` мог выключить redProof
// и уехать в коммит с пометкой `inconclusive` вместо остановки.
const HARNESS_CONFIG = [
  '.harness/harness.json',
  '.harness/fleet/fleet.json',
];

const HARNESS_OWNED = [
  'tasks.md',                    // марка закрытия задачи
  '.harness/loop-logs',          // логи прогонов
  '.harness/review-queue.jsonl', // очередь разбора
  '.harness/learnings.jsonl',
  '.git/elt',                    // run-log.jsonl, judge-desc.json, proof
  '.fleet-wt',                   // рабочие worktree фона
  'review-queue.jsonl',
  'learnings.jsonl',
  'run-log.jsonl',
  // Ретро-разметка bench: дописывается прогоном `judge-bench`, а не слайсом.
  'tools/judge-bench/cases-ingested.json',
];

// Владения, у которых имя не фиксированное. Держим отдельным списком регулярок, а не
// самодельным глоб-матчером: список короткий и обязан читаться глазами.
// `.planning/CHECKPOINT-<стамп>-auto.md` пишет `checkpoint-writer.js` по токен-порогу, в любой
// момент сессии. Слайс его не выбирал — см. комментарий в `checkpoint-writer.js` (gateActive):
// во время цепочки гейта запись глушится маркером, но чекпоинт, написанный ДО старта цепочки,
// всё равно попадает в дифф слайса, и судья ловил его как scope creep.
const HARNESS_OWNED_PATTERNS = [
  /(^|\/)\.planning\/CHECKPOINT-[^/]*-auto\.md$/,
];

// Пишет инструмент, а не человек. Ревьюировать содержание бессмысленно, считать строки — вредно.
const GENERATED = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'node_modules',
  '.codegraph',
];

function matches(rel, list) {
  const p = norm(rel);
  return list.some((entry) => p === entry
    || p.endsWith(`/${entry}`)
    || p.startsWith(`${entry}/`)
    || p.includes(`/${entry}/`));
}

// Конфиг гейта проверяется ПЕРВЫМ и выигрывает: даже если он лежит внутри `.harness/`,
// владением харнеса он не становится.
function isHarnessConfig(rel) {
  return matches(rel, HARNESS_CONFIG);
}

function isHarnessOwned(rel) {
  if (isHarnessConfig(rel)) return false;
  if (matches(rel, HARNESS_OWNED)) return true;
  const p = norm(rel);
  return HARNESS_OWNED_PATTERNS.some((re) => re.test(p));
}

function isGenerated(rel) {
  return matches(rel, GENERATED);
}

// Что воркер не имел права трогать вовсе: состояние прогона И конфиг гейта. Используется
// откатом worktree (`normalizeWorktree`) — там вопрос другой, чем у судьи: не «судить ли
// этот файл», а «мог ли его писать воркер». Конфиг гейта не мог: правило проверки меняет
// человек в своём слайсе, а не агент по дороге.
function isHarnessManaged(rel) {
  return isHarnessOwned(rel) || isHarnessConfig(rel);
}

// Единственная граница, которую должны звать и гейт, и мерка объёма, и промпт судьи.
function isIgnoredForReview(rel) {
  if (isHarnessConfig(rel)) return false;
  return isHarnessOwned(rel) || isGenerated(rel);
}

module.exports = {
  isHarnessOwned, isGenerated, isIgnoredForReview, isHarnessConfig, isHarnessManaged,
  HARNESS_OWNED, GENERATED, HARNESS_CONFIG, HARNESS_OWNED_PATTERNS,
};
