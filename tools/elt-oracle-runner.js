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
//   node tools/elt-oracle-runner.js [--jobs N | --serial]   (env: ELT_ORACLE_JOBS)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

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

async function main() {
  const files = discover(path.join(ROOT, 'tools'))
    .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
    .sort();
  const run = files.filter((f) => !SKIP.has(f));
  const skipped = files.filter((f) => SKIP.has(f));
  const jobs = jobsFrom(process.argv.slice(2));

  console.error(`elt-oracle-runner: ${run.length} test files, jobs=${jobs} (${skipped.length} skipped: ${skipped.join(', ') || 'none'})`);
  const started = Date.now();
  const results = await runAll(run, jobs, ROOT, (r) => {
    if (!r.ok) {
      console.error(`\n── FAIL ${r.file} (exit ${r.code}, ${r.sec.toFixed(1)}s) ──`);
      console.error(r.out);
    }
  });

  const failed = results.filter((r) => !r.ok);
  const wall = ((Date.now() - started) / 1000).toFixed(1);
  const slow = [...results].sort((a, b) => b.sec - a.sec).slice(0, 3)
    .map((r) => `${r.file} ${r.sec.toFixed(1)}s`).join(', ');
  console.error(`\nelt-oracle-runner: ${run.length - failed.length}/${run.length} passed in ${wall}s (slowest: ${slow})`);
  if (failed.length) console.error(`FAILED: ${failed.map((r) => r.file).join(', ')}`);
  process.exit(failed.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = { discover, SKIP, jobsFrom, runFile, runAll };
