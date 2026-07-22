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

function testFilesFromDiff(cwd) {
  return diffFileList(cwd).filter((f) => TEST_FILE_RE.test(f));
}

// harness.json.testCmd явный → берём как есть. Не задан → детект: node-проект (package.json
// или тестовые файлы с JS/TS-расширением) → `node --test` (файлы добавляются аргументами
// ниже). Ни то ни другое → нечем прогнать, скипаем явно, не молчим.
function resolveTestCmd(cwd, files) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(cwd, '.harness', 'harness.json'), 'utf8'));
    if (typeof cfg.testCmd === 'string' && cfg.testCmd.trim()) return cfg.testCmd.trim();
  } catch { /* нет harness.json / битый — детект ниже */ }
  if (fs.existsSync(path.join(cwd, 'package.json')) || files.some((f) => /\.[cm]?[jt]sx?$/i.test(f))) {
    return 'node --test';
  }
  return null;
}

function tailOf(text, maxLines = 40) {
  return (text || '').split(/\r?\n/).slice(-maxLines).join('\n');
}

function redProof({ cwd = process.cwd(), baseHead = 'HEAD' } = {}) {
  const files = testFilesFromDiff(cwd);
  if (!files.length) return { status: 'skipped', reason: 'no-new-tests', files: [], tail: '' };

  const testCmd = resolveTestCmd(cwd, files);
  if (!testCmd) return { status: 'skipped', reason: 'no-test-cmd', files, tail: '' };

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
    const result = spawnSync(bin, [...cmdArgs, '--', ...files], { cwd: wt, encoding: 'utf8', env });
    if (result.error) {
      return { status: 'skipped', reason: `test-cmd-error:${result.error.code || result.error.message}`, files, tail: '' };
    }
    const tail = tailOf((result.stdout || '') + (result.stderr || ''));
    return result.status !== 0
      ? { status: 'red', reason: 'fails-on-base', files, tail }
      : { status: 'green', reason: 'passes-on-base', files, tail };
  } finally {
    if (!gitOk(['worktree', 'remove', '--force', wt], cwd)) {
      try { fs.rmSync(wt, { recursive: true, force: true }); } catch { /* best-effort */ }
      gitOk(['worktree', 'prune'], cwd);
    }
  }
}

module.exports = { redProof, testFilesFromDiff, diffFileList, resolveTestCmd };
