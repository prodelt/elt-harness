// 022 T004 — массовое удаление не должно делать слайс несудимым.
//
// Живьём 2026-08-26: волна публичной гигиены удалила 544 файла. Дифф из 711 секций дал
// ~844 символа на файл, и правка `judge-core.js` оборвалась на середине — судья честно
// ответил «не могу проверить». Параллельно `unreviewed-file` требовал перечислить все 711
// путей, включая 544 удалённых, в которых читать нечего.
//
// Здесь держится обе стороны фикса И граница, за которую он не должен заходить: удаление
// остаётся ВИДИМЫМ, а удаление вперемешку с дописанным кодом сворачивать нельзя.

const test = require('node:test');
const assert = require('node:assert');

const { budgetDiff, isPureDeletion, diffDeletedFiles, checkGrounding } = require('./judge-core.js');

const body = (n, sign) => Array.from({ length: n }, (_, i) => `${sign}строка ${i}`).join('\n');

const deletionSection = (file, lines = 400) => ({
  file,
  text: `diff --git a/${file} b/${file}\ndeleted file mode 100644\n--- a/${file}\n+++ /dev/null\n${body(lines, '-')}`,
});

const editSection = (file, lines = 200) => ({
  file,
  text: `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n${body(lines, '+')}`,
});

test('isPureDeletion: удаление без единой добавленной строки', () => {
  assert.equal(isPureDeletion(deletionSection('a.md')), true);
  assert.equal(isPureDeletion(editSection('b.js')), false);
  // Граница: `deleted file mode` в заголовке не должен покрывать дописанный код.
  const mixed = { file: 'c.js', text: `diff --git a/c.js b/c.js\ndeleted file mode 100644\n-старое\n+новое` };
  assert.equal(isPureDeletion(mixed), false, 'патч с добавленной строкой сворачивать нельзя');
});

test('бюджет достаётся изменённому коду, а не телам удалённых файлов', () => {
  const sections = [
    ...Array.from({ length: 200 }, (_, i) => deletionSection(`archive/old-${i}.md`)),
    editSection('tools/judge-core.js', 300),
  ];

  const { diff } = budgetDiff(sections, 60000, ['tools/judge-core.js']);

  const code = sections[sections.length - 1].text;
  assert.ok(
    diff.includes(code),
    'изменённый файл обязан попасть в промпт целиком: ровно его обрезание и делало слайс несудимым',
  );
  // И при этом удаления не исчезают беззвучно.
  assert.ok(diff.includes('archive/old-0.md'), 'факт удаления обязан остаться видимым');
  assert.ok(/файл удалён целиком: \d+ строк/.test(diff), 'у свёрнутой секции обязан быть объём');
});

test('diffDeletedFiles различает удаление и переименование', () => {
  const status = 'D  archive/x.md\n D tools/y.js\nR  old.md -> new.md\n M tools/z.js\n';
  assert.deepEqual(diffDeletedFiles(status).sort(), ['archive/x.md', 'tools/y.js']);
});

test('за удалённый файл filesReviewed не спрашивается, за изменённый — спрашивается', () => {
  const status = 'D  archive/x.md\nD  archive/y.md\n M tools/z.js\n';
  const reasons = ['проверено'];

  assert.equal(
    checkGrounding(status, ['tools/z.js'], reasons), null,
    'перечисление осмысленных файлов без 544 удалённых путей обязано проходить',
  );
  assert.equal(
    checkGrounding(status, ['archive/x.md', 'archive/y.md'], reasons), 'grounding:unreviewed-file',
    'пропуск ИЗМЕНЁННОГО файла по-прежнему обязан краснеть',
  );
});

// 022 T002 (четвёртый фикс той же волны) — grounding не должен наказывать за послушание.
// Промпт судьи перечисляет владения харнеса и сгенерированное с прямым «не выноси по ним
// вердикт», а `unreviewed-file` тут же требовал назвать их в filesReviewed. Живой блок
// 2026-08-26: судья не отчитался по `.elt/ledger.jsonl`, `.harness/harness.json` и фикстуре
// judge-bench — ровно по тем файлам, о которых его просили молчать.
test('за файлы, о которых судью просили молчать, отчёт не требуется', () => {
  const status = ' M .elt/ledger.jsonl\n M tools/judge-bench/cases-ingested.json\n M tools/judge-core.js\n';
  const reasons = ['проверено'];

  assert.equal(
    checkGrounding(status, ['tools/judge-core.js'], reasons), null,
    'владения харнеса и сгенерированное не спрашиваются: по ним же запрещено выносить вердикт',
  );
  assert.equal(
    checkGrounding(status, ['.elt/ledger.jsonl'], reasons), 'grounding:unreviewed-file',
    'пропуск обычного кода по-прежнему обязан краснеть',
  );
});

// `.harness/harness.json` — НАМЕРЕННОЕ исключение из послабления: это конфиг гейта, и слайс,
// ослабляющий собственную проверку, обязан быть замечен (019 T001, дыра, найденная судьёй).
test('конфиг гейта из послабления исключён — по нему отчёт обязателен', () => {
  const status = ' M .harness/harness.json\n';
  assert.equal(checkGrounding(status, [], ['проверено']), 'grounding:unreviewed-file');
  assert.equal(checkGrounding(status, ['.harness/harness.json'], ['проверено']), null);
});
