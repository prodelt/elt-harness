// T001 (spec 010): отчёт разведки D0 — механический ассерт на структуру, не на содержание.
// Смысл: решение «smoke в 010 или спека 011» принимается по числу N, объявленному ДО разведки,
// поэтому отчёт обязан быть парсимым, а не прозой, в которой N теряется.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPORT = path.join(__dirname, '..', '.planning', 'D0-smoke-feasibility.md');
const REGRESSIONS = ['ocr missing', 'перестало считать токены', 'визиком не участвует'];

test('D0-отчёт существует и разбирает все три регресса', () => {
  assert.ok(fs.existsSync(REPORT), 'нет .planning/D0-smoke-feasibility.md');
  const md = fs.readFileSync(REPORT, 'utf8');
  const sections = md.split(/^## Регресс /m).slice(1);
  assert.strictEqual(sections.length, 3, `ожидалось 3 секции «## Регресс», найдено ${sections.length}`);
  for (const s of REGRESSIONS) {
    assert.ok(md.includes(s), `в отчёте нет регресса «${s}»`);
  }
  // каждая секция обязана нести вердикт и обоснование — иначе это не разведка, а мнение
  for (const [i, sec] of sections.entries()) {
    assert.match(sec, /\*\*Вердикт: (ДА|НЕТ)/, `секция ${i + 1}: нет строки «**Вердикт: ДА/НЕТ»`);
    assert.match(sec, /\*\*Причина/, `секция ${i + 1}: нет «**Причина»`);
  }
});

test('итоговое N парсится и согласовано с вердиктами секций', () => {
  const md = fs.readFileSync(REPORT, 'utf8');
  const m = md.match(/\*\*Итог: N=(\d)\*\*/);
  assert.ok(m, 'нет строки «**Итог: N=<цифра>**»');
  const n = Number(m[1]);
  assert.ok(n >= 0 && n <= 3, `N=${n} вне диапазона 0..3`);
  const yes = (md.match(/\*\*Вердикт: ДА/g) || []).length;
  assert.strictEqual(n, yes, `итог N=${n} расходится с числом вердиктов ДА (${yes})`);
});

// Судья заблокировал первую версию за то, что вердикт «ДА» не был доказан — только описан
// прозой. Эти два теста проверяют не форму отчёта, а содержание сохранённых живых артефактов:
// они обязаны показывать РЕАЛЬНУЮ разницу pre-fix/post-fix, а не произвольный JSON.
test('регресс 2: сохранённый живой ответ Gemini реально показывает 0 → >0 токенов', () => {
  const p = path.join(__dirname, '..', '.planning', 'D0-regression2-live-response.json');
  assert.ok(fs.existsSync(p), 'нет .planning/D0-regression2-live-response.json (живой ответ Gemini)');
  const body = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.ok(!body.usageMetadata, 'реальный ответ не должен содержать usageMetadata (иначе это не тот регресс)');
  assert.ok(body.usage && body.usage.total_tokens > 0, 'usage.total_tokens должен быть > 0 в реальном ответе — иначе post-fix парсер тоже даст 0');
});

test('регресс 3: сохранённый живой ответ Visicom реально показывает pre-fix miss / post-fix hit', () => {
  const p = path.join(__dirname, '..', '.planning', 'D0-regression3-live-response.json');
  assert.ok(fs.existsSync(p), 'нет .planning/D0-regression3-live-response.json (живой ответ Visicom)');
  const { pre_fix, post_fix } = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.strictEqual(pre_fix.candidates.length, 0, 'pre-fix запрос обязан не находить кандидатов — иначе регресс не воспроизведён');
  const hit = post_fix.candidates.find((c) => c.categories === 'adr_address' && c.name === '7');
  assert.ok(hit, 'post-fix запрос обязан находить adr_address дом 7 — иначе фикс не доказан');
});
