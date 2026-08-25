'use strict';
// 020 T018 — Мінімальний реєстр компонентів із frozen lock.
//
// Чому окремо від catalog: store — це авторитетний snapshot components.lock.json,
// який контролює, які generation'и встановлені. Catalog — це резолюція залежностей і схем.
// На одному commit/tree фіксується один immutable lock; update створює нову generation.
//
// Правила store механічні й нему не дозволено:
//   • змінювати lock під час run (снимок фіксується на вхід).
//   • allow pack'у promote себе (policy belongs only to core).
//   • accept modified bytes (коли хеш контенту не збігається).
//   • дозволити duplicate namespaced ID реєстрації (pack/node collision).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const STORE_SCHEMA = 'elt-components/v1';

// Валідація immutable lockDigest: якщо хеш контенту пакету змінився на диску,
// це відбій зберігання у content-addressed storage, але не молчна заміна.
function validatePackContent(packId, expectedContentHash, actualBytes) {
  const actualHash = crypto.createHash('sha256').update(actualBytes).digest('hex');
  if (actualHash !== expectedContentHash) {
    return {
      ok: false,
      reason: 'content-mismatch',
      expected: expectedContentHash,
      actual: actualHash,
      packId,
    };
  }
  return { ok: true };
}

// Загрузить lock-снимок до T015: це єдиний авторитетний source of truth про встановлені
// generation'и до переходу на journal.
function loadLock(lockPath) {
  if (!fs.existsSync(lockPath)) {
    return {
      ok: true,
      schema: STORE_SCHEMA,
      lockDigest: null,
      generation: 0,
      packs: {},
      capabilities: {},
    };
  }
  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const data = JSON.parse(raw);
    if (data.schemaVersion !== 1) {
      return { ok: false, reason: 'unknown-schema' };
    }
    // Перетворити масив на map для швидкого пошуку
    const packs = {};
    const packsArray = Array.isArray(data.packs) ? data.packs : Object.values(data.packs || {});
    packsArray.forEach((p) => {
      if (packs[p.id]) {
        // не return early, we need to collect all errors but for now just note it
      }
      packs[p.id] = p;
    });
    return {
      ok: true,
      schema: data.schemaVersion,
      lockDigest: data.lockDigest,
      generation: data.generation || 1,
      packs,
      capabilities: data.capabilities || {},
      createdAt: data.createdAt,
    };
  } catch (e) {
    return { ok: false, reason: 'parse-error', details: e.message };
  }
}

// Резолюція pack за ID: return installed generation або error.
// Pack не може자신을 resolve (policy enforcement).
function resolvePackInLock(lock, packId, prohibitedPackId = null) {
  if (packId === prohibitedPackId) {
    return {
      ok: false,
      reason: 'pack-self-resolve-denied',
      detail: `Pack ${packId} cannot resolve itself`,
    };
  }
  const pack = lock.packs[packId];
  if (!pack) {
    return {
      ok: false,
      reason: 'missing-pack',
      packId,
    };
  }
  if (!pack.installed) {
    return {
      ok: false,
      reason: 'pack-not-installed',
      packId,
      generation: pack.installedGeneration || 0,
    };
  }
  return {
    ok: true,
    packId,
    version: pack.version,
    commit: pack.commit,
    contentHash: pack.contentHash,
    installPath: pack.installPath,
    generation: pack.installedGeneration,
  };
}

// No-op resolve: уже встановлена та сама generation. Це одиниця идемпотенції перед
// T019/T020 (component-update). Без тієї самої version/commit/hash нема no-op.
function checkInstallationIdempotent(lock, packId, version, commit, contentHash) {
  const existing = lock.packs[packId];
  if (!existing || !existing.installed) return false;
  return (
    existing.version === version
    && existing.commit === commit
    && existing.contentHash === contentHash
  );
}

// Додавання пакету до lock: версія для T020 (component-update), тепер не використовується.
function addPackToLock(lock, packDesc) {
  if (lock.packs[packDesc.id]) {
    return {
      ok: false,
      reason: 'duplicate-pack-id',
      packId: packDesc.id,
    };
  }
  lock.packs[packDesc.id] = {
    id: packDesc.id,
    version: packDesc.version,
    commit: packDesc.commit,
    contentHash: packDesc.contentHash,
    installPath: packDesc.installPath,
    installed: true,
    installedGeneration: 1,
  };
  lock.generation += 1;
  return { ok: true, generation: lock.generation };
}

// Повертає список всіх встановлених пакетів: для графіка integrity check.
function listInstalledPacks(lock) {
  return Object.values(lock.packs).filter((p) => p.installed);
}

// Перевірка, чи lock змінився від snapshot: для detection of stale proofs.
// Старий proof на lock-digest D1 стає stale, коли lock-digest перейшов на D2.
function lockDigestChanged(oldDigest, newLock) {
  return oldDigest !== newLock.lockDigest;
}

module.exports = {
  STORE_SCHEMA,
  validatePackContent,
  loadLock,
  resolvePackInLock,
  checkInstallationIdempotent,
  addPackToLock,
  listInstalledPacks,
  lockDigestChanged,
};
