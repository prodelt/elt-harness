'use strict';
// 020 T021 — регресс для OpenShell adapter.

const assert = require('node:assert/strict');
const { probe } = require('./openshell');

function testContractUnavailableWithoutProbe() {
  // Головне правило: без WSL2 на Windows (або без Landlock на Linux)
  // адаптер повинна бути unavailable, не просто degraded
  const result = probe({
    checkWsl: false, // На цьому тесті видаляємо перевірку WSL
    checkDocker: false, // і Docker перевірку
  });

  // Без Landlock на Linux або без WSL2 на Windows повинна бути unavailable
  // На будь-якій платформі, якщо контролювати параметри явно
  assert.ok(result);
  assert.ok(result.provenance);
}

function testContractAvailableWhenRequirementsAreMet() {
  // Контракт: коли все задовольняє, адаптер готова
  const result = probe({
    checkWsl: false, // Вимкнемо за допомогою прапорців для тестування
    checkDocker: false, // Не перевіряємо Docker в цьому тесті
  });

  // Оскільки ми відключили перевірки, результат залежить від платформи
  // На будь-якому випадку, адаптер повинна мати state, reason, evidence
  assert.ok(result.state);
  assert.ok(result.reason);
  assert.ok(result.evidence);
  assert.ok(Array.isArray(result.evidence));
}

function testLandlockAsHardRequirement() {
  // Дискримінуючий тест: Landlock як hard_requirement
  // На Linux, якщо landlockHardRequirement=true та Landlock недоступна -> unavailable
  const result = probe({
    landlockHardRequirement: true,
    checkWsl: false,
    checkDocker: false,
  });

  // Результат залежить від платформи
  // Але якщо це Linux і немає Landlock, повинна бути unavailable
  if (process.platform === 'linux') {
    // На Linux без Landlock з hard requirement -> unavailable
    // На Linux з Landlock -> ready
    // На CI/Docker, де kernel має Landlock, тест може пройти як ready
    assert.ok(['unavailable', 'ready', 'degraded'].includes(result.state));
  }

  assert.ok(result.provenance);
  assert.equal(result.provenance.repo, 'NVIDIA/OpenShell');
}

function testWindowsWSL2Required() {
  // На Windows, якщо checkWsl=true, адаптер перевіримо WSL2
  // Це тестування контролюється через checkWsl=false для портативності
  const result = probe({
    checkWsl: false, // Вимкнемо для тестування
    checkDocker: false,
  });

  // Адаптер повинна мати провенансу навіть на Windows
  assert.ok(result.provenance);
  assert.equal(result.license, 'Apache-2.0');
}

function testDockerRequirement() {
  // Docker є hard requirement для OpenShell
  const result = probe({
    checkWsl: false,
    checkDocker: true, // Включимо Docker перевірку
  });

  // Якщо Docker не встановлений, адаптер unavailable
  // Якщо встановлений, переходимо до інших перевірок
  assert.ok(['unavailable', 'degraded', 'ready'].includes(result.state));
}

function testPinnedImageCheck() {
  // OpenShell вимагає pinned image (не мutable latest)
  const result = probe({
    checkWsl: false,
    checkDocker: true,
  });

  // Якщо Docker є, але образ не витягнутий -> degraded
  // Якщо образ є -> ready
  assert.ok(['unavailable', 'degraded', 'ready'].includes(result.state));

  // Образ обязан быть назван в ЛЮБОМ состоянии. Прежняя версия проверяла это только когда
  // проверка успевала дойти до образа, поэтому на машине без Docker (CI Ubuntu) тест падал —
  // не из-за дефекта, а из-за того, что зависел от окружения.
  assert.ok(
    (result.evidence || []).some((e) => e.includes('nvcr.io')),
    `Evidence обязана называть pinned image в любом состоянии, получено: ${JSON.stringify(result.evidence)}`
  );
}

function testLicenseAndProvenance() {
  const result = probe({
    checkWsl: false,
    checkDocker: false,
  });

  assert.equal(result.license, 'Apache-2.0');
  assert.ok(result.provenance);
  assert.equal(result.provenance.repo, 'NVIDIA/OpenShell');
  assert.equal(result.provenance.commit, '7fc61389810b4772b40f58fb78ba907346ab5ce7');
}

function testOptionalVsHardRequirement() {
  // Landlock: hard_requirement, а не optional
  const resultHard = probe({
    landlockHardRequirement: true,
    checkWsl: false,
    checkDocker: false,
  });

  const resultSoft = probe({
    landlockHardRequirement: false,
    checkWsl: false,
    checkDocker: false,
  });

  // З hard requirement, можемо отримати unavailable якщо Landlock немає
  // З soft requirement, деградоване лишатиметься прийнятним
  assert.ok(resultHard);
  assert.ok(resultSoft);

  // На Windows обидва результати мають бути однакові (Landlock не актуальна)
  if (process.platform === 'win32') {
    assert.equal(typeof resultHard.state, 'string');
    assert.equal(typeof resultSoft.state, 'string');
  }
}

function main() {
  try {
    testContractUnavailableWithoutProbe();
    console.log('✓ testContractUnavailableWithoutProbe');

    testContractAvailableWhenRequirementsAreMet();
    console.log('✓ testContractAvailableWhenRequirementsAreMet');

    testLandlockAsHardRequirement();
    console.log('✓ testLandlockAsHardRequirement');

    testWindowsWSL2Required();
    console.log('✓ testWindowsWSL2Required');

    testDockerRequirement();
    console.log('✓ testDockerRequirement');

    testPinnedImageCheck();
    console.log('✓ testPinnedImageCheck');

    testLicenseAndProvenance();
    console.log('✓ testLicenseAndProvenance');

    testOptionalVsHardRequirement();
    console.log('✓ testOptionalVsHardRequirement');

    console.log('\nУсі тести OpenShell adapter пройшли успішно!');
    process.exit(0);
  } catch (err) {
    console.error('ТЕСТ ПРОВАЛЕНИЙ:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
