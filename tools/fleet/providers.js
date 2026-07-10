'use strict';
// providers.js — headless-executor для fleet-воркеров.
// run({provider, prompt, cwd, model}) → {exit, ok, reason, logPath, lastMsg}.
//
// Инварианты слайса T002 (specs/002-elt-fleet):
//  - spawn headless каждого провайдера (claude / codex / agy);
//  - промпт идёт через STDIN у ВСЕХ (Windows: реальные CLI = .cmd-шимы → spawn
//    промпта в argv требует shell:true + escaping кавычек; stdin это обходит и
//    кросс-платформенно). Реальные argv/каналы каждого CLI фиксирует T003 [live];
//  - hard-таймаут на ВСЕ вызовы (agy живьём виснет — см. дизайн);
//  - пустой stdout при exit 0 = fail (agy-квирк: выходит 0 без логина/после hang);
//  - лог (stdout+stderr) в .harness/fleet/logs/.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const KILL_GRACE_MS = 3000;
const IS_WIN = process.platform === 'win32';

// Дефолтные headless-флаги (БЕЗ промпта — он в stdin). model опционален.
const PROVIDERS = {
  claude: (model) => ['-p', '--dangerously-skip-permissions', ...(model ? ['--model', model] : [])],
  codex: (model) => ['exec', '--sandbox', 'workspace-write', ...(model ? ['--model', model] : [])],
  agy: (model) => ['-p', '--dangerously-skip-permissions', '--print-timeout', '5m', ...(model ? ['--model', model] : [])],
};

// Переопределение бинарника: env FLEET_BIN_<PROVIDER> = JSON-массив argv-префикса
// (напр. ["node","/path/stub.js"]) или строка-путь. Дефолт — имя CLI из PATH.
function resolveBin(provider) {
  const env = process.env['FLEET_BIN_' + provider.toUpperCase()];
  if (env) {
    try { const j = JSON.parse(env); return Array.isArray(j) ? j.map(String) : [String(j)]; }
    catch { return [env]; }
  }
  return [provider];
}

function logDirFor(cwd) {
  const d = path.join(cwd, '.harness', 'fleet', 'logs');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// ponytail: shell:true нужен ТОЛЬКО чтобы node мог запустить .cmd/.bat-шим (реальные
// CLI на Windows) — с node ≥18.20 прямой spawn .cmd бросает EINVAL. node-стабы и .exe
// зовём без shell (иначе пробелы в пути ломают склейку аргументов при shell:true).
function needsShell(cmd) {
  return IS_WIN && cmd !== 'node' && !/\.exe$/i.test(cmd);
}

function hardKill(child) {
  if (IS_WIN && child.pid) {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /* уже мёртв */ }
  } else {
    try { child.kill('SIGTERM'); } catch { /* noop */ }
    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* noop */ } }, KILL_GRACE_MS);
  }
}

function run({ provider, prompt = '', cwd = process.cwd(), model = null, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    if (!PROVIDERS[provider]) {
      return resolve({ exit: null, ok: false, reason: 'unknown-provider', logPath: null, lastMsg: '' });
    }
    const bin = resolveBin(provider);
    const cmd = bin[0];
    const argv = [...bin.slice(1), ...PROVIDERS[provider](model)];
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(logDirFor(cwd), `${provider}-${ts}-${process.pid}.log`);
    const logFd = fs.openSync(logPath, 'w');
    const writeLog = (s) => { try { fs.writeSync(logFd, s); } catch { /* лог не критичен */ } };

    let child;
    try {
      child = spawn(cmd, argv, { cwd, shell: needsShell(cmd), windowsHide: true });
    } catch (e) {
      writeLog('spawn error: ' + e.message);
      try { fs.closeSync(logFd); } catch { /* noop */ }
      return resolve({ exit: null, ok: false, reason: 'spawn-error', logPath, lastMsg: '' });
    }

    let out = '';
    let killed = false;
    let settled = false;
    const finish = (r) => { if (settled) return; settled = true; try { fs.closeSync(logFd); } catch { /* noop */ } resolve(r); };

    child.stdout.on('data', (b) => { const s = b.toString(); out += s; writeLog(s); });
    child.stderr.on('data', (b) => writeLog(b.toString()));

    if (child.stdin) {
      child.stdin.on('error', () => { /* CLI мог закрыть stdin раньше */ });
      child.stdin.write(prompt);
      child.stdin.end();
    }

    const timer = setTimeout(() => { killed = true; hardKill(child); }, timeoutMs);

    child.on('error', () => {
      clearTimeout(timer);
      finish({ exit: null, ok: false, reason: 'spawn-error', logPath, lastMsg: '' });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const lastMsg = out.split(/\r?\n/).filter((l) => l.trim()).pop() || '';
      if (killed) return finish({ exit: null, ok: false, reason: 'timeout', logPath, lastMsg });
      if (code === 0 && out.trim() === '') return finish({ exit: 0, ok: false, reason: 'empty-stdout', logPath, lastMsg });
      finish({ exit: code, ok: code === 0, reason: code === 0 ? 'ok' : 'nonzero-exit', logPath, lastMsg });
    });
  });
}

module.exports = { run, PROVIDERS, DEFAULT_TIMEOUT_MS, resolveBin };
