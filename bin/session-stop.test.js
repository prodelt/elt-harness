'use strict';
// 020 T012 — контракт Stop-хука (dirty-exit gate).
//
// У гейта два способа быть вредным, и оба проверяются парами:
//   * ложно ЗАПЕРЕТЬ сессию (грязь была до неё, не ELT-проект, зацикливание, нечитаемый
//     транскрипт) — тогда пользователь не может закончить работу вообще;
//   * ложно ПРОПУСТИТЬ (правки есть, дерево грязное) — тогда работа не попадает ни в run-log,
//     ни под судью, то есть выпадает из замера «доля работы через харнес».
//
// Отдельно закреплён живой дефект снятой копии: она советовала `~/.claude/bin/elt.js` —
// развёртку, удалённую спекой 019 T015. Совет вёл в никуда у всех, кто перешёл на плагин.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { decide, editedHere, runtimeRoute, main } = require('./session-stop');

const fakeGit = ({ inRepo = true, dirty = '' } = {}) => (args) => {
  if (args[0] === 'rev-parse') return { stdout: 'true\n', status: inRepo ? 0 : 128 };
  if (args[0] === 'status') return { stdout: dirty, status: 0 };
  return { stdout: '', status: 0 };
};

let seq = 0;
// Транскрипт сессии в том же виде, в каком его пишет Claude Code: JSONL, где правка файла —
// строка с "tool_use" и именем инструмента правки.
function transcript(files) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), `session-stop-${seq++}-`)), 'transcript.jsonl');
  const lines = files.map((f) =>
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: f } }] } }));
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

const CWD = 'C:/proj';
const input = (over = {}) => ({ cwd: CWD, transcript_path: transcript([`${CWD}/a.js`]), ...over });
const withHarness = () => ({ exists: () => true, git: fakeGit({ dirty: ' M a.js\n' }) });

// --- блокирует ---------------------------------------------------------------------------

test('правки этой сессии + грязное дерево → block с перечнем файлов', () => {
  const v = decide(input(), withHarness());
  assert.equal(v.decision, 'block');
  assert.match(v.reason, /DIRTY-EXIT GATE/);
  assert.match(v.reason, /M a\.js/);
});

test('блокировка называет полную цепочку гейта, а не «закоммить как-нибудь»', () => {
  const v = decide(input(), withHarness());
  assert.match(v.reason, /oracle --full/);
  assert.match(v.reason, /judge run --task/);
  assert.match(v.reason, /commit --task .*--skip-oracle/);
  assert.match(v.reason, /ЯВНО одной строкой/, 'сказано, что делать, когда коммитить нельзя');
});

test('маршрут — от корня плагина; снятой развёртки ~/.claude/bin/elt.js в совете нет', () => {
  assert.equal(runtimeRoute({ CLAUDE_PLUGIN_ROOT: '/anywhere' }), '${CLAUDE_PLUGIN_ROOT}/tools/elt.js');
  const v = decide(input(), { ...withHarness(), env: { CLAUDE_PLUGIN_ROOT: '/anywhere' } });
  assert.match(v.reason, /\$\{CLAUDE_PLUGIN_ROOT\}\/tools\/elt\.js/);
  assert.doesNotMatch(v.reason, /\.claude[/\\]bin/, 'ровно этот совет и был сломан в снятой копии');
  assert.doesNotMatch(v.reason, /[A-Za-z]:\\|\/home\/|\/Users\//, 'абсолютных путей нет');
});

test('список файлов обрезается десятью — блокировка остаётся читаемой', () => {
  const dirty = Array.from({ length: 25 }, (_, i) => ` M f${i}.js`).join('\n');
  const v = decide(input(), { exists: () => true, git: fakeGit({ dirty }) });
  const listed = v.reason.split('\n').filter((l) => /^ M f\d+\.js$/.test(l));
  assert.equal(listed.length, 10);
});

// --- пропускает --------------------------------------------------------------------------

test('не ELT-проект → гейт молчит (opt-in по .harness/harness.json)', () => {
  assert.equal(decide(input(), { exists: () => false, git: fakeGit({ dirty: ' M a.js\n' }) }), null);
});

test('stop_hook_active → null: одна блокировка на цепочку, без зацикливания', () => {
  assert.equal(decide(input({ stop_hook_active: true }), withHarness()), null);
});

test('чистое дерево → null', () => {
  assert.equal(decide(input(), { exists: () => true, git: fakeGit({ dirty: '' }) }), null);
});

test('не git-репозиторий → null, а не отказ', () => {
  assert.equal(decide(input(), { exists: () => true, git: fakeGit({ inRepo: false, dirty: ' M a.js\n' }) }), null);
});

test('грязь только в .harness/ → null: её порождает сам харнес после коммита', () => {
  const git = fakeGit({ dirty: ' M .harness/run-log.jsonl\n?? .harness/health.jsonl\n' });
  assert.equal(decide(input(), { exists: () => true, git }), null);
});

test('сессия ничего не правила → null: чужая грязь не её ответственность', () => {
  const v = decide(input({ transcript_path: transcript(['C:/other/x.js']) }), withHarness());
  assert.equal(v, null);
});

test('нечитаемый транскрипт → fail-open: гейт не запирает сессию по своей ошибке', () => {
  assert.equal(editedHere(path.join(os.tmpdir(), 'нет-такого-файла.jsonl'), CWD), null);
  assert.equal(decide(input({ transcript_path: 'нет-такого-файла.jsonl' }), withHarness()), null);
});

test('правка вне проекта не считается правкой проекта', () => {
  assert.equal(editedHere(transcript(['C:/elsewhere/a.js']), CWD), false);
  assert.equal(editedHere(transcript([`${CWD}/sub/a.js`]), CWD), true);
});

// --- CLI ---------------------------------------------------------------------------------

test('main: битый stdin → тишина и exit 0; блокировка выдаётся одним JSON-объектом', () => {
  const buf = [];
  assert.equal(main('не json', { write: (s) => buf.push(s) }), 0);
  assert.deepEqual(buf, [], 'нечитаемый вход не превращается в блокировку');

  const out = [];
  assert.equal(main(JSON.stringify(input()), { write: (s) => out.push(s) }, withHarness()), 0);
  assert.equal(JSON.parse(out.join('')).decision, 'block');
});

test('сам файл хука не содержит абсолютных путей', () => {
  const src = fs.readFileSync(path.join(__dirname, 'session-stop.js'), 'utf8');
  const code = src.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code, /[A-Za-z]:\\\\|['"]\/(?:home|Users)\//);
});
