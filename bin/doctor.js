#!/usr/bin/env node
'use strict';
// bin/doctor.js — 019 T011. Диагностика САМОГО плагина, а не проекта.
//
// Заменяет побайтную сверку `~/.claude/bin` из `tools/doctor-core.js`. Смысл сверки был
// один: убедиться, что развёрнутая копия харнеса не отстала от исходника (дефекты D16, D18 —
// правка есть в `tools/`, нет в копии). У плагина копии нет: установленный каталог И ЕСТЬ
// исходник, поэтому вопрос «отстала ли копия» исчезает, а вместо него остаётся вопрос
// «цело ли замыкание» — на него и отвечает этот файл.
//
// Зелёный в ЧИСТОМ проекте — требование T015: отсутствие `.harness/harness.json` это INFO,
// а не FAIL, иначе плагин нельзя поставить до бутстрапа, а бутстрап нельзя запустить без
// плагина.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PLUGIN_ROOT = path.join(__dirname, '..');

// Замыкание рантайма плагина: точки входа + модули, которые они требуют. Список ручной и
// короткий намеренно — он должен читаться глазами, как и список владений харнеса (T021).
const BIN_ENTRIES = ['oracle.js', 'l0.js', 'ledger.js', 'doctor.js'];
const SURFACE = [
  'commands/elt-verify.md',
  'commands/elt-defects.md',
  'commands/elt-doctor.md',
  'skills/elt/SKILL.md',
  'agents/review-bugs.md',
  'agents/review-claude-md.md',
  'agents/review-code-comments.md',
  'agents/review-history.md',
  'agents/review-prior-comments.md',
  'agents/confidence-scorer.md',
];

function check(name, fn) {
  try {
    const res = fn();
    if (res === true || res === undefined) return { name, status: 'PASS', detail: '' };
    if (res && res.status) return { name, ...res };
    return { name, status: 'PASS', detail: String(res) };
  } catch (error) {
    return { name, status: 'FAIL', detail: error.message };
  }
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8'));
}

function runDoctor({ root = PLUGIN_ROOT, cwd = process.cwd() } = {}) {
  const checks = [];

  checks.push(check('node >= 18', () => {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 18) throw new Error(`node ${process.versions.node} — плагину нужен 18+`);
    return `node ${process.versions.node}`;
  }));

  checks.push(check('git на PATH', () => {
    const v = execFileSync('git', ['--version'], { encoding: 'utf8' }).trim();
    return v;
  }));

  let manifest = null;
  checks.push(check('plugin.json', () => {
    manifest = readJson('.claude-plugin/plugin.json');
    if (manifest.name !== 'elt') throw new Error(`name = "${manifest.name}", ожидается "elt"`);
    if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version))) throw new Error(`version = "${manifest.version}" не semver`);
    return `elt ${manifest.version}`;
  }));

  // Дрейф между двумя манифестами — отдельный класс: `claude plugin tag` валит релиз, если
  // версии разошлись, но заметить это ДО релиза больше нечем.
  checks.push(check('marketplace.json согласован с plugin.json', () => {
    const market = readJson('.claude-plugin/marketplace.json');
    const entry = (market.plugins || []).find((p) => p.name === 'elt');
    if (!entry) throw new Error('в marketplace.json нет плагина elt');
    if (manifest && entry.version !== manifest.version) {
      throw new Error(`версии разошлись: plugin.json ${manifest.version}, marketplace.json ${entry.version}`);
    }
    return `marketplace elt ${entry.version}`;
  }));

  checks.push(check('точки входа bin/', () => {
    const missing = BIN_ENTRIES.filter((f) => !fs.existsSync(path.join(root, 'bin', f)));
    if (missing.length) throw new Error(`нет файлов: ${missing.join(', ')}`);
    return `${BIN_ENTRIES.length} шт.`;
  }));

  // Замыкание: каждая точка входа обязана РЕЗОЛВИТЬСЯ целиком. `require` вместо `node --check`
  // намеренно: синтаксис ловит и --check, а вот оборванный `require('./missing')` — только
  // фактическая загрузка. Ровно так ломались deploy-копии (D16).
  checks.push(check('замыкание bin/ резолвится', () => {
    for (const f of BIN_ENTRIES) {
      const full = path.join(root, 'bin', f);
      delete require.cache[require.resolve(full)];
      require(full);
    }
    return `${BIN_ENTRIES.length} модулей загружены`;
  }));

  checks.push(check('поверхность плагина на месте', () => {
    const missing = SURFACE.filter((f) => !fs.existsSync(path.join(root, f)));
    if (missing.length) throw new Error(`нет файлов: ${missing.join(', ')}`);
    return `${SURFACE.length} файлов`;
  }));

  // Проект — не плагин: его отсутствие это состояние, а не поломка.
  checks.push(check('проект: .harness/harness.json', () => {
    const file = path.join(cwd, '.harness', 'harness.json');
    if (!fs.existsSync(file)) {
      return { status: 'INFO', detail: 'конфига нет — чистый проект; создаётся командой /elt' };
    }
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!cfg.oracle) return { status: 'WARN', detail: 'в конфиге нет поля oracle — механический оракул не назван' };
    return `oracle: ${cfg.oracle}`;
  }));

  const summary = {
    pass: checks.filter((c) => c.status === 'PASS').length,
    warn: checks.filter((c) => c.status === 'WARN').length,
    info: checks.filter((c) => c.status === 'INFO').length,
    fail: checks.filter((c) => c.status === 'FAIL').length,
  };
  return { plugin: 'elt', version: manifest ? manifest.version : null, checks, summary };
}

function formatText(report) {
  const lines = [`elt-doctor — плагин elt ${report.version || '?'}`];
  for (const c of report.checks) {
    lines.push(`  [${c.status.padEnd(4)}] ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
  }
  const s = report.summary;
  lines.push(`  PASS=${s.pass} WARN=${s.warn} INFO=${s.info} FAIL=${s.fail}`);
  return lines.join('\n') + '\n';
}

function main(argv = process.argv.slice(2), out = process.stdout) {
  const report = runDoctor();
  out.write(argv.includes('--json') ? JSON.stringify(report, null, 2) + '\n' : formatText(report));
  return report.summary.fail ? 2 : 0;
}

if (require.main === module) process.exit(main());

module.exports = { runDoctor, formatText, main, BIN_ENTRIES, SURFACE, PLUGIN_ROOT };
