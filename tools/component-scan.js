'use strict';
// 020 T020 — Pre-activation component scanner на основе skill-scan.js.
//
// Этот модуль адаптирует существующий skill-scan.js для T020 workflow:
// - запускает SkillSpector scan на candidate компоненте в staging
// - классифицирует результаты (pass/review/blocked)
// - блокирует incomplete или error
// - candidate НИКОГДА не сканирует сам себя (policy enforcement)
// - возвращает machine-readable result и recommending human approval на `review`

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const skillScan = require('./skill-scan');

// Структура результата скана для T020 workflow
const SCAN_SCHEMA = 'elt-component-scan/v1';

// Перевірити, чи candidate пытается просканировать/повысить сам себя
// Если candidate digest входит в список проверяемых компонентов — это нарушение policy
function validateCandidateNotSelfScan(candidateId, candidateDigest, currentPacks) {
  // Текущие пакеты из lock - знают свой digest и version
  for (const [packId, packData] of Object.entries(currentPacks || {})) {
    if (packData.contentHash === candidateDigest && packId !== candidateId) {
      continue; // OK: другой пакет с тем же digest (dependency)
    }
    if (packId === candidateId && packData.contentHash === candidateDigest) {
      return {
        ok: false,
        reason: 'candidate-self-scan',
        detail: `Candidate ${candidateId} cannot scan itself during promotion`,
        candidateId,
        candidateDigest,
      };
    }
  }
  return { ok: true };
}

// Запустить SkillSpector скан на staging директории
function runComponentScan(stagingPath, options = {}) {
  if (!fs.existsSync(stagingPath)) {
    return {
      ok: false,
      reason: 'staging-not-found',
      stagingPath,
    };
  }

  const binary = skillScan.resolveBinary(options.env, options.homeDir);
  if (!binary) {
    return {
      ok: false,
      reason: 'scanner-not-installed',
      detail: 'SkillSpector binary not found; run: uv tool install nvidia-skillspector',
    };
  }

  try {
    const scanResult = skillScan.summarize(
      stagingPath,
      runRawScan(binary, stagingPath, options.llm || false),
    );

    // Экстрактовать неполноту из raw, если сканер это поддерживает
    const isIncomplete = (scanResult.rawSeverity || '').includes('INCOMPLETE');

    return {
      ok: true,
      schema: SCAN_SCHEMA,
      stagingPath,
      verdict: scanResult.verdict, // pass | review | blocked
      rawScore: scanResult.rawScore,
      rawSeverity: scanResult.rawSeverity,
      componentCount: scanResult.componentCount,
      execFileCount: scanResult.execFileCount,
      blockingCount: scanResult.blockingCount,
      advisoryCount: scanResult.advisoryCount,
      blocking: scanResult.blocking,
      advisory: scanResult.advisory,
      incomplete: isIncomplete,
      knownCodeCategoryDrift: detectCategoryDrift(scanResult),
    };
  } catch (err) {
    return {
      ok: false,
      reason: 'scan-error',
      detail: err.message,
    };
  }
}

// Запустить raw SkillSpector с JSON output
function runRawScan(binary, target, useLlm) {
  const scanArgs = ['scan', target, '--format', 'json'];
  if (!useLlm) scanArgs.push('--no-llm');
  const result = spawnSync(binary, scanArgs, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    timeout: 180000, // 3 minutes for large packs
  });

  if (result.error) throw new Error(`scanner spawn failed: ${result.error.message}`);
  const stdout = (result.stdout || '').trim();
  if (!stdout) {
    throw new Error(`scanner produced no output (stderr: ${(result.stderr || '').slice(0, 400)})`);
  }

  const start = stdout.indexOf('{');
  if (start < 0) throw new Error('scanner output is not JSON');
  return JSON.parse(stdout.slice(start));
}

// Детектор drifting CODE_CATEGORIES имён между версиями сканера
function detectCategoryDrift(scanSummary) {
  const unknown = skillScan.unknownCodeCategories({
    components: scanSummary.components || [],
    issues: scanSummary.blocking && scanSummary.blocking.length > 0
      ? [{ ...scanSummary.blocking[0], severity: 'HIGH' }]
      : [],
  });
  return unknown.length > 0 ? unknown : null;
}

// Validate: incomplete или error = block (не может быть auto-promoted)
function validateScanResult(scanResult) {
  if (!scanResult.ok) {
    return {
      valid: false,
      reason: 'scan-failed',
      detail: scanResult.detail || scanResult.reason,
    };
  }

  if (scanResult.incomplete) {
    return {
      valid: false,
      reason: 'incomplete-scan',
      detail: 'Scanner reported incomplete analysis; manual review required',
    };
  }

  if (scanResult.verdict === 'blocked') {
    return {
      valid: false,
      reason: 'blocked-findings',
      detail: `${scanResult.blockingCount} blocking issues found`,
      blocking: scanResult.blocking.slice(0, 5),
    };
  }

  if (scanResult.knownCodeCategoryDrift) {
    return {
      valid: false,
      reason: 'category-drift-detected',
      detail: `Unknown code categories detected (SkillSpector version mismatch?): ${scanResult.knownCodeCategoryDrift.join(', ')}`,
    };
  }

  return { valid: true };
}

// Determine promotion path: auto (docs-only, no capability change) або manual review
function determinePromotionPath(scanResult, capabilityDiff) {
  if (scanResult.verdict === 'pass') {
    if (!capabilityDiff || (capabilityDiff.added.length === 0 && capabilityDiff.removed.length === 0)) {
      return { path: 'auto', reason: 'no-capability-change' };
    }
  }

  if (scanResult.verdict === 'review') {
    return { path: 'manual', reason: 'advisory-findings', action: 'requires-human-approval' };
  }

  return { path: 'manual', reason: 'caution-default' };
}

module.exports = {
  SCAN_SCHEMA,
  validateCandidateNotSelfScan,
  runComponentScan,
  runRawScan,
  detectCategoryDrift,
  validateScanResult,
  determinePromotionPath,
};
