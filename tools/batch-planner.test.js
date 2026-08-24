'use strict';
// 020 T016 — планировщик батча. Чистая часть: ни git, ни fs, ни сети, поэтому проверяется
// исчерпывающе и мгновенно. E2E-часть (repair-поколение через реальный `elt commit`) живёт в
// elt-batch.test.js — здесь только законность состава и идентичность.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { planBatch, batchIdOf, zonesOf, DEFAULT_BATCH, MAX_BATCH } = require('./batch-planner');

const SPEC = 'specs/020-x/tasks.md';
const item = (id, extra = {}) => ({ id, text: `**${id}** задача\n  [files: tools/${id}.js]`, specPath: SPEC, done: false, ...extra });
const plan = (items, opts = {}) => planBatch({ items, baseHead: 'base1', ...opts });

test('дефолт 3, потолок 4: пятая задача отвергается всегда', () => {
  assert.equal(DEFAULT_BATCH, 3);
  assert.equal(MAX_BATCH, 4);
  assert.equal(plan([item('T1'), item('T2'), item('T3')]).ok, true);
  assert.equal(plan([item('T1'), item('T2'), item('T3'), item('T4')]).reason, 'too-many', 'четвёртая — только явным потолком');
  assert.equal(plan([item('T1'), item('T2'), item('T3'), item('T4')], { max: 4 }).ok, true);
  assert.equal(plan([item('T1'), item('T2'), item('T3'), item('T4'), item('T5')], { max: 9 }).reason, 'too-many',
    'потолок 4 не обходится параметром — иначе судья читал бы дифф произвольного размера');
});

test('батч живёт в ОДНОЙ спеке: split между спеками отвергается', () => {
  const r = plan([item('T1'), { ...item('T2'), specPath: 'specs/019-y/tasks.md' }]);
  assert.equal(r.reason, 'multi-spec');
  assert.match(r.detail, /019-y/);
});

test('пустой батч и дубль id — отказ, а не «как-нибудь»', () => {
  assert.equal(plan([]).reason, 'empty');
  assert.equal(plan([item('T1'), item('T1')]).reason, 'duplicate-task');
});

test('пересечение зон [files:] отвергает батч целиком', () => {
  const a = { ...item('T1'), text: '**T1** a [files: tools/elt.js tools/a.js]' };
  const b = { ...item('T2'), text: '**T2** b [files: tools/elt.js]' };
  const r = plan([a, b]);
  assert.equal(r.reason, 'zone-collision');
  assert.match(r.detail, /tools\/elt\.js.*T1.*T2/s, 'в отказе названы и файл, и обе задачи');
});

test('зоны через ПРОБЕЛ разбираются: иначе коллизия никогда не находится', () => {
  assert.deepEqual(zonesOf('[files: tools/a.js tools/b.js]'), ['tools/a.js', 'tools/b.js']);
  assert.deepEqual(zonesOf('[files: tools/a.js, tools/b.js]'), ['tools/a.js', 'tools/b.js']);
  assert.deepEqual(zonesOf('без зоны'), []);
});

test('обычная посадка требует открытых задач, repair — наоборот, закрытых', () => {
  const closed = item('T1', { done: true });
  assert.equal(plan([closed]).reason, 'closed-task', 'закрытую задачу нельзя посадить второй раз как новую');
  assert.equal(plan([closed], { repair: true }).ok, true, 'repair чинит именно посаженное');
  assert.equal(plan([item('T1')], { repair: true }).reason, 'not-landed', 'чинить нечего, пока батч не посажен');
});

test('идентичность батча держится за спеку, порядок id и базу', () => {
  const id1 = batchIdOf({ specPath: SPEC, taskIds: ['T1', 'T2'], baseHead: 'base1' });
  assert.equal(id1, batchIdOf({ specPath: SPEC, taskIds: ['T1', 'T2'], baseHead: 'base1' }), 'детерминирован');
  assert.notEqual(id1, batchIdOf({ specPath: SPEC, taskIds: ['T2', 'T1'], baseHead: 'base1' }), 'порядок значим');
  assert.notEqual(id1, batchIdOf({ specPath: SPEC, taskIds: ['T1', 'T2'], baseHead: 'base2' }),
    'тот же состав от другой базы — ДРУГОЙ батч: proof первого ко второму не относится');
  assert.notEqual(id1, batchIdOf({ specPath: 'specs/019-y/tasks.md', taskIds: ['T1', 'T2'], baseHead: 'base1' }));
});

test('план несёт упорядоченные taskIdentities, а не голые id', () => {
  const r = plan([item('T1'), item('T2')]);
  assert.deepEqual(r.taskIdentities, [{ specPath: SPEC, id: 'T1' }, { specPath: SPEC, id: 'T2' }]);
  assert.deepEqual(r.taskIds, ['T1', 'T2']);
});
