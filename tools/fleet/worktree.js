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
  return { path: p, branch, tid };
}

// Убрать worktree. force снимает грязное дерево; deleteBranch дропает и ветку fleet/<Tid>
// (после успешного merge оркестратор чистит; при requeue ветку сохраняем).
function remove(tid, { cwd = process.cwd(), force = true, deleteBranch = false } = {}) {
  const p = wtPath(cwd, tid);
  git(['worktree', 'remove', ...(force ? ['--force'] : []), p], cwd);
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
