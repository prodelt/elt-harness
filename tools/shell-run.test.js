'use strict';
// 024 T001 — диспетчер шелла: один на харнес, отказ громкий, дефолт по платформе.
//
// Дискриминирующая часть — второй тест: до 024 отсутствие интерпретатора приезжало в гейт
// как обычный красный оракул (`elt oracle: exit 1 (0s)`, ноль строк причины), и отличить
// «оракул красный» от «на этой платформе нет powershell» было нечем.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const shellRun = require('./shell-run');
const ELT = path.join(__dirname, 'elt.js');
const roots = [];
after(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* windows lock */ } } });

test('024 T001: дефолт выводится из платформы, а не пишется в поставку', () => {
  assert.equal(shellRun.defaultShell('win32'), 'powershell');
  assert.equal(shellRun.defaultShell('linux'), 'bash');
  assert.equal(shellRun.defaultShell('darwin'), 'bash');
  // Отсутствие поля законно: конфиг без `shell` работает на любой платформе.
  assert.equal(shellRun.resolveShell(undefined, 'linux'), 'bash');
  assert.equal(shellRun.resolveShell('', 'win32'), 'powershell');
});

test('024 T001: неизвестный shell не деградирует молча в bash', () => {
  // Прежний код писал `shell === "powershell" ? ps : bash`, то есть ЛЮБАЯ опечатка выбирала
  // bash — включая Windows-конфиг с опиской, где bash может не существовать вовсе.
  assert.equal(shellRun.resolveShell('bahs'), null);
  const r = shellRun.runShell('echo hi', 'bahs');
  assert.equal(r.unknownShell, true);
  assert.match(r.err, /bash, powershell/);
});

test('024 T001: отсутствие интерпретатора отличимо от ненулевого кода команды', () => {
  const present = shellRun.runShell('exit 3', shellRun.defaultShell());
  assert.equal(present.code, 3, 'настоящий код команды обязан доходить как есть');
  assert.equal(present.missing, false);

  const absent = shellRun.runShell('echo hi', process.platform === 'win32' ? 'bash' : 'powershell');
  if (absent.missing) {
    assert.equal(absent.code, 1);
    assert.match(shellRun.missingShellMessage(process.platform === 'win32' ? 'bash' : 'powershell'), /не найден на PATH/);
  }
  // Если чужой интерпретатор на машине ЕСТЬ (bash на Windows через Git for Windows,
  // powershell на Linux через pwsh-пакет), ветка не проверяема — и это не повод краснеть.
});

test('024 T001: elt oracle с недоступным shell называет причину, а не «exit 1 (0s)»', () => {
  const absent = process.platform === 'win32' ? 'bash' : 'powershell';
  if (!shellRun.runShell('echo probe', absent).missing) return; // интерпретатор есть — сценарий неприменим
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-shell-'));
  roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: absent, judge: { enabled: false },
  }));
  const r = spawnSync(process.execPath, [ELT, 'oracle'], { cwd: root, encoding: 'utf8' });
  const said = `${r.stdout}${r.stderr}`;
  assert.notEqual(r.status, 0);
  assert.match(said, new RegExp(`интерпретатор '${absent}' не найден`), said);
  assert.match(said, /harness\.json/, 'отказ обязан назвать поле, которое надо править');
});

test('024 T001: у harness.json репозитория нет жёсткого powershell', () => {
  // Поставочный конфиг перестаёт быть личной настройкой Windows-машины: без поля дефолт
  // считается по платформе того, кто запустил.
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.harness', 'harness.json'), 'utf8'));
  assert.equal(cfg.shell, undefined, 'поле shell в поставке фиксирует платформу автора у всех остальных');
});

test('024 T001: копий диспетчера в дереве больше нет', () => {
  // Пять копий одного правила и разошлись; замок держит их снятыми. Ищется буквальный
  // спавн powershell с ключами `-NoProfile -ExecutionPolicy` мимо общего модуля.
  const root = path.join(__dirname, '..');
  const files = execFileSync('git', ['ls-files', 'tools', 'bin'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
  const offenders = [];
  for (const f of files) {
    if (f === 'tools/shell-run.js') continue;
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    if (/spawnSync\(\s*'powershell'/.test(text) && !/Register-ScheduledTask/.test(text)) offenders.push(f);
  }
  // Исключение названо явно: `elt-retro-label.js` регистрирует задачу планировщика Windows —
  // это не диспетчер оракула, а Windows-only функциональность (её отсутствие на POSIX —
  // отдельный пробел, записанный в audit E16, а не предмет этого замка).
  assert.deepEqual(offenders, [], `диспетчер шелла обязан быть один: ${offenders.join(', ')}`);
});
