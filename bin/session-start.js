#!/usr/bin/env node
'use strict';
// SessionStart — сводка ELT по проекту. 020 T012.
//
// До этой задачи бриф жил ТОЛЬКО в `~/.claude/hooks/elt-session-brief.js` — файле без
// источника в репозитории (аудит 020/T004: шесть из семи активных хуков не имеют источника
// вообще). Такой хук нельзя ни проверить оракулом, ни поставить новому пользователю вместе с
// плагином: он существует лишь на одной машине и правится руками. Здесь он становится частью
// плагина, версионируется вместе с ним и покрывается тестом.
//
// Три свойства, без которых хук вредит больше, чем помогает:
//   * молчит, где сказать нечего (не ELT-проект → пустой вывод, exit 0);
//   * только читает — ничего не запускает и не чинит, поэтому не может задержать старт сессии;
//   * не содержит абсолютных путей: команды в подсказках идут от `${CLAUDE_PLUGIN_ROOT}`,
//     иначе подсказка ведёт на чужую машину.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Маршрут к рантайму. Внутри установленного плагина переменную подставляет Claude Code; при
// прямом запуске из репозитория берём корень относительно этого файла. Абсолютного пути
// пользователя здесь нет ни в одной ветке — это и есть требование задачи.
function runtimeRoute(env = process.env) {
  return env.CLAUDE_PLUGIN_ROOT ? '${CLAUDE_PLUGIN_ROOT}/tools/elt.js' : 'tools/elt.js';
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function readJsonl(file) {
  return readText(file).split(/\r?\n/).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

// План: самый свежий `specs/*/tasks.md` — тот же выбор, что делает `elt` без `--spec`.
function planSummary(cwd) {
  const specsDir = path.join(cwd, 'specs');
  if (!fs.existsSync(specsDir)) return null;
  const files = fs.readdirSync(specsDir)
    .map((d) => path.join(specsDir, d, 'tasks.md'))
    .filter((f) => fs.existsSync(f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!files.length) return null;
  const body = readText(files[0]);
  const open = body.match(/^- \[ \] \*\*(T\d+)\*\*(.*)$/gm) || [];
  const done = (body.match(/^- \[[Xx]\]/gm) || []).length;
  return {
    file: path.relative(cwd, files[0]).split(path.sep).join('/'),
    open: open.length,
    done,
    next: open[0] ? open[0].replace(/^- \[ \] \*\*/, '').replace(/\*\*/, '').slice(0, 100) : null,
  };
}

function gitFacts(cwd, run) {
  const git = run || ((args) => spawnSync('git', args, { cwd, encoding: 'utf8' }));
  const branch = (git(['branch', '--show-current']).stdout || '').trim();
  const dirty = (git(['status', '--porcelain']).stdout || '').split(/\r?\n/).filter(Boolean).length;
  return { branch, dirty };
}

function brief({ cwd = process.cwd(), env = process.env, git } = {}) {
  const harness = path.join(cwd, '.harness', 'harness.json');
  if (!fs.existsSync(harness)) return ''; // не ELT-проект — молчим
  let cfg = {};
  try { cfg = JSON.parse(readText(harness)); } catch { /* битый конфиг покажет doctor */ }

  const { branch, dirty } = gitFacts(cwd, git);
  const plan = planSummary(cwd);
  const queue = readJsonl(path.join(cwd, '.harness', 'review-queue.jsonl')).filter((r) => !r.closedAt);

  const out = [
    `ELT: ветка ${branch || '—'}${dirty ? `, дерево грязное (${dirty} файлов)` : ', дерево чистое'}`
    + `, verify: ${cfg.verify || 'sync'}`,
  ];
  if (plan) {
    out.push(`  план ${plan.file} — открыто ${plan.open}, закрыто ${plan.done}`);
    if (plan.next) out.push(`  следующая: ${plan.next}`);
  }
  if (queue.length) {
    out.push(`  ⚠ elt review: ${queue.length} фоновых красных на разборе`
      + ` (node "${runtimeRoute(env)}" review close --task Txxx)`);
    for (const q of queue.slice(-2)) {
      out.push(`      [${q.layer || q.kind}] ${q.task} ${q.commit || ''} — ${String(q.reason || '').slice(0, 80)}`);
    }
  }
  // Спекулятивный контур возвращает управление ДО тяжёлых слоёв, поэтому пустая очередь на
  // старте сессии ничего не доказывает: фон предыдущей сессии мог не закончить.
  if (cfg.verify === 'background') {
    out.push('  напоминание: коммит возвращает управление сразу — пустая очередь ещё не значит «зелено», фон мог не закончить');
  }
  return out.join('\n');
}

function main(argv = process.argv.slice(2), out = process.stdout, env = process.env) {
  const cwdIdx = argv.indexOf('--cwd');
  const text = brief({ cwd: cwdIdx >= 0 ? argv[cwdIdx + 1] : process.cwd(), env });
  if (text) out.write(text + '\n');
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { brief, planSummary, runtimeRoute, main };
