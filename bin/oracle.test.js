'use strict';
// 019 T011 — контракт оракула плагина.
//
// Главное свойство: оракул не выдумывает команду проекта. Если `.harness/harness.json` есть,
// гоняется ИМЕННО он; если нет — честный откат с объявлением. Аудит 2026-08-11 нашёл ровно
// обратное поведение у прежней обвязки: домашний оракул гнался в чужих проектах и давал 100%
// ложных красных, потому что источник команды был не в целевом проекте.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const oracle = require('./oracle');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'elt-oracle-'));
}

function fakeSpawn(calls) {
  return (cmd, argsOrOpts, maybeOpts) => {
    const opts = maybeOpts || argsOrOpts;
    calls.push({ cmd, args: Array.isArray(argsOrOpts) ? argsOrOpts : null, opts });
    return { status: 0 };
  };
}

test('именованный оракул проекта берётся из .harness/harness.json', () => {
  const cwd = tmp();
  fs.mkdirSync(path.join(cwd, '.harness'));
  fs.writeFileSync(path.join(cwd, '.harness', 'harness.json'), JSON.stringify({ oracle: 'just test' }));

  const calls = [];
  const logged = [];
  const res = oracle.run({ cwd, spawn: fakeSpawn(calls), log: (s) => logged.push(s) });

  assert.equal(res.mode, 'named');
  assert.equal(res.command, 'just test');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'just test');
  assert.equal(calls[0].opts.cwd, cwd, 'команда гонится в целевом проекте, не в доме плагина');
  assert.ok(logged.join('').includes('just test'), 'оракул объявляет, что гонял');
});

test('--full доносится через окружение, а не только через argv', () => {
  const cwd = tmp();
  fs.mkdirSync(path.join(cwd, '.harness'));
  fs.writeFileSync(path.join(cwd, '.harness', 'harness.json'), JSON.stringify({ oracle: 'node run.js' }));

  const calls = [];
  oracle.run({ cwd, full: true, env: {}, spawn: fakeSpawn(calls), log: () => {} });
  assert.equal(calls[0].opts.env.ELT_ORACLE_FULL, '1');

  const plain = [];
  oracle.run({ cwd, full: false, env: {}, spawn: fakeSpawn(plain), log: () => {} });
  assert.equal(plain[0].opts.env.ELT_ORACLE_FULL, undefined);
});

test('без конфига — откат на node --test, и он объявлен', () => {
  const cwd = tmp();
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'src', 'a.test.js'), '');
  fs.writeFileSync(path.join(cwd, 'src', 'a.js'), '');

  const calls = [];
  const logged = [];
  const res = oracle.run({ cwd, spawn: fakeSpawn(calls), log: (s) => logged.push(s) });

  assert.equal(res.mode, 'fallback');
  assert.deepEqual(res.tests, ['src/a.test.js']);
  assert.equal(calls[0].args[0], '--test');
  assert.ok(logged.join('').includes('откат'), 'откат назван вслух, а не молча');
});

test('пустой проект даёт ненулевой код, а не зелёный', () => {
  const cwd = tmp();
  const res = oracle.run({ cwd, spawn: () => ({ status: 0 }), log: () => {} });
  assert.equal(res.mode, 'empty');
  assert.notEqual(res.status, 0, 'нечего гонять — это не успех');
});

test('обход не заходит в node_modules и прочий чужой код', () => {
  const cwd = tmp();
  fs.mkdirSync(path.join(cwd, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'node_modules', 'dep', 'x.test.js'), '');
  fs.mkdirSync(path.join(cwd, 'vendor'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'vendor', 'y.test.js'), '');
  fs.writeFileSync(path.join(cwd, 'mine.test.js'), '');

  assert.deepEqual(oracle.discoverTests(cwd), ['mine.test.js']);
});

test('битый .harness/harness.json не роняет оракул, а уводит в откат', () => {
  const cwd = tmp();
  fs.mkdirSync(path.join(cwd, '.harness'));
  fs.writeFileSync(path.join(cwd, '.harness', 'harness.json'), '{ это не json');
  fs.writeFileSync(path.join(cwd, 'mine.test.js'), '');

  const res = oracle.run({ cwd, spawn: () => ({ status: 0 }), log: () => {} });
  assert.equal(res.mode, 'fallback');
});
