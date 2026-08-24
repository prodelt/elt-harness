#!/usr/bin/env node
'use strict';
// bin/l0.js — 019 T011. Механический гейт L0 как точка входа плагина.
//
// L0 — единственная синхронная часть гейта (016 T011): судья ушёл в фон, а L0 остался
// перед оракулом, потому что он не стоит ни одного LLM-вызова. Здесь только транспорт:
// собрать дифф целевого проекта, отдать его чистой `evaluate()` и напечатать вердикт.
// Вся логика правил живёт в `tools/elt-gate-l0.js` и там же под тестами — дублировать её
// в плагине значило бы завести второй источник правды ровно того класса, который спека 019
// и убирает.

const path = require('path');
const { spawnSync } = require('child_process');

const PLUGIN_ROOT = path.join(__dirname, '..');
const l0 = require(path.join(PLUGIN_ROOT, 'tools', 'elt-gate-l0.js'));

// `core.quotepath=false` — D21: git отдаёт путь с кириллицей в C-кавычках, и любой разбор
// вывода спотыкается об это молча. Флаг ставится в КАЖДОМ вызове git, а не в конфиге репо:
// плагин не имеет права править настройки чужого проекта.
function git(args, cwd) {
  const res = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error || res.status !== 0) return '';
  return res.stdout || '';
}

function collect(cwd) {
  return {
    diff: git(['diff', 'HEAD'], cwd) + git(['diff', '--cached'], cwd),
    status: git(['status', '--porcelain'], cwd),
  };
}

function evaluateProject({ cwd = process.cwd(), taskText = '' } = {}) {
  const { diff, status } = collect(cwd);
  const config = l0.loadConfig(cwd);
  const res = l0.evaluate({ diff, status, config, cwd, taskText });
  const verdict = res.verdict || (res.judgeNeeded ? 'judge-needed' : 'pass');
  return { verdict, triggers: res.triggers || [], judgeNeeded: !!res.judgeNeeded };
}

function formatText(res) {
  const lines = [`elt-l0: ${res.verdict}`];
  if (!res.triggers.length) lines.push('  триггеров нет');
  for (const t of res.triggers) {
    lines.push(`  - ${t.name}: ${t.reason}`);
    if (t.files && t.files.length) lines.push(`    ${t.files.join(', ')}`);
  }
  return lines.join('\n') + '\n';
}

function main(argv = process.argv.slice(2), out = process.stdout) {
  const cwdIdx = argv.indexOf('--cwd');
  const cwd = cwdIdx !== -1 ? argv[cwdIdx + 1] : process.cwd();
  const taskIdx = argv.indexOf('--task-text');
  const taskText = taskIdx !== -1 ? argv[taskIdx + 1] : '';

  const res = evaluateProject({ cwd, taskText });
  out.write(argv.includes('--json') ? JSON.stringify(res, null, 2) + '\n' : formatText(res));
  // 3, а не 1: «гейт заблокировал» надо отличать от «гейт сам упал».
  return res.verdict === 'block' ? 3 : 0;
}

if (require.main === module) process.exit(main());

module.exports = { evaluateProject, collect, formatText, main, PLUGIN_ROOT };
