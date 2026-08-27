'use strict';
// 023 T003 — замок под AC3 спеки 022: «в отслеживаемых файлах нет абсолютных путей автора».
//
// Критерий был объявлен, а проверки под ним не существовало. Цена выяснилась сразу: слайс
// 023/T001 перенёс два замороженных отчёта judge-bench из `.planning/` в поставку, и вместе с
// ними в дерево въехали 36 абсолютных путей вида `C:\Users\<автор>\AppData\Local\Temp\...` в
// поле `judgeLog`. Полный оракул остался зелёным — ловить это было нечем. Нашла линза ревью,
// то есть модель, а не механика; на следующем таком файле её могло не оказаться.
//
// Здесь проверяется ровно то, что обещает AC3, и проверяется у ВСЕХ отслеживаемых файлов, а не
// у списка подозреваемых: список подозреваемых устаревает молча — это и есть D28 в другом
// обличье.
//
// Тест не знает имени автора и не должен: он ищет ФОРМУ домашнего пути с любым именем внутри.
// Поэтому он одинаково краснеет и у автора, и у контрибьютора, который случайно закоммитит
// свой путь, и остаётся зелёным на CI, где никакого домашнего пути в дереве нет.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Заведомые плейсхолдеры: их присутствие — признак того, что путь УЖЕ обезличен.
// `user`/`username` — то, чем 022 заменяла реальное имя в фикстурах тестов; `test` — фикстурное
// имя в `tools/adapters/skillspector.test.js`. Список намеренно короткий и состоит только из
// слов, которые не могут быть ничьим настоящим логином в этом дереве: каждое добавление сюда
// ослабляет замок, поэтому расширять его допустимо лишь под такое же обоснование, а не чтобы
// погасить красноту.
const PLACEHOLDERS = new Set([
  'user', 'username', 'test', 'testuser', 'fixture',
  '<user>', '<home>', '<tmp>', 'runner', 'ИМЯ',
]);

// Windows: C:\Users\<name>\ ; POSIX: /home/<name>/ и /Users/<name>/ (macOS).
// Имя берётся группой, чтобы плейсхолдеры можно было отсеять по значению, а не по всему пути.
const PATTERNS = [
  { re: /[A-Za-z]:\\\\?Users\\\\?([^\\/"'\s]+)/g, kind: 'windows-home' },
  { re: /\/home\/([^/"'\s]+)/g, kind: 'linux-home' },
  { re: /\/Users\/([^/"'\s]+)/g, kind: 'macos-home' },
];

// Двоичные файлы читать бессмысленно; расширения перечислены явно, чтобы не гадать по байтам.
const BINARY = /\.(png|jpg|jpeg|gif|ico|pdf|zip|gz|exe|dll|db|woff2?|ttf|eot|mp4|webm)$/i;

function trackedFiles() {
  const r = spawnSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ls-files упал (${r.status}): ${r.stderr}`);
  return (r.stdout || '').split(/\r?\n/).filter(Boolean);
}

// Возвращает [{ file, kind, name, sample }] — по одной записи на найденное имя в файле.
function personalPaths(relFile, content) {
  const hits = [];
  for (const { re, kind } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const name = m[1];
      if (PLACEHOLDERS.has(name.toLowerCase())) continue;
      // `<...>` в любой форме — уже обезличенный сегмент, а не чьё-то имя.
      if (name.startsWith('<') || name.startsWith('%') || name.startsWith('$')) continue;
      const at = Math.max(0, m.index - 20);
      hits.push({ file: relFile, kind, name, sample: content.slice(at, m.index + 60).replace(/\s+/g, ' ') });
    }
  }
  return hits;
}

const gitOk = spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
const SKIP = gitOk ? false : 'git недоступен — список отслеживаемых файлов не получить';

test('AC3 (022): ни один отслеживаемый файл не несёт абсолютный путь домашнего каталога', { skip: SKIP }, () => {
  const offenders = [];
  for (const rel of trackedFiles()) {
    if (BINARY.test(rel)) continue;
    // Этот файл — единственное законное место, где такие пути написаны: он ими и проверяется.
    if (rel === 'tools/release-hygiene.test.js') continue;
    const abs = path.join(ROOT, rel);
    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch {
      continue; // файл в индексе, но не в дереве (в середине операции) — не наш случай
    }
    offenders.push(...personalPaths(rel, content));
  }

  const lines = offenders.map((o) => `${o.file}: ${o.kind} «${o.name}» — …${o.sample}…`);
  assert.deepEqual(
    lines,
    [],
    'в поставке остались абсолютные пути чьего-то домашнего каталога:\n  ' + lines.join('\n  '),
  );
});

test('замок ловит форму, а не конкретное имя автора', { skip: SKIP }, () => {
  const win = personalPaths('f.json', 'C:' + '\\\\' + 'Users' + '\\\\' + 'somebody' + '\\\\' + 'AppData');
  assert.equal(win.length, 1, 'windows-путь не пойман');
  assert.equal(win[0].name, 'somebody');

  const nix = personalPaths('f.sh', 'export P=/home/somebody/bin');
  assert.equal(nix.length, 1, 'linux-путь не пойман');
  assert.equal(nix[0].name, 'somebody');
});

test('обезличенные пути и плейсхолдеры нарушением не считаются', { skip: SKIP }, () => {
  const samples = [
    '"judgeLog": "<tmp>' + '\\\\' + 'judge-bench' + '\\\\' + 'x.log"',
    'C:' + '\\\\' + 'Users' + '\\\\' + 'user' + '\\\\' + 'projects',
    '/home/user/repo',
    '%USERPROFILE%' + '\\\\' + 'projects',
    '~/.claude/skills/elt/SKILL.md',
  ];
  for (const s of samples) {
    assert.deepEqual(personalPaths('f', s), [], `ложное срабатывание на «${s}»`);
  }
});
