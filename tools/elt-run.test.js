'use strict';
// 020 T015 — одна runtime-дверь: `elt run | advance | cutover` и переключение эпохи.
//
// Проверяется не «команда печатает JSON», а четыре свойства, ради которых дверь и заводилась:
//   1. состояние ВОССТАНАВЛИВАЕТСЯ из журнала другим процессом (это и есть resume после
//      compact/restart — своего состояния у процесса нет);
//   2. повторный хук не двигает прогон дважды и незаконное событие не пишется вовсе;
//   3. провалившийся cutover не оставляет следа — откатывать нечего по построению;
//   4. проекция (`tasks.md`) отстаёт от журнала и это ВИДНО, а не сглажено.
//
// Тесты гоняют настоящий CLI в одноразовом git-репозитории: маршрут, который живёт в argv и
// в `.git/elt/`, нельзя доказать вызовом функции — ровно на границе процессов он и ломался.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ELT = path.join(__dirname, 'elt.js');
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
const roots = [];

function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
function run(root, args, env) {
  return spawnSync(process.execPath, [ELT, ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, ...(env || {}) },
  });
}
function journalLines(root) {
  const file = path.join(root, '.git', 'elt', 'graph-journal.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
}

const SPEC_MD = [
  '# фикстура', '',
  '## Проблема', 'нет', '',
  '## Решения', 'нет', '',
  '## User stories', 'нет', '',
  '## Критерии приёмки', 'нет', '',
  '## Риски', 'нет', '',
  '## Вне scope', 'нет', '',
].join('\n');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-run-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL, branchPolicy: 'feature',
    judge: { enabled: true, model: 'sonnet' },
  }));
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'spec.md'), SPEC_MD);
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** первая\n- [ ] **T002** вторая\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  return root;
}

function cleanup() {
  for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* уборка не гейт */ } }
}

// Пустой журнал — это не «неизвестно где мы», а точка входа графа. Иначе первая же сессия
// требовала бы ручной инициализации состояния, то есть ровно той памяти, которую дверь снимает.
function testRunOnEmptyJournalStartsAtEntry() {
  const root = fixture();
  const r = run(root, ['run', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.node, 'recon');
  assert.equal(out.epoch, 'legacy-v1', 'до cutover авторитет остаётся у checkbox/approval/run-log');
  assert.deepEqual(out.legal.sort(), ['known-zone', 'unknown-zone']);
  assert.equal(out.next.event, 'known-zone');
  assert.ok(out.next.hint, 'следующий шаг обязан быть назван словами, а не подразумеваться');
}

// Тот самый resume: событие пишет ОДИН процесс, читает ДРУГОЙ. Между ними не остаётся ничего,
// кроме журнала, — как после compact или перезапуска сессии.
function testStateSurvivesProcessRestart() {
  const root = fixture();
  const a = run(root, ['advance', '--event', 'known-zone', '--guard', 'familiar-zone,scope-within-limit', '--json']);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(JSON.parse(a.stdout).node, 'build');

  const after = JSON.parse(run(root, ['run', '--json']).stdout);
  assert.equal(after.node, 'build', 'новый процесс обязан восстановить узел из журнала');
  assert.equal(after.journal.events, 1);
  assert.ok(after.runId, 'прогон получил идентификатор и он читается обратно');
}

// Повторный хук (SessionStart дважды, retry драйвера) не имеет права двинуть прогон второй раз.
function testDuplicateEventIsRefusedAndNothingIsWritten() {
  const root = fixture();
  assert.equal(run(root, ['advance', '--event', 'known-zone', '--guard', 'familiar-zone,scope-within-limit']).status, 0);
  const before = journalLines(root).length;
  const again = run(root, ['advance', '--event', 'known-zone', '--guard', 'familiar-zone,scope-within-limit']);
  assert.equal(again.status, 4, 'второй раз то же событие уже незаконно — узел другой');
  assert.equal(journalLines(root).length, before, 'отказ обязан не оставлять строки в журнале');
}

// Недоказанный guard — это не «наверное зелено». Fail-closed именно здесь: строка не пишется.
function testUnprovenGuardBlocksTransition() {
  const root = fixture();
  const r = run(root, ['advance', '--event', 'known-zone', '--json']);
  assert.equal(r.status, 4);
  assert.match(r.stdout + r.stderr, /guard/i);
  assert.equal(journalLines(root).length, 0, 'ни байта на диск при недоказанном guard');
}

// Проекция отстаёт от журнала — и это видно. Checkbox после перехода НЕ трогается: авторитет
// (до cutover) остаётся у него, а `statuses` показывает, что журнал уже знает больше.
function testProjectionStaysUntouchedWhileJournalMovesOn() {
  const root = fixture();
  const tasksBefore = fs.readFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), 'utf8');
  run(root, ['advance', '--event', 'known-zone', '--guard', 'familiar-zone,scope-within-limit']);
  run(root, ['advance', '--event', 'ready', '--guard', 'task-dependencies-closed']);
  const out = JSON.parse(run(root, ['run', '--json']).stdout);
  assert.equal(out.node, 'landing');
  assert.equal(
    fs.readFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), 'utf8'), tasksBefore,
    'переход графа не смеет молча править план — checkbox правит только commit',
  );
  const status = JSON.parse(run(root, ['status']).stdout);
  assert.equal(status.graph.node, 'landing', 'status показывает тот же узел, что и run');
}

// Провалившийся cutover: неоднозначность легаси-эпохи блокирует переключение, журнал не тронут.
// Это и есть заявленный rollback — откатывать нечего, потому что ничего не записано.
function testFailedCutoverLeavesNoTrace() {
  const root = fixture();
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'review-queue.jsonl'),
    JSON.stringify({ kind: 'bg-red', task: 'T001', commit: 'deadbee', specPath: 'specs/001-fixture/tasks.md' }) + '\n');
  const before = journalLines(root).length;
  const r = run(root, ['cutover', '--json']);
  assert.equal(r.status, 5, 'блокированный cutover обязан быть ненулевым, а не warning-success');
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.epoch, 'legacy-v1');
  assert.ok(out.ambiguities.some((a) => a.code === 'unresolved-review-row'));
  assert.equal(journalLines(root).length, before, 'провал не оставляет следа в журнале');
  assert.equal(JSON.parse(run(root, ['run', '--json']).stdout).epoch, 'legacy-v1');
}

// Успешный cutover: чистый снимок + подписанный канонический digest → авторитет у журнала.
// Повторный вызов идемпотентен: эпоха переключается ровно один раз.
function testCutoverSwitchesAuthorityOnceAndIsIdempotent() {
  const root = fixture();
  const approve = run(root, ['spec', 'approve', '--spec', 'specs/001-fixture']);
  assert.equal(approve.status, 0, approve.stderr);
  assert.match(git(root, ['log', '-1', '--format=%B']), /Approval-Digest: [0-9a-f]{64}/,
    'подпись обязана нести канонический digest схемы elt-approval/v1');

  const r = run(root, ['cutover', '--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.epoch, 'journal-v1');
  assert.equal(out.commit, git(root, ['rev-parse', 'HEAD']), 'legacyEpochEnd привязан к ТОЧНОМУ коммиту');

  const again = run(root, ['cutover', '--json']);
  assert.equal(again.status, 0);
  assert.equal(JSON.parse(again.stdout).already, true, 'вторая попытка не пишет вторую эпоху');
  assert.equal(JSON.parse(run(root, ['run', '--json']).stdout).epoch, 'journal-v1');
}

// Подпись СТАРОЙ схемы (без канонического digest) не выдаётся за подпись новой: cutover на
// неподписанном плане запрещён, иначе журнал станет авторитетным для намерения, которое никто
// не подтвердил в канонической форме.
function testCutoverRefusesUnsignedApprovalSchema() {
  const root = fixture();
  const r = run(root, ['cutover', '--json']);
  assert.equal(r.status, 5);
  assert.ok(JSON.parse(r.stdout).ambiguities.some((a) => a.code === 'approval-schema-not-signed'));
}

// Parity Claude/Codex: маршрут не имеет права зависеть от того, чей плагин его позвал.
// Разница окружения здесь ровно та, что отличает две поверхности на живой машине.
function testClaudeAndCodexSurfacesSeeTheSameRoute() {
  const root = fixture();
  run(root, ['advance', '--event', 'known-zone', '--guard', 'familiar-zone,scope-within-limit']);
  const asClaude = JSON.parse(run(root, ['run', '--json'], { CLAUDE_PLUGIN_ROOT: path.join(__dirname, '..') }).stdout);
  const asCodex = JSON.parse(run(root, ['run', '--json'], { CLAUDE_PLUGIN_ROOT: '' }).stdout);
  assert.equal(asClaude.node, asCodex.node);
  assert.deepEqual(asClaude.legal, asCodex.legal);
  assert.deepEqual(asClaude.next, asCodex.next);
  assert.equal(asClaude.graphVersion, asCodex.graphVersion);
}

function main() {
  try {
    testRunOnEmptyJournalStartsAtEntry();
    testStateSurvivesProcessRestart();
    testDuplicateEventIsRefusedAndNothingIsWritten();
    testUnprovenGuardBlocksTransition();
    testProjectionStaysUntouchedWhileJournalMovesOn();
    testFailedCutoverLeavesNoTrace();
    testCutoverSwitchesAuthorityOnceAndIsIdempotent();
    testCutoverRefusesUnsignedApprovalSchema();
    testClaudeAndCodexSurfacesSeeTheSameRoute();
  } finally {
    cleanup();
  }
  process.stdout.write('elt run door tests: PASS\n');
}

main();
