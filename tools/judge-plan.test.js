'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parse, nextBatch, filesConflict } = require('./judge-plan');

const MD = `
# tasks — sample
- [X] **T001** сделано [P] [files:a*]
- [ ] **T002** параллель A [P] [S] [cli:codex] [files:tools/a*]
- [ ] **T003** параллель B [P] [M] [files:tools/b*]
- [ ] **T004** барьер (не-P) [files:tools/c*]
- [ ] **T005** параллель C [P] [files:tools/a2*]
не-задачная строка
`;

test('parse извлекает статус/id/теги', () => {
  const s = parse(MD);
  assert.equal(s.length, 5);
  assert.equal(s[0].id, 'T001');
  assert.equal(s[0].done, true);
  const t2 = s.find((x) => x.id === 'T002');
  assert.equal(t2.parallel, true);
  assert.equal(t2.size, 'S');
  assert.equal(t2.cli, 'codex');
  assert.deepEqual(t2.files, ['tools/a*']);
});

test('nextBatch набирает подряд идущие [P] с непересекающимися files', () => {
  const batch = nextBatch(parse(MD));
  // T001 done → пропущен; T002+T003 [P] disjoint (a* vs b*) → оба; T004 не-[P] = барьер, стоп
  assert.deepEqual(batch.map((b) => b.id), ['T002', 'T003']);
});

test('первый открытый не-[P] → батч из одного (барьер идёт один)', () => {
  const md = `
- [ ] **T010** одиночка [files:x*]
- [ ] **T011** параллель [P] [files:y*]
`;
  const batch = nextBatch(parse(md));
  assert.deepEqual(batch.map((b) => b.id), ['T010']);
});

test('конфликтующие [P] не идут вместе (второй ждёт раунда)', () => {
  const md = `
- [ ] **T020** [P] [files:tools/fleet/a*]
- [ ] **T021** [P] [files:tools/fleet/a2*]
`;
  // a* покрывает a2* (префикс) → конфликт → батч = только T020
  const batch = nextBatch(parse(md));
  assert.deepEqual(batch.map((b) => b.id), ['T020']);
});

test('пустой files = конфликт со всеми (не параллелим вслепую)', () => {
  assert.equal(filesConflict([], ['a*']), true);
  assert.equal(filesConflict(['a*'], ['b*']), false);
  assert.equal(filesConflict(['tools/fleet/*'], ['tools/fleet/gate*']), true);
});

test('все слайсы done → пустой батч', () => {
  const md = '- [X] **T030** done [P] [files:z*]';
  assert.deepEqual(nextBatch(parse(md)), []);
});
