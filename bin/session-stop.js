#!/usr/bin/env node
'use strict';
// Stop — dirty-exit gate. 020 T012.
//
// Не даёт закончить сессию, которая правила файлы в ELT-проекте и оставила дерево git грязным:
// незакоммиченная правка не попадает ни в run-log, ни под судью, то есть выпадает из замера
// «доля работы через харнес» и из ревью целиком.
//
// Перенесён в плагин из `~/.claude/hooks/dirty-exit-gate.js` — файла без источника в
// репозитории. Заодно снят живой дефект той копии: она советовала
// `node ~/.claude/bin/elt.js commit`, то есть развёрнутую копию рантайма, СНЯТУЮ спекой
// 019 T015. Совет вёл в несуществующий файл у всех, кто перешёл на плагин.
//
// Аварийные выходы (все — fail-open, гейт не имеет права запереть сессию по своей ошибке):
// `stop_hook_active` (не зацикливаться), нет `.harness/harness.json`, не git-репо, эта сессия
// ничего не правила, дерево чистое, транскрипт нечитаем.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// `.harness/` — метаданные харнеса (run-log пишется ПОСЛЕ коммита): держать сессию из-за них
// значило бы требовать закоммитить то, что породил сам гейт.
const HARNESS_DIRT = /^..\s+"?\.harness\//;
const EDIT_TOOLS = /"name":\s*"(Edit|Write|MultiEdit|NotebookEdit)"/;

function runtimeRoute(env = process.env) {
  return env.CLAUDE_PLUGIN_ROOT ? '${CLAUDE_PLUGIN_ROOT}/tools/elt.js' : 'tools/elt.js';
}

function dirtyFiles(cwd, git) {
  const run = git || ((args) => spawnSync('git', args, { cwd, encoding: 'utf8' }));
  if (run(['rev-parse', '--is-inside-work-tree']).status !== 0) return null; // не репо
  return (run(['status', '--porcelain']).stdout || '')
    .split(/\r?\n/).filter((l) => l.trim() && !HARNESS_DIRT.test(l));
}

// Правила ли ЭТА сессия файлы внутри проекта? Иначе гейт ругался бы на грязь, которая лежала
// до её начала, — а это не её работа и не её ответственность.
function editedHere(transcriptPath, cwd) {
  let lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').split(/\r?\n/); } catch { return null; } // fail-open
  const cwdNorm = cwd.replace(/\\/g, '/').toLowerCase();
  for (const line of lines) {
    if (!line.includes('"tool_use"') || !EDIT_TOOLS.test(line)) continue;
    const m = line.match(/"(?:file_path|notebook_path)":\s*"((?:[^"\\]|\\.)*)"/);
    if (!m) continue;
    const file = m[1].replace(/\\\\/g, '/').replace(/\\/g, '/').toLowerCase();
    if (file.startsWith(cwdNorm)) return true;
  }
  return false;
}

// Решение гейта как чистая функция: вход — то, что даёт Claude Code, выход — либо null
// (сессия свободна), либо объект блокировки. Тестируется без запуска процесса.
function decide(input, { env = process.env, git, exists = fs.existsSync } = {}) {
  if (!input || input.stop_hook_active) return null; // анти-цикл: одна блокировка на цепочку
  const cwd = input.cwd || process.cwd();
  if (!exists(path.join(cwd, '.harness', 'harness.json'))) return null; // opt-in по проекту

  const dirty = dirtyFiles(cwd, git);
  if (dirty === null || !dirty.length) return null;
  if (editedHere(input.transcript_path, cwd) !== true) return null;

  const files = dirty.slice(0, 10).join('\n');
  const route = runtimeRoute(env);
  return {
    decision: 'block',
    reason:
      `DIRTY-EXIT GATE: в этой сессии правились файлы, а дерево git осталось грязным:\n${files}\n`
      + `Закрой работу цепочкой гейта одним заходом:\n`
      + `  node "${route}" oracle --full\n`
      + `  node "${route}" judge run --task Txxx\n`
      + `  node "${route}" commit --task Txxx --skip-oracle -m "<type>: описание"\n`
      + `Если коммитить нельзя (работа не завершена или тесты красные) — скажи это пользователю `
      + `ЯВНО одной строкой и заверши ход снова.`,
  };
}

function main(stdin, out = process.stdout, options = {}) {
  let input = null;
  try { input = JSON.parse(stdin); } catch { return 0; } // нечитаемый вход — fail-open
  const verdict = decide(input, options);
  if (verdict) out.write(JSON.stringify(verdict));
  return 0;
}

if (require.main === module) {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { process.exit(0); }
  process.exit(main(raw));
}

module.exports = { decide, editedHere, dirtyFiles, runtimeRoute, main };
