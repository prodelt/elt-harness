'use strict';
// merge.js — последовательная очередь merge fleet-веток в интеграционную (T008).
// merge --no-ff fleet/<Tid> → [X]-марк в tasks.md (в том же merge-commit) → smoke-оракул.
// Конфликт → git merge --abort + пометка requeue-serial (оркестратор дожмёт позже).
// Очередь СЕРИАЛЬНА намеренно: интеграционная ветка одна, параллелить merge нельзя.
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const exec = require('./exec');
const plan = require('./plan');

const ELT_CLI = path.join(os.homedir(), '.claude', 'bin', 'elt.js');

function gitTry(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).trim(), status: r.status };
}

// Зона правок слайса из [files:] в tasks.md — глобы для scoped git add (T023).
function sliceFiles(tasksPath, tid) {
  if (!tasksPath || !fs.existsSync(tasksPath)) return [];
  const slice = plan.parse(fs.readFileSync(tasksPath, 'utf8')).find((s) => s.id === tid);
  return slice ? slice.files : [];
}

// Стейджим только зону слайса (+ сам tasksPath ради [X]-марка), НЕ git add -A —
// иначе захватываем чужие dirty-файлы, лежащие в интеграционной рабочей копии.
// Нет [files:] тега (старый/ручной слайс) → безопасный дефолт как раньше.
function stageSlice(cwd, files, tasksPath) {
  if (!files.length) return gitTry(['add', '-A'], cwd);
  const paths = tasksPath ? files.concat([tasksPath]) : files;
  return gitTry(['add', '--', ...paths], cwd);
}

// [ ] → [X] для конкретного слайса в tasks.md интеграционной ветки.
function markDoneInFile(tasksPath, tid) {
  const txt = fs.readFileSync(tasksPath, 'utf8');
  const re = new RegExp('(-\\s*\\[) (\\]\\s*\\*\\*' + tid + '\\*\\*)');
  if (!re.test(txt)) return false;
  fs.writeFileSync(tasksPath, txt.replace(re, '$1X$2'));
  return true;
}

// exec.run, НЕ spawnSync: интеграционный оракул — те же ~96с, и синхронный вызов вешал
// event loop оркестратора (поллинг STOP не тикал, in-flight таймеры стояли) — см. exec.js.
// git-команды ниже остаются синхронными намеренно: они миллисекундные.
async function runOracle(cwd, elt) {
  const r = await exec.run('node', [elt, 'oracle'], { cwd });
  return r.status === 0;
}

// Влить один слайс. Возвращает {ok, tid, conflict?, requeue?, marked?, oracleOk?, stage?}.
async function mergeSlice(tid, { cwd = process.cwd(), integration = 'main', tasksPath = null, elt = ELT_CLI, oracle = true } = {}) {
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
  stageSlice(cwd, sliceFiles(tasksPath, tid), tasksPath);
  const hasStaged = !gitTry(['diff', '--cached', '--quiet'], cwd).ok; // exit≠0 ⇒ есть staged

  if (inMerge || hasStaged) {
    const c = gitTry(['commit', '--no-edit', '-m', `merge(fleet): ${tid}${marked ? ' [X]' : ''}`], cwd);
    if (!c.ok) {
      // реальный merge не закоммитился — merge --abort сам откатывает merge-состояние
      // (git reset --merge внутри), не трогая посторонние dirty-файлы; --hard убрали (T023)
      gitTry(['merge', '--abort'], cwd);
      return { ok: false, stage: 'commit', tid, err: c.out };
    }
  }
  // inMerge=false и нет staged ⇒ слайс уже влит (идемпотентный re-merge) — коммитить нечего

  const oracleOk = oracle ? await runOracle(cwd, elt) : null;
  return { ok: true, tid, merged: inMerge, marked, oracleOk };
}

// Серийная очередь. Конфликтные слайсы собираются в conflicts (requeue-serial —
// оркестратор повторит их после того, как остальные влились и дерево сдвинулось).
async function mergeAll(tids, opts = {}) {
  const merged = [], conflicts = [], oracleFails = [];
  for (const tid of tids) {
    const r = await mergeSlice(tid, opts);
    if (r.conflict) conflicts.push(tid);
    else if (r.ok) { merged.push(tid); if (r.oracleOk === false) oracleFails.push(tid); }
  }
  return { merged, conflicts, oracleFails };
}

module.exports = { mergeSlice, mergeAll, markDoneInFile, sliceFiles, stageSlice };
