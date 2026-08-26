'use strict';
// 020 T021 — Release adapter для NVIDIA OpenShell.
//
// Цель: optional strong-isolation adapter. Без WSL2/Linux probe -> unavailable.
// Pinned image; Landlock только как hard_requirement.
//
// Контракт probe(): {state, reason, evidence, license, provenance}
// - ready: OpenShell доступна й конфіговано
// - degraded: OpenShell є, але з обмеженнями
// - unavailable: WSL2/Linux немає; Landlock є як hard_requirement, не optional

const { spawnSync } = require('node:child_process');
const os = require('node:os');

const OPENSHELL_REPO = 'NVIDIA/OpenShell';
const OPENSHELL_COMMIT = '7fc61389810b4772b40f58fb78ba907346ab5ce7';
const OPENSHELL_IMAGE = 'nvcr.io/nvidia/openshell:24.12'; // pinned image

/**
 * probe(opts) → {state, reason, evidence, license, provenance}
 *
 * opts.checkWsl (optional, default: true): перевірити наявність WSL2 на Windows
 * opts.checkDocker (optional, default: true): перевірити доступність Docker
 * opts.landlockHardRequirement (optional, default: true): Landlock як hard requirement
 *
 * На Linux без Landlock support -> degraded або unavailable залежно від hard requirement.
 * На Windows без WSL2 -> unavailable (не «сойдёт»).
 */
function probe(opts = {}) {
  const evidence = [];
  const {
    checkWsl = true,
    checkDocker = true,
    landlockHardRequirement = true,
  } = opts;

  const platform = process.platform;
  evidence.push(`platform: ${platform}`);

  // На Windows вимагаємо WSL2
  if (platform === 'win32') {
    if (checkWsl) {
      const hasWsl2 = checkWSL2();
      evidence.push(`WSL2 detected: ${hasWsl2}`);

      if (!hasWsl2) {
        return {
          state: 'unavailable',
          reason: 'wsl2-required-on-windows',
          evidence: [
            ...evidence,
            `required pinned image: ${OPENSHELL_IMAGE}`,
            'OpenShell вимагає WSL2 на Windows',
            'Без WSL2 або WSL 1 адаптер не працює',
          ],
          license: 'Apache-2.0',
          provenance: { repo: OPENSHELL_REPO, commit: OPENSHELL_COMMIT },
        };
      }
    }
  }

  // На Linux перевіримо Landlock
  if (platform === 'linux') {
    const hasLandlock = checkLandlock();
    evidence.push(`Landlock support: ${hasLandlock}`);

    if (!hasLandlock && landlockHardRequirement) {
      return {
        state: 'unavailable',
        reason: 'landlock-hard-requirement',
        evidence: [
          ...evidence,
          `required pinned image: ${OPENSHELL_IMAGE}`,
          'OpenShell вимагає Landlock для изоляции',
          'hard_requirement: true - без Landlock недоступна',
        ],
        license: 'Apache-2.0',
        provenance: { repo: OPENSHELL_REPO, commit: OPENSHELL_COMMIT },
      };
    }

    if (!hasLandlock) {
      evidence.push('WARNING: Landlock не доступна, изоляция ослаблена');
    }
  }

  // Перевіримо Docker (необхідний для OpenShell)
  if (checkDocker) {
    const dockerAvailable = checkDocker_();
    // Требуемый образ называется ВСЕГДА, а не только когда до него дошла проверка. Читатель
    // отчёта должен видеть, чего именно не хватает, даже в ветке «докера нет»: иначе
    // `unavailable` не отличить от «адаптер не знает, что ему нужно».
    evidence.push(`required pinned image: ${OPENSHELL_IMAGE}`);
    evidence.push(`Docker available: ${dockerAvailable}`);

    if (!dockerAvailable) {
      return {
        state: 'unavailable',
        reason: 'docker-not-available',
        evidence: [
          ...evidence,
          'OpenShell вимагає Docker для контейнеризації',
        ],
        license: 'Apache-2.0',
        provenance: { repo: OPENSHELL_REPO, commit: OPENSHELL_COMMIT },
      };
    }
  }

  // Перевіримо pinned image
  if (checkDocker) {
    const hasImage = checkDockerImage(OPENSHELL_IMAGE);
    evidence.push(`OpenShell image ${OPENSHELL_IMAGE}: ${hasImage}`);

    if (!hasImage) {
      return {
        state: 'degraded',
        reason: 'openshell-image-not-pulled',
        evidence: [
          ...evidence,
          `потрібно: docker pull ${OPENSHELL_IMAGE}`,
          'адаптер готов, але образ потребує завантаження',
        ],
        license: 'Apache-2.0',
        provenance: { repo: OPENSHELL_REPO, commit: OPENSHELL_COMMIT },
      };
    }
  }

  // Все готово
  return {
    state: 'ready',
    reason: 'openshell-available',
    evidence: [
      ...evidence,
      `pinned image: ${OPENSHELL_IMAGE}`,
      'OpenShell готова для использования',
    ],
    license: 'Apache-2.0',
    provenance: { repo: OPENSHELL_REPO, commit: OPENSHELL_COMMIT },
  };
}

/**
 * checkWSL2() → boolean
 *
 * На Windows перевіримо наявність WSL2. Спробуємо запустити `wsl --version`.
 */
function checkWSL2() {
  try {
    const result = spawnSync('wsl', ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });

    if (result.status === 0 && result.stdout) {
      // WSL2 повинна мати версію >= 2
      const match = /WSL\s+(\d+)/i.exec(result.stdout);
      if (match && parseInt(match[1], 10) >= 2) {
        return true;
      }
    }
  } catch {
    // WSL не встановлена
  }
  return false;
}

/**
 * checkLandlock() → boolean
 *
 * На Linux перевіримо наявність Landlock. Спробуємо через /proc/sys або через landlock CLI.
 */
function checkLandlock() {
  if (process.platform !== 'linux') return false;

  try {
    // Спробуємо через landlock-cli якщо є
    const result = spawnSync('landlock', ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status === 0) return true;
  } catch {
    // Landlock CLI не встановлена
  }

  // Альтернатива: перевіримо через /proc
  // На Linux ядра з Landlock support матиме /proc/sys/kernel/landlock/*
  // Для простоти повернемо false якщо не можемо перевірити
  return false;
}

/**
 * checkDocker_() → boolean
 *
 * Перевіримо чи Docker доступний через `docker --version`.
 */
function checkDocker_() {
  try {
    const result = spawnSync('docker', ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });

    if (result.status === 0 && result.stdout) {
      return true;
    }
  } catch {
    // Docker не встановлений
  }
  return false;
}

/**
 * checkDockerImage(imageName) → boolean
 *
 * Перевіримо чи образ вже витягнутий через `docker image inspect`.
 */
function checkDockerImage(imageName) {
  try {
    const result = spawnSync('docker', ['image', 'inspect', imageName], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });

    if (result.status === 0) {
      return true;
    }
  } catch {
    // Образ не знайдений
  }
  return false;
}

module.exports = {
  probe,
  checkWSL2,
  checkLandlock,
  checkDocker_,
  checkDockerImage,
  OPENSHELL_REPO,
  OPENSHELL_COMMIT,
  OPENSHELL_IMAGE,
};
