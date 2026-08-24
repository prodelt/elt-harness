#!/usr/bin/env node
'use strict';
// smoke-elt-deploy — L2 smoke этого репозитория (dogfood §3.1).
//
// Слой проверяет ровно то, чем пользуется человек. До 019 T015 этим была deploy-копия
// `~/.claude/bin/elt.js`: единственный отказ, который юнит-тесты на исходники не видят в
// принципе, — `MODULE_NOT_FOUND` во ВСЕХ проектах, когда замыкание копии разошлось с репо
// (T017, D16, D18).
//
// Копии больше нет: харнес ставится плагином, и установленный каталог — это и есть
// репозиторий. Но КЛАСС отказа никуда не делся, он только сменил форму: плагин может
// приехать с оборванным замыканием (`require` соседа, которого нет), и снаружи это опять
// выглядит как «команда просто не работает». Поэтому smoke остался тем же по смыслу —
// запуск ИЗ ЧУЖОГО каталога, где рядом нет ни `tools/`, ни `.harness/`, — и сменил только
// цель: вместо копии проверяется сам плагин.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PLUGIN_ROOT = path.join(__dirname, '..');

function smokeEltDeploy({ pluginRoot = PLUGIN_ROOT } = {}) {
  const doctor = path.join(pluginRoot, 'bin', 'doctor.js');
  if (!fs.existsSync(doctor)) {
    return { ok: false, reason: 'missing', detail: `${doctor} не найден — установка плагина неполна` };
  }
  // Пустая temp-директория: никакого `tools/` рядом. Относительные `require()` внутри
  // замыкания ловят расхождение именно здесь, а прогон в корне репо его не увидит никогда.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-plugin-smoke-'));
  try {
    const r = spawnSync(process.execPath, [doctor, '--json'], { cwd: tmp, encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    if (r.status !== 0 || /MODULE_NOT_FOUND/.test(out)) {
      return { ok: false, reason: 'broken', detail: out.slice(-2000), exit: r.status };
    }
    let report = null;
    try { report = JSON.parse(r.stdout); } catch { /* не json — ниже это и станет отказом */ }
    if (!report || !report.summary) {
      return { ok: false, reason: 'broken', detail: `доктор не вернул разбираемый отчёт: ${out.slice(-500)}`, exit: r.status };
    }
    if (report.summary.fail) {
      const failed = report.checks.filter((c) => c.status === 'FAIL').map((c) => c.name).join(', ');
      return { ok: false, reason: 'broken', detail: `FAIL: ${failed}`, exit: r.status };
    }
    return { ok: true, reason: 'ok', detail: `plugin ${report.version}, PASS=${report.summary.pass}` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  const r = smokeEltDeploy();
  console.error(`smoke-elt-deploy: ${r.reason}${r.detail ? ' — ' + r.detail : ''}`);
  process.exit(r.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = { smokeEltDeploy, PLUGIN_ROOT };
