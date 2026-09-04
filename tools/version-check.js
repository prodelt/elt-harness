'use strict';
// 020 T006 — механическая сверка версии по всем местам, где она объявлена.
//
// Зачем отдельный модуль: версия в этом проекте живёт в четырёх независимых файлах
// (`plugin.json`, `marketplace.json`, `CHANGELOG.md`, git-тег). Ни один из них не является
// источником для остальных, и расхождение обнаруживается только глазами. История уже дала
// живой пример класса: deploy-копия в `~/.claude/bin` молча отставала от исходника (D16, D18),
// и это было невидимо ровно до момента, когда сломалось.
//
// Тег — не файл, поэтому проверка версий делится на две: «файлы согласованы между собой»
// (можно проверить в любой момент) и «тег указывает на тот же SemVer» (можно проверить только
// когда тег есть). Смешивать их нельзя: отсутствие тега до релиза — норма, а не отказ.

const fs = require('node:fs');
const path = require('node:path');

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * collectVersions(root) → { sources: [{ where, version, file }], errors: [] }
 * Читает все объявленные версии. Отсутствие файла — ошибка, а не «пропустим»: молчаливый
 * пропуск источника означал бы, что сверка проходит тем легче, чем больше файлов потеряно.
 */
function collectVersions(root) {
  const sources = [];
  const errors = [];

  const plugin = path.join(root, '.claude-plugin', 'plugin.json');
  try { sources.push({ where: 'plugin.json', version: readJson(plugin).version, file: plugin }); }
  catch (e) { errors.push(`plugin.json: ${e.message}`); }

  const market = path.join(root, '.claude-plugin', 'marketplace.json');
  try {
    const m = readJson(market);
    // Версия объявлена ДВАЖДЫ: в metadata самого маркетплейса и в записи плагина. Обе идут
    // в сверку — расхождение между ними такое же расхождение, как и с plugin.json.
    const entry = (m.plugins || []).find((p) => p.name === 'elt') || (m.plugins || [])[0] || {};
    if (m.metadata && m.metadata.version) sources.push({ where: 'marketplace.metadata', version: m.metadata.version, file: market });
    sources.push({ where: 'marketplace.plugins[elt]', version: entry.version, file: market });
  } catch (e) { errors.push(`marketplace.json: ${e.message}`); }

  // 024 T007: пятый источник. `package.json` появился этой спекой, и версия в нём обязана
  // ходить вместе с остальными — иначе повторится D28 (версия объявлена в шести местах,
  // сверялись четыре, релиз прошёл «ok» и оракул дал четыре красных файла).
  const pkg = path.join(root, 'package.json');
  try { sources.push({ where: 'package.json', version: readJson(pkg).version, file: pkg }); }
  catch (e) { errors.push(`package.json: ${e.message}`); }

  // 024 T007 (корень D28): ШЕСТОЙ источник — фронтматтер скила. Его сверял доктор, но не
  // `version-check`, а инструкция релиза писалась по охвату `version-check` — поэтому подъём
  // версии «строго по инструкции» проходил как `ok` и давал четыре красных файла в полном
  // оракуле. D28 записан с корнем «чинить одним источником списка мест, а не ещё одной
  // проверкой рядом»: этот список и есть тот единственный источник, поэтому место добавляется
  // СЮДА. `.elt/components.json` намеренно НЕ здесь: у `elt/core` своя версия, пришпиленная к
  // коммиту компонента, и совпадать с версией плагина она не обязана.
  const skill = path.join(root, 'skills', 'elt', 'SKILL.md');
  try {
    const text = fs.readFileSync(skill, 'utf8');
    const m = text.match(/^version:\s*v?(\d+\.\d+\.\d+)\s*$/m);
    if (!m) errors.push('skills/elt/SKILL.md: не найдено поле version во фронтматтере');
    else sources.push({ where: 'skills/elt/SKILL.md', version: m[1], file: skill });
  } catch (e) { errors.push(`skills/elt/SKILL.md: ${e.message}`); }

  const changelog = path.join(root, 'CHANGELOG.md');
  try {
    const text = fs.readFileSync(changelog, 'utf8');
    // Первый заголовок вида `## [X.Y.Z]` или `## X.Y.Z` — это и есть текущий релиз.
    const m = text.match(/^##\s*\[?v?(\d+\.\d+\.\d+)\]?/m);
    if (!m) errors.push('CHANGELOG.md: не найден заголовок версии вида "## [X.Y.Z]"');
    else sources.push({ where: 'CHANGELOG.md', version: m[1], file: changelog });
  } catch (e) { errors.push(`CHANGELOG.md: ${e.message}`); }

  return { sources, errors };
}

/**
 * checkVersions(root, { tag }) → { ok, version, sources, mismatches, errors }
 * `tag` необязателен: до релиза его нет, и это НЕ отказ. Но если он передан — обязан
 * совпасть, иначе тег указывает на версию, которой нет ни в одном файле.
 */
function checkVersions(root, { tag = null } = {}) {
  const { sources, errors } = collectVersions(root);
  const mismatches = [];

  for (const s of sources) {
    if (!s.version) { mismatches.push(`${s.where}: версия отсутствует`); continue; }
    if (!SEMVER.test(s.version)) mismatches.push(`${s.where}: "${s.version}" не SemVer`);
  }

  const versions = [...new Set(sources.map((s) => s.version).filter(Boolean))];
  if (versions.length > 1) {
    mismatches.push(`версии разошлись: ${sources.map((s) => `${s.where}=${s.version}`).join(', ')}`);
  }

  const version = versions.length === 1 ? versions[0] : null;

  if (tag) {
    const bare = String(tag).replace(/^v/, '');
    if (!SEMVER.test(bare)) mismatches.push(`тег "${tag}" не SemVer`);
    else if (version && bare !== version) mismatches.push(`тег ${tag} не совпадает с версией файлов ${version}`);
  }

  return {
    ok: errors.length === 0 && mismatches.length === 0,
    version,
    sources,
    mismatches,
    errors,
  };
}

/**
 * nextVersion(current, kind) — SemVer-шаг. Нужен runbook'у, чтобы «следующая версия» не
 * назначалась на глаз: patch после minor это 5.1.0 → 5.1.1, а не 5.1.1 → 5.2.0.
 */
function nextVersion(current, kind) {
  const m = SEMVER.exec(String(current));
  if (!m) return { ok: false, reason: 'not-semver' };
  const [major, minor, patch] = m.slice(1).map(Number);
  if (kind === 'major') return { ok: true, version: `${major + 1}.0.0` };
  if (kind === 'minor') return { ok: true, version: `${major}.${minor + 1}.0` };
  if (kind === 'patch') return { ok: true, version: `${major}.${minor}.${patch + 1}` };
  return { ok: false, reason: 'unknown-kind' };
}

function formatText(report) {
  const lines = [];
  for (const s of report.sources) lines.push(`  ${s.where}: ${s.version || '(нет)'}`);
  for (const e of report.errors) lines.push(`  ОШИБКА ${e}`);
  for (const m of report.mismatches) lines.push(`  РАСХОЖДЕНИЕ ${m}`);
  lines.push(report.ok ? `version-check: ok — ${report.version}` : 'version-check: FAIL');
  return lines.join('\n') + '\n';
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const tagIdx = argv.indexOf('--tag');
  const root = path.join(__dirname, '..');
  const report = checkVersions(root, { tag: tagIdx >= 0 ? argv[tagIdx + 1] : null });
  process.stdout.write(argv.includes('--json') ? JSON.stringify(report, null, 2) + '\n' : formatText(report));
  process.exit(report.ok ? 0 : 1);
}

module.exports = { SEMVER, checkVersions, collectVersions, formatText, nextVersion };
