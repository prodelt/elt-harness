'use strict';
// 020 T013 — компилятор графа: единственное место, где документ становится исполнимым.
//
// Зачем отдельный слой, а не «прочитали JSON и пошли»: граф — это политика власти, а не
// конфиг. Внешний pack, который объявит у себя `commit` или `certify`, забирает у ядра
// terminal verdict; узел `oracle` с `failure: skip` превращает красное в зелёное молча.
// Оба случая нельзя ловить в рантайме — к моменту перехода уже поздно. Поэтому проверки
// живут ДО первого перехода и fail-closed: любая непонятая конструкция — ошибка, не варнинг.
//
// Зависимостей нет намеренно: валидатор схемы — узкое подмножество JSON Schema (ровно то,
// что использует graphs/schema.json). Тянуть ajv ради 90 строк — новая supply-chain
// поверхность в файле, который как раз и стоит на границе доверия.

const fs = require('node:fs');
const path = require('node:path');

// Способности, которыми ядро не делится ни с одним pack. Список из спеки 020 (раздел
// «Продуктова межа ELT v5») дословно: identity, approve, oracle, certify, certificate,
// git, commit, merge, tag, push, release.
const AUTHORITY_CAPABILITIES = [
  'identity', 'approve', 'oracle', 'certify', 'certificate',
  'git', 'commit', 'merge', 'tag', 'push', 'release',
];

// Способность обязана быть подкреплена объявленным побочным эффектом: узел, который коммитит,
// но не объявил `git`, обманывает broker — тот выдаёт возможности ровно по объявлению.
const REQUIRED_SIDE_EFFECTS = {
  git: ['git'], commit: ['git'], merge: ['git'], tag: ['git'],
  push: ['git', 'network'], release: ['git', 'network'],
};

const GRAPH_DIR = path.join(__dirname, '..', 'graphs');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadCanonicalGraph() {
  return readJson(path.join(GRAPH_DIR, 'elt-v5.json'));
}

function loadSchema() {
  return readJson(path.join(GRAPH_DIR, 'schema.json'));
}

// --- узкое подмножество JSON Schema ------------------------------------------------------
// Поддержано ровно то, что встречается в graphs/schema.json. Неизвестное ключевое слово не
// игнорируется молча: validateSchemaSubset() ниже проверяет саму схему на понятность.
const SUPPORTED_KEYWORDS = new Set([
  '$schema', '$id', '$ref', '$defs', 'title', 'type', 'required', 'properties',
  'additionalProperties', 'enum', 'items', 'minItems', 'uniqueItems', 'pattern', 'minimum',
]);

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) return null;
  let node = root;
  for (const part of ref.slice(2).split('/')) {
    if (!node || typeof node !== 'object') return null;
    node = node[part];
  }
  return node || null;
}

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function validate(schema, value, at, root, errors) {
  if (schema.$ref) {
    const target = resolveRef(root, schema.$ref);
    if (!target) { errors.push(`${at}: unresolved $ref ${schema.$ref}`); return; }
    validate(target, value, at, root, errors);
    return;
  }
  if (schema.type) {
    const actual = typeOf(value);
    const ok = schema.type === 'number'
      ? (actual === 'integer' || actual === 'number')
      : schema.type === actual;
    if (!ok) { errors.push(`${at}: expected ${schema.type}, got ${actual}`); return; }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.join('|')}`);
  }
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${at}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
  }
  if (typeof schema.minimum === 'number' && typeof value === 'number' && value < schema.minimum) {
    errors.push(`${at}: ${value} is below minimum ${schema.minimum}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${at}: needs at least ${schema.minItems} items`);
    }
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) {
      errors.push(`${at}: items must be unique`);
    }
    if (schema.items) value.forEach((v, i) => validate(schema.items, v, `${at}[${i}]`, root, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${at}: missing required ${key}`);
    }
    const props = schema.properties || {};
    for (const [key, sub] of Object.entries(value)) {
      if (props[key]) validate(props[key], sub, `${at}.${key}`, root, errors);
      else if (schema.additionalProperties === false) errors.push(`${at}: unknown property ${key}`);
    }
  }
}

// Схема, которую компилятор не понимает целиком, опаснее отсутствующей: она создаёт
// впечатление проверки там, где её нет (ровно так тихо слабел гейт скана скилов на 015).
function validateSchemaSubset(schema, at, errors) {
  if (!schema || typeof schema !== 'object') return;
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) errors.push(`${at}: unsupported schema keyword ${key}`);
  }
  for (const [key, sub] of Object.entries(schema.properties || {})) validateSchemaSubset(sub, `${at}.properties.${key}`, errors);
  for (const [key, sub] of Object.entries(schema.$defs || {})) validateSchemaSubset(sub, `${at}.$defs.${key}`, errors);
  if (schema.items) validateSchemaSubset(schema.items, `${at}.items`, errors);
}

// --- структурные проверки ---------------------------------------------------------------

function isAuthority(node) {
  return (node.capabilities || []).some((c) => AUTHORITY_CAPABILITIES.includes(c));
}

// Цикл без явного loop-edge — не «стиль», а невозможность отличить прогресс от зависания:
// reducer детерминирован, значит петля без объявления крутится вечно на тех же evidence.
function findImplicitCycle(nodes, edges) {
  const out = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (e.loop) continue; // объявленная петля — законный откат в build/recon
    if (out.has(e.from)) out.get(e.from).push(e.to);
  }
  const state = new Map(); // 0 — не был, 1 — в стеке, 2 — закрыт
  const stack = [];
  let found = null;
  const walk = (id) => {
    if (found) return;
    state.set(id, 1); stack.push(id);
    for (const next of out.get(id) || []) {
      if (state.get(next) === 1) { found = [...stack.slice(stack.indexOf(next)), next]; return; }
      if (!state.get(next)) { walk(next); if (found) return; }
    }
    state.set(id, 2); stack.pop();
  };
  for (const n of nodes) if (!state.get(n.id) && !found) walk(n.id);
  return found;
}

/**
 * compile(doc, options) → { ok, errors, graph }
 * Ошибки — строки вида `<код>: <детали>`; коды механические, чтобы тест и ledger ссылались
 * на причину, а не на формулировку.
 */
function compile(doc, options = {}) {
  const schema = options.schema || loadSchema();
  const errors = [];

  validateSchemaSubset(schema, 'schema', errors);
  if (errors.length) return { ok: false, errors: errors.map((e) => `schema-unsupported: ${e}`), graph: null };

  const schemaErrors = [];
  validate(schema, doc, 'graph', schema, schemaErrors);
  for (const e of schemaErrors) errors.push(`schema-mismatch: ${e}`);
  if (errors.length) return { ok: false, errors, graph: null };

  const nodes = doc.nodes;
  const seen = new Set();
  for (const node of nodes) {
    if (seen.has(node.id)) errors.push(`duplicate-id: node ${node.id} declared twice`);
    seen.add(node.id);
  }

  const declaredSchemas = new Set(doc.schemas);
  for (const node of nodes) {
    for (const ref of [...node.consumes, ...node.produces]) {
      if (!declaredSchemas.has(ref)) errors.push(`schema-mismatch: node ${node.id} references undeclared schema ${ref}`);
    }
    if (node.sideEffects.includes('none') && node.sideEffects.length > 1) {
      errors.push(`undeclared-side-effect: node ${node.id} mixes none with real effects`);
    }
    for (const capability of node.capabilities || []) {
      for (const effect of REQUIRED_SIDE_EFFECTS[capability] || []) {
        if (!node.sideEffects.includes(effect)) {
          errors.push(`undeclared-side-effect: node ${node.id} needs ${effect} for capability ${capability}`);
        }
      }
    }
    if (isAuthority(node)) {
      // Ядро владеет authority по двум независимым признакам: pack-namespace в id и trust.
      // Достаточно нарушить любой — и власть уходит наружу.
      if (node.id.includes('/')) errors.push(`authority-capture: pack node ${node.id} claims core capability`);
      if (node.trust !== 'core') errors.push(`authority-capture: node ${node.id} claims core capability at trust ${node.trust}`);
      if (node.failure && node.failure !== 'block') {
        errors.push(`authority-failure-policy: node ${node.id} tries failure:${node.failure} on core capability`);
      }
    }
    if (options.platform && !node.platforms.includes(options.platform)) {
      errors.push(`platform-unsupported: node ${node.id} does not run on ${options.platform}`);
    }
  }

  if (!seen.has(doc.entry)) errors.push(`unknown-node: entry ${doc.entry} is not declared`);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Set();
  for (const edge of doc.edges) {
    if (!seen.has(edge.from)) errors.push(`unknown-node: edge from ${edge.from}`);
    if (!seen.has(edge.to)) errors.push(`unknown-node: edge to ${edge.to}`);
    // Недетерминированный выбор перехода недопустим по определению reducer: одно и то же
    // событие на одном узле обязано вести ровно в одно место.
    const key = `${edge.from} ${edge.event}`;
    if (outgoing.has(key)) errors.push(`ambiguous-edge: ${edge.from} declares event ${edge.event} twice`);
    outgoing.add(key);
    // Guard ребра обязан быть объявлен узлом-источником. Иначе предикат появляется только в
    // ребре, никто не отвечает за его вычисление, и evidence может не принести его никогда —
    // переход становится мёртвым, а выглядит живым.
    const from = byId.get(edge.from);
    for (const guard of edge.guards || []) {
      if (from && !from.guards.includes(guard)) {
        errors.push(`undeclared-guard: edge ${edge.from} --${edge.event}--> requires ${guard}, not declared by node`);
      }
    }
  }

  const cycle = findImplicitCycle(nodes, doc.edges);
  if (cycle) errors.push(`implicit-cycle: ${cycle.join(' -> ')} has no declared loop edge`);

  if (errors.length) return { ok: false, errors, graph: null };

  // Нормализация — вторая половина «принудительно ставить block»: политика отказа не бывает
  // неуказанной. Умолчание fail-closed для всех, для authority — единственно возможное.
  const compiledNodes = {};
  for (const node of nodes) {
    compiledNodes[node.id] = {
      ...node,
      capabilities: node.capabilities || [],
      failure: isAuthority(node) ? 'block' : (node.failure || 'block'),
    };
  }
  const edges = doc.edges.map((e) => ({
    from: e.from, to: e.to, event: e.event,
    guards: e.guards || [], loop: e.loop === true, repair: e.repair === true,
  }));

  return {
    ok: true,
    errors: [],
    graph: {
      graphVersion: doc.graphVersion,
      entry: doc.entry,
      schemas: [...doc.schemas],
      nodes: compiledNodes,
      edges,
    },
  };
}

module.exports = {
  AUTHORITY_CAPABILITIES,
  compile,
  loadCanonicalGraph,
  loadSchema,
};
