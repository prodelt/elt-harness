'use strict';
// 011 T009 (AC9) — новый внешний импорт без свежего пруфа ctx7 = block.
//
// Мотив (§3.3 спеки): API чужой либы — то самое место, где модель уверенно пишет
// несуществующий метод, а оракул этого не ловит (тест пишет тот же, кто выдумал API).
// Пруф обращения к документации — механическая замена «я помню эту либу».
//
// R5: недоступность САМОГО ctx7 (а не отсутствие пруфа) обязана давать `inconclusive`, а не
// `block` — иначе внешний сервис получает право останавливать работу.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const { evaluate, externalImports, ctx7Covered } = require('./elt-gate-l0');
const { runCtx7, appendCtx7Proof, CTX7_PROOF } = require('./context7-cli');

const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx7-proof-')); dirs.push(d); return d; };
const added = (line) => `diff --git a/src/app.js b/src/app.js\n--- a/src/app.js\n+++ b/src/app.js\n@@ -1,1 +1,2 @@\n+${line}\n`;
const proofRow = (library, agoDays = 0) => ({
  subcommand: 'library', library, query: 'usage',
  ts: new Date(Date.now() - agoDays * 24 * 60 * 60 * 1000).toISOString(),
});
after(() => { for (const d of dirs) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* windows lock */ } });

test('новый внешний импорт БЕЗ пруфа → block с названной либой', () => {
  const r = evaluate({ diff: added("const express = require('express');"), config: {} });
  assert.equal(r.verdict, 'block');
  const t = r.triggers.find((x) => x.name === 'external-import-no-ctx7');
  assert.ok(t, 'триггер назван, а не спрятан в общем вердикте');
  assert.deepEqual(t.files, ['express']);
  assert.match(t.reason, /без свежего пруфа/);
});

test('тот же импорт СО свежим пруфом → вердикта нет, гейт идёт дальше', () => {
  const r = evaluate({ diff: added("const express = require('express');"), config: { ctx7: { proofs: [proofRow('express')] } } });
  assert.equal(r.verdict, undefined, 'сверился с документацией — блокировать не за что');
  assert.equal(r.triggers.find((x) => x.name === 'external-import-no-ctx7'), undefined);
});

test('пруф ПРОТУХШИЙ (старше окна) не считается — иначе он был бы разовой индульгенцией', () => {
  const r = evaluate({ diff: added("const express = require('express');"), config: { ctx7: { proofs: [proofRow('express', 400)], freshDays: 30 } } });
  assert.equal(r.verdict, 'block');
});

test('ctx7 НЕДОСТУПЕН → inconclusive, а не block (R5: чужой сервис не стопорит работу)', () => {
  const r = evaluate({
    diff: added("const express = require('express');"),
    config: { ctx7: { proofs: [], available: false, reason: 'ETIMEDOUT' } },
  });
  assert.equal(r.verdict, 'inconclusive');
  assert.match(r.triggers.find((x) => x.name === 'external-import-no-ctx7').reason, /ctx7 недоступен.*ETIMEDOUT/);
});

test('встроенные модули и относительные пути внешними импортами не считаются', () => {
  assert.deepEqual(externalImports(added("const fs = require('node:fs');")), []);
  assert.deepEqual(externalImports(added("const fs = require('fs');")), [], 'builtin без префикса — тоже builtin');
  assert.deepEqual(externalImports(added("const x = require('./local');")), []);
  assert.deepEqual(externalImports(added("import y from '../up/there';")), []);
  assert.equal(evaluate({ diff: added("const fs = require('node:fs');"), config: {} }).verdict, undefined);
});

test('подпуть и scoped-пакет схлопываются в имя либы (пруф берётся на либу, не на файл)', () => {
  assert.deepEqual(externalImports(added("const fp = require('lodash/fp');")), ['lodash']);
  assert.deepEqual(externalImports(added("import { z } from '@scope/pkg/sub';")), ['@scope/pkg']);
});

test('только ДОБАВЛЕННЫЕ строки: импорт, существовавший до слайса, слайсу не вменяется', () => {
  const diff = 'diff --git a/src/app.js b/src/app.js\n--- a/src/app.js\n+++ b/src/app.js\n@@ -1,2 +1,2 @@\n' +
    " const express = require('express');\n-const old = 1;\n+const now = 2;\n";
  assert.deepEqual(externalImports(diff), []);
});

test('свежесть считается по ts, а совпадение — по имени либы в записи', () => {
  assert.equal(ctx7Covered('express', [proofRow('express', 1)], 30), true);
  assert.equal(ctx7Covered('express', [proofRow('fastify', 1)], 30), false, 'пруф на другую либу не покрывает');
  assert.equal(ctx7Covered('express', [proofRow('express', 31)], 30), false);
  assert.equal(ctx7Covered('express', [{ library: 'express', ts: 'не дата' }], 30), false, 'битая запись не покрывает');
});

test('context7-cli пишет пруф на УСПЕХ и молчит на провале', () => {
  const okDir = tmp();
  const okRunner = () => ({ status: 0, stdout: '/vercel/next.js', stderr: '' });
  const r = runCtx7('library', ['next.js', 'app router'], { runner: okRunner, proofCwd: okDir });
  assert.equal(r.ok, true);
  const rows = fs.readFileSync(path.join(okDir, CTX7_PROOF), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].library, 'next.js');
  assert.equal(rows[0].query, 'app router');
  assert.ok(!Number.isNaN(Date.parse(rows[0].ts)));
  // Записанного достаточно, чтобы L0 признал импорт покрытым — иначе пруф был бы декорацией.
  assert.equal(evaluate({ diff: added("import next from 'next.js';"), config: { ctx7: { proofs: rows } } }).verdict, undefined);

  const failDir = tmp();
  const failRunner = () => ({ status: 1, stdout: '', stderr: 'not found' });
  assert.equal(runCtx7('library', ['нет-такой'], { runner: failRunner, proofCwd: failDir }).ok, false);
  assert.equal(fs.existsSync(path.join(failDir, CTX7_PROOF)), false, 'провалившийся вызов пруфом не считается');
});

test('пруф-файл дописывается, а не перезаписывается — история обращений остаётся', () => {
  const dir = tmp();
  appendCtx7Proof('library', ['a'], dir);
  appendCtx7Proof('docs', ['b', 'вопрос'], dir);
  assert.equal(fs.readFileSync(path.join(dir, CTX7_PROOF), 'utf8').trim().split('\n').length, 2);
});
