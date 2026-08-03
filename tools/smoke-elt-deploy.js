#!/usr/bin/env node
'use strict';
// 011 T021 — L2 smoke для ЭТОГО репо (dogfood §3.1). Единственный слой v3, который харнесс
// сам не ел: Ametrin Web (T018) уже прогоняет L2 живьём, здесь его не было вовсе.
//
// Smoke = то, чем реально пользуется человек — deploy-копия `~/.claude/bin/elt.js` в проекте
// БЕЗ repo-checkout. Это ровно класс отказа T017: `MODULE_NOT_FOUND` во ВСЕХ проектах
// (замыкание разошлось с репо), пойманный случайно, а не механикой. Прогон СНАРУЖИ репо
// (пустая temp-директория, никакого tools/ рядом) — relative require() внутри elt.js ловит
// именно это расхождение, юнит-тест на исходники этого репо его в принципе не видит.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function smokeEltDeploy({ home = os.homedir() } = {}) {
  const eltPath = path.join(home, '.claude', 'bin', 'elt.js');
  if (!fs.existsSync(eltPath)) {
    return { ok: false, reason: 'missing', detail: `${eltPath} не найден — sync-bin.js не запускался на этой машине` };
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-deploy-smoke-'));
  try {
    // Без аргументов elt.js печатает usage и выходит 0 — единственный путь, не требующий
    // git-репо/harness.json в cwd, и при этом безусловно проходящий через ВСЕ top-level
    // require() замыкания до первой развилки по команде.
    const r = spawnSync(process.execPath, [eltPath], { cwd: tmp, encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    if (r.status !== 0 || /MODULE_NOT_FOUND/.test(out)) {
      return { ok: false, reason: 'broken', detail: out.slice(-2000), exit: r.status };
    }
    return { ok: true, reason: 'ok' };
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

module.exports = { smokeEltDeploy };
