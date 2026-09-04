'use strict';
// 024 T001 — ОДИН диспетчер шелла на весь харнес.
//
// Их было пять: `elt.js:sh()`, `elt-verify-bg.js:shellArgv()`, `harness-selfcheck.js:
// defaultRunner()`, встроенный в `project-bootstrap.js` и безусловный `spawnSync('powershell')`
// в `elt-retro-label.js`. Пять копий одного правила — причина, по которой правка в одной из
// них не чинила остальные: фон и синхронный гейт расходились в способе запуска той же самой
// команды (016 T005 чинил это точечно, оставив три копии).
//
// Второй и более дорогой дефект, ради которого модуль и появился. В поставочном
// `.harness/harness.json` стояло `"shell": "powershell"`, а `sh()` спавнил его без единой
// проверки. На Linux и macOS `spawnSync` отдаёт `status: null` и `error.code === 'ENOENT'`;
// прежний код превращал это в `code 1` и НЕ печатал `error` никогда:
//
//     $ node tools/elt.js oracle
//     elt oracle: node tools/elt-oracle-runner.js
//     elt oracle: exit 1 (0s)
//
// Ноль секунд, ноль строк причины — на первом же шаге документированной цепочки гейта.
// Отличить «оракул красный» от «интерпретатора нет» было нечем. Для серверного агента, ради
// которого харнес и существует, это не десять минут разбора, а петля перезапусков: причины
// нет в выводе вообще.

const { spawnSync } = require('node:child_process');

// Закрытый список. Значение вне его — ошибка конфига, а не «ну пусть будет bash»: молчаливый
// фолбек означал бы, что опечатка в `shell` меняет ИНТЕРПРЕТАТОР, а не отвергается.
const SHELLS = ['bash', 'powershell'];

// Дефолт выводится из платформы, а не пишется в поставку. Конфиг с жёстким `powershell`
// приезжал в чужой проект как личная настройка Windows-машины автора.
function defaultShell(platform = process.platform) {
  return platform === 'win32' ? 'powershell' : 'bash';
}

function resolveShell(shell, platform = process.platform) {
  if (shell == null || shell === '') return defaultShell(platform);
  return SHELLS.includes(shell) ? shell : null;
}

// `psExitCode` — вариант для «глубокой» пробы чужой команды: PowerShell возвращает 0/1 по
// успеху пайплайна, а не код нативной команды, поэтому красный оракул с exit 3 приезжал бы
// как 1, а несуществующая команда — как 0. Поведение унаследовано из project-bootstrap.js,
// где оно было поймано живым прогоном.
function shellArgv(cmd, shell, { psExitCode = false } = {}) {
  if (shell === 'powershell') {
    return ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      psExitCode ? `$ErrorActionPreference='Stop'; ${cmd}; exit $LASTEXITCODE` : cmd]];
  }
  return ['bash', ['-c', cmd]];
}

function missingShellMessage(shell, platform = process.platform) {
  const suggested = defaultShell(platform);
  return `интерпретатор '${shell}' не найден на PATH (платформа ${platform}). `
    + `Исправить: поле "shell" в .harness/harness.json → "${suggested}", либо поставить '${shell}'. `
    + `Допустимые значения: ${SHELLS.join(', ')}.`;
}

// Единственная точка запуска. Возвращает `missing: true`, когда интерпретатора нет, —
// вызывающий обязан отличить это от «команда вернула ненулевой код», иначе повторяется ровно
// тот дефект, ради которого написан модуль.
function runShell(cmd, shell, { cwd, maxBuffer, timeout, psExitCode = false, env } = {}) {
  const resolved = resolveShell(shell);
  if (!resolved) {
    return {
      code: 1, out: '', err: `неизвестный shell '${shell}' — допустимо: ${SHELLS.join(', ')}`,
      missing: false, unknownShell: true,
    };
  }
  const [bin, argv] = shellArgv(cmd, resolved, { psExitCode });
  const opts = { encoding: 'utf8', windowsHide: true };
  if (cwd) opts.cwd = cwd;
  if (maxBuffer) opts.maxBuffer = maxBuffer;
  if (timeout) opts.timeout = timeout;
  if (env) opts.env = env;
  const r = spawnSync(bin, argv, opts);
  const missing = !!(r.error && (r.error.code === 'ENOENT' || r.error.code === 'EACCES'));
  return {
    code: r.status === null || r.status === undefined ? 1 : r.status,
    out: `${r.stdout || ''}`,
    err: `${r.stderr || ''}` || (r.error ? String(r.error.code || r.error.message) : ''),
    missing,
    unknownShell: false,
    shell: resolved,
    timedOut: !!(r.error && r.error.code === 'ETIMEDOUT'),
    raw: r,
  };
}

module.exports = { SHELLS, defaultShell, resolveShell, shellArgv, runShell, missingShellMessage };
