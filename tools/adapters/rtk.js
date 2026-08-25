'use strict';
// 020 T021 — Release adapter для RTK (RunTrace Kit).
//
// Цель: presentation поверх сохранённых сырых stdout/exit. Источник истины —
// сырой вывод и код возврата, RTK лишь форматирует.
// Потеря/подмена сырого вывода ЗАПРЕЩЕНА.
//
// Контракт probe(): {state, reason, evidence, license, provenance}
// - ready: RTK доступна й готова форматовувати output
// - degraded: RTK є, але з обмеженнями
// - unavailable: RTK не знайдена або не може бути використана

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RTK_REPO = 'rtk-ai/rtk';
const RTK_COMMIT = '29f9bb7161775cd807565fd3041eb2b7d1be071c';

/**
 * probe(opts) → {state, reason, evidence, license, provenance}
 *
 * opts.rtkPath (optional): явно передана путь до RTK бінарика або інтерпретатора
 * opts.rawStdout (optional): для тестування — передати сирий stdout замість вызова
 * opts.rawExit (optional): для тестування — передати exit code замість вызова
 *
 * RTK лише форматує:
 * - Джерело істини: сирий вивід і код повернення
 * - RTK не видаляє і не замінює оригінальні дані
 * - Якщо RTK недоступна, доказ не втрачається
 */
function probe(opts = {}) {
  const evidence = [];
  const { rtkPath, rawStdout, rawExit } = opts;

  // Якщо передано сиру дані (для тестування), використаємо її
  if (rawStdout !== undefined && rawExit !== undefined) {
    evidence.push(`raw stdout length: ${rawStdout.length}`);
    evidence.push(`raw exit code: ${rawExit}`);
    evidence.push('raw data provided for fixture testing');

    const rtk = detectRtk(rtkPath);
    if (rtk) {
      evidence.push(`RTK: ${rtk.name}`);
      return {
        state: 'ready',
        reason: 'rtk-presentation-available',
        evidence,
        license: 'MIT',
        provenance: { repo: RTK_REPO, commit: RTK_COMMIT },
        preservesRaw: true,
      };
    } else {
      return {
        state: 'degraded',
        reason: 'rtk-not-found',
        evidence: [
          ...evidence,
          'Raw output is preserved',
          'RTK formatter not available for presentation',
        ],
        license: 'MIT',
        provenance: { repo: RTK_REPO, commit: RTK_COMMIT },
        preservesRaw: true,
      };
    }
  }

  // У реальному режимі спробуємо виявити RTK
  const rtk = detectRtk(rtkPath);

  if (!rtk) {
    return {
      state: 'unavailable',
      reason: 'rtk-not-installed',
      evidence: [
        'RTK binary not found in PATH or specified location',
        'Run trace formatter unavailable',
        'Raw output preservation is unaffected',
      ],
      license: 'MIT',
      provenance: { repo: RTK_REPO, commit: RTK_COMMIT },
    };
  }

  // Проверяем доступность и версию RTK
  evidence.push(`RTK: ${rtk.name}`);
  evidence.push(`location: ${rtk.path}`);

  try {
    const version = getRtkVersion(rtk.path);
    if (version) {
      evidence.push(`version: ${version}`);
    }
  } catch (err) {
    evidence.push(`version check failed: ${err.message}`);
  }

  return {
    state: 'ready',
    reason: 'rtk-ready',
    evidence,
    license: 'MIT',
    provenance: { repo: RTK_REPO, commit: RTK_COMMIT },
    preservesRaw: true,
  };
}

/**
 * detectRtk(explicitPath) → {name, path} | null
 *
 * Пошук RTK бінарику в PATH або явно передаму шляху.
 * На Windows спробуємо .exe версію.
 */
function detectRtk(explicitPath) {
  if (explicitPath && fs.existsSync(explicitPath)) {
    return { name: path.basename(explicitPath), path: explicitPath };
  }

  const candidates = [
    'rtk',
    'rtk.exe',
    path.join(process.env.HOME || '', '.local', 'bin', 'rtk'),
    path.join(process.env.HOME || '', '.local', 'bin', 'rtk.exe'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { name: path.basename(candidate), path: candidate };
    }
  }

  // Спробуємо через which/where
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(cmd, ['rtk'], { encoding: 'utf8', windowsHide: true });
    if (result.status === 0 && result.stdout) {
      const rtkPath = result.stdout.trim().split('\n')[0];
      if (rtkPath) return { name: 'rtk', path: rtkPath };
    }
  } catch {
    // where/which не доступні
  }

  return null;
}

/**
 * getRtkVersion(rtkPath) → string | null
 *
 * Виклич RTK з --version, щоб отримати версію.
 */
function getRtkVersion(rtkPath) {
  try {
    const result = spawnSync(rtkPath, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status === 0 && result.stdout) {
      const match = /(\d+\.\d+\.\d+)/.exec(result.stdout);
      return match ? match[1] : result.stdout.trim().slice(0, 50);
    }
  } catch {
    // Помилка при вызові
  }
  return null;
}

module.exports = { probe, detectRtk, getRtkVersion, RTK_REPO, RTK_COMMIT };
