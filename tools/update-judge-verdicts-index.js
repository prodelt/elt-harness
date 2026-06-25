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

// ── B-линза: здоровье судьи + тренды + recall (Фаза B0-B2) ────────────────────

const DEGENERATE_MIN_N = 5;     // ниже — «мало данных», не «штамп»
const DEGENERATE_STDEV = 0.25;  // разброс ниже → судья почти не различает
// ponytail: пороги-эвристики, калибруются на реальном корпусе (см. ELT-CODE-B-DESIGN «порог на советника»)

/** Популяционный stdev (n<2 → 0). */
function stdev(nums) {
  if (!nums || nums.length < 2) return 0;
  const m = nums.reduce((a, b) => a + b, 0) / nums.length;
  const v = nums.reduce((a, b) => a + (b - m) * (b - m), 0) / nums.length;
  return Math.sqrt(v);
}

/** Все S-оценки корпуса плоским списком. */
function allScores(verdicts) {
  const out = [];
  for (const v of verdicts) {
    const s = v.soft || {};
    for (const k of ['S1', 'S2', 'S3', 'S4']) {
      if (s[k] && typeof s[k].score === 'number') out.push(s[k].score);
    }
  }
  return out;
}

/** По каждой оси: {n, mean, stdev}. */
function axisStats(verdicts) {
  const res = {};
  for (const k of ['S1', 'S2', 'S3', 'S4']) {
    const nums = verdicts
      .map(v => (v.soft || {})[k])
      .filter(x => x && typeof x.score === 'number')
      .map(x => x.score);
    res[k] = {
      n: nums.length,
      mean: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null,
      stdev: stdev(nums),
    };
  }
  return res;
}

/** (i) Здоровье судьи: вырожден ли (штампует одинаково при достаточном n). */
function judgeHealth(verdicts) {
  const scores = allScores(verdicts);
  const sd = stdev(scores);
  const degenerate = scores.length >= DEGENERATE_MIN_N && sd < DEGENERATE_STDEV;
  return { n: scores.length, stdev: sd, degenerate, axes: axisStats(verdicts) };
}

/** Слабейшая ось (минимум среднего) или null. */
function weakestAxis(verdicts) {
  const a = axisStats(verdicts);
  let lo = null;
  for (const k of ['S1', 'S2', 'S3', 'S4']) {
    if (a[k].mean === null) continue;
    if (lo === null || a[k].mean < a[lo].mean) lo = k;
  }
  return lo;
}

/** Зуб №1: метка доверия к цифре по n. */
function confidence(n) {
  if (n >= 12) return 'надёжно';
  if (n >= DEGENERATE_MIN_N) return `умеренно (n=${n})`;
  return `слабо (n=${n})`;
}

/** (ii) Тренд S-avg по хронологии: ↑/↓/→ (n<2 → →; сравнение первой и последней половины). */
function trend(verdicts) {
  const avgs = verdicts.map(sAvg).filter(x => x !== null);
  if (avgs.length < 2) return '→';
  const half = Math.floor(avgs.length / 2);
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const d = mean(avgs.slice(avgs.length - half)) - mean(avgs.slice(0, half));
  return d > 0.3 ? '↑' : d < -0.3 ? '↓' : '→';
}

/** Распарсить judge_miss-события (ручной recall-крючок, схема: {type,ts,ref_verdict_ts,what}). */
function parseMissLines(text, projectKey) {
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let ev;
    try { ev = JSON.parse(s); } catch { continue; }
    if (!ev || ev.type !== 'judge_miss') continue;
    out.push({ ...ev, projectKey });
  }
  return out;
}

/** recall = ловли/(ловли+промахи). ponytail: грубо — каждый block = верная ловля (FP-сигнала нет). */
function recallStats(verdicts, misses) {
  const caught = verdicts.filter(v => v.verdict === 'block').length;
  const missed = misses.length;
  const denom = caught + missed;
  return { caught, missed, recall: denom ? caught / denom : null };
}

function truncate(str, n) {
  const s = String(str == null ? '' : str).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Markdown-индекс из вердиктов. */
function renderMarkdown(verdicts, misses, generatedAt) {
  misses = misses || [];
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

  // (i) Здоровье судьи — зуб №2: вырождение гейтит доверие к (ii) ниже
  const health = judgeHealth(verdicts);
  lines.push('## Здоровье судьи (i)');
  lines.push('');
  if (health.degenerate) {
    lines.push(`> ⚠ **Судья под вопросом:** разброс σ=${health.stdev.toFixed(2)} на ${health.n} оценках — судья почти не различает (штампует). Раздел качества работы ниже — **(ii) недостоверно**.`);
  } else if (health.n < DEGENERATE_MIN_N) {
    lines.push(`> Данных мало (n=${health.n}) — здоровье судьи оценивается слабо. σ=${health.stdev.toFixed(2)}.`);
  } else {
    lines.push(`> Судья различает: σ=${health.stdev.toFixed(2)} на ${health.n} оценках.`);
  }
  lines.push('');
  lines.push('| ось | среднее | σ | n |');
  lines.push('|-----|:-------:|:-:|:-:|');
  for (const k of ['S1', 'S2', 'S3', 'S4']) {
    const a = health.axes[k];
    lines.push(`| ${k} | ${a.mean === null ? '—' : a.mean.toFixed(2)} | ${a.stdev.toFixed(2)} | ${a.n} |`);
  }
  lines.push('');

  // recall (внешняя валидность) — только при наличии judge_miss (иначе честно молчим)
  if (misses.length) {
    const r = recallStats(verdicts, misses);
    lines.push('## Recall судьи (внешняя валидность)');
    lines.push('');
    lines.push(`- Промахов (judge_miss): **${r.missed}** · ловли (block): **${r.caught}** · recall ≈ **${r.recall === null ? '—' : r.recall.toFixed(2)}**`);
    lines.push('> Груб: каждый block считается верной ловлей (FP-сигнала нет). Кормится вручную событиями `judge_miss`.');
    lines.push('');
  }

  // (ii) per-project: тренд + слабейшая ось + метка доверия (зуб №1); вырождение → недостоверно (зуб №2)
  for (const [pk, vs] of [...byProject.entries()].sort()) {
    vs.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    lines.push(`## ${pk}`);
    lines.push('');
    const gate = health.degenerate ? ' · ⚠ **(ii) недостоверно** — судья под вопросом' : '';
    lines.push(`Тренд S-avg: **${trend(vs)}** · слабейшая ось: **${weakestAxis(vs) || '—'}** · доверие: **${confidence(vs.length)}**${gate}`);
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

function collectEvents(ledgerPaths) {
  let verdicts = [];
  let misses = [];
  for (const p of ledgerPaths) {
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
    const projectKey = path.basename(path.dirname(p));
    verdicts = verdicts.concat(parseLedgerLines(text, projectKey));
    misses = misses.concat(parseMissLines(text, projectKey));
  }
  return { verdicts: dedup(verdicts), misses };
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
  const md = renderMarkdown(parsed, [], 'TEST');
  assert.ok(md.includes('Hard-block (H1/H2 fail): **1** (100%)'), 'агрегат block%');
  assert.ok(md.includes('| 1 | 2026-01-01 | a |'), 'строка таблицы');

  // ── B-линза: фикстуры-билдер ──
  const mkV = (sc, verdict = 'pass', ts = '2026-01-01') => ({
    type: 'judge_verdict', ts, task: 't', complexity: 'MEDIUM', verdict,
    hard: { H1: { r: 'pass' }, H2: { r: 'pass' } },
    soft: { S1: { score: sc[0] }, S2: { score: sc[1] }, S3: { score: sc[2] }, S4: { score: sc[3] } },
    projectKey: 'proj',
  });

  // B0 — здоровье судьи + метка доверия
  assert.ok(Math.abs(stdev([2, 4, 3, 3]) - Math.sqrt(0.5)) < 1e-9, 'stdev (популяционный)');
  const flat = Array.from({ length: 5 }, () => mkV([4, 4, 4, 4]));
  assert.strictEqual(judgeHealth(flat).degenerate, true, 'нулевой разброс + n≥порог → штамп');
  const varied = [mkV([1, 2, 3, 4]), mkV([5, 4, 2, 1]), mkV([2, 5, 3, 1]), mkV([4, 1, 5, 2]), mkV([3, 3, 1, 5])];
  assert.strictEqual(judgeHealth(varied).degenerate, false, 'есть разброс → не штамп');
  assert.strictEqual(weakestAxis([mkV([2, 4, 4, 4])]), 'S1', 'слабейшая ось');
  assert.ok(confidence(2).includes('слабо'), 'метка доверия: n=2 слабо');
  assert.strictEqual(confidence(20), 'надёжно', 'метка доверия: большой n надёжно');

  // B1 — тренд per-project
  assert.strictEqual(trend([mkV([2, 2, 2, 2]), mkV([2, 2, 2, 2]), mkV([5, 5, 5, 5]), mkV([5, 5, 5, 5])]), '↑', 'тренд вверх');
  assert.strictEqual(trend([mkV([5, 5, 5, 5]), mkV([5, 5, 5, 5]), mkV([2, 2, 2, 2]), mkV([2, 2, 2, 2])]), '↓', 'тренд вниз');
  assert.strictEqual(trend([mkV([3, 3, 3, 3]), mkV([3, 3, 3, 3])]), '→', 'тренд плоский');

  // B2 — recall-крючок judge_miss
  const missSample = '{"type":"judge_miss","ts":"2026-01-02","ref_verdict_ts":"2026-01-01","what":"PASS, всплыл баг"}\n{"type":"other"}';
  const misses = parseMissLines(missSample, 'proj');
  assert.strictEqual(misses.length, 1, 'парсит judge_miss, игнор прочего');
  const rec = recallStats([mkV([4, 4, 4, 4], 'block'), mkV([4, 4, 4, 4], 'block'), mkV([4, 4, 4, 4], 'pass')], misses);
  assert.strictEqual(rec.caught, 2, 'ловли = block-вердикты');
  assert.strictEqual(rec.missed, 1, 'промахи = judge_miss');
  assert.ok(Math.abs(rec.recall - 2 / 3) < 1e-9, 'recall = caught/(caught+missed) = 2/3');

  // зуб №2 — вырождение гейтит (ii)
  const mdDegen = renderMarkdown(flat, [], 'TEST');
  assert.ok(mdDegen.includes('Судья под вопросом'), 'баннер вырождения');
  assert.ok(mdDegen.includes('(ii) недостоверно'), 'зуб №2: (ii) помечен недостоверным');

  // recall-раздел: есть при judge_miss, скрыт без
  assert.ok(renderMarkdown(varied, misses, 'TEST').includes('Recall судьи'), 'recall-раздел при judge_miss');
  assert.ok(!renderMarkdown(varied, [], 'TEST').includes('Recall судьи'), 'recall-раздел скрыт без judge_miss');

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
  const { verdicts, misses } = collectEvents(ledgers);
  const generatedAt = new Date().toISOString();

  if (isJson) {
    process.stdout.write(JSON.stringify({ generatedAt, ledgers, count: verdicts.length, misses: misses.length, verdicts }, null, 2) + '\n');
    return;
  }

  const md = renderMarkdown(verdicts, misses, generatedAt);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md);
  console.log(`Indexed ${verdicts.length} verdict(s) + ${misses.length} miss(es) from ${ledgers.length} ledger(s) → ${outPath}`);
}

main();
