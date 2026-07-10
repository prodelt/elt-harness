'use strict';
// providers.js — headless-executor для fleet-воркеров.
// run({provider, prompt, cwd, model}) → {exit, ok, reason, logPath, lastMsg}.
//
// Инварианты слайса T002 (specs/002-elt-fleet), уточнены T003 [live]:
//  - spawn headless каждого провайдера (claude / codex / agy);
//  - claude/codex: промпт через STDIN (Windows: реальные CLI = .cmd-шимы → spawn
//    промпта в argv требует shell:true + escaping кавычек; stdin это обходит).
//  - agy: STDIN как канал промпта НЕ РАБОТАЕТ (T003 live-fire — CLI игнорирует
//    stdin и отвечает про собственные argv-флаги вместо ввода); промпт идёт
//    значением `-p` в argv. agy также игнорирует cwd процесса (пишет в фикс.
//    ~/.gemini/antigravity-cli/scratch без явного --add-dir) — передаём cwd
//    через --add-dir. agy — реальный .exe на PATH (не .cmd-шим) → спавним БЕЗ
//    shell (needsShell), иначе argv-промпт открыл бы shell-injection.
//  - hard-таймаут на ВСЕ вызовы; agy при истечении своего --print-timeout
//    падает exit 1 + stderr "Error: timeout waiting for response" (T003 live —
//    не hang, наблюдались холодные старты 15–90с).
//  - пустой stdout при exit 0 = fail (эвристика на случай выхода без ответа);
//  - лог (stdout+stderr) в .harness/fleet/logs/.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const KILL_GRACE_MS = 3000;
const IS_WIN = process.platform === 'win32';

// Дефолтные headless-флаги. claude/codex: БЕЗ промпта (он в stdin). agy: промпт
// и cwd — прямые аргументы (T003 live, см. комментарий вверху файла). model опционален.
const PROVIDERS = {
  claude: (model) => ['-p', '--dangerously-skip-permissions', ...(model ? ['--model', model] : [])],
  codex: (model) => ['exec', '--sandbox', 'workspace-write', ...(model ? ['--model', model] : [])],
  agy: (model, prompt, cwd) => ['-p', prompt, '--add-dir', cwd, '--dangerously-skip-permissions', '--print-timeout', '5m', ...(model ? ['--model', model] : [])],
};

// Баг #10 (T016 live-fire): судья зовётся с inline `--json-schema {…}` (JSON с кавычками).
// `claude` на PATH — это claude.cmd-шим → node спавнит через cmd.exe (shell:true, .cmd иначе
// не спавнится на node ≥18.20) → cmd.exe рвёт кавычки JSON → "not valid JSON" → судья падает →
// REJECT-default блокирует КАЖДЫЙ слайс. Резолвим шим в реальный claude.exe (шим и указывает на
// node_modules/@anthropic-ai/claude-code/bin/claude.exe): .exe спавнится БЕЗ shell (needsShell) →
// node сам корректно квотит argv → схема долетает целой. Не нашли exe → fallback 'claude' (старое).
let _claudeExe; // кеш: undefined=не искали, null=не нашли, string=путь
function claudeExe() {
  if (_claudeExe !== undefined) return _claudeExe;
  _claudeExe = null;
  if (!IS_WIN) return _claudeExe;
  try {
    const hits = execFileSync('where', ['claude'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
    for (const h of hits) {
      const exe = path.join(path.dirname(h), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
      if (fs.existsSync(exe)) { _claudeExe = exe; break; }
    }
  } catch { /* where/шим недоступен → fallback на 'claude' */ }
  return _claudeExe;
}

// Переопределение бинарника: env FLEET_BIN_<PROVIDER> = JSON-массив argv-префикса
// (напр. ["node","/path/stub.js"]) или строка-путь. Дефолт — имя CLI из PATH (claude → .exe, баг #10).
function resolveBin(provider) {
  const env = process.env['FLEET_BIN_' + provider.toUpperCase()];
  if (env) {
    try { const j = JSON.parse(env); return Array.isArray(j) ? j.map(String) : [String(j)]; }
    catch { return [env]; }
  }
  if (provider === 'claude') { const exe = claudeExe(); if (exe) return [exe]; }
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
  // agy резолвится в реальный .exe на PATH (T003 live: `where agy`), не .cmd-шим —
  // спавним напрямую (без cmd.exe), иначе argv-промпт agy открыл бы shell-injection.
  return IS_WIN && cmd !== 'node' && cmd !== 'agy' && !/\.exe$/i.test(cmd);
}

function hardKill(child) {
  if (IS_WIN && child.pid) {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /* уже мёртв */ }
  } else {
    try { child.kill('SIGTERM'); } catch { /* noop */ }
    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* noop */ } }, KILL_GRACE_MS);
  }
}

function run({ provider, prompt = '', cwd = process.cwd(), model = null, timeoutMs = DEFAULT_TIMEOUT_MS, jsonSchema = null }) {
  return new Promise((resolve) => {
    if (!PROVIDERS[provider]) {
      return resolve({ exit: null, ok: false, reason: 'unknown-provider', logPath: null, lastMsg: '' });
    }
    const bin = resolveBin(provider);
    const cmd = bin[0];
    // jsonSchema: только для вызовов, которым нужен структурированный ответ (судья) — НЕ
    // трогает обычные слайс-вызовы имплементатора. Вызывающий отвечает за то, что провайдер
    // поддерживает --json-schema/--output-format (claude поддерживает, T016 live-fire).
    const argv = [
      ...bin.slice(1),
      ...PROVIDERS[provider](model, prompt, cwd),
      ...(jsonSchema ? ['--json-schema', jsonSchema, '--output-format', 'json'] : []),
    ];
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
      if (provider !== 'agy') child.stdin.write(prompt); // agy: промпт уже в argv (T003 live)
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
      if (killed) return finish({ exit: null, ok: false, reason: 'timeout', logPath, lastMsg, stdout: out });
      if (code === 0 && out.trim() === '') return finish({ exit: 0, ok: false, reason: 'empty-stdout', logPath, lastMsg, stdout: out });
      finish({ exit: code, ok: code === 0, reason: code === 0 ? 'ok' : 'nonzero-exit', logPath, lastMsg, stdout: out });
    });
  });
}

module.exports = { run, PROVIDERS, DEFAULT_TIMEOUT_MS, resolveBin, claudeExe, needsShell };
