'use strict';
// 011 T027 — правило 4 схемы C: «эволюция сама проходит гейт». До этого слайса рубрика,
// пороги и промпт судьи правились вручную и НИ РАЗУ не проверялись на «помогло ли» — T022 дал
// числа, T023 дал judge-bench с реальными кейсами, но между ними и правкой gate.js/промпта
// не было моста. Мост: правка обязана нести evidence+rootCause+predictedImpact (дёшево,
// без сети) и прогоняется на judge-bench ПРОТИВ последнего сохранённого прогона (baseline) —
// ухудшила recall/falsePositiveRate → отказ в learnings.jsonl, не ухудшила → применяется.
//
// «Применяется»/«не применяется» здесь — не git-операция (правка гейта уже лежит в дереве,
// откатывать код не задача этого файла): это ворота ПЕРЕД `elt commit` того слайса, тем же
// духом, что red-proof — не чинит, только пропускает или останавливает с явной причиной.
const fs = require('fs');
const path = require('path');

const LEARNINGS = path.join('.harness', 'learnings.jsonl');

function validate({ evidence, rootCause, predictedImpact }) {
  const missing = [];
  if (!evidence || !String(evidence).trim()) missing.push('evidence');
  if (!rootCause || !String(rootCause).trim()) missing.push('root-cause');
  if (!predictedImpact || !String(predictedImpact).trim()) missing.push('predicted-impact');
  return missing.length ? { ok: false, reason: `отсутствует: ${missing.join(', ')}` } : { ok: true };
}

// Последний прогон judge-bench в .planning/ (T023 кладёт их туда) — самый свежий по mtime,
// если явный --baseline не задан. Ни одного файла нет → нечем измерить «ухудшила», честный отказ.
function findLatestBaseline(root) {
  const dir = path.join(root, '.planning');
  let files;
  try { files = fs.readdirSync(dir); } catch { return null; }
  const candidates = files
    .filter((f) => /^JUDGE-BENCH-.*\.json$/.test(f))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!candidates.length) return null;
  try { return JSON.parse(fs.readFileSync(path.join(dir, candidates[0].f), 'utf8')); } catch { return null; }
}

// null у обеих сторон (набор без такого класса кейсов) — нейтрально, не регресс: сравнивать
// нечего, а не считать это ухудшением по умолчанию.
function compare(baseScore, nextScore) {
  const worseRecall = baseScore.recall != null && nextScore.recall != null && nextScore.recall < baseScore.recall;
  const worseFpr = baseScore.falsePositiveRate != null && nextScore.falsePositiveRate != null
    && nextScore.falsePositiveRate > baseScore.falsePositiveRate;
  return { improved: !worseRecall && !worseFpr, worseRecall, worseFpr };
}

function appendLearning(root, entry) {
  const file = path.join(root, LEARNINGS);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

// runBench: () => Promise<{recall, falsePositiveRate, ...}> — инъекция, как runTests у
// elt-mutate.js (T008). В тестах — стаб на фикстуре, в CLI — реальный judge-bench (деньги/сеть).
async function propose({ root, evidence, rootCause, predictedImpact, baseline, runBench }) {
  const v = validate({ evidence, rootCause, predictedImpact });
  if (!v.ok) return { ok: false, verdict: 'invalid', reason: v.reason };

  const base = baseline || findLatestBaseline(root);
  if (!base || !base.score) return { ok: false, verdict: 'invalid', reason: 'нет baseline (.planning/JUDGE-BENCH-*.json) — сначала elt harness propose --baseline <path> или прогон judge-bench' };

  const nextScore = await runBench();
  const cmp = compare(base.score, nextScore);
  const entry = {
    evidence, rootCause, predictedImpact,
    baseline: { recall: base.score.recall, falsePositiveRate: base.score.falsePositiveRate },
    result: { recall: nextScore.recall, falsePositiveRate: nextScore.falsePositiveRate },
    verdict: cmp.improved ? 'accepted' : 'rejected',
  };
  appendLearning(root, entry);
  return { ok: cmp.improved, verdict: entry.verdict, baseline: entry.baseline, result: entry.result };
}

module.exports = { propose, validate, compare, findLatestBaseline, appendLearning, LEARNINGS };
