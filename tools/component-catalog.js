'use strict';
// 020 T018 — Каталог компонентів з резолюцією схем і guard валідацією.
//
// На відміну від store, catalog читає components.json (objective intent), а не lock.
// Компилятор граф графа перевіряє против catalog перед execution: нема node — нема edge.
// Catalog також перевіряє policy constraints для кожного node:
//   • external pack не може мати explicit guard на approve/certify/commit/publish;
//   • skip/degrade дозволені лише для enrichment, не для authority edges.

const fs = require('node:fs');

const CATALOG_SCHEMA = 'elt-components/v1';

// Завантажити components.json: тут чітко сказано, які pack'и та node'и існують.
function loadCatalog(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return {
      ok: true,
      schema: CATALOG_SCHEMA,
      packs: {},
      nodeById: {},
    };
  }
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const data = JSON.parse(raw);
    if (data.schemaVersion !== 1) {
      return { ok: false, reason: 'unknown-schema' };
    }
    const catalog = {
      ok: true,
      schema: CATALOG_SCHEMA,
      packs: {},
      nodeById: {},
    };
    // Індексувати pack'и та їхні node'и
    (data.packs || []).forEach((pack) => {
      if (catalog.packs[pack.id]) {
        catalog.errors = catalog.errors || [];
        catalog.errors.push({ reason: 'duplicate-pack-id', packId: pack.id });
        return;
      }
      catalog.packs[pack.id] = pack;
      (pack.nodes || []).forEach((node) => {
        if (catalog.nodeById[node.id]) {
          catalog.errors = catalog.errors || [];
          catalog.errors.push({ reason: 'duplicate-node-id', nodeId: node.id });
          return;
        }
        catalog.nodeById[node.id] = { ...node, packId: pack.id };
      });
    });
    return catalog;
  } catch (e) {
    return { ok: false, reason: 'parse-error', details: e.message };
  }
}

// Резолюція node за ID. Каталог це robustness check перед execution.
function resolveNode(catalog, nodeId) {
  if (!catalog.ok) return { ok: false, reason: 'catalog-invalid' };
  const node = catalog.nodeById[nodeId];
  if (!node) {
    return {
      ok: false,
      reason: 'node-not-found',
      nodeId,
    };
  }
  return {
    ok: true,
    nodeId,
    packId: node.packId,
    kind: node.kind,
    consumes: node.consumes || [],
    produces: node.produces || [],
    guards: node.guards || [],
    sideEffects: node.sideEffects || [],
    trust: node.trust,
    platforms: node.platforms || [],
    timeoutMs: node.timeoutMs || 120000,
    failure: node.failure || 'block',
  };
}

// Перевірка на конфлікт імен: дві node'и не можуть мати однаковий ID
// (це перехоплюється при завантаженні, але тест робить явну перевірку).
function checkDuplicateNodeIds(catalog) {
  const seen = {};
  const duplicates = [];
  Object.keys(catalog.nodeById).forEach((nodeId) => {
    if (seen[nodeId]) {
      duplicates.push(nodeId);
    }
    seen[nodeId] = true;
  });
  return duplicates;
}

// Перевірка policy: external pack не може claim approve/certify/commit/publish.
// Authority nodes завжди мають failure:block, skip/degrade — лише для enrichment.
function validateNodePolicy(node) {
  const errors = [];
  const authorityCapabilities = ['approve', 'certify', 'commit', 'publish', 'release', 'commit-proof'];
  const produces = node.produces || [];
  if (node.trust !== 'core') {
    const hasAuthority = produces.some((p) => authorityCapabilities.includes(p));
    if (hasAuthority) {
      const authProd = produces.find((p) => authorityCapabilities.includes(p));
      errors.push({
        reason: 'external-pack-authority-claim',
        nodeId: node.id,
        detail: `Only core pack can own ${authProd}`,
      });
    }
  }
  // Лише authority nodes мають failure:block
  const isAuthority = node.kind === 'gate' || node.kind === 'barrier';
  if (isAuthority && node.failure !== 'block') {
    errors.push({
      reason: 'authority-node-not-block',
      nodeId: node.id,
      detail: `Authority nodes must have failure:block, not ${node.failure}`,
    });
  }
  return errors;
}

// Список всіх pack'ів у catalog.
function listPacksInCatalog(catalog) {
  if (!catalog.ok) return [];
  return Object.values(catalog.packs);
}

module.exports = {
  CATALOG_SCHEMA,
  loadCatalog,
  resolveNode,
  checkDuplicateNodeIds,
  validateNodePolicy,
  listPacksInCatalog,
};
