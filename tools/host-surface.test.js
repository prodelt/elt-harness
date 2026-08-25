'use strict';
// 020 T011 — контракт хост-поверхности НА ФИКСТУРАХ.
//
// Раньше эти проверки читали `os.homedir()` живой машины: на машине разработчика они были
// зелёными, на любом чистом клоне и на обеих машинах CI — красными. Здесь `home` и `PATH`
// передаются явно, поэтому файл герметичен и одинаково гоняется в Windows и в Linux.
//
// Каждая проверка парная: «правильная фикстура → ok» И «сломанная фикстура → НЕ ok». Без
// второй половины зелёный ничего не значил бы — он был бы зелёным и на сломанном сравнении.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  HOST_SKILLS, SKILL_ROOTS, JUDGE_BINARIES,
  checkHostSkills, checkJudgeBinaries, checkConfiguredJudge, checkHostSurface, hermeticViolations, main,
} = require('./host-surface');

// Тело, удовлетворяющее контракту grill-me целиком. Оно же — образец, по которому видно, что
// именно контракт требует; ломаем его точечно в тестах ниже.
const GRILL_ME = `---
name: grill-me
description: Гриллинг плана до общего понимания
---

# grill-me

## Протокол v2

1. Разведка кода ДО вопросов: прочитать зону изменения, а не спрашивать вслепую.
2. Минимум 2 раунда AskUserQuestion, и раунды обязаны покрыть все четыре категории:
   пользователи/сценарии, данные/интеграции, риски/edge cases, не-цели/приоритет MVP.
3. Для UI-задач отдельный раунд: показать 2–3 варианта концепции, а не один.

## Решения (зафиксированы с пользователем <дата>)
`;

let seq = 0;
function makeHome({ skills = { 'grill-me': GRILL_ME }, mirrors = ['codex', 'gemini'], mirrorBody = null } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `host-surface-${seq++}-`));
  for (const [name, body] of Object.entries(skills)) {
    const clients = ['claude', ...mirrors];
    for (const client of clients) {
      const dir = SKILL_ROOTS.find((r) => r.client === client).dir;
      const file = path.join(home, dir, 'skills', name, 'SKILL.md');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, client === 'claude' ? body : (mirrorBody === null ? body : mirrorBody));
    }
  }
  return home;
}

// --- скилы ---------------------------------------------------------------------------

test('полная фикстура: источник + два побайтовых зеркала + контракт → ok', () => {
  const r = checkHostSkills({ home: makeHome() });
  assert.equal(r.status, 'ok');
  assert.equal(r.skills[0].name, 'grill-me');
  assert.deepEqual(r.skills[0].contractMissing, []);
});

test('пустой home → absent и НИКОГДА не ok; отсутствующие пути названы поимённо', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'host-surface-empty-'));
  const r = checkHostSkills({ home });
  assert.equal(r.status, 'absent');
  assert.notEqual(r.status, 'ok', 'отсутствие поверхности не смеет выглядеть чистой проверкой');
  assert.equal(r.skills[0].status, 'absent');
  assert.equal(r.skills[0].missing.length, SKILL_ROOTS.length, 'названы все три пути, а не только первый');
  for (const p of r.skills[0].missing) assert.match(p, /SKILL\.md$/);
});

test('зеркало разошлось с источником → drift, а не ok', () => {
  const r = checkHostSkills({ home: makeHome({ mirrorBody: GRILL_ME + '\nЛИШНЯЯ СТРОКА\n' }) });
  assert.equal(r.status, 'drift');
  const drifted = r.skills[0].mirrors.filter((m) => !m.identical);
  assert.equal(drifted.length, 2, 'разошлись оба зеркала — оба и названы');
  assert.ok(drifted.every((m) => m.present), 'файл есть, но содержимое другое — это именно drift');
});

test('зеркала нет вовсе → drift с present:false у пропавшего клиента', () => {
  const r = checkHostSkills({ home: makeHome({ mirrors: ['codex'] }) });
  assert.equal(r.status, 'drift');
  const gemini = r.skills[0].mirrors.find((m) => m.client === 'gemini');
  assert.equal(gemini.present, false);
  assert.equal(r.skills[0].mirrors.find((m) => m.client === 'codex').identical, true);
});

test('каждый пункт контракта дискриминирует: убери его из тела — он попадёт в contractMissing', () => {
  for (const clause of HOST_SKILLS[0].contract) {
    const broken = GRILL_ME.replace(clause.re, '<вырезано>');
    assert.notEqual(broken, GRILL_ME, `паттерн «${clause.name}» вообще не находится в эталонном теле`);
    const r = checkHostSkills({ home: makeHome({ skills: { 'grill-me': broken } }) });
    assert.equal(r.status, 'contract-miss', `нарушение «${clause.name}» обязано быть видно`);
    assert.deepEqual(r.skills[0].contractMissing, [clause.name], `и ровно оно, а не соседнее`);
  }
});

// --- судья ---------------------------------------------------------------------------

test('судьи на PATH нет → absent, все имена в missing', () => {
  const r = checkJudgeBinaries({ pathEnv: '/nope', pathExt: '.EXE;.CMD', exists: () => false });
  assert.equal(r.status, 'absent');
  assert.deepEqual(r.missing, JUDGE_BINARIES);
  assert.deepEqual(r.found, []);
});

test('судья найден по PATHEXT-варианту (Windows: claude.cmd, не claude)', () => {
  const dir = path.join(os.tmpdir(), 'fake-bin');
  const hit = path.join(dir, 'claude.cmd');
  const r = checkJudgeBinaries({ pathEnv: dir, pathExt: '.EXE;.CMD', exists: (p) => p === hit });
  assert.equal(r.status, 'present');
  assert.deepEqual(r.found, [{ name: 'claude', path: hit }]);
  assert.ok(r.missing.includes('codex') && r.missing.includes('agy'));
});

// --- герметичность прогона -----------------------------------------------------------

test('hermeticViolations: пустой home и пустой PATH → нарушений нет', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'host-surface-herm-'));
  const report = checkHostSurface({ home, pathEnv: '', exists: () => false });
  assert.deepEqual(hermeticViolations(report), []);
});

test('hermeticViolations: найденный скил и найденный судья — оба ОТКАЗ, а не удача', () => {
  const dir = path.join(os.tmpdir(), 'fake-bin');
  const report = checkHostSurface({ home: makeHome(), pathEnv: dir, pathExt: '', exists: (p) => p === path.join(dir, 'codex') });
  const v = hermeticViolations(report);
  assert.equal(v.length, 2);
  assert.ok(v.some((x) => /глобальный скил grill-me присутствует/.test(x)));
  assert.ok(v.some((x) => /судья codex установлен/.test(x)));
});

test('CLI --expect-absent: пустой home → exit 0; заполненный → exit 1', () => {
  const sink = () => { const buf = []; return { write: (s) => buf.push(s), text: () => buf.join('') }; };
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'host-surface-cli-'));

  const okOut = sink();
  // PATH машины сюда не попадает: судью подменяем пустым окружением через process.env на время
  // вызова — иначе тест зависел бы от того, установлен ли claude у того, кто его гоняет.
  const prevPath = process.env.PATH;
  process.env.PATH = '';
  try {
    assert.equal(main(['--expect-absent', '--home', empty], okOut), 0);
    assert.match(okOut.text(), /герметично/);

    const badOut = sink();
    assert.equal(main(['--expect-absent', '--home', makeHome()], badOut), 1);
    assert.match(badOut.text(), /ОТКАЗ герметичности/);
    assert.match(badOut.text(), /grill-me/);
  } finally {
    process.env.PATH = prevPath;
  }
});

test('CLI без --expect-absent: пустой home → exit 1 (отсутствие поверхности это отказ)', () => {
  const buf = [];
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'host-surface-cli2-'));
  assert.equal(main(['--home', empty], { write: (s) => buf.push(s) }), 1);
  assert.match(buf.join(''), /absent/);
});

test('CLI --json отдаёт разбираемый отчёт с обоими разделами', () => {
  const buf = [];
  main(['--json', '--home', makeHome()], { write: (s) => buf.push(s) });
  const parsed = JSON.parse(buf.join(''));
  assert.equal(parsed.skills.status, 'ok');
  assert.ok(Array.isArray(parsed.judges.found));
});

// --- судья, названный конфигом проекта ------------------------------------------------

test('configuredJudge: провайдер из harness.json установлен → ok, не установлен → not-installed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-surface-cfg-'));
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'),
    JSON.stringify({ kind: 'code', oracle: 'node -e "0"', judge: { enabled: true, provider: 'codex' } }));

  const installed = checkConfiguredJudge({ root, judges: { found: [{ name: 'codex', path: '/bin/codex' }] } });
  assert.deepEqual(installed, { status: 'ok', provider: 'codex' });

  const missing = checkConfiguredJudge({ root, judges: { found: [{ name: 'claude', path: '/bin/claude' }] } });
  assert.deepEqual(missing, { status: 'not-installed', provider: 'codex' },
    'установлен ДРУГОЙ судья — это не «ok», конфиг называет конкретного');
});

test('configuredJudge: провайдер не указан → дефолт claude; конфига нет → no-config; битый → bad-config', () => {
  const mk = (body) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-surface-cfg2-'));
    if (body !== null) {
      fs.mkdirSync(path.join(root, '.harness'));
      fs.writeFileSync(path.join(root, '.harness', 'harness.json'), body);
    }
    return root;
  };
  const judges = { found: [{ name: 'claude', path: '/bin/claude' }] };
  assert.deepEqual(checkConfiguredJudge({ root: mk(JSON.stringify({ kind: 'code' })), judges }),
    { status: 'ok', provider: 'claude' }, 'без явного provider судья по умолчанию claude');
  assert.equal(checkConfiguredJudge({ root: mk(null), judges }).status, 'no-config');
  assert.equal(checkConfiguredJudge({ root: mk('{не json'), judges }).status, 'bad-config',
    'нечитаемый конфиг — не «судья на месте»');
});
