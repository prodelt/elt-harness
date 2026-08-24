'use strict';
// 019 T001 — контракт единого списка владения. Тест держит ровно то, из-за чего родились
// D9/D15/D19: два списка в разных файлах, которые разошлись. Поэтому проверяется не только
// сама функция, но и то, что оба потребителя зовут ИМЕННО её.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isHarnessOwned, isGenerated, isIgnoredForReview, isHarnessConfig } = require('./harness-files');
const l0 = require('./elt-gate-l0');

test('владения харнеса: то, что пишет сам харнес, а не слайс', () => {
  for (const rel of [
    'tasks.md',
    'specs/019-elt-v5-phases-2-5/tasks.md',
    '.harness/learnings.jsonl',
    '.harness/loop-logs/bg-abc.log',
    '.git/elt/run-log.jsonl',
    '.harness/review-queue.jsonl',
  ]) assert.equal(isHarnessOwned(rel), true, `${rel} пишет харнес`);

  // `.harness/harness.json` — КОНФИГ гейта: правит его человек, и судиться он обязан как код.
  for (const rel of ['tools/elt.js', 'specs/019-x/spec.md', 'README.md', 'tools/harness-files.js', '.harness/harness.json']) {
    assert.equal(isHarnessOwned(rel), false, `${rel} пишет человек`);
  }
});

// Два владения, найденные живьём после батча A: оба пишет сам харнес, оба судья ловил как
// scope creep. Чекпоинт с именем по стампу — поэтому список владений умеет и регулярки.
test('владения без фиксированного имени: авточекпоинт и ретро-разметка bench', () => {
  for (const rel of [
    '.planning/CHECKPOINT-2026-08-24-1200-auto.md',
    './.planning/CHECKPOINT-abc-auto.md',
    '.planning\\CHECKPOINT-2026-08-24-auto.md',
    'tools/judge-bench/cases-ingested.json',
    'tools\\judge-bench\\cases-ingested.json',
  ]) {
    assert.equal(isHarnessOwned(rel), true, `${rel} пишет харнес`);
    assert.equal(isIgnoredForReview(rel), true, `${rel} не судится`);
  }

  // Границу не размывать: чекпоинт, написанный человеком, и код bench судятся как обычно.
  for (const rel of [
    '.planning/CHECKPOINT-2026-08-24.md',
    '.planning/STATE.md',
    'tools/judge-bench.js',
    'tools/judge-bench/cases.json',
    'docs/CHECKPOINT-auto.md',
  ]) assert.equal(isHarnessOwned(rel), false, `${rel} пишет человек`);
});

test('D22-сосед: авточекпоинт в диффе не даёт out-of-scope', () => {
  const diff = ['tools/widget.js', '.planning/CHECKPOINT-2026-08-24-1200-auto.md',
    'tools/judge-bench/cases-ingested.json']
    .map((f) => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -1,1 +1,1 @@\n+x`).join('\n');
  const triggers = l0.evaluate({ diff, config: {}, taskText: 'T021 правка [files: tools/widget.js]' })
    .triggers.map((t) => t.name);
  assert.deepEqual(triggers, [], `владения харнеса не нарушение зоны: ${triggers.join(', ')}`);
});

test('сгенерированное: пишет инструмент, ревьюировать нечего', () => {
  for (const rel of ['package-lock.json', 'app/package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'node_modules/x/index.js', '.codegraph/graph.db']) {
    assert.equal(isGenerated(rel), true, `${rel} генерируется`);
  }
  // Файл с похожим именем, но написанный человеком, под правило не подпадает.
  assert.equal(isGenerated('tools/package-lock-audit.js'), false);
  assert.equal(isGenerated('docs/lockfile-policy.md'), false);
});

test('windows-разделители не ломают границу', () => {
  assert.equal(isHarnessOwned('specs\\019-x\\tasks.md'), true);
  assert.equal(isGenerated('app\\package-lock.json'), true);
  assert.equal(isIgnoredForReview('.\\.harness\\review-queue.jsonl'), true);
});

test('D9: сгенерированное не считается в объёме диффа', () => {
  const bigLock = ['diff --git a/package-lock.json b/package-lock.json',
    '--- a/package-lock.json', '+++ b/package-lock.json', '@@ -1,1 +1,1 @@',
    ...Array.from({ length: l0.DEFAULT_DIFF_SIZE + 100 }, (_, i) => `+  "dep${i}": "1.0.0",`)].join('\n');
  const small = ['diff --git a/tools/widget.js b/tools/widget.js',
    '--- a/tools/widget.js', '+++ b/tools/widget.js', '@@ -1,1 +1,1 @@', '+const a = 1;'].join('\n');
  const triggers = l0.evaluate({ diff: `${bigLock}\n${small}`, config: {}, taskText: 'T001 правка' })
    .triggers.map((t) => t.name);
  assert.ok(!triggers.includes('diff-size'), `lock-файл не должен раздувать объём: ${triggers.join(', ')}`);
});

test('D15/D19: владения харнеса не выносятся за зону слайса', () => {
  const diff = ['tools/widget.js', '.harness/review-queue.jsonl', 'specs/019-x/tasks.md']
    .map((f) => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -1,1 +1,1 @@\n+x`).join('\n');
  const triggers = l0.evaluate({ diff, config: {}, taskText: 'T001 правка [files: tools/widget.js]' })
    .triggers.map((t) => t.name);
  assert.deepEqual(triggers, [], `владения харнеса не нарушение зоны: ${triggers.join(', ')}`);
});

// Главное, ради чего модуль вообще заведён: копий больше нет. Тест смотрит ИСХОДНИК обоих
// потребителей — если кто-то заведёт локальный `function isHarnessOwned`, списки снова
// разойдутся молча, ровно как это уже случилось между L0 и судьёй.
test('копий списка не осталось: оба потребителя зовут модуль', () => {
  for (const rel of ['elt-gate-l0.js', 'judge-core.js']) {
    const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    assert.ok(/require\((['"])\.\.?\/?harness-files\1\)/.test(src), `${rel} обязан звать harness-files`);
    assert.ok(!/function\s+isHarnessOwned\s*\(/.test(src), `${rel} держит собственную копию списка`);
  }
});

test('модуль остаётся листом замыкания судьи', () => {
  const src = fs.readFileSync(path.join(__dirname, 'harness-files.js'), 'utf8');
  const requires = src.match(/require\([^)]*\)/g) || [];
  assert.deepEqual(requires, [], 'harness-files.js едет в deploy-копию каждого проекта — импортов быть не должно');
  const { CLOSURE } = require('./sync-bin');
  assert.ok(CLOSURE.includes('harness-files.js'), 'файл обязан входить в замыкание sync-bin');
});

// D19, живая проводка: до этой правки знание о владении жило в гейте и не доезжало до судьи —
// судья честно называл scope creep'ом очередь разбора, которую пишет сам харнес. Теперь блок,
// который держится ТОЛЬКО на таких файлах, понижается до inconclusive: причина не теряется,
// коммит не встаёт. Проверка идёт в обе стороны — настоящий блок обязан выжить.
test('D19: блок только по файлам харнеса — не блок', () => {
  const { reasonsAreNoiseOnly } = require('./judge-core');
  assert.equal(reasonsAreNoiseOnly(['scope creep: изменён .harness/review-queue.jsonl вне зоны']), true);
  assert.equal(reasonsAreNoiseOnly(['дифф раздут: package-lock.json 694 строки']), true);
  assert.equal(reasonsAreNoiseOnly(['tools/elt.js: проглочена ошибка в catch']), false);
  assert.equal(reasonsAreNoiseOnly(['.harness/review-queue.jsonl вне зоны', 'tools/elt.js: проглочена ошибка']), false,
    'смесь шума и настоящей причины блок не теряет');
  assert.equal(reasonsAreNoiseOnly(['тест мокает ровно ту логику, которую проверяет']), false,
    'причина без единого файла шумом не считается');
  assert.equal(reasonsAreNoiseOnly([]), false, 'пустой список причин не повод снимать блок');
});

// Граница, ради которой судья заблокировал батч A: `.harness/harness.json` лежит внутри
// `.harness/`, но это КОНФИГ гейта, а не его состояние. Ослабление конфига обязано судиться
// как обычный код — иначе слайс выключает redProof и уезжает в коммит с пометкой.
test('конфиг гейта — не владение харнеса', () => {
  assert.equal(isHarnessConfig('.harness/harness.json'), true);
  assert.equal(isHarnessOwned('.harness/harness.json'), false, 'конфиг не владение');
  assert.equal(isIgnoredForReview('.harness/harness.json'), false, 'конфиг всегда ревьюируется');
  assert.equal(isHarnessConfig('.harness/fleet/fleet.json'), true);
  // а состояние рядом с ним — по-прежнему владение
  assert.equal(isHarnessOwned('.harness/review-queue.jsonl'), true);
  assert.equal(isHarnessOwned('.harness/loop-logs/bg-abc.log'), true);
});

test('D19: блок по конфигу гейта не снимается', () => {
  const { reasonsAreNoiseOnly } = require('./judge-core');
  assert.equal(reasonsAreNoiseOnly(['.harness/harness.json: redProof выключен']), false,
    'слайс, ослабляющий собственный гейт, обязан остаться заблокированным');
});

// Две границы намеренно РАЗНЫЕ, и путать их нельзя: откат worktree спрашивает «мог ли воркер
// это писать» (конфиг гейта — не мог), судья спрашивает «можно ли не выносить вердикт»
// (по конфигу гейта — обязан). Тест держит обе стороны сразу.
test('откат worktree и ревью спрашивают разное про конфиг гейта', () => {
  const { isHarnessManaged } = require('./harness-files');
  assert.equal(isHarnessManaged('.harness/harness.json'), true, 'воркер не имел права его писать');
  assert.equal(isIgnoredForReview('.harness/harness.json'), false, 'но судить его обязаны');
  assert.equal(isHarnessManaged('.harness/review-queue.jsonl'), true);
  assert.equal(isIgnoredForReview('.harness/review-queue.jsonl'), true);
  assert.equal(isHarnessManaged('tools/elt.js'), false, 'обычный код — ни то, ни другое');
});
