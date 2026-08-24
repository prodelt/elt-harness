#!/usr/bin/env node
'use strict';
// bin/oracle.js — 019 T011. Механический оракул как точка входа плагина.
//
// Оракул ВСЕГДА объявляет, что именно он гонял. Молчаливый зелёный неотличим от «не гонял
// ничего» — этот класс уже стоил ложных «оракул зелёный» в чужих проектах, где конфиг не
// доехал (аудит 2026-08-11: домашний оракул гнался везде, 100% ложных красных).
//
// Источник команды — только `.harness/harness.json` целевого проекта. Если конфига нет,
// оракул НЕ выдумывает команду проекта, а честно откатывается на `node --test` по
// найденным `*.test.js` и говорит об этом.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const IGNORED_DIRS = new Set(['node_modules', '.git', '.fleet-wt', 'vendor', 'dist', 'build', '.next']);

function harnessOracleCmd(cwd) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(cwd, '.harness', 'harness.json'), 'utf8'));
    return typeof cfg.oracle === 'string' && cfg.oracle.trim() ? cfg.oracle.trim() : null;
  } catch {
    return null;
  }
}

function discoverTests(dir, root = dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) discoverTests(full, root, out);
    else if (entry.name.endsWith('.test.js')) out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out;
}

function run({ cwd = process.cwd(), full = false, env = process.env, spawn = spawnSync, log = (s) => process.stderr.write(s) } = {}) {
  const named = harnessOracleCmd(cwd);
  const childEnv = { ...env };
  if (full) childEnv.ELT_ORACLE_FULL = '1';

  if (named) {
    log(`elt-oracle: именованный оракул проекта — ${named}${full ? ' (--full)' : ''}\n`);
    const res = spawn(named, { cwd, env: childEnv, shell: true, stdio: 'inherit' });
    return { mode: 'named', command: named, status: res.status === null ? 1 : res.status };
  }

  const tests = discoverTests(cwd);
  if (!tests.length) {
    log('elt-oracle: конфига .harness/harness.json нет и ни одного *.test.js не найдено — гонять нечего\n');
    return { mode: 'empty', command: null, status: 1, tests: [] };
  }
  log(`elt-oracle: конфига нет, откат на node --test по ${tests.length} файлам\n`);
  const res = spawn(process.execPath, ['--test', ...tests], { cwd, env: childEnv, stdio: 'inherit' });
  return { mode: 'fallback', command: `node --test (${tests.length} файлов)`, status: res.status === null ? 1 : res.status, tests };
}

function main(argv = process.argv.slice(2)) {
  const full = argv.includes('--full');
  const cwdIdx = argv.indexOf('--cwd');
  const cwd = cwdIdx !== -1 ? argv[cwdIdx + 1] : process.cwd();
  return run({ cwd, full }).status;
}

if (require.main === module) process.exit(main());

module.exports = { run, harnessOracleCmd, discoverTests, main, IGNORED_DIRS };
