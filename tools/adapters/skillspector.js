'use strict';
// 020 T021 — Release adapter для NVIDIA SkillSpector.
//
// Цель: activation gate, сканирование ДО активации, `--fail-on-incomplete`,
// стану CAUTION/incomplete/error блокируют. Обёртка над tools/skill-scan.js.
//
// Контракт probe(): {state, reason, evidence, license, provenance}
// - ready: SkillSpector доступна, pass/review verdict (без block)
// - degraded: CAUTION або incomplete знайдені
// - unavailable: SkillSpector не встановлена

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SKILLSPECTOR_REPO = 'NVIDIA/SkillSpector';
const SKILLSPECTOR_COMMIT = '698e2bf29c7d32aa8211ada677382460c01900d7';

/**
 * probe(opts) → {state, reason, evidence, license, provenance}
 *
 * opts.skillPath (REQUIRED): шлях до skill, яку сканувати
 * opts.failOnIncomplete (optional, default: true): використовувати --fail-on-incomplete
 * opts.skipScan (optional): для тестування — передати фіксований результат
 *
 * Стану CAUTION, incomplete, error ЗАВЖДИ блокують активацію.
 */
function probe(opts = {}) {
  const evidence = [];
  const { skillPath, failOnIncomplete = true, skipScan } = opts;

  // Якщо передано фіксований результат (для тестування), використаємо його
  if (skipScan) {
    return processSkillScanResult(skipScan, evidence, failOnIncomplete);
  }

  // ВИМОГА: skillPath обов'язковий
  if (!skillPath) {
    return {
      state: 'unavailable',
      reason: 'skill-path-required',
      evidence: ['SkillSpector adapter вимагає skillPath для сканування'],
      license: 'Apache-2.0',
      provenance: { repo: SKILLSPECTOR_REPO, commit: SKILLSPECTOR_COMMIT },
    };
  }

  // Спробуємо запустити skill-scan.js
  const skillScanPath = path.join(__dirname, '..', 'skill-scan.js');

  try {
    const args = ['--json'];
    if (failOnIncomplete) args.push('--fail-on-incomplete');
    args.push(skillPath);

    const result = spawnSync('node', [skillScanPath, ...args], {
      encoding: 'utf8',
      timeout: 60000,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });

    if (result.error) {
      return {
        state: 'unavailable',
        reason: 'skill-scan-error',
        evidence: [
          `error: ${result.error.message}`,
          `skill-scan.js не запустилась`,
        ],
        license: 'Apache-2.0',
        provenance: { repo: SKILLSPECTOR_REPO, commit: SKILLSPECTOR_COMMIT },
      };
    }

    let scanResult;
    try {
      scanResult = JSON.parse(result.stdout);
    } catch {
      return {
        state: 'degraded',
        reason: 'skill-scan-output-invalid',
        evidence: [
          `stdout not JSON: ${result.stdout.slice(0, 100)}`,
          `stderr: ${result.stderr ? result.stderr.slice(0, 100) : '(none)'}`,
        ],
        license: 'Apache-2.0',
        provenance: { repo: SKILLSPECTOR_REPO, commit: SKILLSPECTOR_COMMIT },
      };
    }

    return processSkillScanResult(scanResult, evidence, failOnIncomplete);
  } catch (err) {
    return {
      state: 'degraded',
      reason: 'skill-scan-exception',
      evidence: [`exception: ${err.message}`],
      license: 'Apache-2.0',
      provenance: { repo: SKILLSPECTOR_REPO, commit: SKILLSPECTOR_COMMIT },
    };
  }
}

/**
 * processSkillScanResult(scanResult, evidence, failOnIncomplete)
 *
 * Обработка результату skill-scan.js:
 * - verdict: 'blocked' -> всегда unavailable
 * - verdict: 'review' + failOnIncomplete -> degraded
 * - verdict: 'pass' -> ready
 *
 * Статус CAUTION, incomplete, error БЛОКИРУЮТ.
 */
function processSkillScanResult(scanResult, evidence, failOnIncomplete) {
  evidence.push(`verdict: ${scanResult.verdict}`);
  evidence.push(`issues found: ${scanResult.issues?.length || 0}`);

  // Ищем CAUTION, incomplete, error в issues
  let hasCaution = false;
  let hasIncomplete = false;
  let hasError = false;

  if (scanResult.issues && Array.isArray(scanResult.issues)) {
    for (const issue of scanResult.issues) {
      const severity = String(issue.severity || '').toUpperCase();
      const category = String(issue.category || '');

      if (severity === 'CAUTION' || category.includes('CAUTION')) {
        hasCaution = true;
      }
      if (category.includes('incomplete') || severity.includes('incomplete')) {
        hasIncomplete = true;
      }
      if (category.includes('error') || severity === 'ERROR') {
        hasError = true;
      }
    }
  }

  // Принимаем решение
  if (scanResult.verdict === 'blocked' || hasError) {
    return {
      state: 'unavailable',
      reason: 'skillspector-blocked',
      evidence: [
        ...evidence,
        'Skill блокирована SkillSpector (HIGH/CRITICAL в executable)',
      ],
      license: 'Apache-2.0',
      provenance: { repo: SKILLSPECTOR_REPO, commit: SKILLSPECTOR_COMMIT },
    };
  }

  if ((scanResult.verdict === 'review' || hasCaution || hasIncomplete) && failOnIncomplete) {
    return {
      state: 'degraded',
      reason: 'skillspector-incomplete',
      evidence: [
        ...evidence,
        'SkillSpector verdict: review (потребує ревью)',
        hasCaution ? 'CAUTION знайдена' : '',
        hasIncomplete ? 'incomplete знайдена' : '',
      ].filter(Boolean),
      license: 'Apache-2.0',
      provenance: { repo: SKILLSPECTOR_REPO, commit: SKILLSPECTOR_COMMIT },
    };
  }

  if (scanResult.verdict === 'pass') {
    return {
      state: 'ready',
      reason: 'skillspector-pass',
      evidence: [
        ...evidence,
        'Skill пройшла SkillSpector сканування (pass)',
      ],
      license: 'Apache-2.0',
      provenance: { repo: SKILLSPECTOR_REPO, commit: SKILLSPECTOR_COMMIT },
    };
  }

  // Fallback: якщо review але не failOnIncomplete
  if (scanResult.verdict === 'review') {
    return {
      state: 'degraded',
      reason: 'skillspector-review',
      evidence: [
        ...evidence,
        'SkillSpector потребує ревью',
      ],
      license: 'Apache-2.0',
      provenance: { repo: SKILLSPECTOR_REPO, commit: SKILLSPECTOR_COMMIT },
    };
  }

  return {
    state: 'degraded',
    reason: 'skillspector-unknown-verdict',
    evidence: [
      ...evidence,
      `unknown verdict: ${scanResult.verdict}`,
    ],
    license: 'Apache-2.0',
    provenance: { repo: SKILLSPECTOR_REPO, commit: SKILLSPECTOR_COMMIT },
  };
}

module.exports = { probe, processSkillScanResult, SKILLSPECTOR_REPO, SKILLSPECTOR_COMMIT };
