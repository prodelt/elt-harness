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
const CLAUDE_INVOKE = path.join(__dirname, '..', 'claude-invoke.js');
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

test('T006 e2e: agy-writer получает промпт v3 (разведка → решение → запреты)',
  { skip: process.platform !== 'win32' ? 'PowerShell 5.1 только на Windows' : false }, () => {
  // Исполняемое доказательство: гоняем настоящий elt-loop.ps1 против temp-репо, стаб claude
  // сохраняет полученный промпт и argv. Ассертим латиницу/структуру, не русский текст —
  // stdout PowerShell приходит в OEM-кодировке, а промпт долетает сюда файлом (utf8).
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-t006-'));
    const g = (a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
    g(['init', '-q']); g(['config', 'user.email', 't@e.com']); g(['config', 'user.name', 'T']);
    fs.mkdirSync(path.join(repo, '.harness'));
    fs.writeFileSync(path.join(repo, '.harness', 'harness.json'), JSON.stringify({
      kind: 'code', shell: 'powershell', branchPolicy: 'feature',
      oracle: 'node -e "process.exit(1)"', judge: { enabled: true, model: 'sonnet' },
    }));
    fs.mkdirSync(path.join(repo, 'specs', '001-fx'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'specs', '001-fx', 'tasks.md'), '- [ ] **T001** большой слайс [L] [files:seed.txt]\n');
    fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
    g(['add', '-A']); g(['commit', '-qm', 'seed']); g(['checkout', '-qb', 'work']);

    // Зонд пишем ВНЕ репо: парковка слайса откатывает дерево `git stash -u` и унесла бы файл.
    const capture = path.join(TMP, 'capture-t006.json');
    fs.rmSync(capture, { force: true });
    const stub = path.join(TMP, 'capture-stub.js');
    fs.writeFileSync(stub, `const fs=require("fs"),path=require("path");let s="";
process.stdin.on("data",(c)=>{s+=c}).on("end",()=>{
  const d=path.join(process.cwd(),'.harness','fleet','prompts');
  if(!s && fs.existsSync(d)){const files=fs.readdirSync(d).sort();if(files.length)s=fs.readFileSync(path.join(d,files[files.length-1]),'utf8');}
  if(!fs.existsSync(${JSON.stringify(capture)})) fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify({argv:process.argv.slice(2),prompt:s}));
  fs.appendFileSync(${JSON.stringify(path.join(repo, 'seed.txt'))},"impl\\n");console.log("stub");process.exit(0);});`);

    spawnSync('powershell', ['-NoProfile', '-File', path.join(__dirname, '..', 'elt-loop.ps1'),
      '-Project', repo, '-Slices', '1', '-Batch', '1'],
    { cwd: repo, encoding: 'utf8', env: { ...process.env, FLEET_BIN_AGY: JSON.stringify([process.execPath, stub]), FLEET_BIN_CLAUDE: JSON.stringify([process.execPath, stub]) } });

    assert.ok(fs.existsSync(capture), 'драйвер обязан дойти до вызова имплементатора');
    const { argv, prompt } = JSON.parse(fs.readFileSync(capture, 'utf8'));
    assert.match(argv.join(' '), /--model gemini-3.7-flash-high\b/, 'writer обязан идти через Antigravity с явной моделью');
    assert.match(prompt, /\.gemini\\skills\\elt\\SKILL\.md/, 'agy должен явно прочитать ELT skill: сам он его не загружает');
    // Разведка названа полностью: зона через codegraph, рубрика (spec+constitution), тесты зоны.
    assert.match(prompt, /codegraph_context/, 'секция разведки обязана называть codegraph');
    assert.match(prompt, /spec\.md/, 'разведка обязана посылать в спеку — по ней судит судья');
    assert.match(prompt, /constitution\.md/);
    assert.match(prompt, /существующие тесты|тесты в зоне/, 'разведка обязана посылать в существующие тесты');
    assert.match(prompt, /"filesChanged"/, 'слайс обязан требовать JSON-заявку (почва T009)');
    assert.match(prompt, /"testsAdded"/);
    // Порядок секций и ЕСТЬ механизм слайса: перестановка запретов вперёд обязана валить тест.
    const at = (re) => { const m = prompt.match(re); assert.ok(m, `нет секции ${re}`); return m.index; };
    const recon = at(/СНАЧАЛА РАЗБЕРИСЬ/), decide = at(/ПОТОМ РЕШИ/), ban = at(/ЗАПРЕТЫ:/), claim = at(/"filesChanged"/);
    assert.ok(recon < decide && decide < ban && ban < claim,
      `порядок обязан быть разведка(${recon}) → решение(${decide}) → запреты(${ban}) → заявка(${claim})`);
    fs.rmSync(repo, { recursive: true, force: true });
  });

test('T006: elt-loop.ps1 остаётся UTF-8 с BOM (PS 5.1 иначе читает кириллицу как mojibake)', () => {
  const head = fs.readFileSync(path.join(__dirname, '..', 'elt-loop.ps1')).subarray(0, 3);
  assert.deepEqual([...head], [0xef, 0xbb, 0xbf]);
});
