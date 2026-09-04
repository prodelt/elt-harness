'use strict';
// 020 T006 — сверка версий. Проверяется главным образом то, что сверка НЕ проходит там, где
// не должна: молчаливо согласный чекер хуже отсутствующего, потому что создаёт уверенность.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { checkVersions, nextVersion, SEMVER } = require('./version-check');

const roots = [];
function fixture({ plugin = '5.0.0', marketMeta = '5.0.0', marketPlugin = '5.0.0', changelog = '5.0.0', pkg = '5.0.0', skill = '5.0.0' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-version-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'elt', version: plugin }));
  fs.writeFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({
    name: 'elt', metadata: { version: marketMeta }, plugins: [{ name: 'elt', version: marketPlugin }],
  }));
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), `# CHANGELOG\n\n## [${changelog}] — 2026-08-25\n\nтекст\n`);
  // 024 T007: пятый и шестой источники версии.
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'elt-harness', version: pkg }));
  fs.mkdirSync(path.join(root, 'skills', 'elt'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'elt', 'SKILL.md'),
    `---\nname: elt\ndescription: fixture\nversion: ${skill}\n---\n\n# elt\n`);
  return root;
}
function cleanup() {
  for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* уборка не гейт */ } }
}

function testAllAlignedIsOk() {
  const r = checkVersions(fixture());
  assert.equal(r.ok, true, JSON.stringify(r.mismatches));
  assert.equal(r.version, '5.0.0');
  assert.equal(r.sources.length, 6, 'все шесть объявлений версии обязаны попасть в сверку');
}

// Каждый источник проверяется ОТДЕЛЬНО: расхождение в любом одном обязано валить сверку.
// Иначе достаточно забыть один файл, чтобы релиз ушёл с несогласованной версией.
function testEachSourceCanBreakIt() {
  for (const key of ['plugin', 'marketMeta', 'marketPlugin', 'changelog', 'pkg', 'skill']) {
    const r = checkVersions(fixture({ [key]: '5.0.1' }));
    assert.equal(r.ok, false, `расхождение в ${key} обязано валить сверку`);
    assert.match(r.mismatches.join(' '), /версии разошлись/);
  }
}

// Отсутствующий файл — ошибка, а не «пропустим». Молчаливый пропуск означал бы, что сверка
// проходит тем легче, чем больше файлов потеряно.
function testMissingSourceIsError() {
  const root = fixture();
  fs.rmSync(path.join(root, 'CHANGELOG.md'));
  const r = checkVersions(root);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /CHANGELOG/);
}

function testNonSemverIsRefused() {
  const r = checkVersions(fixture({ plugin: '5.0' }));
  assert.equal(r.ok, false);
  assert.match(r.mismatches.join(' '), /не SemVer/);
}

// Тег необязателен: до релиза его нет, и это НЕ отказ. Но если передан — обязан совпасть.
function testTagIsOptionalButMustMatchWhenGiven() {
  assert.equal(checkVersions(fixture()).ok, true, 'отсутствие тега не делает сверку красной');

  const good = checkVersions(fixture(), { tag: 'v5.0.0' });
  assert.equal(good.ok, true);

  const bad = checkVersions(fixture(), { tag: 'v5.1.0' });
  assert.equal(bad.ok, false, 'тег на версию, которой нет в файлах, обязан валить сверку');
  assert.match(bad.mismatches.join(' '), /не совпадает/);

  const garbage = checkVersions(fixture(), { tag: 'release-latest' });
  assert.equal(garbage.ok, false, 'mutable-имя вместо SemVer — отказ');
}

// Шаг версии не назначается на глаз: patch после minor это 5.1.0 → 5.1.1.
function testNextVersionFollowsSemver() {
  assert.equal(nextVersion('5.0.0', 'patch').version, '5.0.1');
  assert.equal(nextVersion('5.0.9', 'minor').version, '5.1.0');
  assert.equal(nextVersion('5.1.3', 'major').version, '6.0.0');
  assert.equal(nextVersion('5.1.3', 'выдуманное').ok, false);
  assert.equal(nextVersion('latest', 'patch').ok, false, 'mutable-имя не версия');
}

// Живой репозиторий обязан быть согласован прямо сейчас: это и есть тот случай, ради
// которого модуль написан.
function testThisRepositoryIsAligned() {
  const r = checkVersions(path.join(__dirname, '..'));
  assert.equal(r.ok, true, `версии этого репозитория разошлись: ${r.mismatches.concat(r.errors).join('; ')}`);
  assert.ok(SEMVER.test(r.version));
}

function main() {
  try {
    testAllAlignedIsOk();
    testEachSourceCanBreakIt();
    testMissingSourceIsError();
    testNonSemverIsRefused();
    testTagIsOptionalButMustMatchWhenGiven();
    testNextVersionFollowsSemver();
    testThisRepositoryIsAligned();
  } finally {
    cleanup();
  }
  process.stdout.write('version-check tests: PASS\n');
}

main();
