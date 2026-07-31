'use strict';
// red-proof (008 T003): доказывает, что новый/изменённый тест слайса реально ловит
// поломку — а не мокает ровно то, что проверяет. Копирует тестовые файлы диффа в
// worktree на baseHead (код ДО слайса) и гоняет их там: должны падать. Зелёный на
// baseHead = тест ничего не проверяет из нового поведения → слайс не доказан.
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TEST_FILE_RE = /\.test\.[cm]?[jt]sx?$|(^|[\\/])test_[^\\/]+\.py$|_test\.py$/i;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}
function gitOk(args, cwd) {
  try { execFileSync('git', args, { cwd, stdio: 'ignore' }); return true; } catch { return false; }
}

// Тот же разбор `git status --porcelain`, что и grounding-чек судьи (tools/fleet/gate.js
// diffFileList) — единый источник правды "что реально в диффе", не завязан на cap диффа.
function diffFileList(cwd) {
  const status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
  const files = [];
  for (const line of status.split(/\r?\n/)) {
    if (line.length < 4) continue;
    let rel = line.slice(3).replace(/^"|"$/g, '').trim();
    if (!rel) continue;
    const arrow = rel.indexOf(' -> ');
    if (arrow !== -1) rel = rel.slice(arrow + 4).trim();
    files.push(rel.replace(/\\/g, '/'));
  }
  return files;
}

// ВСЕ тест-файлы диффа, а не только новые: `git status --porcelain` несёт и `M`, и `A`, и `??`,
// поэтому правка существующего теста слой НЕ проскакивает (011 T007 — проверено тестом ниже
// и живыми прогонами T003/T006, где red-proof гонял изменённые `*.test.js`).
function testFilesFromDiff(cwd) {
  return diffFileList(cwd).filter((f) => TEST_FILE_RE.test(f));
}
// 011 T007: удалённый тест-файл в порcelain есть, а на диске его нет — `copyFileSync` кидал
// ENOENT и ронял ВЕСЬ слой исключением. Самый прямой способ ослабить проверку (снести тест)
// обваливал механизм, который эту проверку и стережёт. Удалённые отделяем: гонять их на base
// нечем, но исчезнуть молча они не должны — уезжают в отчёт отдельным списком.
function splitDeleted(cwd, files) {
  const alive = [];
  const deleted = [];
  for (const f of files) (fs.existsSync(path.join(cwd, f)) ? alive : deleted).push(f);
  return { alive, deleted };
}

// harness.json.testCmd явный → берём как есть. Не задан → детект: node-проект (package.json
// или тестовые файлы с JS/TS-расширением) → `node --test` (файлы добавляются аргументами
// ниже). Ни то ни другое → нечем прогнать, скипаем явно, не молчим.
function readHarness(cwd) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, '.harness', 'harness.json'), 'utf8'));
  } catch { return {}; } // нет harness.json / битый — дефолты
}

function resolveTestCmd(cwd, files) {
  const cfg = readHarness(cwd);
  if (typeof cfg.testCmd === 'string' && cfg.testCmd.trim()) return cfg.testCmd.trim();
  if (fs.existsSync(path.join(cwd, 'package.json')) || files.some((f) => /\.[cm]?[jt]sx?$/i.test(f))) {
    return 'node --test';
  }
  return null;
}

// 011 T016: без потолка зависший раннер вешал гейт молча и бесконечно (живьём 25 мин на
// `node --test -- tools/doctor.test.js`). Потолок — НА ФАЙЛ, из harness.json.redProofTimeoutMs.
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
function resolveTimeoutMs(cwd) {
  const v = readHarness(cwd).redProofTimeoutMs;
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TIMEOUT_MS;
}

// Тест, чей предмет проверки лежит вне рабочего дерева: он адресует домашний каталог
// (`os.homedir()`), а не файл репозитория. Признак намеренно узкий — это устоявшийся в проекте
// приём контракт-тестов на глобальные скилы/конфиги, а не догадка про «внешность» вообще.
function isExternalSubject(cwd, file) {
  try { return /os\.homedir\(\)|homedir\(\)/.test(fs.readFileSync(path.join(cwd, file), 'utf8')); }
  catch { return false; }
}

function tailOf(text, maxLines = 40) {
  return (text || '').split(/\r?\n/).slice(-maxLines).join('\n');
}

function redProof({ cwd = process.cwd(), baseHead = 'HEAD' } = {}) {
  const inDiff = testFilesFromDiff(cwd);
  // `no-test-files`, а не прежнее `no-new-tests`: слой смотрит на ВСЕ тест-файлы диффа, и
  // старое имя врало про причину — читалось как «изменённые не считаются».
  if (!inDiff.length) return { status: 'skipped', reason: 'no-test-files', files: [], tail: '' };
  const { alive: files, deleted } = splitDeleted(cwd, inDiff);
  const withDeleted = (r) => (deleted.length ? { ...r, deletedTests: deleted } : r);
  if (!files.length) {
    return withDeleted({ status: 'skipped', reason: 'only-deleted-tests', files: inDiff, tail: '' });
  }

  const testCmd = resolveTestCmd(cwd, files);
  if (!testCmd) return withDeleted({ status: 'skipped', reason: 'no-test-cmd', files, tail: '' });

  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'red-proof-'));
  try {
    git(['worktree', 'add', '--detach', '-q', wt, baseHead], cwd);
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(wt, f)), { recursive: true });
      fs.copyFileSync(path.join(cwd, f), path.join(wt, f));
    }
    const [bin, ...cmdArgs] = testCmd.split(/\s+/);
    // NODE_TEST_CONTEXT (наследуется, если red-proof сам вызван из-под `node --test`,
    // напр. CI) заставляет вложенный `node --test` думать, что он child-репортёр —
    // он тогда молча не гоняет тесты по-настоящему и отдаёт exit 0 (ложный green).
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    // `--` перед файлами: путь диффа не должен трактоваться раннером как флаг (напр. файл
    // с именем, начинающимся на `-`, попавший в дифф).
    // По ОДНОМУ файлу за прогон: `node -- a.js b.js` запустил бы только a.js (остальное ушло бы
    // в argv скрипта) — молчаливое доказательство лишь первого теста. Первый упавший = слайс
    // доказан, дальше не гоняем.
    const timeout = resolveTimeoutMs(cwd);
    let tail = '';
    for (const f of files) {
      const result = spawnSync(bin, [...cmdArgs, '--', f], { cwd: wt, encoding: 'utf8', env, timeout });
      tail = tailOf((result.stdout || '') + (result.stderr || ''));
      if (result.error) {
        const code = result.error.code || result.error.message;
        // spawnSync при превышении timeout убивает процесс и кладёт сюда ETIMEDOUT.
        const reason = code === 'ETIMEDOUT' ? `test-cmd-timeout:${f}` : `test-cmd-error:${code}`;
        return withDeleted({ status: 'skipped', reason, files, tail });
      }
      if (result.status !== 0) return withDeleted({ status: 'red', reason: 'fails-on-base', files, tail });
    }
    // 011 T013 (живой случай): у слайса, чей продукт лежит ВНЕ этого репо (контракт-тест на
    // `~/.claude/skills/**` — отдельный git), откат к baseHead не откатывает предмет проверки.
    // Такой тест зелен на базе ВСЕГДА, независимо от того, хорош он или пуст, — слой не «не
    // доказал», а неприменим, и выдавать это за `green` значит блокировать по невозможности.
    // Признак узкий и механический: тест адресует домашний каталог (`os.homedir()`), т.е.
    // заведомо не файл рабочего дерева. Смешанный набор остаётся `green`: если хоть один файл
    // судим внутри репо, слой применим и его зелень — это отсутствие доказательства.
    const external = files.filter(isExternalSubject.bind(null, cwd));
    if (external.length === files.length) {
      return withDeleted({ status: 'skipped', reason: `external-subject:${external.join(',')}`, files, tail });
    }
    return withDeleted({ status: 'green', reason: 'passes-on-base', files, tail });
  } finally {
    if (!gitOk(['worktree', 'remove', '--force', wt], cwd)) {
      try { fs.rmSync(wt, { recursive: true, force: true }); } catch { /* best-effort */ }
      gitOk(['worktree', 'prune'], cwd);
    }
  }
}

module.exports = { redProof, testFilesFromDiff, diffFileList, resolveTestCmd, splitDeleted, isExternalSubject };
