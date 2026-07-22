'use strict';
// Фатальная конфигурация провайдера — регрессия живого прогона 007 (2026-07-22).
//
// Что было: router.DEFAULT_MODELS.agy указывал на протухшее имя модели, agy отвечал
// «invalid model selection» за ~1с, а fleet считал это обычным провалом воркера: гонял
// ПОЛНЫЙ оракул в worktree (~96с), звал судью на пустом диффе, получал законный block и
// ретраил слайс до maxAttempts. Три слайса × 3 попытки = минуты стенных часов и лишние
// LLM-вызовы из-за одной строки конфига, а в отчёте — невнятное «failed».
//
// Инвариант: такой отказ детектится по выводу CLI, слайс валится СРАЗУ (без оракула,
// судьи и ретраев), прогон останавливается, а причина несёт текст самого CLI.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const router = require('./router');
const fleet = require('./fleet');

// Дословный вывод agy из прогона 007 — тест обязан ловить РЕАЛЬНУЮ строку, а не
// причёсанную выдумку.
const AGY_007 = `Error: invalid model selection (--model "gemini-3.1-pro-preview" --effort ""): model gemini-3.1-pro-preview is not recognized as a known model or custom model in settings
Available models:
  Gemini 3.6 Flash (High)
  Gemini 3.5 Flash (High)`;

test('detectFatalConfig: ловит реальный вывод agy из прогона 007 и возвращает улику', () => {
  const hit = router.detectFatalConfig({ ok: false, lastMsg: AGY_007 });
  assert.ok(hit, 'вывод из живого прогона обязан детектиться');
  assert.match(hit, /invalid model selection/);
  assert.ok(hit.length <= 300, 'улика обрезана, а не весь лог');
});

test('detectFatalConfig: другие фатальные классы (флаг, логин) и НЕ-фатальные', () => {
  const fatal = (m) => router.detectFatalConfig({ ok: false, lastMsg: m });
  assert.ok(fatal('unknown flag: --json-schema'));
  assert.ok(fatal('Error: unrecognized option --effort'));
  assert.ok(fatal('not logged in — please run login'));
  assert.ok(fatal('model gpt-9 does not exist'));

  // Не фатальное: лечится ретраем/failover или heal — валить прогон нельзя.
  assert.equal(fatal('HTTP 429 rate limit exceeded'), null, 'лимит лечится ожиданием');
  assert.equal(fatal('AssertionError: expected 3 to equal 4'), null, 'красный тест лечит heal');
  assert.equal(fatal('timeout waiting for response'), null, 'таймаут — транзиент');
  assert.equal(router.detectFatalConfig({ ok: true, lastMsg: AGY_007 }), null, 'успешный вызов не фатален');
  assert.equal(router.detectFatalConfig(null), null);
});

test('detectFatalConfig и detectLimit не спорят за один и тот же результат', () => {
  // Классы должны быть непересекающимися: лимит → cooldown+failover, фатал → стоп.
  assert.equal(router.detectLimit({ ok: false, lastMsg: AGY_007 }), false, 'протухшая модель — не лимит');
  assert.equal(router.detectFatalConfig({ ok: false, lastMsg: 'HTTP 429' }), null);
});

test('DEFAULT_MODELS.agy — живое имя модели, а не протухшее из 007', () => {
  assert.notEqual(router.DEFAULT_MODELS.agy, 'gemini-3.1-pro-preview', 'имя из прогона 007 больше не существует');
  assert.match(router.DEFAULT_MODELS.agy, /^gemini-/);
});

// --- e2e: тот же сценарий целиком, через настоящий fleet.run со стаб-провайдером ---
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fatal-cfg-'));
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git(['init', '-q']); git(['config', 'user.email', 't@t']); git(['config', 'user.name', 't']);
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node --version', shell: process.platform === 'win32' ? 'powershell' : 'bash',
    branchPolicy: 'feature', push: false, judge: { enabled: true, model: 'sonnet' },
  }));
  const tasks = path.join(root, 'tasks.md');
  fs.writeFileSync(tasks,
    '- [ ] **T001** [P] первый [files: a.txt]\n' +
    '- [ ] **T002** [P] второй [files: b.txt]\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(['add', '-A']); git(['commit', '-q', '-m', 'seed']);
  return { root, tasks, branch: git(['branch', '--show-current']).trim() };
}

test('fleet.run: мёртвый от конфига воркер → слайс failed СРАЗУ, без оракула/судьи, прогон стопает', async () => {
  const { root, tasks, branch } = makeRepo();
  const calls = { worker: 0 };
  // Воркер врёт ровно как agy в прогоне 007: мгновенный отказ с той же строкой.
  const worker = async () => { calls.worker++; return { ok: false, exit: 1, reason: 'nonzero-exit', lastMsg: AGY_007, logPath: null }; };

  const started = Date.now();
  const s = await fleet.run({ cwd: root, tasksPath: tasks, integration: branch, workers: 2, worker, maxAttempts: 3 });
  const sec = (Date.now() - started) / 1000;

  assert.ok(s.failed.length >= 1, 'слайс обязан быть failed');
  assert.match(String(s.stoppedReason), /fatal-config/, 'прогон стопает с внятной причиной');
  assert.match(String(s.stoppedReason), /invalid model selection/, 'причина несёт текст самого CLI');
  assert.equal(s.merged.length, 0);
  assert.ok(calls.worker <= 2, `никаких ретраев мёртвой конфигурации: спавнов=${calls.worker}`);
  assert.ok(sec < 60, `падать надо быстро, а не через оракул+судью (заняло ${sec.toFixed(1)}с)`);

  const events = fleet.readEvents(root);
  const fatalEv = events.find((e) => e.event === 'fatal-config');
  assert.ok(fatalEv, 'событие fatal-config обязано попасть в журнал');
  assert.match(String(fatalEv.detail), /invalid model selection/);
});
