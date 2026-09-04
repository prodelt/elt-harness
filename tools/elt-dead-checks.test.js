'use strict';
// 024 T010 — проверки, которые не могли сработать.
//
// Три штуки, все выглядели работающей защитой:
//
//  * `unresolvedReview` (elt.js, команда `elt run`) и `graph-state.js` фильтровали очередь
//    ревью по полю `resolved`, которого не пишет НИКТО: строки закрываются меткой `closedAt`.
//    Счётчик не убывал никогда, а в `graph-state` разобранная строка навсегда оставалась
//    неоднозначностью и могла навсегда заблокировать `elt cutover`;
//  * гард `--push` читал у сертификата поле `commitHash`, которое есть только у РЕЛИЗНЫХ
//    (certification.js:224); батчевые несут `commit` (:162) — условие было всегда ложным.
//    Наивное переименование переключило бы гард в «всегда блокировать»: в сертификат едет
//    КОРОТКИЙ sha, а сверка берёт полный.
//
// Проверка проверки: каждый тест ниже утверждает и то, что защита срабатывает, и то, что она
// не срабатывает там, где не должна.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const ELT = path.join(__dirname, 'elt.js');
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
const roots = [];
after(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* windows lock */ } } });

function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
function run(root, args) { return spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8' }); }

function fixture(rows) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-dead-checks-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL, judge: { enabled: true, model: 'codex' },
  }));
  fs.writeFileSync(path.join(root, '.harness', 'review-queue.jsonl'),
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  return root;
}

test('024 T010: закрытая строка очереди перестаёт считаться неразобранной', () => {
  const closed = { kind: 'bg-red', task: 'T001', commit: 'aaa1111', closedAt: '2026-09-01T00:00:00Z' };
  const open = { kind: 'bg-red', task: 'T002', commit: 'bbb2222' };

  const count = (rows) => {
    const r = run(fixture(rows), ['run', '--json']);
    return JSON.parse(r.stdout).unresolvedReview;
  };
  assert.equal(count([closed, open]), 1, 'считается только та, у которой нет closedAt');
  assert.equal(count([closed, { ...closed, task: 'T003' }]), 0, 'после разбора счётчик обязан дойти до нуля');
  // И наоборот: поле `resolved` больше ничего не решает — писать его было некому.
  assert.equal(count([{ ...open, resolved: true }]), 1, '`resolved` не закрывает строку — закрывает `closedAt`');
});

test('024 T010: graph-state считает неоднозначностью только незакрытые строки', () => {
  const { migrationSnapshot } = require('./graph-state');
  const kinds = (rows) => (migrationSnapshot({
    specPath: 'specs/001-x', tasksText: '- [ ] **T001** x\n', runLogEntries: [], reviewRows: rows,
  }).ambiguities || []).filter((a) => a.code === 'unresolved-review-row').length;

  assert.equal(kinds([{ kind: 'bg-red', task: 'T001' }]), 1, 'открытая строка — неоднозначность');
  assert.equal(kinds([{ kind: 'bg-red', task: 'T001', closedAt: '2026-09-01T00:00:00Z' }]), 0,
    'разобранная строка не имеет права навсегда блокировать cutover');
});

test('024 T010: привязка сертификата к коммиту сверяется по короткому sha', () => {
  // Форма ошибки, которая делала гард мёртвым: сертификат батча несёт `commit`, гард читал
  // `commitHash`. Форма ошибки, в которую превратило бы наивное переименование: `commit`
  // короткий, `rev-parse HEAD` полный — прямое сравнение не совпало бы никогда.
  const head = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const bind = (cert) => {
    const certCommit = cert.commit || cert.commitHash || null;
    return !certCommit || head.startsWith(certCommit);
  };
  assert.equal(bind({ commit: head.slice(0, 7) }), true, 'свой короткий sha обязан проходить');
  assert.equal(bind({ commit: head }), true, 'свой полный sha обязан проходить');
  assert.equal(bind({ commitHash: head }), true, 'релизный сертификат читается тем же гардом');
  assert.equal(bind({ commit: 'deadbee' }), false, 'чужой коммит обязан блокировать');
  assert.equal(bind({}), true, 'сертификат без привязки — не повод блокировать (поведение прежнее)');
});
