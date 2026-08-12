'use strict';
// 014 T012 (AC8) — ретро-разметка: тест на КАЖДУЮ метку по настоящей git-фикстуре (не мок:
// метки строятся на реальных диффах и порядке коммитов, мок доказывал бы сам себя).
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const { label, format, touchedLines, overlaps, daily, REPORT } = require('./elt-retro-label');
const roots = [];
after(() => { for (const r of roots) try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* windows lock */ } });

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-retro-'));
  roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  return root;
}
function commit(root, file, body, msg) {
  fs.writeFileSync(path.join(root, file), body);
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', msg], { cwd: root });
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}
function runLog(root, entries) {
  const file = path.join(root, 'run-log.jsonl');
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';

test('false-block: после блока ни одной красной попытки — задача закрылась как была', () => {
  const root = repo();
  const sha = commit(root, 'a.js', lines(5), 'feat: T001 слайс');
  const r = label(root, { runLog: runLog(root, [
    { ts: '2026-08-01T10:00:00Z', task: 'T001', verdict: 'block', reasons: ['scope creep'] },
    { ts: '2026-08-01T10:30:00Z', task: 'T001', commit: sha, verdict: 'pass' },
  ]) });
  assert.equal(r.results[0].label, 'false-block');
  assert.match(r.results[0].evidence, /ни одной новой красной попытки/);
});

test('correct: после блока были красные попытки — блок указал на реальную работу', () => {
  const root = repo();
  const sha = commit(root, 'a.js', lines(5), 'feat: T001 слайс');
  const r = label(root, { runLog: runLog(root, [
    { ts: '2026-08-01T10:00:00Z', task: 'T001', verdict: 'block' },
    { ts: '2026-08-01T10:10:00Z', task: 'T001', status: 'red-stop' },
    { ts: '2026-08-01T10:30:00Z', task: 'T001', commit: sha, verdict: 'pass' },
  ]) });
  assert.equal(r.results[0].label, 'correct');
});

test('missed-defect: за pass в окне пришёл fix тех же строк', () => {
  const root = repo();
  const sha = commit(root, 'a.js', lines(20), 'feat: T001 слайс');
  commit(root, 'a.js', lines(20).replace('line 3', 'line 3 ПОЧИНЕНО'), 'fix: T001 падало на границе');
  const r = label(root, { runLog: runLog(root, [{ ts: '2026-08-01T10:00:00Z', task: 'T001', commit: sha, verdict: 'pass' }]) });
  assert.equal(r.results[0].label, 'missed-defect');
  assert.match(r.results[0].evidence, /те же строки a\.js/);
});

test('correct: фикс в окне есть, но трогает ДРУГОЙ файл — вердикт не наказывается зря', () => {
  const root = repo();
  const sha = commit(root, 'a.js', lines(20), 'feat: T001 слайс');
  commit(root, 'b.js', lines(5), 'fix: T002 чужая поломка');
  const r = label(root, { runLog: runLog(root, [{ ts: '2026-08-01T10:00:00Z', task: 'T001', commit: sha, verdict: 'pass' }]) });
  assert.equal(r.results[0].label, 'correct');
});

test('unknown: блок без последующего коммита и pass с коммитом вне истории', () => {
  const root = repo();
  commit(root, 'a.js', lines(3), 'feat: T001 слайс');
  const r = label(root, { runLog: runLog(root, [
    { ts: '2026-08-01T10:00:00Z', task: 'T009', verdict: 'block' },
    { ts: '2026-08-01T11:00:00Z', task: 'T010', commit: 'deadbee', verdict: 'pass' },
  ]) });
  assert.deepEqual(r.results.map((x) => x.label), ['unknown', 'unknown']);
});

test('доля unknown считается и печатается — число, ради которого разметка честная', () => {
  const root = repo();
  const sha = commit(root, 'a.js', lines(5), 'feat: T001 слайс');
  const r = label(root, { runLog: runLog(root, [
    { ts: '2026-08-01T10:00:00Z', task: 'T001', commit: sha, verdict: 'pass' },
    { ts: '2026-08-01T11:00:00Z', task: 'T009', verdict: 'block' },
  ]) });
  assert.equal(r.total, 2);
  assert.equal(r.unknown, 1);
  assert.equal(r.unknownShare, 0.5);
  assert.match(format(r), /unknown: 1 \(50%\)/);
});

test('touchedLines/overlaps: пересечение по строкам, а не по одному лишь имени файла', () => {
  const root = repo();
  const a = commit(root, 'x.js', lines(60), 'feat: T001 база');
  const far = commit(root, 'x.js', lines(60).replace('line 55', 'line 55 правка'), 'fix: далеко');
  assert.equal(overlaps(touchedLines(root, a), touchedLines(root, far)) === null, false,
    'первый коммит создаёт файл целиком — он пересекается с любой его правкой');
  const b = commit(root, 'y.js', lines(60), 'feat: T002 второй файл');
  assert.equal(overlaps(touchedLines(root, b), touchedLines(root, far)), null, 'разные файлы не пересекаются');
});

// 014 T015: суточный проход, который вешается в Task Scheduler. Планировщик показывает только
// LastTaskResult — «процесс не упал»; пруф работы даёт ОТЧЁТ НА ДИСКЕ, поэтому его и проверяем.
// Заодно ловится цикл require между этим модулем и judge-bench-ingest: он рвётся именно здесь
// (ingest требует label обратно) и падает молча только в реальном запуске, не в юнитах label().
test('T015 daily(): размечает, зовёт ingest и кладёт отчёт на диск', () => {
  const root = repo();
  const sha = commit(root, 'a.js', lines(5), 'feat: T001 слайс');
  fs.mkdirSync(path.join(root, '.git', 'elt'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'elt', 'run-log.jsonl'), [
    { ts: '2026-08-01T10:00:00Z', task: 'T001', verdict: 'block', reasons: ['scope creep'] },
    { ts: '2026-08-01T10:30:00Z', task: 'T001', commit: sha, verdict: 'pass' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');

  const rep = daily(root);
  assert.equal(rep.labels['false-block'], 1, 'блок, за которым не было красных попыток, — ложный');
  assert.equal(rep.total, Object.values(rep.labels).reduce((a, b) => a + b, 0), 'метки покрывают все вердикты');
  assert.equal(typeof rep.benchTotal, 'number', 'ingest отработал, а не свалился на цикле require');
  const onDisk = JSON.parse(fs.readFileSync(path.join(root, REPORT), 'utf8'));
  assert.deepEqual(onDisk.labels, rep.labels, 'отчёт на диске совпадает с возвращённым');
});

// 016 T006 — регресс на 0x80070520: задача обязана регистрироваться как S4U, иначе она
// "Interactive only" и в 03:00 при заблокированной сессии не стартует вовсе.
test('scheduleCommand: S4U-принципал, а не interactive-only schtasks', () => {
  const { scheduleCommand } = require('./elt-retro-label');
  const cmd = scheduleCommand('C:\repo', { time: '03:00', name: 'ELT-x' });
  assert.match(cmd, /-LogonType S4U/);
  assert.match(cmd, /Register-ScheduledTask/);
  assert.match(cmd, /-Force/);              // идемпотентность
  assert.doesNotMatch(cmd, /\/RP\b/);       // пароль в аргументах не хранится
  assert.match(cmd, /--daily --project "C:\repo"/);
});
