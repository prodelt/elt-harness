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
const crypto = require('node:crypto');
const router = require('./router');

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const KILL_GRACE_MS = 3000;
const IS_WIN = process.platform === 'win32';

// Дефолтные headless-флаги. claude/codex: БЕЗ промпта (он в stdin). agy: промпт
// и cwd — прямые аргументы (T003 live, см. комментарий вверху файла). model резолвится
// в run() (явно передан ИЛИ router.modelFor) — сюда всегда приходит непустой (T019).
//
// lean (T019): флаг отключает загрузку глобальной массы skills/MCP/hooks/CLAUDE.md
// для fleet-воркеров (аудит: ~25k токенов профиль-догруза на КАЖДЫЙ spawn).
//  - claude: --safe-mode (auth/model/tools работают, customizations выключены — не --bare,
//    тот требует ANTHROPIC_API_KEY и ломает OAuth-подписку).
//  - codex: --ignore-user-config (не грузит ~/.codex/config.toml; auth через CODEX_HOME цел).
//  - agy: у CLI нет эквивалентного флага (проверено `agy --help`, T019 ресерч) — нечего выключать.
const PROVIDERS = {
  claude: (model, prompt, cwd, lean) => [
    '-p', '--dangerously-skip-permissions', ...(model ? ['--model', model] : []),
    ...(lean ? ['--safe-mode'] : []),
  ],
  // 009 T010 (разбор живого лога, 567KB): судья-codex с правом записи ведёт себя как
  // ИСПОЛНИТЕЛЬ — уходит гонять `node tools/elt-oracle-runner.js` внутри судейского вызова
  // (оракул уже зелёный, это предусловие гейта!), пишет артефакты в дерево и не укладывается
  // ни в какой таймаут: 300/301/301/481/540с, DEAD 5 из 5. Роль судьи read-only не по вкусу,
  // а структурно: читать дифф он может, менять дерево — нет (это ещё и источник stale-tree).
  codex: (model, prompt, cwd, lean, timeoutMs, readOnly) => [
    'exec', '--sandbox', readOnly ? 'read-only' : 'workspace-write', ...(model ? ['--model', model] : []),
    ...(lean ? ['--ignore-user-config'] : []),
  ],
  // agy: --print-timeout ПРОИЗВОДЕН от нашего timeoutMs, а не литерал. Живой прогон 007
  // (2026-07-22): литеральные '5m' у agy и DEFAULT_TIMEOUT_MS были двумя независимыми
  // лимитами — воркеры T001/T003 дописали код за 2.5 мин, но упали на «Error: timeout
  // waiting for response», потому что agy сдавался по СВОЕМУ лимиту раньше, чем наш
  // caller успевал что-то решить. Один источник правды: сколько дали мы, столько и agy.
  //
  // 011 T028 (практика waggle, §06 артефакта): промпт судьи/воркера — В ФАЙЛ, argv несёт
  // только путь. agy — единственный провайдер, у которого промпт вообще идёт в argv (не
  // stdin, см. шапку файла), и на реальном диффе (DIFF_CAP 60K) это упирается в лимит длины
  // командной строки Windows раньше, чем в сам DIFF_CAP — `spawn ENAMETOOLONG` живьём
  // (T017б лечила симптом failover'ом на другого судью, причина оставалась). Файл ложится
  // в `.harness/fleet/prompts/` — та же директория, что уже покрыта `--add-dir cwd`, значит
  // agy достаёт его без ДОПОЛНИТЕЛЬНОГО --add-dir. Ссылка вместо копии — argv короткий
  // независимо от размера промпта, класс ошибки снят, а не подловлен порогом.
  agy: (model, prompt, cwd, lean, timeoutMs) => [
    '-p', promptRefForAgy(cwd, prompt), '--add-dir', cwd, '--dangerously-skip-permissions',
    '--print-timeout', `${Math.max(1, Math.round(timeoutMs / 60000))}m`, ...(model ? ['--model', model] : []),
  ],
};

function promptRefForAgy(cwd, prompt) {
  gitExcludeFleet(cwd);
  const dir = path.join(cwd, '.harness', 'fleet', 'prompts');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `agy-${Date.now()}-${process.pid}-${crypto.randomUUID()}.txt`);
  fs.writeFileSync(file, prompt, 'utf8');
  return `Полная инструкция и содержимое (включая дифф) лежат в файле ${file} — прочитай его целиком и ответь по формату, описанному внутри.`;
}

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
      // Нативный установщик (2.1.x): `where` уже отдаёт настоящий claude.exe, вложенного
      // node_modules рядом с ним нет. Без этой ветки резолв падал в fallback 'claude' →
      // needsShell=true → cmd.exe КОНКАТЕНИРУЕТ argv вместо экранирования → `--json-schema`
      // приезжал битым (`--json-schema is not valid JSON`) и КАЖДЫЙ вызов судьи со схемой
      // умирал с exit 1 (~1.7 s). Обычные вызовы выживали: у них промпт идёт через STDIN.
      if (/\.exe$/i.test(h) && fs.existsSync(h)) { _claudeExe = h; break; }
      // npm-раскладка: шим на PATH указывает на exe внутри пакета.
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

// CLI реально установлен? Стаб-override (FLEET_BIN_*) считается доступностью и проверяется
// первым — тесты и live-стабы не должны зависеть от того, что стоит на машине. Результат
// `where` кешируется на процесс. 009 T010: живёт здесь (а не в fleet.js), потому что нужен
// обоим — и роутеру ролей судьи, и gate.js при failover мёртвого judge CLI.
const _availCache = new Map();
function available(provider) {
  if (process.env['FLEET_BIN_' + provider.toUpperCase()]) return true;
  if (!_availCache.has(provider)) {
    try { execFileSync(IS_WIN ? 'where' : 'which', [provider], { stdio: 'ignore' }); _availCache.set(provider, true); }
    catch { _availCache.set(provider, false); }
  }
  return _availCache.get(provider);
}

// 011 T014 (живой дефект, найден при приёмке в чужом проекте): `.harness/fleet/` живёт
// ВНУТРИ дерева (логи — всегда, T028-промпты agy — теперь тоже), и в репо-разработчике он
// гитигнорен, но НИ ОДИН другой проект (это репо деплоится в ~/.claude/bin/) про это не
// знает. Живьём судья реально ПОЛУЧАЛ `.harness/fleet/...` как «файл диффа» (untracked,
// git status его видит) и вписывал его в grounding — рантайм-артефакт гейта вменялся
// имплементатору. `.git/info/exclude` — тот же приём, что `gitExclude()` в elt.js для
// `parked.json`: пишется САМИМ гейтом, не зависит от .gitignore целевого проекта.
let _excludedFleetDir = null; // кеш на процесс: не бить диск на каждый spawn
function gitExcludeFleet(cwd) {
  if (_excludedFleetDir === cwd) return;
  try {
    const gitDirOut = execFileSync('git', ['rev-parse', '--git-dir'], { cwd, encoding: 'utf8' }).trim();
    if (!gitDirOut) return;
    const gitDir = path.isAbsolute(gitDirOut) ? gitDirOut : path.join(cwd, gitDirOut);
    const exclude = path.join(gitDir, 'info', 'exclude');
    const body = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
    const line = '.harness/fleet/';
    if (!body.split(/\r?\n/).includes(line)) {
      fs.mkdirSync(path.dirname(exclude), { recursive: true });
      fs.writeFileSync(exclude, body + (body && !body.endsWith('\n') ? '\n' : '') + line + '\n');
    }
    _excludedFleetDir = cwd;
  } catch { /* не git-репо/read-only — молчим, не работа executor'а */ }
}

function logDirFor(cwd) {
  gitExcludeFleet(cwd);
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

// T027 (дефект 3): STOP-файл раньше проверялся ТОЛЬКО между батчами fleet.js — in-flight
// spawn переживал STOP до собственного 5-минутного timeoutMs. stopFile здесь — путь к
// .harness/STOP КОРНЕВОГО проекта (не worktree-cwd, где реально не будет STOP-файла);
// caller (fleet.js defaultWorker) прокидывает его явно. hardKill уже делает настоящий
// tree-kill (taskkill /T /F на Windows) — не хватало только быстрого триггера.
const STOP_POLL_MS_DEFAULT = 1000;

function run({ provider, prompt = '', cwd = process.cwd(), model = null, timeoutMs = DEFAULT_TIMEOUT_MS, jsonSchema = null, lean, effort = null, sessionId = null, resume = false, stopFile = null, stopPollMs = STOP_POLL_MS_DEFAULT, readOnly = false } = {}) {
  return new Promise((resolve) => {
    if (!PROVIDERS[provider]) {
      return resolve({ exit: null, ok: false, reason: 'unknown-provider', logPath: null, lastMsg: '' });
    }
    // T019: caller не передал model → берём явный дефолт из router (не ambient CLI/аккаунт).
    const resolvedModel = model || router.modelFor(provider, router.loadPolicy(cwd));
    // 009 T010: lean по умолчанию ВЫКЛЮЧЕН. Он снимал с воркера не только токен-налог
    // (~25k профиль-догруза), но и проектную дисциплину — CLAUDE.md, скилы, хуки-зубы:
    // воркер работал вслепую и потом ловил block судьи за то, чего не мог знать. Экономия
    // токенов дешевле, чем переделанный слайс. FLEET_LEAN=1 — явный откат (отладка/бюджет).
    const leanFlag = lean === undefined ? process.env.FLEET_LEAN === '1' : !!lean;
    const bin = resolveBin(provider);
    const cmd = bin[0];
    // jsonSchema: только для вызовов, которым нужен структурированный ответ (судья) — НЕ
    // трогает обычные слайс-вызовы имплементатора. Вызывающий отвечает за то, что провайдер
    // поддерживает --json-schema/--output-format (claude поддерживает, T016 live-fire).
    const argv = [
      ...bin.slice(1),
      ...PROVIDERS[provider](resolvedModel, prompt, cwd, leanFlag, timeoutMs, readOnly),
      // T003 (004-elt-selfdrive): адаптивный эффорт. `claude --effort <level>` — headless-флаг
      // (подтв. `claude --help`, 2.1.207). Только claude: codex/agy своего эквивалента не имеют.
      // Проброс на месте (не в PROVIDERS.claude) — argv-строитель провайдера остаётся про модель/lean.
      ...(effort && provider === 'claude' ? ['--effort', String(effort)] : []),
      // T007 (004-elt-selfdrive): session-rotation драйвер (elt-drive.ps1). --session-id/-r
      // confirmed claude-only flags (T014 probe) — resume:false → fresh id (--session-id);
      // resume:true → continue that id (-r/--resume). codex/agy get neither.
      ...(sessionId && provider === 'claude' ? (resume ? ['-r', String(sessionId)] : ['--session-id', String(sessionId)]) : []),
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

    let stoppedByFile = false;
    const timer = setTimeout(() => { killed = true; hardKill(child); }, timeoutMs);
    // T027: отдельный от timeout триггер — STOP-файл убивает child ≤stopPollMs (дефолт 1с),
    // не ждёт timeoutMs (было до 5 минут) и не ждёт конца текущего батча fleet.js.
    const stopTimer = stopFile
      ? setInterval(() => {
          if (!settled && fs.existsSync(stopFile)) { killed = true; stoppedByFile = true; hardKill(child); }
        }, stopPollMs)
      : null;
    const clearTimers = () => { clearTimeout(timer); if (stopTimer) clearInterval(stopTimer); };

    child.on('error', () => {
      clearTimers();
      finish({ exit: null, ok: false, reason: 'spawn-error', logPath, lastMsg: '' });
    });

    child.on('close', (code) => {
      clearTimers();
      const lastMsg = out.split(/\r?\n/).filter((l) => l.trim()).pop() || '';
      if (killed) return finish({ exit: null, ok: false, reason: stoppedByFile ? 'stopped' : 'timeout', logPath, lastMsg, stdout: out });
      if (code === 0 && out.trim() === '') return finish({ exit: 0, ok: false, reason: 'empty-stdout', logPath, lastMsg, stdout: out });
      finish({ exit: code, ok: code === 0, reason: code === 0 ? 'ok' : 'nonzero-exit', logPath, lastMsg, stdout: out });
    });
  });
}

module.exports = { run, PROVIDERS, DEFAULT_TIMEOUT_MS, resolveBin, claudeExe, needsShell, available };
