// 022 T003 — переименование и grounding.
//
// Живой ложный block 2026-08-26: слайс переносил реестр дефектов
// `.planning/HARNESS-DEFECTS-REGISTRY-2026-08-21.md` → `docs/DEFECTS.md`. Судья честно
// перечислил ОБА пути, но `diffFileList` из строки `R  old -> new` берёт только цель, а
// исходного файла на диске уже нет — и честный отчёт получил `grounding:phantom-file`.
//
// Фикс асимметричный, и оба теста ниже держат именно асимметрию:
//   • источник переименования законно НАЗВАТЬ — фантомом он не считается;
//   • требовать его нельзя — `unreviewed-file` спрашивает только цели, иначе на месте
//     снятого ложного отказа появился бы новый.

const test = require('node:test');
const assert = require('node:assert');

const { checkGrounding, diffRenameSources } = require('./judge-core.js');

// Порцелан git для переименования: два пробела статуса, затем `old -> new`.
const RENAME_STATUS = 'R  .planning/OLD-REGISTRY.md -> docs/DEFECTS.md\n M tools/judge-core.js\n';
const REASONS = ['перенос реестра проверен'];

test('diffRenameSources достаёт исходную сторону переименования', () => {
  assert.deepEqual(diffRenameSources(RENAME_STATUS), ['.planning/OLD-REGISTRY.md']);
  assert.deepEqual(diffRenameSources(' M tools/judge-core.js\n'), [], 'обычная правка источника не даёт');
  assert.deepEqual(diffRenameSources(''), []);
});

test('источник переименования, названный судьёй, не фантом', () => {
  const verdict = checkGrounding(
    RENAME_STATUS,
    ['.planning/OLD-REGISTRY.md', 'docs/DEFECTS.md', 'tools/judge-core.js'],
    REASONS,
  );
  assert.equal(verdict, null, 'честный отчёт с обеими сторонами переименования обязан проходить');
});

test('цель переименования по-прежнему обязательна в отчёте', () => {
  // Асимметрия: назвать источник — можно, подменить им цель — нельзя.
  const verdict = checkGrounding(
    RENAME_STATUS,
    ['.planning/OLD-REGISTRY.md', 'tools/judge-core.js'],
    REASONS,
  );
  assert.equal(verdict, 'grounding:unreviewed-file', 'пропуск цели переименования обязан краснеть');
});

test('настоящая выдумка остаётся фантомом', () => {
  const verdict = checkGrounding(
    RENAME_STATUS,
    ['docs/DEFECTS.md', 'tools/judge-core.js', 'tools/no-such-file-ever.js'],
    REASONS,
  );
  assert.equal(verdict, 'grounding:phantom-file', 'несуществующий путь вне переименования — по-прежнему фантом');
});
