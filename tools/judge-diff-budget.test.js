// 022 T002 — регрессия на корень, а не на симптом.
//
// У судьи есть бюджет диффа (DIFF_CAP): он именно для того, чтобы большой слайс дошёл до
// модели урезанным, а не уронил цепочку. Но `slurpDiff` читал git дефолтным `maxBuffer`
// (1 МиБ), и на диффе больше мегабайта execFileSync бросал исключение ДО `budgetDiff` —
// защита от большого диффа ломалась ровно на большом диффе. Живьём: слайс с массовым
// удалением отслеживаемых файлов дал `git diff HEAD` на 6 МБ, и `elt judge run` завершился
// сообщением «судья не вернул JSON (exit 1)», в котором был виден кусок диффа.
//
// Тест держит поведение, а не число: дифф заведомо больше 1 МиБ обязан вернуться
// урезанным по бюджету. До фикса он краснел исключением, а не ассертом.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { slurpDiff } = require('./judge-core.js');

const ONE_MIB = 1024 * 1024;

function git(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function makeRepoWithHugeDiff() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-budget-'));
  git(dir, 'init', '--quiet');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'core.autocrlf', 'false');

  // Базовый коммит: файлы уже отслеживаются, поэтому их правка попадёт в `git diff HEAD`
  // как настоящий дифф, а не как untracked-секция.
  const line = `${'x'.repeat(120)}\n`;
  for (let i = 0; i < 12; i++) {
    fs.writeFileSync(path.join(dir, `f${i}.txt`), line.repeat(200));
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', 'base');

  // Перезапись содержимого целиком: каждая строка уходит в дифф дважды (− и +).
  const other = `${'y'.repeat(120)}\n`;
  for (let i = 0; i < 12; i++) {
    fs.writeFileSync(path.join(dir, `f${i}.txt`), other.repeat(800));
  }
  return dir;
}

test('slurpDiff: дифф больше 1 МиБ урезается бюджетом, а не падает исключением', () => {
  const dir = makeRepoWithHugeDiff();
  try {
    const raw = execFileSync('git', ['diff', 'HEAD'], {
      cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    });
    assert.ok(
      raw.length > ONE_MIB,
      `фикстура обязана превышать дефолтный maxBuffer, иначе тест ничего не проверяет: ${raw.length}`,
    );

    const result = slurpDiff(dir);

    assert.ok(result && typeof result.diff === 'string', 'slurpDiff обязан вернуть дифф, а не бросить');
    assert.ok(result.diff.length < raw.length, 'дифф обязан быть урезан бюджетом');
    assert.ok(Array.isArray(result.omitted), 'непоказанные файлы обязаны быть перечислены');
    // Судья не имеет права молча недосмотреть файл: то, что не влезло, названо поимённо.
    const shownOrOmitted = result.omitted.length + (result.diff.match(/^diff --git /gm) || []).length;
    assert.equal(shownOrOmitted, 12, 'каждый изменённый файл либо показан, либо назван в omitted');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
