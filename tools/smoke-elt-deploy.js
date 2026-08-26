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

// 021 T005 — второй слой того же smoke: чистый ПРОЕКТ, а не чистый каталог.
//
// smokeEltDeploy выше отвечает на вопрос «плагин вообще запускается снаружи себя». Он не
// отвечает на вопрос, ради которого человек ставит харнес: «я в новом репозитории — я получу
// рабочий конфиг?». Между этими вопросами живёт целый класс отказов (доктор упал на проекте
// без `.harness/`, `elt init` записал конфиг, который сам же доктор потом считает битым),
// и до этой задачи его проверял только живой прогон руками — то есть никто.
//
// Проверка идёт в СВЕЖЕМ git-репозитории во временном каталоге: без него `elt init` не имеет
// корня, а доктор судит не то дерево.
function smokeFreshProject({ pluginRoot = PLUGIN_ROOT } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-fresh-project-'));
  const runIn = (file, args) => spawnSync(process.execPath, [path.join(pluginRoot, file), ...args], { cwd: tmp, encoding: 'utf8' });
  try {
    for (const args of [['init', '-q'], ['config', 'user.email', 'smoke@elt.local'], ['config', 'user.name', 'smoke']]) {
      const g = spawnSync('git', args, { cwd: tmp, encoding: 'utf8' });
      if (g.status !== 0) return { ok: false, reason: 'git', detail: `git ${args[0]} упал: ${(g.stderr || '').slice(-300)}` };
    }

    // 1. Чистый проект БЕЗ конфига — доктор обязан быть зелёным. Отсутствие
    // `.harness/harness.json` это INFO, а не отказ: плагин ставится ДО бутстрапа, и красный
    // доктор в этот момент означал бы, что первый же шаг инструкции по установке лжёт.
    const before = runIn(path.join('bin', 'doctor.js'), ['--json']);
    if (before.status !== 0) {
      return { ok: false, reason: 'doctor-clean', detail: `доктор в чистом проекте вернул ${before.status}: ${((before.stdout || '') + (before.stderr || '')).slice(-500)}` };
    }

    // 2. Первый bootstrap.
    const init = runIn(path.join('tools', 'elt.js'), ['init', '--oracle', 'node --test']);
    if (init.status !== 0) {
      return { ok: false, reason: 'init', detail: `elt init вернул ${init.status}: ${((init.stdout || '') + (init.stderr || '')).slice(-500)}` };
    }
    const cfgPath = path.join(tmp, '.harness', 'harness.json');
    if (!fs.existsSync(cfgPath)) return { ok: false, reason: 'init', detail: 'elt init отчитался успехом, но .harness/harness.json не появился' };
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (err) {
      return { ok: false, reason: 'init', detail: `конфиг не разбирается как JSON: ${err.message}` };
    }
    if (cfg.oracle !== 'node --test') return { ok: false, reason: 'init', detail: `оракул в конфиге '${cfg.oracle}', а просили 'node --test'` };

    // 3. Доктор ПОСЛЕ бутстрапа — он обязан увидеть свежесозданный конфиг проектом, а не
    // промолчать. Именно эта половина ловит конфиг, который init пишет, а doctor не признаёт.
    const after = runIn(path.join('bin', 'doctor.js'), ['--json']);
    if (after.status !== 0) {
      return { ok: false, reason: 'doctor-configured', detail: `доктор после init вернул ${after.status}: ${((after.stdout || '') + (after.stderr || '')).slice(-500)}` };
    }
    let report = null;
    try { report = JSON.parse(after.stdout); } catch { /* ниже станет отказом */ }
    const projectCheck = report && (report.checks || []).find((c) => /harness\.json/.test(c.name));
    if (!projectCheck) return { ok: false, reason: 'doctor-configured', detail: 'доктор не сообщил о конфиге проекта вообще' };
    if (projectCheck.status !== 'PASS') {
      return { ok: false, reason: 'doctor-configured', detail: `доктор видит свой же свежий конфиг как ${projectCheck.status}: ${projectCheck.detail || ''}` };
    }
    return { ok: true, reason: 'ok', detail: `чистый проект: doctor PASS=${report.summary.pass}, оракул '${cfg.oracle}'` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  let failed = false;
  for (const [name, fn] of [['plugin', smokeEltDeploy], ['fresh-project', smokeFreshProject]]) {
    const r = fn();
    console.error(`smoke-elt-deploy [${name}]: ${r.reason}${r.detail ? ' — ' + r.detail : ''}`);
    if (!r.ok) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();

module.exports = { smokeEltDeploy, smokeFreshProject, PLUGIN_ROOT };
