'use strict';
// 020 T021 — Release adapter для Spec Kit importer.
//
// Цель: валідація наявності spec.md і tasks.md з явним spec dir і канонічним
// approval identity. Не входить до oracle truth; це лише capability provider.
//
// Контракт probe(): {state, reason, evidence, license, provenance}
// - ready: обидва файли присутні, канонічний approval digest обчислюється
// - degraded: файли є, але approval identity має проблеми
// - unavailable: файли відсутні або spec dir не явний

const fs = require('node:fs');
const path = require('node:path');

// Використовується вже наявна task-identity.js для approval schema v1
let approvalDigest;
try {
  ({ approvalDigest } = require('../task-identity'));
} catch {
  // Не вдалось завантажити task-identity; це буде помічено у probe()
  approvalDigest = null;
}

const SPEC_KIT_REPO = 'github/spec-kit';
const SPEC_KIT_COMMIT = '27f50f7e6b618ea14d74dd4037f9e7c60218b16c';

/**
 * probe(opts) → {state, reason, evidence, license, provenance}
 *
 * opts.specDir (REQUIRED): явно передана директорія спеки
 * opts.repoDir (optional): корінь репозиторію для approval digest
 *
 * Без явного specDir -> unavailable (не вгадуємо).
 * Без задачі -> degraded або unavailable (визначено стану).
 */
function probe(opts = {}) {
  const evidence = [];
  const { specDir, repoDir } = opts;

  // Правило 1: spec dir обов'язково явний, ніякого угадування
  if (!specDir) {
    return {
      state: 'unavailable',
      reason: 'spec-dir-required',
      evidence: [
        'Spec Kit adapter вимагає явно передати specDir',
        'угадування локації спеки заборонено за контрактом',
      ],
      license: 'BSD-3-Clause',
      provenance: { repo: SPEC_KIT_REPO, commit: SPEC_KIT_COMMIT },
    };
  }

  // Правило 2: обидва файли мають бути присутні
  const specPath = path.join(specDir, 'spec.md');
  const tasksPath = path.join(specDir, 'tasks.md');

  const specExists = fs.existsSync(specPath);
  const tasksExists = fs.existsSync(tasksPath);

  evidence.push(`spec.md exists: ${specExists}`);
  evidence.push(`tasks.md exists: ${tasksExists}`);

  if (!specExists || !tasksExists) {
    return {
      state: 'unavailable',
      reason: 'missing-spec-files',
      evidence: [
        `spec dir: ${specDir}`,
        ...evidence,
      ],
      license: 'BSD-3-Clause',
      provenance: { repo: SPEC_KIT_REPO, commit: SPEC_KIT_COMMIT },
    };
  }

  // Правило 3: канонічний approval identity через schema v1
  if (!approvalDigest) {
    return {
      state: 'degraded',
      reason: 'approval-identity-module-missing',
      evidence: [
        'tools/task-identity.js не завантажена',
        'approval digest не може бути обчислений',
      ],
      license: 'BSD-3-Clause',
      provenance: { repo: SPEC_KIT_REPO, commit: SPEC_KIT_COMMIT },
    };
  }

  let digestResult;
  try {
    const effectiveRepoDir = repoDir || process.cwd();
    digestResult = approvalDigest({ repoDir: effectiveRepoDir, specDir });
  } catch (err) {
    return {
      state: 'degraded',
      reason: 'approval-digest-error',
      evidence: [
        `error: ${err.message}`,
        `spec dir: ${specDir}`,
      ],
      license: 'BSD-3-Clause',
      provenance: { repo: SPEC_KIT_REPO, commit: SPEC_KIT_COMMIT },
    };
  }

  if (!digestResult.ok) {
    return {
      state: 'degraded',
      reason: digestResult.reason,
      evidence: [
        `detail: ${digestResult.detail || 'unknown'}`,
        `spec dir: ${specDir}`,
      ],
      license: 'BSD-3-Clause',
      provenance: { repo: SPEC_KIT_REPO, commit: SPEC_KIT_COMMIT },
    };
  }

  // Все перевірки пройшли
  evidence.push(`approval schema: ${digestResult.schema}`);
  evidence.push(`approval digest: ${digestResult.digest.slice(0, 16)}...`);
  evidence.push(`spec.md: ${digestResult.records[0]?.bytes} bytes`);
  evidence.push(`tasks.md: ${digestResult.records[1]?.bytes} bytes`);

  return {
    state: 'ready',
    reason: 'spec-kit-available',
    evidence,
    license: 'BSD-3-Clause',
    provenance: { repo: SPEC_KIT_REPO, commit: SPEC_KIT_COMMIT },
    digest: digestResult.digest,
    schema: digestResult.schema,
  };
}

module.exports = { probe, SPEC_KIT_REPO, SPEC_KIT_COMMIT };
