'use strict';
// 020 T010 — контракт канонического рантайма ревью.
//
// Проверяется ровно то, что делает рецепт рецептом, а не пожеланием:
//   1. пять линз идут ПАРАЛЛЕЛЬНО (доказывается перекрытием во времени, не замером);
//   2. оценщик зовётся РОВНО ОДИН раз на любое число находок;
//   3. мёртвая линза и мёртвый оценщик — видимы и НЕ зелёные;
//   4. `<80` уходит в журнал как `weak-signal`, `>=80` влияет на вердикт;
//   5. оценка оценщика перекрывает самооценку линзы.
// Транспорт инъектируется фикстурами: контракт обязан доказываться за миллисекунды.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const { runReview, parseLensFindings, REVIEW_TERMINAL } = require('./review-runtime');
const { LENS_NAMES } = require('./review-lenses');

const AGENTS = path.join(__dirname, '..', 'agents');
const roots = [];
after(() => { for (const r of roots) try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* windows lock */ } });
function tmp() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-review-rt-')); roots.push(d); return d; }

const finding = (over = {}) => ({
  file: 'tools/a.js', line: 7, summary: 'находка', failure_scenario: 'вход X → неверный Y', confidence: 50, ...over,
});
const okLens = (findings) => async () => ({ ok: true, text: JSON.stringify(findings) });
const okScorer = (scores) => async () => ({ ok: true, text: JSON.stringify(scores) });

test('T010: пять линз идут параллельно, а не по очереди', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const seen = [];
  const r = await runReview({
    lensesDir: AGENTS, diff: 'diff', taskText: 'T001 [files: tools/a.js]',
    runLens: async ({ lens }) => {
      seen.push(lens.name);
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((res) => setTimeout(res, 20));
      inFlight -= 1;
      return { ok: true, text: '[]' };
    },
    runScorer: okScorer([]),
  });
  assert.equal(maxInFlight, LENS_NAMES.length, 'все пять обязаны быть в полёте одновременно');
  assert.equal(seen.length, LENS_NAMES.length);
  assert.equal(r.status, REVIEW_TERMINAL.pass);
});

test('T010: оценщик зовётся РОВНО ОДИН раз на любое число находок', async () => {
  let scorerCalls = 0;
  const many = Array.from({ length: 7 }, (_, i) => finding({ line: i + 1 }));
  const r = await runReview({
    lensesDir: AGENTS, diff: 'diff',
    runLens: okLens(many),
    runScorer: async ({ prompt }) => {
      scorerCalls += 1;
      assert.match(prompt, /80/, 'отсечка обязана быть видима в промпте оценщика');
      return { ok: true, text: JSON.stringify(many.flatMap((_, i) => [{ index: i, confidence: 10, why: 'шум' }])) };
    },
  });
  assert.equal(scorerCalls, 1, 'один оценщик — иначе классификаций столько же, сколько вызовов');
  assert.equal(r.findings.length, many.length * LENS_NAMES.length);
});

test('T010: ноль находок — оценщик не зовётся, и это ОБЪЯВЛЕНО, а не подразумевается', async () => {
  let scorerCalls = 0;
  const r = await runReview({
    lensesDir: AGENTS, runLens: okLens([]), runScorer: async () => { scorerCalls += 1; return { ok: true, text: '[]' }; },
  });
  assert.equal(scorerCalls, 0);
  assert.equal(r.status, REVIEW_TERMINAL.pass);
  assert.equal(r.scorer.skipped, true);
  assert.match(r.scorer.reason, /находок нет/);
});

test('T010: мёртвая линза видна и НЕ зелёная', async () => {
  const r = await runReview({
    lensesDir: AGENTS,
    runLens: async ({ lens }) => (lens.name.includes('bugs')
      ? { ok: false, reason: 'CLI не ответил' }
      : { ok: true, text: '[]' }),
    runScorer: okScorer([]),
  });
  assert.equal(r.status, REVIEW_TERMINAL.dead);
  assert.notEqual(r.verdict, 'pass', 'вердикт четырёх линз не выдаётся за вердикт пяти');
  assert.match(r.reasons.join(' '), /CLI не ответил/);
  assert.equal(r.lenses.filter((l) => !l.ok).length, 1, 'мёртвая названа поимённо');
});

test('T010: нечитаемый ответ линзы — смерть, а не «ноль находок»', async () => {
  const garbage = await runReview({
    lensesDir: AGENTS, runLens: async () => ({ ok: true, text: 'я подумал и решил, что всё хорошо' }), runScorer: okScorer([]),
  });
  assert.equal(garbage.status, REVIEW_TERMINAL.dead, 'сломанный транспорт не смеет выглядеть чистым диффом');

  // Явный пустой массив — законный ноль находок, и он ДОЛЖЕН отличаться от мусора.
  assert.deepEqual(parseLensFindings('[]'), { ok: true, findings: [] });
  assert.equal(parseLensFindings('всё хорошо').ok, false);
  assert.equal(parseLensFindings('').ok, false);
});

test('T010: находка не по контракту — смерть линзы, а не тихий пропуск', async () => {
  const r = await runReview({
    lensesDir: AGENTS,
    runLens: okLens([{ file: 'a.js', summary: 'без строки и сценария' }]),
    runScorer: okScorer([]),
  });
  assert.equal(r.status, REVIEW_TERMINAL.dead);
  assert.match(r.reasons.join(' '), /не по контракту/);
});

test('T010: мёртвый оценщик — не зелёное, даже когда все линзы живы', async () => {
  const r = await runReview({
    lensesDir: AGENTS, runLens: okLens([finding()]), runScorer: async () => ({ ok: false, reason: 'таймаут' }),
  });
  assert.equal(r.status, REVIEW_TERMINAL.dead);
  assert.equal(r.scorer.ok, false);
  assert.match(r.reasons.join(' '), /таймаут/);

  const unreadable = await runReview({
    lensesDir: AGENTS, runLens: okLens([finding()]), runScorer: async () => ({ ok: true, text: 'ну, вроде норм' }),
  });
  assert.equal(unreadable.status, REVIEW_TERMINAL.dead, 'нечитаемая классификация — отсутствие классификации');
});

test('T010: >=80 блокирует, <80 уходит в журнал слабым сигналом', async () => {
  const cwd = tmp();
  const recorded = [];
  const r = await runReview({
    cwd, task: 'T001', lensesDir: AGENTS,
    // Одна находка на каждую из пяти линз: первая станет блокирующей, остальные — слабыми.
    runLens: okLens([finding()]),
    runScorer: async () => ({
      ok: true,
      text: JSON.stringify([
        { index: 0, confidence: 95, why: 'реальная дыра' },
        { index: 1, confidence: 79, why: 'на грани' },
        { index: 2, confidence: 10, why: 'шум' },
        { index: 3, confidence: 0, why: 'шум' },
        { index: 4, confidence: 50, why: 'непонятно' },
      ]),
    }),
    ledger: { record: (root, entry) => recorded.push(entry) },
  });
  assert.equal(r.verdict, 'block');
  assert.equal(r.status, REVIEW_TERMINAL.block);
  assert.equal(r.blocking.length, 1, '79 не блокирует — отсечка ровно 80');
  assert.equal(r.weak.length, 4);
  assert.equal(recorded.length, 4, 'каждый слабый сигнал уходит в журнал сам');
  assert.ok(recorded.every((e) => e.kind === 'weak-signal'));
  assert.ok(recorded.every((e) => e.rule.startsWith('review/')), 'правило именуется линзой — иначе сводку не по чему группировать');
  assert.ok(recorded.every((e) => e.task === 'T001'));
});

test('T010: оценка оценщика перекрывает самооценку линзы (в обе стороны)', async () => {
  const r = await runReview({
    lensesDir: AGENTS,
    runLens: okLens([finding({ confidence: 99 })]), // линза уверена в себе
    runScorer: okScorer(Array.from({ length: 5 }, (_, i) => ({ index: i, confidence: 5, why: 'ложное срабатывание' }))),
  });
  assert.equal(r.verdict, 'inconclusive', 'самооценка линзы не имеет права блокировать');
  assert.equal(r.blocking.length, 0);
  assert.ok(r.findings.every((f) => f.confidence === 5));

  const up = await runReview({
    lensesDir: AGENTS,
    runLens: okLens([finding({ confidence: 1 })]), // линза скромничает
    runScorer: okScorer(Array.from({ length: 5 }, (_, i) => ({ index: i, confidence: 90, why: 'реальная проблема' }))),
  });
  assert.equal(up.verdict, 'block');
});

test('T010: неполный набор линз — отказ, а не ревью «сколько нашлось»', async () => {
  const dir = tmp();
  fs.copyFileSync(path.join(AGENTS, 'review-bugs.md'), path.join(dir, 'review-bugs.md'));
  const r = await runReview({ lensesDir: dir, runLens: okLens([]), runScorer: okScorer([]) });
  assert.equal(r.status, REVIEW_TERMINAL.dead);
  // 024 T010: отказ называет, КАКИХ линз не хватает. Прежнее «ожидалось 5, найдено 1»
  // сообщало количество и умалчивало имена — читателю оставалось сверять каталог руками.
  assert.match(r.reasons.join(' '), /не хватает линз/);
  assert.match(r.reasons.join(' '), /review-claude-md/);
});

test('024 T010: ШЕСТАЯ линза не убивает судью — набор закрыт снизу, а не сверху', async () => {
  // Сверка была `lenses.length !== LENS_NAMES.length`, то есть лишняя линза давала ровно тот
  // же `dead`, что и недостача. Форк, добавивший собственную линзу, получал мёртвого судью
  // на КАЖДОМ слайсе: единственная объявленная точка расширения ломала харнес целиком.
  const dir = tmp();
  for (const f of fs.readdirSync(AGENTS).filter((x) => x.startsWith('review-') && x.endsWith('.md'))) {
    fs.copyFileSync(path.join(AGENTS, f), path.join(dir, f));
  }
  const sixth = fs.readFileSync(path.join(AGENTS, 'review-bugs.md'), 'utf8')
    .replace(/^name:\s*review-bugs\s*$/m, 'name: review-custom');
  fs.writeFileSync(path.join(dir, 'review-custom.md'), sixth);

  const r = await runReview({ lensesDir: dir, runLens: okLens([]), runScorer: okScorer([]) });
  assert.notEqual(r.status, REVIEW_TERMINAL.dead, `шестая линза не должна убивать ревью: ${r.reasons.join(' ')}`);
  assert.equal(r.lenses.length, 6, 'лишняя линза работает наравне, а не игнорируется');
});

test('T010: без транспорта рантайм отказывает, а не притворяется зелёным', async () => {
  const r = await runReview({ lensesDir: AGENTS });
  assert.equal(r.status, REVIEW_TERMINAL.dead);
  assert.match(r.reasons.join(' '), /транспорт/);
});

test('T010: промпт линзы называет шкалу 0-100 явно', () => {
  const { lensPrompt } = require('./review-runtime');
  const p = lensPrompt({ name: 'review-bugs', description: 'd' }, { diff: 'd', taskText: 't' });
  // Живой прогон вернул `confidence: 0.99` — валидное число в 0..100, которое тихо становилось
  // слабым сигналом. Шкала обязана быть названа, иначе блокирование теряется на ровном месте.
  assert.match(p, /0–100/);
  assert.match(p, /не 0–1/);
});
