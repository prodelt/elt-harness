'use strict';
// 020 T010 — КАНОНИЧЕСКИЙ рантайм ревью пятью линзами.
//
// Что было до этой задачи (проверено grep'ом по tools/ и bin/): пять `agents/review-*.md` и
// `agents/confidence-scorer.md` НЕ запускались из кода ни разу. `bin/doctor.js` проверял, что
// файлы существуют; `commands/elt-verify.md` был инструкцией в прозе для агента — «запусти
// пять субагентов одним блоком». То есть официальный рецепт жил только в тексте, и выполнялся
// ровно настолько, насколько его в этот раз прочитал агент. `tools/review-lenses.js` и
// `tools/review-confidence.js` (019 T003/T004) — чистые куски этого рецепта, у которых не было
// того, кто их соединит.
//
// Здесь и есть соединение. Модуль намеренно НЕ знает, чем ходить к модели: транспорт
// инъектируется (`runLens`, `runScorer`). Причина не в чистоте, а в проверяемости: контракт
// (параллельность, ровно один вызов оценщика, отказ на мёртвой линзе) обязан доказываться
// фикстурами за миллисекунды, а не живым прогоном за десять минут. Живой прогон доказывает
// другое — что транспорт вообще работает, — и делается отдельно.
//
// Порядок обязателен: линзы НЕ должны знать оценок друг друга, иначе они сговариваются на
// общем ложном срабатывании (официальный рецепт, `commands/elt-verify.md`).

const { loadLenses, LENS_NAMES, validateFinding } = require('./review-lenses');
const { scorerPrompt, parseJsonArray, classify, verdictFrom, CUTOFF } = require('./review-confidence');

// Терминальные состояния рантайма. `dead` — отдельное состояние, а НЕ «почти pass»: линза,
// которая не отработала, не видела диффа, и вердикт без неё — вердикт четырёх линз, выданный
// за вердикт пяти. Ровно та подмена, которую 020 T007 закрыл для фона.
const REVIEW_TERMINAL = { pass: 'review-pass', block: 'review-block', inconclusive: 'review-inconclusive', dead: 'review-dead' };

function lensPrompt(lens, { diff = '', taskText = '', body = '' }) {
  return [
    `# Линза ревью: ${lens.name}`,
    '',
    lens.description || '',
    '',
    body,
    '',
    '## Задача слайса',
    taskText || '(текст задачи не передан)',
    '',
    '## Дифф',
    '```diff',
    diff,
    '```',
    '',
    '## Формат ответа',
    'Верни ТОЛЬКО JSON-массив находок ОДНОЙ строкой. Каждая находка:',
    '{"file":"path","line":1,"summary":"...","failure_scenario":"конкретные входные данные → неверный результат","confidence":0}',
    // Живой прогон 25.08: модель ответила `confidence: 0.99`, то есть по шкале 0–1. Формально
    // это валидное число в диапазоне 0–100, и находка тихо становилась слабым сигналом.
    // Шкалу называем явно — умолчание здесь стоило бы пропущенного блокирования.
    '`confidence` — ЦЕЛОЕ число по шкале 0–100 (не 0–1): 0–74 сомнение, 75–100 реальная проблема.',
    'Находок нет — верни [].',
  ].join('\n');
}

// Разбор ответа линзы. Мусор — не «ноль находок»: линза, чей ответ нечитаем, считается мёртвой.
// Пустой массив и нечитаемый ответ различаются намеренно, иначе сломанный транспорт выглядел
// бы как чистый дифф.
function parseLensFindings(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return { ok: false, reason: 'пустой ответ линзы' };
  const arr = parseJsonArray(t);
  if (!Array.isArray(arr)) return { ok: false, reason: 'ответ линзы не JSON-массив' };
  // Пустой массив законен только когда он реально был в ответе.
  if (!arr.length && !/\[\s*\]/.test(t)) return { ok: false, reason: 'ответ линзы не содержит JSON-массива' };
  const findings = [];
  for (const raw of arr) {
    const f = { confidence: 0, ...(raw && typeof raw === 'object' ? raw : {}) };
    try { validateFinding(f); } catch (e) { return { ok: false, reason: `находка не по контракту: ${e.message}` }; }
    findings.push(f);
  }
  return { ok: true, findings };
}

/**
 * runReview — единственный путь ревью пятью линзами.
 *
 * Транспорт инъектируется:
 *   runLens({ lens, prompt })   → { ok, text, reason? }
 *   runScorer({ prompt })       → { ok, text, reason? }
 * Журнал слабых сигналов — тоже инъекция (`ledger.record`), чтобы модуль не тащил bin/.
 */
async function runReview({
  cwd = process.cwd(), diff = '', taskText = '', task = '',
  lensesDir, runLens, runScorer, ledger = null, readBody = null,
} = {}) {
  if (typeof runLens !== 'function' || typeof runScorer !== 'function') {
    return { status: REVIEW_TERMINAL.dead, verdict: 'dead', reasons: ['транспорт ревью не задан'], lenses: [], scorer: { ok: false, reason: 'нет транспорта' } };
  }

  let lenses;
  try { lenses = loadLenses(lensesDir); } catch (e) {
    return { status: REVIEW_TERMINAL.dead, verdict: 'dead', reasons: [`линзы не загрузились: ${e.message}`], lenses: [], scorer: { ok: false, reason: 'линзы не загрузились' } };
  }
  // Набор линз закрыт. Не «хотя бы пять» и не «сколько нашлось»: рецепт называет ровно эти
  // пять, и любая недостача — это ревью, которое чего-то не смотрело, но выглядит полным.
  if (lenses.length !== LENS_NAMES.length) {
    return {
      status: REVIEW_TERMINAL.dead, verdict: 'dead', lenses: [],
      reasons: [`ожидалось ${LENS_NAMES.length} линз, найдено ${lenses.length}`],
      scorer: { ok: false, reason: 'набор линз неполон' },
    };
  }

  // ПАРАЛЛЕЛЬНО. Последовательный запуск не только медленнее — он даёт линзам возможность
  // видеть контекст друг друга через общий файл/лог, а рецепт этого прямо не хочет.
  const results = await Promise.all(lenses.map(async (lens) => {
    const prompt = lensPrompt(lens, { diff, taskText, body: readBody ? readBody(lens) : '' });
    let r;
    try { r = await runLens({ lens, prompt }); } catch (e) { r = { ok: false, reason: `линза упала: ${e.message}` }; }
    if (!r || r.ok === false) return { name: lens.name, ok: false, reason: (r && r.reason) || 'линза не отработала', findings: [] };
    const parsed = parseLensFindings(r.text);
    if (!parsed.ok) return { name: lens.name, ok: false, reason: parsed.reason, findings: [] };
    return { name: lens.name, ok: true, reason: null, findings: parsed.findings.map((f) => ({ ...f, lens: lens.name })) };
  }));

  const dead = results.filter((r) => !r.ok);
  if (dead.length) {
    return {
      status: REVIEW_TERMINAL.dead, verdict: 'dead', lenses: results,
      reasons: dead.map((d) => `линза ${d.name}: ${d.reason}`),
      scorer: { ok: false, reason: 'оценщик не звался — набор находок неполон' },
    };
  }

  const findings = results.flatMap((r) => r.findings);

  // Оценщик зовётся РОВНО ОДИН раз и только когда есть что оценивать. Ноль находок от пяти
  // живых линз — законный pass, и звать модель, чтобы она подтвердила пустоту, значит платить
  // за ритуал. Пропуск объявлен в отчёте, а не подразумевается.
  if (!findings.length) {
    return {
      status: REVIEW_TERMINAL.pass, verdict: 'pass', findings: [], blocking: [], weak: [], ignored: [],
      lenses: results, reasons: [], scorer: { ok: true, skipped: true, reason: 'находок нет — классифицировать нечего' },
    };
  }

  let scored;
  try { scored = await runScorer({ prompt: scorerPrompt(findings, { diff, taskText }) }); }
  catch (e) { scored = { ok: false, reason: `оценщик упал: ${e.message}` }; }
  if (!scored || scored.ok === false) {
    return {
      status: REVIEW_TERMINAL.dead, verdict: 'dead', findings, lenses: results,
      reasons: [`оценщик не отработал: ${(scored && scored.reason) || 'без причины'}`],
      scorer: { ok: false, reason: (scored && scored.reason) || 'оценщик не отработал' },
    };
  }
  const scores = parseJsonArray(scored.text);
  if (!Array.isArray(scores) || !scores.length) {
    return {
      status: REVIEW_TERMINAL.dead, verdict: 'dead', findings, lenses: results,
      reasons: ['ответ оценщика нечитаем — классификации нет'],
      scorer: { ok: false, reason: 'ответ оценщика нечитаем' },
    };
  }

  // Оценка оценщика ПЕРЕКРЫВАЕТ самооценку линзы: линза заинтересована в своей находке, а
  // отсечка 80 — единственное, что отделяет реальное блокирование от шума 1:7.
  const byIndex = new Map();
  for (const s of scores) {
    if (s && typeof s === 'object' && Number.isFinite(Number(s.index))) byIndex.set(Number(s.index), s);
  }
  const rescored = findings.map((f, i) => {
    const s = byIndex.get(i);
    return s && Number.isFinite(Number(s.confidence))
      ? { ...f, confidence: Number(s.confidence), why: s.why || '' }
      : { ...f, confidence: f.confidence, why: 'оценщик не назвал эту находку' };
  });

  const classified = classify(rescored);
  const verdict = verdictFrom(classified);

  // `<80` уходит в журнал сам. Смысл журнала — эволюция правил: слабый сигнал, повторившийся
  // пять раз, перестаёт быть шумом и становится задачей (bin/ledger.js, порог THRESHOLD).
  if (ledger && typeof ledger.record === 'function') {
    for (const w of classified.weak) {
      try {
        ledger.record(cwd, {
          kind: 'weak-signal',
          rule: `review/${w.lens || 'unknown'}`,
          note: `${w.file}:${w.line} ${w.summary}`.slice(0, 300),
          task: task || '',
        });
      } catch { /* журнал не гейт: его отказ не смеет менять вердикт ревью */ }
    }
  }

  return {
    status: verdict === 'block' ? REVIEW_TERMINAL.block
      : verdict === 'inconclusive' ? REVIEW_TERMINAL.inconclusive : REVIEW_TERMINAL.pass,
    verdict,
    findings: rescored,
    blocking: classified.blocking,
    weak: classified.weak,
    ignored: classified.ignored,
    lenses: results,
    scorer: { ok: true, skipped: false, scored: scores.length },
    reasons: classified.blocking.map((b) => `${b.lens || 'lens'} ${b.file}:${b.line} — ${b.summary} (${b.confidence})`),
    cutoff: CUTOFF,
  };
}

module.exports = { runReview, lensPrompt, parseLensFindings, REVIEW_TERMINAL };
