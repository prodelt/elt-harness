#!/usr/bin/env node
'use strict';

/**
 * update-judge-verdicts-index.js — ELT-CODE Фаза 4
 *
 * Собирает кросс-проектный индекс judge_verdict из session-ledger.jsonl.
 * On-demand (НЕ file-watcher, НЕ SessionStart, НЕ claude-mem авто-инъекция).
 *
 * Источник по умолчанию: ~/.claude/projects/<key>/session-ledger.jsonl
 * Доп. леджеры — позиционными аргументами (напр. live-fire в ~/.claude/tmp/...).
 *
 * Канон-схема события (как пишет судья в скиле):
 *   {type:"judge_verdict", ts, task, complexity, slice, model, verdict,
 *    hard:{H1:{r,note},H2:{r,note}}, soft:{S1:{score}..S4:{score}}, summary}
 *
 * ponytail: полная регенерация из леджеров, НЕ append-merge. Леджеры = источник
 * правды (durable), пересборка не теряет данные и дедупит даром. Upgrade: если
 * появятся вердикты, живущие ТОЛЬКО в индексе (архив удалённых проектов) — тогда merge.
 *
 * Usage:
 *   node tools/update-judge-verdicts-index.js                 # канон-источник
 *   node tools/update-judge-verdicts-index.js <ledger.jsonl>  # + доп. леджеры
 *   node tools/update-judge-verdicts-index.js --json          # машинный вывод, не пишет файл
 *   node tools/update-judge-verdicts-index.js --out <path>    # своя цель
 *   node tools/update-judge-verdicts-index.js --self-check    # assert-проверка
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const PROJECTS_DIR = path.join(HOME, '.claude', 'projects');
const DEFAULT_OUT = path.join(PROJECTS_DIR, '_verdict-index', 'judge-verdicts.md');

// ── pure core ──────────────────────────────────────────────────────────────

/** Распарсить строки леджера → массив judge_verdict-событий (прочие строки игнор). */
function parseLedgerLines(text, projectKey) {
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let ev;
    try { ev = JSON.parse(s); } catch { continue; } // битые строки молча пропускаем
    if (!ev || ev.type !== 'judge_verdict') continue;
    out.push({ ...ev, projectKey });
  }
  return out;
}

/** Дедуп по (projectKey, ts) — последнее вхождение побеждает. */
function dedup(verdicts) {
  const map = new Map();
  for (const v of verdicts) map.set(`${v.projectKey}|${v.ts}`, v);
  return [...map.values()];
}

function sAvg(v) {
  const s = v.soft || {};
  const nums = ['S1', 'S2', 'S3', 'S4']
    .map(k => (s[k] && typeof s[k].score === 'number' ? s[k].score : null))
    .filter(n => n !== null);
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function hardCell(v, key) {
  const h = (v.hard || {})[key];
  if (!h || !h.r) return '—';
  return h.r === 'pass' ? '✓' : h.r === 'fail' ? '✗' : h.r;
}

function isHardBlock(v) {
  const h = v.hard || {};
  return ['H1', 'H2'].some(k => h[k] && h[k].r === 'fail');
}

function truncate(str, n) {
  const s = String(str == null ? '' : str).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Markdown-индекс из вердиктов. */
function renderMarkdown(verdicts, generatedAt) {
  const byProject = new Map();
  for (const v of verdicts) {
    if (!byProject.has(v.projectKey)) byProject.set(v.projectKey, []);
    byProject.get(v.projectKey).push(v);
  }

  const lines = [];
  lines.push('# Judge Verdict Index — кросс-проектный');
  lines.push('');
  lines.push('> Автогенерация `tools/update-judge-verdicts-index.js` (on-demand). НЕ редактировать вручную.');
  lines.push(`> Обновлено: ${generatedAt} · источник: \`~/.claude/projects/*/session-ledger.jsonl\` (+ extra).`);
  lines.push('> Читается ON-DEMAND (вход `/elt-code` по projectKey или тулинг Фазы B) — НЕ авто-инъекция.');
  lines.push('');

  // агрегаты
  const total = verdicts.length;
  const blocks = verdicts.filter(isHardBlock).length;
  const blockPct = total ? Math.round((blocks / total) * 100) : 0;
  const avgs = verdicts.map(sAvg).filter(n => n !== null);
  const overallS = avgs.length ? (avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(2) : '—';
  const modelDist = {};
  for (const v of verdicts) modelDist[v.model || '?'] = (modelDist[v.model || '?'] || 0) + 1;
  const modelStr = Object.entries(modelDist).map(([m, n]) => `${m}:${n}`).join(', ') || '—';

  lines.push('## Агрегаты');
  lines.push('');
  lines.push(`- Всего прогонов: **${total}** в ${byProject.size} проект(ах)`);
  lines.push(`- Hard-block (H1/H2 fail): **${blocks}** (${blockPct}%)`);
  lines.push(`- Средний S (S1-S4): **${overallS}**`);
  lines.push(`- Распределение моделей: ${modelStr}`);
  lines.push('');

  // per-project таблицы (хронология = тренд; ponytail: отдельную линию тренда не строим)
  for (const [pk, vs] of [...byProject.entries()].sort()) {
    vs.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    lines.push(`## ${pk}`);
    lines.push('');
    lines.push('| run | дата | задача | сложн. | H1 | H2 | S-avg | модель | вердикт |');
    lines.push('|----:|------|--------|--------|:--:|:--:|:-----:|--------|---------|');
    vs.forEach((v, i) => {
      const sa = sAvg(v);
      lines.push(`| ${i + 1} | ${truncate((v.ts || '').slice(0, 10), 10)} | ${truncate(v.task, 48)} | ${truncate(v.complexity, 8)} | ${hardCell(v, 'H1')} | ${hardCell(v, 'H2')} | ${sa === null ? '—' : sa.toFixed(1)} | ${truncate(v.model, 10)} | ${truncate(v.verdict, 10)} |`);
    });
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

// ── io ───────────────────────────────────────────────────────────────────────

function findCanonicalLedgers() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  const out = [];
  for (const entry of fs.readdirSync(PROJECTS_DIR)) {
    if (entry.startsWith('_')) continue; // _verdict-index и т.п.
    const led = path.join(PROJECTS_DIR, entry, 'session-ledger.jsonl');
    if (fs.existsSync(led)) out.push(led);
  }
  return out;
}

function collectVerdicts(ledgerPaths) {
  let all = [];
  for (const p of ledgerPaths) {
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
    const projectKey = path.basename(path.dirname(p));
    all = all.concat(parseLedgerLines(text, projectKey));
  }
  return dedup(all);
}

// ── self-check (ponytail: parser/aggregate — нетривиальная логика) ────────────

function selfCheck() {
  const assert = require('assert');
  const sample = [
    '{"type":"other","ts":"x"}',
    '{"type":"judge_verdict","ts":"2026-01-01T00:00:00Z","task":"a","complexity":"MEDIUM","model":"sonnet","verdict":"block","hard":{"H1":{"r":"fail"},"H2":{"r":"pass"}},"soft":{"S1":{"score":2},"S2":{"score":4},"S3":{"score":3},"S4":{"score":3}}}',
    'не-json мусор',
  ].join('\n');
  const parsed = parseLedgerLines(sample, 'proj');
  assert.strictEqual(parsed.length, 1, 'фильтрует не-verdict и битые строки');
  assert.strictEqual(parsed[0].projectKey, 'proj');
  assert.strictEqual(sAvg(parsed[0]), 3, 'S-avg = (2+4+3+3)/4 = 3');
  assert.strictEqual(isHardBlock(parsed[0]), true, 'H1 fail → hard-block');
  // дедуп по (projectKey, ts)
  const dup = dedup([...parsed, ...parsed]);
  assert.strictEqual(dup.length, 1, 'дедуп по projectKey|ts');
  const md = renderMarkdown(parsed, 'TEST');
  assert.ok(md.includes('Hard-block (H1/H2 fail): **1** (100%)'), 'агрегат block%');
  assert.ok(md.includes('| 1 | 2026-01-01 | a |'), 'строка таблицы');
  console.log('self-check OK');
}

// ── cli ────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-check')) return selfCheck();

  const isJson = args.includes('--json');
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args[outIdx + 1] : DEFAULT_OUT;

  const extra = args.filter((a, i) =>
    !a.startsWith('--') && !(outIdx >= 0 && i === outIdx + 1));

  const ledgers = [...findCanonicalLedgers(), ...extra];
  const verdicts = collectVerdicts(ledgers);
  const generatedAt = new Date().toISOString();

  if (isJson) {
    process.stdout.write(JSON.stringify({ generatedAt, ledgers, count: verdicts.length, verdicts }, null, 2) + '\n');
    return;
  }

  const md = renderMarkdown(verdicts, generatedAt);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md);
  console.log(`Indexed ${verdicts.length} verdict(s) from ${ledgers.length} ledger(s) → ${outPath}`);
}

main();
