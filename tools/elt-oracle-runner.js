#!/usr/bin/env node
'use strict';
// elt-oracle-runner — full control-plane test oracle: discovers every
// tools/**/*.test.js (both node:test-based and plain-script suites; the repo
// mixes both styles) and runs each with a plain `node <file>`, honest exit
// code from each file, no framework needed. Replaces the old doctor+Fleet-only
// oracle (spec 005 T007) which silently skipped ELT/bootstrap/project-docs
// coverage.
//
// Параллельный по умолчанию (замер 2026-07-22: последовательный прогон = 3м42с на
// 41 файл, и он платится КАЖДЫМ слайсом — это была самая дорогая часть гейта).
// Файлы изолированы друг от друга (каждый работает в своём mkdtemp), поэтому
// параллелить их безопасно; `--serial` оставлен для отладки флейка.
//   node tools/elt-oracle-runner.js [--jobs N | --serial] [--full]   (env: ELT_ORACLE_JOBS, ELT_ORACLE_FULL)
//
// 011 T020 — `--full`/ELT_ORACLE_FULL игнорирует `oracleSelect: impact` и гонит всё. Схема A
// артефакта требует сеть безопасности ПОД impact-выборкой (`L1 -.полный сьют.-> M`): impact
// строится обратным текстовым сканом глубины 2 — единственная сеть под ним раньше отсутствовала
// вовсе. env, а не только argv: `elt.js` вызывает этот файл как shell-строку из
// `harness.json.oracle`, а не с явными argv, поэтому единственный канал донести флаг через
// границу процесса — переменная окружения (тот же приём, что уже есть у ELT_ORACLE_JOBS).

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { selectTests } = require('./elt-oracle-select');
const oracleCache = require('./elt-oracle-cache');

const ROOT = path.join(__dirname, '..');

// 014 T001 — инвалидация кэша по «версии раннера»: хеш собственного исходника + исходника
// модуля кэша. Правка логики выборки/сравнения обязана сбросить весь кэш, а не оставить старые
// ключи, посчитанные по старым правилам.
const RUNNER_VERSION = crypto.createHash('sha256')
  .update(fs.readFileSync(__filename))
  .update(fs.readFileSync(require.resolve('./elt-oracle-cache')))
  .digest('hex');

function harnessOracleCmd(root = ROOT) {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.harness', 'harness.json'), 'utf8')).oracle || 'node'; }
  catch { return 'node'; }
}

// Denylist for known-broken tests (reason required). Empty since 005 T020
// removed the codemap suite that was the only entry.
const SKIP = new Set();

function discover(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(discover(full));
    else if (entry.name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

function jobsFrom(argv, env = process.env) {
  if (argv.includes('--serial')) return 1;
  const i = argv.indexOf('--jobs');
  const raw = i >= 0 ? argv[i + 1] : env.ELT_ORACLE_JOBS;
  const n = parseInt(raw, 10);
  if (n > 0) return n;
  return Math.max(1, Math.min(8, os.cpus().length));
}

// Один тест-файл: вывод БУФЕРИЗУЕТСЯ (при параллели stdio:'inherit' даёт кашу из
// перемешанных строк) и печатается только если файл упал — зелёный прогон должен быть
// тихим, иначе настоящая ошибка тонет в 41 простыне.
function runFile(file, root = ROOT) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [file], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    child.on('error', (e) => resolve({ file, ok: false, sec: 0, out: 'spawn error: ' + e.message }));
    child.on('close', (code) => resolve({ file, ok: code === 0, code, sec: (Date.now() - started) / 1000, out }));
  });
}

async function runAll(files, jobs, root = ROOT, onDone = () => {}) {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const r = await runFile(files[next++], root);
      results.push(r);
      onDone(r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, worker));
  return results;
}

// 011 T006: что тронул слайс. Untracked отдельно — в `git diff` их нет вовсе, а новый файл
// это самый частый случай слайса. Не git-репо / git недоступен → пустой список, и выборка
// сама уйдёт в «гнать все».
function changedFiles(root = ROOT) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  try {
    return [
      ...git(['diff', '--name-only', 'HEAD']).split(/\r?\n/),
      ...git(['ls-files', '--others', '--exclude-standard']).split(/\r?\n/),
    ].filter(Boolean);
  } catch { return []; }
}
function oracleSelectMode(root = ROOT, forceFull = false) {
  if (forceFull) return 'all'; // 011 T020: --full/ELT_ORACLE_FULL перекрывает конфиг целиком
  try {
    const mode = JSON.parse(fs.readFileSync(path.join(root, '.harness', 'harness.json'), 'utf8')).oracleSelect;
    return mode === 'impact' ? 'impact' : 'all'; // дефолт `all` — обратная совместимость (AC6)
  } catch { return 'all'; }
}

// 011 T020 — «слайсов с последнего полного прогона» читается из ХВОСТА run-log: каждая запись
// оракула несёт `oracle.full` (elt.js пишет её). Считаем impact-прогоны НАЗАД от конца до
// ближайшего full (full сбрасывает счётчик); записи без поля `full` (не-оракульные события,
// или прогоны до T020) пропускаются, а не хоронят счёт.
function slicesSinceFull(entries) {
  let count = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const o = entries[i] && entries[i].oracle;
    if (!o || typeof o.full !== 'boolean') continue;
    if (o.full) return count;
    count++;
  }
  return count;
}

// 014 T001 — тест-файлы, чьё замыкание не изменилось с прошлого зелёного прогона, не гоняются
// повторно. Кэш хранит только PASS: нет записи, замыкание изменилось или прошлый прогон был
// красным → промах (гонять), не попадание. `forceFull` (--full/ELT_ORACLE_FULL) игнорирует
// кэш целиком — ни чтения, ни записи.
function partitionByCache(run, root = ROOT, forceFull = false) {
  if (forceFull) return { toRun: run, hits: [], entries: {}, cache: {} };
  const cache = oracleCache.loadCache(root);
  const read = (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } };
  const cmd = harnessOracleCmd(root);
  const toRun = [];
  const hits = [];
  const entries = {};
  for (const file of run) {
    const { key } = oracleCache.computeEntry({ root, testFile: file, runnerVersion: RUNNER_VERSION, cmd, readFile: read });
    entries[file] = key;
    if (cache[file] && cache[file].key === key) hits.push(file);
    else toRun.push(file);
  }
  return { toRun, hits, entries, cache };
}

// 019 T011: корней сканирования два. `bin/` — точки входа плагина, и их тесты обязаны быть
// частью того же механического оракула: иначе новый код харнеса живёт вне гейта, которым сам
// же харнес всех и меряет. Список корней явный, а не «всё дерево»: `specs/`, `demo/` и
// `vendor/` содержат чужие `*.test.js`, которые к нашему оракулу отношения не имеют.
// 021 T003: третий корень — `benchmarks/`. Тесты замерочного контура (runner.test.js,
// gate-runner.test.js) писались как discriminating regressions, но лежали ВНЕ оракула и
// поэтому не гонялись ни разу ни на одном коммите. Замер, чьи регрессы не под гейтом, — это
// тот же «новый код харнеса вне гейта», ради которого корнем сделали `bin/`. Список корней
// по-прежнему явный: `specs/`, `demo/` и `vendor/` содержат чужие `*.test.js`.
const TEST_ROOTS = ['tools', 'bin', 'benchmarks'];

async function main() {
  const files = TEST_ROOTS
    .map((dir) => path.join(ROOT, dir))
    .filter((dir) => fs.existsSync(dir))
    .flatMap((dir) => discover(dir))
    .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
    .sort();
  const all = files.filter((f) => !SKIP.has(f));
  const skipped = files.filter((f) => SKIP.has(f));
  const jobs = jobsFrom(process.argv.slice(2));
  const forceFull = process.argv.slice(2).includes('--full') || process.env.ELT_ORACLE_FULL === '1';

  // Выборка НИКОГДА не молчит: и режим, и причина печатаются — иначе «оракул зелёный» стало бы
  // невозможно отличить от «оракул ничего не гонял».
  const pick = selectTests({ cwd: ROOT, changedFiles: changedFiles(), allTests: all, mode: oracleSelectMode(ROOT, forceFull) });
  const run = pick.files;
  console.error(`elt-oracle-runner: выборка ${pick.mode} — ${pick.selected}/${pick.total} файлов (${pick.reason})`);

  console.error(`elt-oracle-runner: ${run.length} test files, jobs=${jobs} (${skipped.length} skipped: ${skipped.join(', ') || 'none'})`);

  // 014 T001 — кэш по хешу замыкания: попадания не гоняются вовсе, с пометкой в отчёте.
  const { toRun, hits, entries, cache } = partitionByCache(run, ROOT, forceFull);
  if (hits.length) console.error(`elt-oracle-runner: кэш оракула — ${hits.length} попаданий, ${toRun.length} к прогону (замыкание не изменилось)`);

  const started = Date.now();
  const ran = await runAll(toRun, jobs, ROOT, (r) => {
    if (!r.ok) {
      console.error(`\n── FAIL ${r.file} (exit ${r.code}, ${r.sec.toFixed(1)}s) ──`);
      console.error(r.out);
    }
  });
  const cached = hits.map((file) => ({ file, ok: true, code: 0, sec: 0, out: '(кэш оракула)' }));
  const results = [...ran, ...cached];

  if (!forceFull) {
    const nextCache = { ...cache };
    for (const r of ran) {
      if (r.ok) nextCache[r.file] = { key: entries[r.file], ts: Date.now() };
      else delete nextCache[r.file]; // красный никогда не считается «неизменным» (R3)
    }
    oracleCache.saveCache(ROOT, nextCache);
  }

  const failed = results.filter((r) => !r.ok);
  const wall = ((Date.now() - started) / 1000).toFixed(1);
  const slow = [...results].sort((a, b) => b.sec - a.sec).slice(0, 3)
    .map((r) => `${r.file} ${r.sec.toFixed(1)}s`).join(', ');
  console.error(`\nelt-oracle-runner: ${run.length - failed.length}/${run.length} passed in ${wall}s (slowest: ${slow})`);
  if (failed.length) console.error(`FAILED: ${failed.map((r) => r.file).join(', ')}`);
  process.exit(failed.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = {
  discover, SKIP, TEST_ROOTS, jobsFrom, runFile, runAll, changedFiles, oracleSelectMode, slicesSinceFull,
  partitionByCache, harnessOracleCmd,
};
