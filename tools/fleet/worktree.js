'use strict';
// worktree.js — изоляция fleet-воркеров через git worktree (слайс T004).
// create/remove/list `.fleet-wt/<Tid>` на ветке `fleet/<Tid>` от интеграционной.
// Каждый воркер работает в своём worktree → правки не топчут друг друга; merge —
// отдельной очередью (T008).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const WT_DIR = '.fleet-wt';
const BRANCH_PREFIX = 'fleet/';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}
function gitOk(args, cwd) {
  try { execFileSync('git', args, { cwd, stdio: 'ignore' }); return true; } catch { return false; }
}

function wtPath(cwd, tid) { return path.join(cwd, WT_DIR, tid); }
function branchName(tid) { return BRANCH_PREFIX + tid; }

// Завести worktree для слайса. base = интеграционная ветка/commit-ish (деф. HEAD).
// Если ветка fleet/<Tid> уже есть (resume после падения) — переиспользуем, не -b.
function create(tid, { cwd = process.cwd(), base = 'HEAD' } = {}) {
  const p = wtPath(cwd, tid);
  const branch = branchName(tid);
  fs.mkdirSync(path.join(cwd, WT_DIR), { recursive: true });
  const branchExists = gitOk(['rev-parse', '--verify', '--quiet', branch], cwd);
  if (branchExists) {
    git(['worktree', 'add', p, branch], cwd);
  } else {
    git(['worktree', 'add', p, '-b', branch, base], cwd);
  }
  linkNodeModules(cwd, p);
  return { path: p, branch, tid };
}

// node_modules гитом не отслеживается → свежий worktree пуст, и оракул любого JS-проекта
// (`npx tsc`, `npm run lint`, `npm test`) там красный по причине «нет зависимостей», а не
// по причине слайса. Симлинк-junction на node_modules корня: на Windows не требует прав
// админа, на POSIX — обычный dir-симлинк. Чтения конкурентны и безопасны.
// ponytail: общий на все worktree — параллельные vitest/eslint делят кэш внутри
// node_modules. Апгрейд, если пойдут гонки кэша: `npm ci` в каждый worktree (минуты) или
// per-worktree CACHE_DIR через env оракула.
function linkNodeModules(cwd, wt) {
  const src = path.join(cwd, 'node_modules');
  const dst = path.join(wt, 'node_modules');
  if (!fs.existsSync(src) || fs.existsSync(dst)) return;
  try { fs.symlinkSync(src, dst, 'junction'); } catch { /* нет прав/не Node-проект — оракул скажет сам */ }
}

// Снять junction ДО любого удаления worktree. Живой инцидент 2026-08-15: `fs.rmSync(recursive)`
// на Windows пошёл СКВОЗЬ junction и начал выедать node_modules КОРНЕВОГО дерева (первым лёг
// `.bin`), а затем упёрся в залоченный файл и отрапортовал «директория занята». Один unlink
// линка снимает и утечку удаления, и саму причину лока.
function unlinkNodeModules(wt) {
  const link = path.join(wt, 'node_modules');
  try {
    if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
  } catch { /* нет линка — нечего снимать */ }
}

// Синхронный busy-wait: короткий (≤900мс суммарно за все ретраи), только на пути ошибки.
// Без Atomics/SharedArrayBuffer — не тянет версионные/threading оговорки Node.
function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy-wait */ }
}

// ponytail: на Windows хендл на файл worktree иногда переживает завершение child-процесса
// (антивирус/индексатор/отложенный close дескриптора лога) на доли секунды — `git worktree
// remove --force` тогда падает "Directory not empty" (T016 live-fire, fleet-бенч), и следующий
// create() падает "already exists". Ретраим git-путь, затем ручное удаление директории; если
// и оно не помогло — громко предупреждаем и бросаем ошибку (молчать нельзя: маскировка сделает
// будущий "already exists" необъяснимым).
function removeWorktreeRetrying(p, cwd, force) {
  const attempts = 3;
  for (let i = 0; i < attempts; i++) {
    try {
      execFileSync('git', ['worktree', 'remove', ...(force ? ['--force'] : []), p], { cwd, stdio: 'ignore' });
      return;
    } catch {
      if (i < attempts - 1) sleepSync(300 * (i + 1));
    }
  }
  gitOk(['worktree', 'prune'], cwd); // снять git-метаданные сразу, независимо от исхода ниже
  for (let i = 0; i < attempts; i++) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ретраим ниже */ }
    if (!fs.existsSync(p)) return;
    if (i < attempts - 1) sleepSync(300 * (i + 1));
  }
  console.warn(`worktree.remove: не удалось снести ${p} после ${attempts * 2} попыток — директория занята другим процессом`);
  throw new Error(`worktree.remove: directory still locked: ${p}`);
}

// Убрать worktree. force снимает грязное дерево; deleteBranch дропает и ветку fleet/<Tid>
// (после успешного merge оркестратор чистит; при requeue ветку сохраняем).
function remove(tid, { cwd = process.cwd(), force = true, deleteBranch = false } = {}) {
  const p = wtPath(cwd, tid);
  unlinkNodeModules(p);
  removeWorktreeRetrying(p, cwd, force);
  if (deleteBranch) gitOk(['branch', '-D', branchName(tid)], cwd);
  return { path: p, branch: branchName(tid) };
}

// Список ТОЛЬКО fleet-worktree'ов (по префиксу пути .fleet-wt/).
function list({ cwd = process.cwd() } = {}) {
  let out = '';
  try { out = git(['worktree', 'list', '--porcelain'], cwd); } catch { return []; }
  const res = [];
  for (const block of out.split(/\n\s*\n/)) {
    const mPath = block.match(/^worktree (.+)$/m);
    if (!mPath) continue;
    const norm = mPath[1].replace(/\\/g, '/');
    const marker = '/' + WT_DIR + '/';
    const idx = norm.indexOf(marker);
    if (idx === -1) continue;
    const tid = norm.slice(idx + marker.length);
    const mBranch = block.match(/^branch (.+)$/m);
    const branch = mBranch ? mBranch[1].replace('refs/heads/', '') : null;
    res.push({ path: mPath[1], branch, tid });
  }
  return res;
}

module.exports = { create, remove, list, wtPath, branchName, WT_DIR, BRANCH_PREFIX };
