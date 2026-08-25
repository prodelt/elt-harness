'use strict';
// 019 T011/T015 — контракт диагностики плагина.
//
// Этот тест — прямая замена побайтной сверки `~/.claude/bin` из `doctor.test.js`. Та сверка
// ловила один класс: развёрнутая копия отстала от исходника (D16, D18). У плагина копии нет,
// поэтому проверяется другое: замыкание цело и два манифеста не разошлись версиями.
//
// Отдельно закреплено требование T015: в ЧИСТОМ проекте (без `.harness/`) доктор ЗЕЛЁНЫЙ.
// Иначе плагин нельзя поставить до бутстрапа, а бутстрап нельзя запустить без плагина.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const doctor = require('./doctor');

function statusOf(report, name) {
  const c = report.checks.find((x) => x.name === name);
  assert.ok(c, `в отчёте есть проверка "${name}"`);
  return c.status;
}

test('в чистом проекте доктор зелёный — конфига нет, но это INFO, а не FAIL', () => {
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-clean-'));
  const report = doctor.runDoctor({ cwd: clean });
  assert.equal(report.summary.fail, 0, JSON.stringify(report.checks.filter((c) => c.status === 'FAIL'), null, 2));
  assert.equal(statusOf(report, 'проект: .harness/harness.json'), 'INFO');
});

test('замыкание bin/ резолвится целиком, а не только компилируется', () => {
  const report = doctor.runDoctor();
  assert.equal(statusOf(report, 'замыкание bin/ резолвится'), 'PASS');
  for (const entry of doctor.BIN_ENTRIES) {
    assert.ok(fs.existsSync(path.join(doctor.PLUGIN_ROOT, 'bin', entry)), `${entry} на месте`);
  }
});

test('вся объявленная поверхность плагина существует', () => {
  const report = doctor.runDoctor();
  const missing = doctor.SURFACE.filter((f) => !fs.existsSync(path.join(doctor.PLUGIN_ROOT, f)));
  assert.deepEqual(missing, [], 'команды, скилл и агенты на месте');
  assert.equal(statusOf(report, 'поверхность плагина на месте'), 'PASS');
});

test('версии двух манифестов совпадают', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(doctor.PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const market = JSON.parse(fs.readFileSync(path.join(doctor.PLUGIN_ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const entry = market.plugins.find((p) => p.name === 'elt');
  assert.equal(plugin.name, 'elt');
  assert.equal(entry.version, plugin.version, 'дрейф версий валит релиз через `claude plugin tag`');
  assert.equal(statusOf(doctor.runDoctor(), 'marketplace.json согласован с plugin.json'), 'PASS');
});

// Дискриминирующий регресс: проверка обязана ПАДАТЬ на разошедшихся версиях. Без него
// «PASS» ничего не значит — он был бы PASS и на сломанном сравнении.
test('разошедшиеся версии манифестов дают FAIL, а не тихий PASS', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-drift-'));
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'elt', version: '5.0.0' }));
  fs.writeFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'elt', plugins: [{ name: 'elt', version: '4.9.0' }] }));

  // runDoctor читает манифесты от PLUGIN_ROOT, поэтому подменяем корень через отдельный
  // процесс: копируем doctor.js в фикстуру и зовём его там.
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.copyFileSync(path.join(doctor.PLUGIN_ROOT, 'bin', 'doctor.js'), path.join(root, 'bin', 'doctor.js'));
  const drifted = require(path.join(root, 'bin', 'doctor.js'));
  const report = drifted.runDoctor({ root });
  const c = report.checks.find((x) => x.name === 'marketplace.json согласован с plugin.json');
  assert.equal(c.status, 'FAIL');
  assert.match(c.detail, /версии разошлись/);
});

test('formatText печатает итог с числом отказов', () => {
  const text = doctor.formatText(doctor.runDoctor());
  assert.match(text, /elt-doctor/);
  assert.match(text, /FAIL=\d+/);
});

// --- 020 T011: проверки поведения, а не наличия файла -------------------------------------
//
// У каждой новой проверки ниже есть пара «сломанная фикстура → FAIL». Без неё PASS ничего не
// значил бы: он был бы PASS и на проверке, которая ничего не сравнивает. Фикстура — отдельный
// корень плагина с копией самого `doctor.js`, потому что `runDoctor` читает манифесты от
// PLUGIN_ROOT (тот же приём, что и в тесте про разошедшиеся версии выше).

let fixtureSeq = 0;
function makePluginRoot({ version = '5.0.0', skill = null, surfaceExtra = [], hooks = null, bgModule = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `elt-doctor-fx-${fixtureSeq++}-`));
  const put = (rel, body) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };
  put('.claude-plugin/plugin.json', JSON.stringify({ name: 'elt', version }));
  put('.claude-plugin/marketplace.json', JSON.stringify({ name: 'elt', plugins: [{ name: 'elt', version }] }));
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.copyFileSync(path.join(doctor.PLUGIN_ROOT, 'bin', 'doctor.js'), path.join(root, 'bin', 'doctor.js'));
  if (skill !== null) put('skills/elt/SKILL.md', skill);
  for (const rel of surfaceExtra) put(rel, '# файл поверхности\n');
  if (hooks !== null) put('hooks/hooks.json', hooks);
  if (bgModule !== null) put('tools/elt-verify-bg.js', bgModule);
  return root;
}

function checkIn(root, name) {
  const drifted = require(path.join(root, 'bin', 'doctor.js'));
  const report = drifted.runDoctor({ root, cwd: root });
  const c = report.checks.find((x) => x.name === name);
  assert.ok(c, `в отчёте есть проверка "${name}"`);
  return c;
}

const GOOD_SKILL = `---
name: elt
version: 5.0.0
---
Пути: \`tools/a.js\` \`tools/b.js\` \`bin/c.js\` \`agents/d.md\` \`commands/e.md\`
`;

test('поверхность: необъявленный файл в agents/ — FAIL, а не тихий PASS', () => {
  const root = makePluginRoot({ surfaceExtra: ['agents/самозванец.md'] });
  const c = checkIn(root, 'поверхность объявлена целиком (обе стороны)');
  assert.equal(c.status, 'FAIL');
  assert.match(c.detail, /самозванец\.md/);
});

test('/elt: оборванная ссылка инструкции — FAIL с именем файла', () => {
  const root = makePluginRoot({ skill: GOOD_SKILL });
  const c = checkIn(root, '/elt: замыкание инструкции');
  assert.equal(c.status, 'FAIL');
  assert.match(c.detail, /несуществующие файлы/);
  assert.match(c.detail, /tools\/a\.js/);
});

test('/elt: версия скила разошлась с plugin.json — FAIL', () => {
  const files = ['tools/a.js', 'tools/b.js', 'bin/c.js', 'agents/d.md', 'commands/e.md'];
  const root = makePluginRoot({ version: '5.1.0', skill: GOOD_SKILL, surfaceExtra: files });
  const c = checkIn(root, '/elt: замыкание инструкции');
  assert.equal(c.status, 'FAIL');
  assert.match(c.detail, /версии разошлись/);
});

test('/elt: отсутствие скила — FAIL, входа не существует', () => {
  const c = checkIn(makePluginRoot(), '/elt: замыкание инструкции');
  assert.equal(c.status, 'FAIL');
  assert.match(c.detail, /skills\/elt\/SKILL\.md/);
});

test('фон: живой модуль даёт PASS и приоритет red > dead > inconclusive', () => {
  const c = checkIn(makePluginRoot(), 'фон: схема терминальных состояний');
  // Фикстура без своего tools/ — модуля нет, значит FAIL; живой корень обязан быть PASS.
  assert.equal(c.status, 'FAIL', 'без модуля проверка не смеет быть зелёной');
  const live = doctor.runDoctor().checks.find((x) => x.name === 'фон: схема терминальных состояний');
  assert.equal(live.status, 'PASS');
  assert.match(live.detail, /red > dead > inconclusive/);
});

test('фон: возврат умолчания «всё, что не красное — pass» ловится как FAIL', () => {
  const broken = `'use strict';
const BG_TERMINAL = { pass: 'background-verify-pass', red: 'background-verify-red', dead: 'background-verify-dead', inconclusive: 'background-verify-inconclusive', error: 'background-verify-error' };
// Ровно тот дефект, который чинил 020 T007: одна тернарка, и любой неучтённый исход зелёный.
function classifyRun(sections) { return sections.some((s) => s.red) ? 'red' : 'pass'; }
module.exports = { BG_TERMINAL, classifyRun };
`;
  const c = checkIn(makePluginRoot({ bgModule: broken }), 'фон: схема терминальных состояний');
  assert.equal(c.status, 'FAIL');
  assert.match(c.detail, /classifyRun/);
});

test('фон: статус без префикса background-verify- — FAIL (bg-silent его не найдёт)', () => {
  const broken = `'use strict';
const BG_TERMINAL = { pass: 'ok', red: 'background-verify-red', dead: 'background-verify-dead', inconclusive: 'background-verify-inconclusive', error: 'background-verify-error' };
function classifyRun(s) { return s.some((x) => x.red) ? 'red' : s.some((x) => x.nonConclusive) ? 'dead' : s.some((x) => x.inconclusive) ? 'inconclusive' : 'pass'; }
module.exports = { BG_TERMINAL, classifyRun };
`;
  const c = checkIn(makePluginRoot({ bgModule: broken }), 'фон: схема терминальных состояний');
  assert.equal(c.status, 'FAIL');
  assert.match(c.detail, /background-verify-/);
});

test('hooks: файла нет → INFO (его ставит T012), кривой JSON → FAIL', () => {
  assert.equal(checkIn(makePluginRoot(), 'plugin hooks').status, 'INFO');
  const c = checkIn(makePluginRoot({ hooks: '{не json' }), 'plugin hooks');
  assert.equal(c.status, 'FAIL');
});

test('hooks: абсолютный путь внутри — FAIL, на чужой машине он не разрешится', () => {
  const win = checkIn(makePluginRoot({ hooks: JSON.stringify({ SessionStart: [{ command: 'node C:\\Users\\espad\\hook.js' }] }) }), 'plugin hooks');
  assert.equal(win.status, 'FAIL');
  assert.match(win.detail, /абсолютные пути/);
  const nix = checkIn(makePluginRoot({ hooks: JSON.stringify({ SessionStart: [{ command: '/home/espad/hook.js' }] }) }), 'plugin hooks');
  assert.equal(nix.status, 'FAIL');
});

// --- 020 T012: хуки плагина проверяются предметно ------------------------------------------
//
// «JSON разбирается» — не проверка: хук, указывающий в несуществующий файл или в снятую
// развёртку `~/.claude/bin`, разбирается прекрасно и ломается только на чужой машине и только
// в момент старта сессии. Каждая фикстура ниже — отдельный способ сломаться молча.

const HOOKS_OK = JSON.stringify({
  hooks: {
    SessionStart: [{ matcher: 'startup|resume', hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/session-start.js"' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/session-stop.js"' }] }],
  },
});

function hooksFixture(body, extra = []) {
  return makePluginRoot({ hooks: body, surfaceExtra: extra });
}

test('hooks: живой репозиторий — оба события и обе цели на месте', () => {
  const live = doctor.runDoctor().checks.find((c) => c.name === 'plugin hooks');
  assert.equal(live.status, 'PASS');
  assert.match(live.detail, /2 событий, 2 команд/);
});

test('hooks: корректная фикстура даёт PASS, а её цели действительно проверяются', () => {
  const root = hooksFixture(HOOKS_OK, ['bin/session-start.js', 'bin/session-stop.js']);
  assert.equal(checkIn(root, 'plugin hooks').status, 'PASS');
});

test('hooks: цель не существует → FAIL с именем файла, а не тихий PASS', () => {
  const c = checkIn(hooksFixture(HOOKS_OK), 'plugin hooks');
  assert.equal(c.status, 'FAIL');
  assert.match(c.detail, /несуществующий файл bin\/session-start\.js/);
});

test('hooks: неизвестное событие → FAIL (опечатка = хук, который никогда не вызовется)', () => {
  const body = JSON.stringify({ hooks: { SesionStart: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/x.js"' }] }] } });
  const c = checkIn(hooksFixture(body, ['bin/x.js']), 'plugin hooks');
  assert.equal(c.status, 'FAIL');
  assert.match(c.detail, /неизвестные события: SesionStart/);
});

test('hooks: команда мимо ${CLAUDE_PLUGIN_ROOT} → FAIL', () => {
  const body = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node ./bin/session-stop.js' }] }] } });
  const c = checkIn(hooksFixture(body, ['bin/session-stop.js']), 'plugin hooks');
  assert.equal(c.status, 'FAIL');
  assert.match(c.detail, /CLAUDE_PLUGIN_ROOT/);
});

test('hooks: ссылка на снятую развёртку ~/.claude/bin → FAIL', () => {
  const body = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/.claude/bin/elt.js"' }] }] } });
  const c = checkIn(hooksFixture(body), 'plugin hooks');
  assert.equal(c.status, 'FAIL');
  assert.match(c.detail, /снятую развёртку/);
});

test('hooks: пустой объект событий → FAIL, а не «хуков нет»', () => {
  const c = checkIn(hooksFixture(JSON.stringify({ hooks: {} })), 'plugin hooks');
  assert.equal(c.status, 'FAIL');
  assert.match(c.detail, /нет ни одного события/);
});

test('hooks: тип, отличный от command → FAIL', () => {
  const body = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'inline', command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/x.js"' }] }] } });
  const c = checkIn(hooksFixture(body, ['bin/x.js']), 'plugin hooks');
  assert.equal(c.status, 'FAIL');
  assert.match(c.detail, /не поддерживается/);
});

test('точки входа: хуки входят в замыкание bin/ наравне с командами', () => {
  assert.ok(doctor.BIN_ENTRIES.includes('session-start.js'));
  assert.ok(doctor.BIN_ENTRIES.includes('session-stop.js'));
  assert.equal(doctor.runDoctor().checks.find((c) => c.name === 'замыкание bin/ резолвится').status, 'PASS');
});

// --- 020 T012: документация установки не расходится с рантаймом ---------------------------
//
// `docs/INSTALL.md` — единственное, что читает человек перед первой командой. Команда из него,
// ведущая в несуществующий файл или несуществующий флаг, выглядит рабочей ровно до момента
// запуска. Markdown никто не компилирует, поэтому проверка нужна отдельная.

const INSTALL = fs.readFileSync(path.join(doctor.PLUGIN_ROOT, 'docs', 'INSTALL.md'), 'utf8');

test('INSTALL.md: каждая команда `node <файл>` ведёт в существующий файл плагина', () => {
  const targets = [...INSTALL.matchAll(/node\s+((?:bin|tools)\/[A-Za-z0-9._\-/]+\.js)/g)].map((m) => m[1]);
  assert.ok(targets.length >= 3, `в инструкции найдено ${targets.length} команд — разбор сломался`);
  const missing = [...new Set(targets)].filter((rel) => !fs.existsSync(path.join(doctor.PLUGIN_ROOT, rel)));
  assert.deepEqual(missing, [], 'инструкция по установке ведёт в несуществующие файлы');
});

test('INSTALL.md: каждый флаг host-surface из инструкции реально разбирается', () => {
  const src = fs.readFileSync(path.join(doctor.PLUGIN_ROOT, 'tools', 'host-surface.js'), 'utf8');
  const flags = [...new Set([...INSTALL.matchAll(/host-surface\.js((?:\s+--[a-z-]+)+)/g)]
    .flatMap((m) => m[1].trim().split(/\s+/)))];
  assert.ok(flags.length >= 2, `флагов найдено ${flags.length} — разбор сломался`);
  for (const flag of flags) {
    assert.ok(src.includes(`'${flag}'`), `флаг ${flag} назван в инструкции, но не разбирается в host-surface.js`);
  }
});

test('INSTALL.md: снятая развёртка ~/.claude/bin названа только как СНЯТАЯ, не как шаг', () => {
  for (const m of INSTALL.matchAll(/^.*\.claude[/\\]bin.*$/gm)) {
    assert.match(m[0], /снят|не удал|не трог|не запис/i,
      `строка про ~/.claude/bin читается как действующий маршрут: ${m[0].trim()}`);
  }
});

test('INSTALL.md: описанный состав поверхности совпадает с тем, что объявляет доктор', () => {
  const skills = doctor.SURFACE.filter((f) => f.startsWith('skills/')).length;
  const agents = doctor.SURFACE.filter((f) => f.startsWith('agents/')).length;
  const commands = doctor.SURFACE.filter((f) => f.startsWith('commands/')).length;
  // Скилы Claude Code показывает вместе с командами: три команды приезжают как скилы тоже.
  assert.match(INSTALL, new RegExp(`${skills + commands} скилов`), 'число скилов в инструкции разошлось с манифестом');
  assert.match(INSTALL, new RegExp(`${agents} агентов`), 'число агентов в инструкции разошлось с манифестом');

  const events = Object.keys(JSON.parse(fs.readFileSync(path.join(doctor.PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks);
  assert.match(INSTALL, new RegExp(`${events.length} хука`), 'число хуков в инструкции разошлось с манифестом');
  for (const event of events) assert.ok(INSTALL.includes(event), `событие ${event} не описано в инструкции`);
});
