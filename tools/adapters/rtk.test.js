'use strict';
// 020 T021 — регресс для RTK adapter.

const assert = require('node:assert/strict');
const { probe, detectRtk } = require('./rtk');

function testContractReady() {
  // Контракт: коли все добре (хоча RTK можебути й не встановлена)
  // всеодно повинна бути evidence про raw output
  const result = probe({
    rawStdout: 'test output\n',
    rawExit: 0,
  });
  assert.ok(['ready', 'degraded'].includes(result.state));
  assert.ok(result.evidence);
  assert.ok(result.provenance);
  assert.equal(result.provenance.repo, 'rtk-ai/rtk');
  assert.equal(result.preservesRaw, true, 'RTK обов\'язково зберігає сирі дані');
}

function testContractDegraded() {
  // Коли RTK не знайдена, але сирі дані збережені
  const result = probe({
    rawStdout: 'output without formatting\n',
    rawExit: 1,
  });
  assert.ok(['ready', 'degraded'].includes(result.state));
  // Сирі дані повинні бути у evidence
  assert.ok(result.evidence.some((e) => e.includes('output')));
  // Жоден стан не припиняє збереження raw data
  assert.ok(result.preservesRaw);
}

function testContractUnavailable() {
  // Коли RTK не встановлена взагалі, probe()->unavailable
  const result = probe({
    rtkPath: '/path/that/does/not/exist',
  });
  assert.equal(result.state, 'unavailable');
  assert.equal(result.reason, 'rtk-not-installed');
  // Навіть при unavailable ліворуч не втрачається доказ про можливість
  assert.ok(result.license);
}

function testRawOutputPreservationIsNonNegotiable() {
  // Дискримінуючий тест на головне правило: сирий вивід ніколи не втрачається
  // і RTK лише додає presentation поверх, не замінюючи оригінал
  const rawStdout = 'line 1\nline 2 with special chars: []{}<>!@#$%\nline 3\n';
  const rawExit = 42;

  const result = probe({
    rawStdout,
    rawExit,
  });

  // Жоден стан не зробить то, що сирі дані втрачаються
  assert.equal(result.preservesRaw, true);
  // Evidence повинна містити інформацію про сирий вывід
  assert.ok(result.evidence.some((e) => e.includes('raw')));
}

function testWindowsAndPathHandling() {
  // На Windows шляхи можуть мати зворотний слеш, це не повинно ламати adapter
  const result = probe({
    rtkPath: 'C:\\Program Files\\rtk\\rtk.exe',
  });

  // Не повинно бути exception
  assert.ok(result);
  // Повинна бути коректна провенанса навіть при Windows paths
  assert.equal(result.provenance.repo, 'rtk-ai/rtk');
}

function testDetectRtkDoesNothing() {
  // detectRtk() не повинна вмороживати оригінальний вивід
  // це лише допоміжна функція для пошуку бінарика
  const rtk = detectRtk('/nonexistent');
  // Якщо не знайдено, повертаємо null — це окей
  assert.equal(rtk, null);
}

function testLicenseAndProvenance() {
  // Кожен adapter повинен мати license і provenance
  const result = probe({
    rawStdout: 'test',
    rawExit: 0,
  });

  assert.equal(result.license, 'MIT');
  assert.ok(result.provenance);
  assert.equal(result.provenance.repo, 'rtk-ai/rtk');
  assert.equal(result.provenance.commit, '29f9bb7161775cd807565fd3041eb2b7d1be071c');
}

function main() {
  try {
    testContractReady();
    console.log('✓ testContractReady');

    testContractDegraded();
    console.log('✓ testContractDegraded');

    testContractUnavailable();
    console.log('✓ testContractUnavailable');

    testRawOutputPreservationIsNonNegotiable();
    console.log('✓ testRawOutputPreservationIsNonNegotiable');

    testWindowsAndPathHandling();
    console.log('✓ testWindowsAndPathHandling');

    testDetectRtkDoesNothing();
    console.log('✓ testDetectRtkDoesNothing');

    testLicenseAndProvenance();
    console.log('✓ testLicenseAndProvenance');

    console.log('\nУсі тести RTK adapter пройшли успішно!');
    process.exit(0);
  } catch (err) {
    console.error('ТЕСТ ПРОВАЛЕНИЙ:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
