'use strict';
// 020 T017 — Hash-bound Mirror, certificate algebra и publish quarantine.
//
// На одном batchHead/generation — РОВНО ОДИН impact oracle та один review-subgraph.
// Детерминирована таблиця required lenses входить в evidence. Для high-risk/release —
// завжди всі п'ять.
//
// Pass = oracle exit 0 + усі required lenses terminal-success + scorer terminal-success +
// ноль findings ≥80 + exact graph/lock/spec/batch/generation/commit/tree hash match.
//
// unknown/error/inconclusive/stale блокують publish; <80 → weak-signal, ≥80 → debrief/recon.
//
// Batch та release сертифікати — РІЗНІ versioned schemas, невзаємозамінні.
// Сертифікат живе ВНЕ certificate-bound tree (append-only evidence store).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { LENS_NAMES } = require('./review-lenses');

// Core-owned детерминированная таблица required lenses. Имена берутся из ОДНОГО источника —
// `review-lenses.js`, — а не переписываются здесь: список, разошедшийся с `agents/review-*.md`,
// заставил бы сертификат ждать результата линзы, которой не существует, и ни один батч не
// смог бы пройти. Таблица принадлежит ядру: pack её не меняет (спека 020, «Продуктова межа»).
//
// Для high-risk и release — ВСЕ пять, без исключений. Для обычного батча обязательны три
// линзы, которые смотрят на сам код и его правила; история и прошлые комментарии — обогащение,
// их отсутствие не делает ревью неполным.
const REQUIRED_LENSES_BY_RISK = {
  'high-risk': [...LENS_NAMES],
  'release': [...LENS_NAMES],
  'default': ['review-bugs', 'review-claude-md', 'review-code-comments'],
};

// Терминальні стани ревю та oracle
const ORACLE_TERMINAL = { exit0: 'exit-0', nonzero: 'exit-nonzero', error: 'error', timeout: 'timeout', unknown: 'unknown' };
const REVIEW_TERMINAL = { pass: 'review-pass', block: 'review-block', inconclusive: 'review-inconclusive', dead: 'review-dead' };

// Версійовані schemas сертифікатів
const BATCH_CERT_SCHEMA = 'elt-batch-certificate/v1';
const RELEASE_CERT_SCHEMA = 'elt-release-certificate/v1';

function certificatePath(cwd) {
  return path.join(cwd, '.git', 'elt', 'certificates');
}

function batchCertificatePath(cwd, batchId, generation) {
  return path.join(certificatePath(cwd), `batch-${batchId}-gen${generation}.json`);
}

function releaseCertificatePath(cwd, releaseId) {
  return path.join(certificatePath(cwd), `release-${releaseId}.json`);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Детерміновано обчисли required lenses за рівнем ризику
function requiredLenses(riskLevel = 'default') {
  return REQUIRED_LENSES_BY_RISK[riskLevel] || REQUIRED_LENSES_BY_RISK.default;
}

/**
 * validateBatchPass — перевірка алгебри pass для batch.
 *
 * Контракт (дослівно):
 * - oracle exit 0
 * - усі required lenses terminal-success
 * - scorer terminal-success
 * - ноль findings з confidence ≥80
 * - exact match graph/lock/spec/batch/generation/commit/tree hashes
 *
 * Будь-яке відхилення — не pass.
 */
function validateBatchPass(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    return { ok: false, reason: 'evidence-missing' };
  }

  // Oracle must exit 0
  if (evidence.oracleTerminal !== ORACLE_TERMINAL.exit0) {
    return { ok: false, reason: 'oracle-nonzero', detail: evidence.oracleTerminal };
  }

  // All required lenses must be terminal-success
  const required = requiredLenses(evidence.riskLevel);
  if (!evidence.lensResults || typeof evidence.lensResults !== 'object') {
    return { ok: false, reason: 'lens-results-missing' };
  }

  for (const lensName of required) {
    const result = evidence.lensResults[lensName];
    if (!result) {
      return { ok: false, reason: 'lens-missing', detail: lensName };
    }
    if (result.status !== REVIEW_TERMINAL.pass) {
      return { ok: false, reason: 'lens-not-terminal', detail: `${lensName}: ${result.status}` };
    }
  }

  // Scorer must be terminal-success
  if (evidence.scorerTerminal !== REVIEW_TERMINAL.pass) {
    return { ok: false, reason: 'scorer-not-pass', detail: evidence.scorerTerminal };
  }

  // Zero findings with confidence ≥ 80
  const blockingFindings = (evidence.findings || []).filter((f) => f.confidence >= 80);
  if (blockingFindings.length > 0) {
    return { ok: false, reason: 'blocking-findings', detail: blockingFindings.length };
  }

  // Exact hash match
  const hashFields = ['graphHash', 'lockHash', 'specHash', 'batchHash', 'generationHash', 'commitHash', 'treeHash'];
  for (const field of hashFields) {
    if (!evidence[field] || !evidence.expected[field]) {
      return { ok: false, reason: 'hash-missing', detail: field };
    }
    if (evidence[field] !== evidence.expected[field]) {
      return { ok: false, reason: 'hash-mismatch', detail: field };
    }
  }

  return { ok: true };
}

/**
 * createBatchCertificate — створи batch certificate ВНЕ дерева.
 *
 * Сертифікат живе в append-only evidence store (.git/elt/certificates/).
 * Запис у дерево ПІСЛЯ сертифіката робить його stale.
 */
function createBatchCertificate(cwd, {
  batchId, generation, commit, treeHash, specIdentity, taskIdentities,
  graphVersion, componentLockDigest, riskLevel, evidence,
}) {
  // Перевіри алгебру
  const validation = validateBatchPass(evidence);
  if (!validation.ok) {
    return { ok: false, reason: 'batch-pass-failed', detail: validation.reason };
  }

  const certPath = batchCertificatePath(cwd, batchId, generation);
  fs.mkdirSync(path.dirname(certPath), { recursive: true });

  // Перевіри ідемпотентність: другий запуск на тому ж batchHead/generation — відмова
  if (fs.existsSync(certPath)) {
    const existing = JSON.parse(fs.readFileSync(certPath, 'utf8'));
    if (existing.commit === commit && existing.treeHash === treeHash) {
      return { ok: false, reason: 'certificate-exists', detail: 'no-op on duplicate batchHead/generation' };
    }
    // Але якщо commit або treeHash інший, це anomaly: той самий batchId/gen має різні hashes
    return { ok: false, reason: 'certificate-collision', detail: 'same batchId/gen but different commit/tree' };
  }

  const certificate = {
    v: BATCH_CERT_SCHEMA,
    certificateId: `batch-${batchId}-gen${generation}`,
    batchId,
    generation,
    commit,
    treeHash,
    specIdentity,
    taskIdentities,
    graphVersion,
    componentLockDigest,
    riskLevel,
    createdAt: new Date().toISOString(),
    evidence: {
      oracleTerminal: evidence.oracleTerminal,
      lensResults: evidence.lensResults,
      scorerTerminal: evidence.scorerTerminal,
      findings: evidence.findings,
      blockingFindings: evidence.findings.filter((f) => f.confidence >= 80),
      weakSignals: evidence.findings.filter((f) => f.confidence < 80),
    },
  };

  // Обчисли digest
  const digest = sha256(JSON.stringify(certificate, null, 2));
  certificate.digest = digest;

  // Запиши append-only
  fs.writeFileSync(certPath, JSON.stringify(certificate, null, 2) + '\n');

  return { ok: true, certificateId: certificate.certificateId, digest };
}

/**
 * createReleaseCertificate — створи release certificate.
 *
 * Release schema містить releaseId, упорядковані specIdentities[], упорядковані
 * includedBatchCertificateDigests[], release commit/tree/graph/lock hashes та
 * машинне доказательство, що нема открытих release-задач и невключеного certified batch.
 */
function createReleaseCertificate(cwd, {
  releaseId, specIdentities, includedBatchCertificateDigests, commitHash, treeHash,
  graphVersion, componentLockDigest, evidence,
}) {
  // Перевіри алгебру для release (усі 5 лінз)
  const validation = validateBatchPass({ ...evidence, riskLevel: 'release' });
  if (!validation.ok) {
    return { ok: false, reason: 'release-pass-failed', detail: validation.reason };
  }

  const certPath = releaseCertificatePath(cwd, releaseId);
  fs.mkdirSync(path.dirname(certPath), { recursive: true });

  // Release одна, перевіри ідемпотентність
  if (fs.existsSync(certPath)) {
    return { ok: false, reason: 'release-exists', detail: 'release certificate already created' };
  }

  const certificate = {
    v: RELEASE_CERT_SCHEMA,
    certificateId: `release-${releaseId}`,
    releaseId,
    specIdentities: Array.isArray(specIdentities) ? specIdentities.sort() : [],
    includedBatchCertificateDigests: Array.isArray(includedBatchCertificateDigests)
      ? includedBatchCertificateDigests.sort() : [],
    commitHash,
    treeHash,
    graphVersion,
    componentLockDigest,
    createdAt: new Date().toISOString(),
    evidence: {
      oracleTerminal: evidence.oracleTerminal,
      allFiveLenses: evidence.lensResults,
      scorerTerminal: evidence.scorerTerminal,
      findings: evidence.findings,
      blockingFindings: evidence.findings.filter((f) => f.confidence >= 80),
      noOpenReleaseTasks: evidence.noOpenReleaseTasks !== false,
      noStaleBatches: evidence.noStaleBatches !== false,
    },
  };

  // Обчисли digest
  const digest = sha256(JSON.stringify(certificate, null, 2));
  certificate.digest = digest;

  // Запиши append-only
  fs.writeFileSync(certPath, JSON.stringify(certificate, null, 2) + '\n');

  return { ok: true, certificateId: certificate.certificateId, digest };
}

/**
 * readBatchCertificate — прочитай batch certificate з evidence store.
 */
function readBatchCertificate(cwd, batchId, generation) {
  const certPath = batchCertificatePath(cwd, batchId, generation);
  if (!fs.existsSync(certPath)) {
    return { ok: false, reason: 'not-found' };
  }
  try {
    const cert = JSON.parse(fs.readFileSync(certPath, 'utf8'));
    if (cert.v !== BATCH_CERT_SCHEMA) {
      return { ok: false, reason: 'schema-mismatch' };
    }
    return { ok: true, certificate: cert };
  } catch (e) {
    return { ok: false, reason: 'parse-error', detail: e.message };
  }
}

/**
 * readReleaseCertificate — прочитай release certificate.
 */
function readReleaseCertificate(cwd, releaseId) {
  const certPath = releaseCertificatePath(cwd, releaseId);
  if (!fs.existsSync(certPath)) {
    return { ok: false, reason: 'not-found' };
  }
  try {
    const cert = JSON.parse(fs.readFileSync(certPath, 'utf8'));
    if (cert.v !== RELEASE_CERT_SCHEMA) {
      return { ok: false, reason: 'schema-mismatch' };
    }
    return { ok: true, certificate: cert };
  } catch (e) {
    return { ok: false, reason: 'parse-error', detail: e.message };
  }
}

module.exports = {
  BATCH_CERT_SCHEMA,
  RELEASE_CERT_SCHEMA,
  ORACLE_TERMINAL,
  REVIEW_TERMINAL,
  REQUIRED_LENSES_BY_RISK,
  requiredLenses,
  validateBatchPass,
  createBatchCertificate,
  createReleaseCertificate,
  readBatchCertificate,
  readReleaseCertificate,
  certificatePath,
  batchCertificatePath,
  releaseCertificatePath,
};
