'use strict';
// 019 T016 — контракт замерщика доли работы через харнес.
//
// Число из README обязано быть воспроизводимым, а метод — защищённым от двух конкретных
// способов соврать в свою пользу:
//   1. сверка ПО ВРЕМЕНИ вместо хеша: ручной коммит через минуту после прогона харнеса
//      попадал в окно и засчитывался;
//   2. пустой run-log читается как «харнес не работал», а не как «файла нет» — 0% в этих
//      двух случаях означает совершенно разное.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const kpi = require('./kpi-commit-share');

function repo() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-kpi-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('config', 'commit.gpgsign', 'false');
  return { cwd, git };
}

// Возвращает полный sha созданного коммита.
function commit(ctx, subject, file = 'f.txt') {
  fs.appendFileSync(path.join(ctx.cwd, file), `${subject}\n`);
  ctx.git('add', '-A');
  ctx.git('-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', subject);
  return ctx.git('rev-parse', 'HEAD').trim();
}

function writeRunLog(cwd, entries) {
  const dir = path.join(cwd, '.git', 'elt');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-log.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

test('строгая доля считается по хешу: коммит есть в run-log — засчитан', () => {
  const ctx = repo();
  const a = commit(ctx, 'feat: через харнес');
  commit(ctx, 'chore: руками');
  writeRunLog(ctx.cwd, [{ commit: a.slice(0, 7), msg: 'feat: через харнес' }]);

  const r = kpi.measure({ cwd: ctx.cwd });
  assert.equal(r.total, 2);
  assert.equal(r.strict.count, 1);
  assert.equal(r.strict.share, 50);
  assert.equal(r.bypassed.length, 1);
  assert.match(r.bypassed[0], /руками/);
});

// Дискриминирующий регресс: без него сверка могла бы засчитывать по времени, и тест был бы
// зелёным на обеих реализациях.
test('коммит, которого нет в run-log, не засчитывается — даже сделанный в том же окне', () => {
  const ctx = repo();
  commit(ctx, 'chore: руками один');
  commit(ctx, 'chore: руками два');
  writeRunLog(ctx.cwd, [{ commit: 'deadbee', msg: 'feat: совсем другой коммит' }]);

  const r = kpi.measure({ cwd: ctx.cwd });
  assert.equal(r.strict.count, 0, 'соседство по времени не является доказательством');
  assert.equal(r.strict.share, 0);
});

test('короткий хеш в run-log совпадает с полным из git log', () => {
  const ctx = repo();
  const a = commit(ctx, 'feat: короткий хеш');
  writeRunLog(ctx.cwd, [{ commit: a.slice(0, 7) }]);
  assert.equal(kpi.measure({ cwd: ctx.cwd }).strict.count, 1);

  // ...и обрывок короче семи символов совпадением НЕ считается: два разных коммита легко
  // делят шестизначный префикс.
  writeRunLog(ctx.cwd, [{ commit: a.slice(0, 4) }]);
  assert.equal(kpi.measure({ cwd: ctx.cwd }).strict.count, 0);
});

test('мягкая доля ловит коммит харнеса с переписанным хешем', () => {
  const ctx = repo();
  commit(ctx, 'feat: коммит харнеса, потом amend');
  writeRunLog(ctx.cwd, [{ commit: 'aaaaaaa', msg: 'feat: коммит харнеса, потом amend' }]);

  const r = kpi.measure({ cwd: ctx.cwd });
  assert.equal(r.strict.count, 0, 'по хешу — не совпало');
  assert.equal(r.soft.count, 1, 'по сообщению — тот же коммит, переписанный');
  assert.equal(r.bypassed.length, 0);
});

test('отсутствие run-log отличимо от нулевой доли', () => {
  const ctx = repo();
  commit(ctx, 'chore: один');
  const r = kpi.measure({ cwd: ctx.cwd });
  assert.equal(r.runLog.exists, false, 'файла нет — это состояние, а не результат замера');
  assert.equal(r.strict.count, 0);
  assert.match(kpi.formatText(r), /НЕТ ФАЙЛА/);
});

test('битая строка в run-log не роняет замер', () => {
  const ctx = repo();
  const a = commit(ctx, 'feat: живой');
  const dir = path.join(ctx.cwd, '.git', 'elt');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-log.jsonl'), `не json\n${JSON.stringify({ commit: a })}\n`, 'utf8');
  assert.equal(kpi.measure({ cwd: ctx.cwd }).strict.count, 1);
});

test('нормализация сообщения не склеивает разные коммиты', () => {
  assert.equal(kpi.normalizeMsg('feat:  Один   два '), kpi.normalizeMsg('feat: один два'));
  assert.notEqual(kpi.normalizeMsg('feat: один'), kpi.normalizeMsg('feat: два'));
});

test('сводный KPI суммирует числители и знаменатели, а не усредняет проценты', () => {
  const a = repo();
  const aHarness = commit(a, 'feat: a через харнес');
  commit(a, 'chore: a руками');
  writeRunLog(a.cwd, [{ commit: aHarness }]);

  const b = repo();
  const bHarness = commit(b, 'feat: b через харнес');
  writeRunLog(b.cwd, [{ commit: bHarness }]);

  const r = kpi.measureMany({ cwds: [a.cwd, b.cwd], days: 14 });
  assert.equal(r.total, 3);
  assert.deepEqual(r.strict, { count: 2, share: 66.7 });
  assert.equal(r.projects.length, 2);
  assert.match(kpi.formatAggregate(r), /2\/3 = 66\.7%/);
});

test('повторяемый --cwd включает сводный режим CLI', () => {
  const a = repo();
  const b = repo();
  commit(a, 'chore: a');
  commit(b, 'chore: b');
  const chunks = [];
  kpi.main(['--cwd', a.cwd, '--cwd', b.cwd, '--days', '14'], { write: (s) => chunks.push(s) });
  assert.match(chunks.join(''), /2 репо/);
});

test('--as-of делает историческое число воспроизводимым и ограничивает верхнюю дату', () => {
  const ctx = repo();
  commit(ctx, 'chore: сегодняшний коммит');
  const past = kpi.measure({ cwd: ctx.cwd, asOf: '2000-01-01' });
  assert.equal(past.total, 0, 'коммит после даты среза не попадает в историю');

  const future = kpi.measure({ cwd: ctx.cwd, asOf: '2099-01-01' });
  assert.equal(future.total, 0, 'скользящее окно не расширяется до всей истории');
  assert.equal(future.period.until, '2099-01-01');
});
