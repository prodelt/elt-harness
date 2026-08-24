'use strict';
// T004 (004-elt-selfdrive): адаптивный эффорт. Тестируем и чистую политику (effortFor),
// и сквозной резолв фазы → --effort в argv через claude-invoke.js (тот же мост, что зовёт
// solo-драйвер): phase:'heal' обязан эскалировать на max, phase:'impl' — держать high.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { effortFor, IMPL_EFFORT, HEAL_EFFORT } = require('./effort-policy');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'effort-policy-'));
const CLAUDE_INVOKE = path.join(__dirname, 'claude-invoke.js');
let ARGV_STUB;
before(() => {
  ARGV_STUB = path.join(TMP, 'argv.js');
  fs.writeFileSync(ARGV_STUB, 'console.log(JSON.stringify(process.argv.slice(2)));process.exit(0);');
});
after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* noop */ } });

test('T004: effortFor — impl→high, heal→max, unknown→high (safe default)', () => {
  assert.equal(effortFor('impl'), 'high');
  assert.equal(effortFor('heal'), 'max');
  assert.equal(effortFor('xyz'), 'high', 'неизвестная фаза не эскалирует зря');
  assert.equal(effortFor(), 'high');
  assert.equal(IMPL_EFFORT, 'high');
  assert.equal(HEAL_EFFORT, 'max');
});

// claude-invoke.js пишет stdout провайдера себе в stdout → для argv-стаба это JSON переданного argv.
function invokeArgv(desc) {
  const f = path.join(TMP, 'desc.json');
  fs.writeFileSync(f, JSON.stringify({ cwd: TMP, prompt: 'p', ...desc }));
  const prev = process.env.FLEET_BIN_CLAUDE;
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', ARGV_STUB]);
  try {
    const r = spawnSync('node', [CLAUDE_INVOKE, f], { encoding: 'utf8' });
    return JSON.parse(r.stdout);
  } finally {
    if (prev === undefined) delete process.env.FLEET_BIN_CLAUDE; else process.env.FLEET_BIN_CLAUDE = prev;
  }
}

test('T004 e2e: claude-invoke phase:heal → argv несёт --effort max (эскалация на починку)', () => {
  const argv = invokeArgv({ phase: 'heal' });
  assert.match(argv.join(' '), /--effort max\b/);
});

test('T004 e2e: claude-invoke phase:impl → argv несёт --effort high (дефолт, экономия токенов)', () => {
  const argv = invokeArgv({ phase: 'impl' });
  assert.match(argv.join(' '), /--effort high\b/);
});

test('T004 e2e: явный effort в дескрипторе побеждает фазу', () => {
  const argv = invokeArgv({ phase: 'impl', effort: 'max' });
  assert.match(argv.join(' '), /--effort max\b/);
});

// ── 009 T006: эффорт по тегу сложности + промпт agy writer v3 ──────────────────────

test('T006: effortFor(impl, size) — [L]→max, [S]/[M]/без тега→high', () => {
  assert.equal(effortFor('impl', 'L'), 'max', 'крупный слайс стартует на max, не ждёт heal');
  assert.equal(effortFor('impl', 'l'), 'max', 'регистр тега не важен');
  assert.equal(effortFor('impl', 'S'), 'high');
  assert.equal(effortFor('impl', 'M'), 'high');
  assert.equal(effortFor('impl', null), 'high', 'без тега — старое поведение');
  assert.equal(effortFor('impl', 'XXL'), 'high', 'неизвестный тег не эскалирует');
  assert.equal(effortFor('heal', 'S'), 'max', 'heal остаётся max независимо от размера');
});


// 019 T007: e2e-проверка промпта писателя v3 и BOM-инвариант `PowerShell-драйвер (снят 019/T007)` сняты вместе с
// самим драйвером. Контракт промпта НЕ потерян — он выписан в
// `specs/019-elt-v5-phases-2-5/writer-prompt-v3.md` как вход для T012, где писатель
// возвращается командой плагина поверх `providers.js`. Сам `effortFor` остаётся живым и
// проверяется тестами выше: он нужен любому writer'у, а не только PowerShell-петле.
