'use strict';
// Проводка судьи: harness.json → ФАКТИЧЕСКИ вызванный CLI.
//
// Зачем отдельный тест: до 2026-07-22 provider судьи был литералом 'claude' в fleet.js и
// PowerShell-драйвер (снят 019/T007), а harness.json читался только ради enabled/model — правка конфига молча не
// действовала. Такой класс дефекта не ловится юнит-тестом на функцию: там всё «работает»,
// ломается именно ПРОВОДКА. Поэтому здесь спавнится настоящий judge-invoke.js со стаб-CLI,
// который записывает свой argv на диск — проверяем, что запустился тот провайдер и та
// модель, что стоят в harness.json.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { judgeSettings, JUDGE_DEFAULTS } = require('./elt-config');

const BRIDGE = path.join(__dirname, 'judge-invoke.js');

// Репо со стаб-провайдером: стаб пишет argv в argv.json и отвечает вердиктом pass.
function makeRepo(judgeCfg) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-wiring-'));
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git(['init', '-q']); git(['config', 'user.email', 't@t']); git(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(['add', '-A']); git(['commit', '-q', '-m', 'seed']);
  fs.writeFileSync(path.join(root, 'seed.txt'), 'изменено слайсом\n'); // непустой дифф для судьи

  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  const cfg = { kind: 'code', oracle: 'node --version', shell: 'bash', branchPolicy: 'feature', push: false };
  if (judgeCfg) cfg.judge = judgeCfg;
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify(cfg));

  const argvOut = path.join(root, 'argv.json');
  const stub = path.join(root, 'stub.js');
  fs.writeFileSync(stub, `
const fs = require('fs');
fs.writeFileSync(${JSON.stringify(argvOut)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify([{ type: 'result', structured_output: { verdict: 'pass', reasons: ['стаб'] } }]));
`);
  return { root, argvOut, stub };
}

// Прогнать judge-invoke.js так, как его зовёт solo-драйвер, со стабом вместо CLI провайдера.
function runBridge({ root, argvOut, stub }, provider, desc) {
  const descFile = path.join(root, 'desc.json');
  fs.writeFileSync(descFile, JSON.stringify({ cwd: root, tid: 'T1', taskText: 'демо-слайс', ...desc }));
  const env = { ...process.env, ['FLEET_BIN_' + provider.toUpperCase()]: JSON.stringify(['node', stub]) };
  const r = spawnSync('node', [BRIDGE, descFile], { cwd: root, encoding: 'utf8', env, timeout: 60000 });
  return {
    out: JSON.parse(r.stdout || '{}'),
    argv: fs.existsSync(argvOut) ? JSON.parse(fs.readFileSync(argvOut, 'utf8')) : null,
  };
}

test('judgeSettings: harness.json → provider/model, битый конфиг → дефолты', () => {
  const a = makeRepo({ enabled: true, provider: 'agy', model: 'gemini-3.6-flash-high' });
  assert.deepEqual(judgeSettings(a.root), { provider: 'agy', model: 'gemini-3.6-flash-high' });

  const b = makeRepo({ enabled: true, model: 'sonnet' }); // provider не указан
  assert.deepEqual(judgeSettings(b.root), JUDGE_DEFAULTS);

  const c = makeRepo({ enabled: true, provider: 'НЕТ-ТАКОГО', model: '' }); // мусор → дефолты, не крэш
  assert.deepEqual(judgeSettings(c.root), JUDGE_DEFAULTS);

  assert.deepEqual(judgeSettings(path.join(os.tmpdir(), 'нет-такой-папки-' + Date.now())), JUDGE_DEFAULTS);
});

test('проводка solo: judge.provider=agy в harness.json → реально спавнится agy с его моделью', () => {
  const repo = makeRepo({ enabled: true, provider: 'agy', model: 'gemini-3.6-flash-high' });
  const { out, argv } = runBridge(repo, 'agy', {});
  assert.equal(out.runOk, true, 'судья должен отработать');
  assert.equal(out.verdict, 'pass');
  assert.ok(argv, 'стаб agy не был запущен — значит конфиг не долетел до spawn');
  assert.ok(argv.includes('--model'), 'модель обязана уходить явным флагом');
  assert.equal(argv[argv.indexOf('--model') + 1], 'gemini-3.6-flash-high');
  assert.ok(argv.includes('--add-dir'), 'agy-специфичный флаг = спавнился именно agy, а не claude');
});

test('проводка solo: дескриптор драйвера перебивает harness.json', () => {
  const repo = makeRepo({ enabled: true, provider: 'agy', model: 'gemini-3.6-flash-high' });
  const { out, argv } = runBridge(repo, 'codex', { provider: 'codex', model: 'gpt-5.6-sol' });
  assert.equal(out.runOk, true);
  assert.equal(argv[argv.indexOf('--model') + 1], 'gpt-5.6-sol');
  assert.ok(argv.includes('exec'), 'codex спавнится через `codex exec`');
});

test('проводка solo: без judge в harness.json → claude/sonnet (обратная совместимость)', () => {
  const repo = makeRepo(null);
  const { out, argv } = runBridge(repo, 'claude', {});
  assert.equal(out.runOk, true);
  assert.equal(argv[argv.indexOf('--model') + 1], 'sonnet');
  assert.ok(argv.includes('-p'), 'claude headless-флаг');
});

// 019 T006: кейс «проводка fleet: run() берёт судью из harness.json» снят вместе с fleet.js.
// Он читал ИСХОДНИК оркестратора; оркестратора нет. Сам резолв провайдера (judgeSettings
// вместо литерала «claude») проверяют кейсы выше — они зовут функцию, а не грепают файл.
