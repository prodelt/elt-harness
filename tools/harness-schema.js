'use strict';
// 024 T008 — схема `.harness/harness.json`.
//
// До этой спеки `validateHarnessConfig` проверял ВОСЕМЬ полей из тридцати трёх, которые
// читает код. Остальные двадцать пять не отвергались при опечатке, а МЕНЯЛИ ПОВЕДЕНИЕ ГЕЙТА:
//
//     validateHarnessConfig({ shel: 'bash', oracelSelect: 'impact', batch: 'three',
//                             specApproval: 'no', redProof: 'OFF' })
//     → { ok: true, errors: [] }
//
//   `specApproval: "no"`  — непустая строка truthy → гейт подписи ВКЛЮЧЁН
//   `redProof: "OFF"`     — `!== 'off'` → контур red-proof ВКЛЮЧЁН
//   `batch: "three"`      — Number() → NaN → тихий дефолт 3
//   `shel`, `oracelSelect` — поле проигнорировано, работает дефолт
//
// Ни одна поддержка не воспроизведёт «у меня redProof выключен, а он работает».
//
// Строгость вводится в ДВА шага намеренно. Значение вне типа — ошибка сразу: такой конфиг уже
// сегодня ведёт себя не так, как написано, и молчать об этом нельзя. Неизвестный ключ — пока
// предупреждение: у существующих проектов могут лежать поля от снятых спек (`judge.verify`,
// поля fleet), и отказ на них сломал бы работающие установки на ровном месте. Отказ включается
// следующей минорной версией; `SCHEMA_VERSION` и есть тот счётчик, по которому это видно.

const { SHELLS } = require('./shell-run');

const SCHEMA_VERSION = 1;

const enumOf = (...values) => ({ kind: 'enum', values });
const T = {
  string: { kind: 'string' },
  nonEmptyString: { kind: 'string', nonEmpty: true },
  boolean: { kind: 'boolean' },
  positiveNumber: { kind: 'number', positive: true },
  object: { kind: 'object' },
  stringArray: { kind: 'array', of: 'string' },
};

// Каждое поле объявлено ровно один раз, вместе с типом и тем, кто его читает. Комментарий с
// читателем — не украшение: именно рассинхрон «поле читают, а схема о нём не знает» и есть
// дефект, который эта таблица закрывает.
const FIELDS = {
  schemaVersion: T.positiveNumber,                       // эта схема
  kind: enumOf('code', 'docs', 'office'),                // elt-config, elt.js
  oracle: T.nonEmptyString,                              // elt.js runOracle, elt-verify-bg
  artifactVerifier: T.nonEmptyString,                    // elt-config (kind: docs/office)
  smoke: T.string,                                       // elt.js runSmoke
  smokeParallel: T.boolean,                              // elt.js
  shell: enumOf(...SHELLS),                              // shell-run (024 T001)
  verify: enumOf('sync', 'background'),                  // elt.js, elt-verify-bg
  backgroundTimeoutMin: T.positiveNumber,                // harness-watch
  background: T.object,                                  // elt-verify-bg (layers, judgeTimeoutMs)
  // `feature` — коммит уезжает на авто-ветку; `none` — остаётся на текущей. Словарь снят с
  // кода и фикстур (`elt.js:2203` сравнивает ровно с 'feature'), а не придуман: схема,
  // написанная по догадке, отвергала бы работающие конфиги.
  branchPolicy: enumOf('feature', 'none'),               // elt.js commit
  push: T.boolean,                                       // elt.js commit
  judge: T.object,                                       // elt-config (enabled/model/provider/attest)
  redProof: enumOf('on', 'off'),                         // elt.js redProofMode
  redProofTimeoutMs: T.positiveNumber,                   // red-proof
  testCmd: T.nonEmptyString,                             // red-proof
  oracleSelect: enumOf('impact', 'all'),                 // elt-oracle-runner
  batch: T.positiveNumber,                               // elt.js batch-planner
  specApproval: T.boolean,                               // elt.js specApprovalGateFor
  ctx7Gate: enumOf('warn', 'block', 'off'),              // project-bootstrap
  l0: T.object,                                          // elt-gate-l0 loadConfig
  // 024 (ревью): поле читается `judge-core.js:reviewConfigOf` и включает набор линз. Его
  // отсутствие в схеме давало проекту, который им пользуется, предупреждение «неизвестное
  // поле» на КАЖДОЙ команде — а следующей минорной, когда неизвестный ключ станет отказом,
  // сломало бы его совсем. Ровно тот рассинхрон «поле читают, схема не знает», ради запрета
  // которого таблица и написана; замок на него — тест покрытия ниже.
  review: T.object,                                      // judge-core reviewConfigOf
};

const BACKGROUND_FIELDS = {
  layers: T.stringArray,
  judgeTimeoutMs: T.positiveNumber,
};
const L0_FIELDS = {
  hotPaths: T.stringArray,
  knownPackages: T.stringArray,
  fanInThreshold: T.positiveNumber,
  diffSizeThreshold: T.positiveNumber,
  ctx7: T.object,
};

// Поля снятых спек. Они не ошибка и не предупреждение — про них известно, что они мертвы, и
// об этом надо сказать прямо, иначе владелец проекта будет чинить то, что уже не читается.
const RETIRED = {
  'judge.verify': 'снято спекой 011: runtime его игнорирует, `project-bootstrap apply` удаляет поле',
  fleet: 'снято 019/T006 вместе с fleet',
  workers: 'снято 019/T006 вместе с fleet',
};

function typeError(name, type, value) {
  const got = Array.isArray(value) ? 'array' : typeof value;
  switch (type.kind) {
    case 'enum':
      return `${name} must be one of: ${type.values.join(', ')} (got ${JSON.stringify(value)})`;
    case 'string':
      if (typeof value !== 'string') return `${name} must be a string (got ${got})`;
      return type.nonEmpty && !value.trim() ? `${name} must be a non-empty string` : null;
    case 'boolean':
      return typeof value === 'boolean' ? null : `${name} must be boolean, not ${got} — "true"/"no" are truthy strings and would silently flip the gate`;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) return `${name} must be a number (got ${got})`;
      return type.positive && !(value > 0) ? `${name} must be a positive number` : null;
    case 'object':
      return value && typeof value === 'object' && !Array.isArray(value) ? null : `${name} must be an object (got ${got})`;
    case 'array':
      return Array.isArray(value) && value.every((v) => typeof v === type.of) ? null : `${name} must be an array of ${type.of}`;
    default:
      return null;
  }
}

function checkType(name, type, value) {
  if (type.kind === 'enum') return type.values.includes(value) ? null : typeError(name, type, value);
  return typeError(name, type, value);
}

// checkSection(prefix, fields, value) → { errors, warnings }
function checkSection(prefix, fields, value) {
  const errors = [];
  const warnings = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { errors, warnings };
  for (const [key, raw] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (RETIRED[name]) { warnings.push(`${name}: ${RETIRED[name]}`); continue; }
    const type = fields[key];
    if (!type) { warnings.push(`${name}: неизвестное поле — оно ничего не делает (опечатка?)`); continue; }
    if (raw === undefined) continue;
    const err = checkType(name, type, raw);
    if (err) errors.push(err);
  }
  return { errors, warnings };
}

/**
 * checkSchema(config) → { errors, warnings }
 * Только про ФОРМУ. Обязательность полей (`kind` есть всегда, `oracle` нужен коду) остаётся в
 * `validateHarnessConfig`: это правила ПРОЕКТА, а не типы, и они зависят от `kind`.
 */
function checkSchema(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { errors: ['config must be an object'], warnings: [] };
  }
  const top = checkSection('', FIELDS, config);
  const bg = checkSection('background', BACKGROUND_FIELDS, config.background);
  const l0 = checkSection('l0', L0_FIELDS, config.l0);
  // judge разбирает validateHarnessConfig — там правила зависят от `enabled`; здесь только
  // снятое поле `judge.verify`, чтобы про него сказали, а не промолчали.
  const judgeRetired = config.judge && typeof config.judge === 'object' && 'verify' in config.judge
    ? [`judge.verify: ${RETIRED['judge.verify']}`] : [];
  return {
    errors: [...top.errors, ...bg.errors, ...l0.errors],
    warnings: [...top.warnings, ...bg.warnings, ...l0.warnings, ...judgeRetired],
  };
}

module.exports = { checkSchema, FIELDS, BACKGROUND_FIELDS, L0_FIELDS, RETIRED, SCHEMA_VERSION };
