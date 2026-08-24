'use strict';
// 020 T016 — батч как ПЕРВОКЛАССНАЯ единица посадки и repair-поколения.
//
// До этой задачи батч был строкой `"T001,T002"` в argv: у него не было ни идентичности, ни
// состояния, ни способа быть починенным. Живой отказ, ради которого написан файл: фоновой
// вердикт по `b6cd3b4` пришёл красным ПОСЛЕ того, как `elt commit` уже проставил `[X]`, и
// починить батч стало физически нечем — `elt commit --task T001,T007` отвечает «задача не
// найдена среди открытых [ ]». Обходы (снять галочку, закоммитить мимо elt) — подделка
// состояния и нарушение правил репо, поэтому маршрут один: repair-поколение того же батча.
//
// Здесь живёт ТОЛЬКО чистая часть: планирование и идентичность. Состояние поколений
// (`.git/elt/batch-state.json`) и сам коммит — в `tools/elt.js`: файл без git и без fs-записи
// тестируется на порядок дешевле, а планировщик обязан быть детерминированным.

const crypto = require('crypto');

// Батч по умолчанию 3, потолок 4 (решение спеки). Не «сколько влезет»: судья читает ОДИН
// дифф на батч, и с ростом задач в нём падает не скорость, а качество вердикта.
const DEFAULT_BATCH = 3;
const MAX_BATCH = 4;

function fail(reason, detail) { return { ok: false, reason, detail }; }

// Идентичность батча = (спека, упорядоченный список id, база). База входит намеренно: тот же
// список задач от другого коммита — ДРУГОЙ батч, и proof первого к нему не относится.
function batchIdOf({ specPath, taskIds, baseHead }) {
  return crypto.createHash('sha256')
    .update(`${specPath}\n${taskIds.join(',')}\n${baseHead}`)
    .digest('hex').slice(0, 16);
}

// Зоны задач пересекаются → батч отвергается. Причина не в конфликте git, а в вердикте:
// когда две задачи правят один файл, ни судья, ни человек не могут сказать, какая из них
// внесла найденное нарушение, и красное поколение чинится вслепую.
// Разбор `[files: ...]` здесь СВОЙ, а не импорт из elt-gate-l0.js, по двум причинам.
// 1) Замыкание: планировщик зовётся на каждом коммите, а L0 тянет за собой harness-files и
//    дальше — чужой чекаут с урезанным набором файлов падал бы `Cannot find module` на ровном
//    месте (поймано оракулом живьём на elt-gate.test.js).
// 2) Контракт другой: `taskScopeFiles` режет только по ЗАПЯТЫМ, а планы этого репо пишут зоны
//    через пробел, поэтому оттуда приходит одна строка «tools/a.js tools/b.js». Та же
//    особенность делает L0-триггер зоны в таких планах бесполезным (глоб с пробелом не
//    совпадает ни с одним путём) — это отдельный дефект L0, он вне [files:] этой задачи и
//    записан в реестр, а не починен здесь мимоходом.
function zonesOf(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/\[files:([^\]]+)\]/g)) {
    for (const part of m[1].split(/[\s,]+/)) {
      const g = part.trim();
      if (g && !out.includes(g)) out.push(g);
    }
  }
  return out;
}
function zoneCollision(items) {
  const seen = new Map();
  for (const it of items) {
    for (const g of zonesOf(it.text)) {
      if (seen.has(g) && seen.get(g) !== it.id) return { glob: g, a: seen.get(g), b: it.id };
      seen.set(g, it.id);
    }
  }
  return null;
}

/**
 * planBatch — единственный авторитет по составу батча. `--task T001,T002` остаётся фасадом:
 * argv лишь называет id, а законность состава решается здесь.
 *
 * items: [{ id, text, specPath, done }] в порядке ФАЙЛА плана (порядок — часть идентичности).
 */
function planBatch({ items, baseHead, max = DEFAULT_BATCH, hardMax = MAX_BATCH, repair = false }) {
  if (!Array.isArray(items) || !items.length) return fail('empty', 'батч без задач');
  if (items.length > hardMax) return fail('too-many', `${items.length} задач при потолке ${hardMax}`);
  if (items.length > max && !repair) return fail('too-many', `${items.length} задач при батче ${max} (потолок ${hardMax} — только с явным --batch)`);

  const specs = [...new Set(items.map((i) => i.specPath))];
  if (specs.length !== 1 || !specs[0]) {
    return fail('multi-spec', `батч обязан жить в ОДНОЙ утверждённой спеке: ${specs.join(', ') || 'спека не определена'}`);
  }
  const ids = items.map((i) => i.id);
  if (new Set(ids).size !== ids.length) return fail('duplicate-task', ids.join(','));

  // Обычная посадка требует ОТКРЫТЫХ задач; repair-поколение — наоборот, закрытых: оно чинит
  // уже посаженный батч, а не сажает новый.
  const closed = items.filter((i) => i.done).map((i) => i.id);
  const open = items.filter((i) => !i.done).map((i) => i.id);
  if (!repair && closed.length) return fail('closed-task', `уже закрыты: ${closed.join(',')}`);
  if (repair && open.length) return fail('not-landed', `ещё не посажены: ${open.join(',')} — repair чинит посаженный батч`);

  const collision = zoneCollision(items);
  if (collision) return fail('zone-collision', `${collision.glob} заявлен и в ${collision.a}, и в ${collision.b}`);

  return {
    ok: true,
    specPath: specs[0],
    taskIdentities: items.map((i) => ({ specPath: i.specPath, id: i.id })),
    taskIds: ids,
    batchId: batchIdOf({ specPath: specs[0], taskIds: ids, baseHead }),
    zones: items.flatMap((i) => zonesOf(i.text)),
  };
}

module.exports = { planBatch, batchIdOf, zoneCollision, zonesOf, DEFAULT_BATCH, MAX_BATCH };
