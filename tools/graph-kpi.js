'use strict';
// 020 T022 — измерители, которые обязаны быть честными в обе стороны.
//
// Смысл файла не в том, чтобы посчитать проценты, а в том, чтобы число нельзя было
// нарисовать. История этого репозитория даёт ровно три способа соврать метрикой, и все три
// уже случались:
//
//   1. Считать по времени, а не по хешам: коммиты соседней минуты приписывались харнесу, и
//      доля «через elt» завышалась (reference: замер по `.git/elt/run-log.jsonl` ∩ `git log`).
//   2. Смешивать выборки: сводная доля по всем проектам подставлялась вместо однорепной.
//   3. Округлять отношение сигнал/шум в свою пользу — `1:${Math.round(2/5)}` давало «1:0»,
//      то есть «шума нет».
//
// Поэтому здесь: перцентили считаются по фактическим записям и возвращают `null` при пустой
// выборке (а не 0, который выглядит как отличный результат); пороги, для которых окна ещё нет,
// возвращают `not-yet-measured` — спека 020 прямо требует этого статуса вместо fake pass.

const LATENCY_TARGET_P95_SEC = 5;
const RELEASE_CORE_LOC_TARGET = 3500;
const GRAPH_CORE_LOC_TARGET = 1500;
const ADOPTION_TARGET = 0.8;
const SIGNAL_NOISE_TARGET = 1;
const OBSERVATION_WINDOW_DIFFS = 20;

/**
 * percentile(values, q) → number | null
 * Пустая выборка — `null`, а не ноль: «не измеряли» и «ноль секунд» это разные утверждения,
 * и второе из них в отчёте выглядит как достижение.
 */
function percentile(values, q) {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

/**
 * latencyKpi(runLogEntries) → { readyToCommit: {n, p50, p95, target, status}, oracle: {...} }
 * `status`: 'pass' | 'fail' | 'not-yet-measured'. Третье значение не вежливость, а требование
 * спеки: порог, под который нет данных, не имеет права выглядеть ни зелёным, ни красным.
 */
function latencyKpi(runLogEntries = []) {
  const ready = runLogEntries
    .filter((e) => e && e.batch && Number.isFinite(e.batch.readyToLocalCommitSec))
    .map((e) => e.batch.readyToLocalCommitSec);
  const oracle = runLogEntries
    .filter((e) => e && e.oracle && Number.isFinite(e.oracle.durationSec))
    .map((e) => e.oracle.durationSec);

  const p95 = percentile(ready, 0.95);
  return {
    readyToCommit: {
      n: ready.length,
      p50: percentile(ready, 0.5),
      p95,
      target: LATENCY_TARGET_P95_SEC,
      status: p95 === null ? 'not-yet-measured' : (p95 < LATENCY_TARGET_P95_SEC ? 'pass' : 'fail'),
    },
    // Тяжёлая латентность публикуется ОТДЕЛЬНО и намеренно: спрятать её внутрь одной средней
    // цифры значило бы скрыть ровно ту причину, по которой человек обходит харнес на мелкой
    // правке (замер: oracle p50 161 s при `ready→commit` секундах).
    certification: {
      n: oracle.length,
      p50: percentile(oracle, 0.5),
      p90: percentile(oracle, 0.9),
    },
  };
}

/**
 * locKpi({ releaseCoreLoc, graphCoreLoc, rebaselineApprovedBy })
 * Порог ≤3 500 не может быть объявлен выполненным молча: либо число под порогом, либо есть
 * ЯВНЫЙ пользовательский rebaseline, и тогда в отчёте видно, кем он одобрен.
 */
function locKpi({ releaseCoreLoc, graphCoreLoc, rebaselineApprovedBy = null } = {}) {
  const graphOk = Number.isFinite(graphCoreLoc) && graphCoreLoc <= GRAPH_CORE_LOC_TARGET;
  const coreOk = Number.isFinite(releaseCoreLoc) && releaseCoreLoc <= RELEASE_CORE_LOC_TARGET;
  return {
    releaseCore: {
      loc: releaseCoreLoc,
      target: RELEASE_CORE_LOC_TARGET,
      status: coreOk ? 'pass' : (rebaselineApprovedBy ? 'rebaselined' : 'fail'),
      rebaselineApprovedBy: coreOk ? null : rebaselineApprovedBy,
    },
    graphCore: { loc: graphCoreLoc, target: GRAPH_CORE_LOC_TARGET, status: graphOk ? 'pass' : 'fail' },
  };
}

/**
 * adoptionKpi({ commits, viaHarness, windowDays })
 * Доля работы через харнес. Считается по СВЕРКЕ множеств (хеши коммитов), а не по времени —
 * вызывающий обязан передать уже пересечённые числа. Здесь только арифметика и статус.
 */
function adoptionKpi({ commits = 0, viaHarness = 0, windowDays = null } = {}) {
  if (!commits) return { commits, viaHarness, share: null, target: ADOPTION_TARGET, status: 'not-yet-measured', windowDays };
  const share = viaHarness / commits;
  return {
    commits, viaHarness, share, windowDays,
    target: ADOPTION_TARGET,
    // Порог наблюдательный: до полного недельного окна он не «провален», он не измерен.
    status: windowDays === null || windowDays < 7 ? 'not-yet-measured' : (share >= ADOPTION_TARGET ? 'pass' : 'fail'),
  };
}

/**
 * signalNoiseKpi({ signal, noise, unknown, diffs })
 * `unknown` НИКОГДА не подмешивается ни в одну сторону — именно это делало прошлый замер
 * недоказуемым в обе стороны. Отношение возвращается числом, а не строкой `1:N`: строка
 * округлялась и однажды показала «шума нет» там, где шум был.
 */
function signalNoiseKpi({ signal = 0, noise = 0, unknown = 0, diffs = 0 } = {}) {
  const classified = signal + noise;
  const ratio = noise === 0 ? (signal > 0 ? Infinity : null) : signal / noise;
  return {
    signal, noise, unknown, diffs, classified,
    unknownShare: classified + unknown ? unknown / (classified + unknown) : null,
    ratio,
    target: SIGNAL_NOISE_TARGET,
    status: diffs < OBSERVATION_WINDOW_DIFFS || ratio === null
      ? 'not-yet-measured'
      : (ratio >= SIGNAL_NOISE_TARGET ? 'pass' : 'fail'),
  };
}

/**
 * releaseGate(kpi) → { ok, blockers }
 * Наблюдательные пороги (adoption, S/N) НЕ блокируют первый честный приватный тег — так прямо
 * записано в спеке. Блокируют только те, что проверяемы здесь и сейчас.
 */
function releaseGate({ latency = null, loc = null, adoption = null, signalNoise = null, blockingDefects = 0 } = {}) {
  const blockers = [];
  if (blockingDefects > 0) blockers.push(`blocking-defects: ${blockingDefects}`);
  if (loc && loc.graphCore.status === 'fail') blockers.push(`graph-core LOC ${loc.graphCore.loc} > ${loc.graphCore.target}`);
  if (loc && loc.releaseCore.status === 'fail') blockers.push(`release-core LOC ${loc.releaseCore.loc} > ${loc.releaseCore.target} без rebaseline`);
  return {
    ok: blockers.length === 0,
    blockers,
    observational: {
      latency: latency ? latency.readyToCommit.status : 'not-yet-measured',
      adoption: adoption ? adoption.status : 'not-yet-measured',
      signalNoise: signalNoise ? signalNoise.status : 'not-yet-measured',
    },
  };
}

module.exports = {
  ADOPTION_TARGET,
  GRAPH_CORE_LOC_TARGET,
  LATENCY_TARGET_P95_SEC,
  OBSERVATION_WINDOW_DIFFS,
  RELEASE_CORE_LOC_TARGET,
  SIGNAL_NOISE_TARGET,
  adoptionKpi,
  latencyKpi,
  locKpi,
  percentile,
  releaseGate,
  signalNoiseKpi,
};
