'use strict';
// merge.js — последовательная очередь merge fleet-веток в интеграционную (T008).
// merge --no-ff fleet/<Tid> → [X]-марк в tasks.md (в том же merge-commit) → smoke-оракул.
// Конфликт → git merge --abort + пометка requeue-serial (оркестратор дожмёт позже).
// Очередь СЕРИАЛЬНА намеренно: интеграционная ветка одна, параллелить merge нельзя.
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ELT_CLI = path.join(os.homedir(), '.claude', 'bin', 'elt.js');

function gitTry(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).trim(), status: r.status };
}

// [ ] → [X] для конкретного слайса в tasks.md интеграционной ветки.
function markDoneInFile(tasksPath, tid) {
  const txt = fs.readFileSync(tasksPath, 'utf8');
  const re = new RegExp('(-\\s*\\[) (\\]\\s*\\*\\*' + tid + '\\*\\*)');
  if (!re.test(txt)) return false;
  fs.writeFileSync(tasksPath, txt.replace(re, '$1X$2'));
  return true;
}

function runOracle(cwd, elt) {
  const r = spawnSync('node', [elt, 'oracle'], { cwd, encoding: 'utf8' });
  return r.status === 0;
}

// Влить один слайс. Возвращает {ok, tid, conflict?, requeue?, marked?, oracleOk?, stage?}.
function mergeSlice(tid, { cwd = process.cwd(), integration = 'main', tasksPath = null, elt = ELT_CLI, oracle = true } = {}) {
  const branch = 'fleet/' + tid;
  const co = gitTry(['checkout', integration], cwd);
  if (!co.ok) return { ok: false, stage: 'checkout', tid, err: co.out };

  // --no-commit: вложим [X] в тот же merge-commit
  const m = gitTry(['merge', '--no-ff', '--no-commit', branch], cwd);
  if (!m.ok) {
    gitTry(['merge', '--abort'], cwd); // откат — интеграционная остаётся чистой
    return { ok: false, conflict: true, requeue: 'serial', tid, err: m.out };
  }

  // Реальный merge (есть MERGE_HEAD) vs «already up to date» (--no-ff без изменений).
  const inMerge = gitTry(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], cwd).ok;
  const marked = tasksPath && fs.existsSync(tasksPath) ? markDoneInFile(tasksPath, tid) : false;
  gitTry(['add', '-A'], cwd);
  const hasStaged = !gitTry(['diff', '--cached', '--quiet'], cwd).ok; // exit≠0 ⇒ есть staged

  if (inMerge || hasStaged) {
    const c = gitTry(['commit', '--no-edit', '-m', `merge(fleet): ${tid}${marked ? ' [X]' : ''}`], cwd);
    if (!c.ok) {
      // реальный merge не закоммитился — не оставляем грязь: откат состояния, явный отказ
      gitTry(['merge', '--abort'], cwd);
      gitTry(['reset', '--hard'], cwd);
      return { ok: false, stage: 'commit', tid, err: c.out };
    }
  }
  // inMerge=false и нет staged ⇒ слайс уже влит (идемпотентный re-merge) — коммитить нечего

  const oracleOk = oracle ? runOracle(cwd, elt) : null;
  return { ok: true, tid, merged: inMerge, marked, oracleOk };
}

// Серийная очередь. Конфликтные слайсы собираются в conflicts (requeue-serial —
// оркестратор повторит их после того, как остальные влились и дерево сдвинулось).
function mergeAll(tids, opts = {}) {
  const merged = [], conflicts = [], oracleFails = [];
  for (const tid of tids) {
    const r = mergeSlice(tid, opts);
    if (r.conflict) conflicts.push(tid);
    else if (r.ok) { merged.push(tid); if (r.oracleOk === false) oracleFails.push(tid); }
  }
  return { merged, conflicts, oracleFails };
}

module.exports = { mergeSlice, mergeAll, markDoneInFile };
