const test = require('node:test');
const assert = require('node:assert');
const {
  getRoster,
  validateRoster,
  formatRoster,
  renderAgentMarkdown
} = require('../lib/roster.js');

test('getRoster returns exactly 12 entries', () => {
  const roster = getRoster();
  assert.strictEqual(roster.length, 12);
});

test('getRoster ids are unique', () => {
  const roster = getRoster();
  const ids = roster.map(r => r.id);
  const uniqueIds = new Set(ids);
  assert.strictEqual(uniqueIds.size, 12);
});

test('getRoster all models are haiku or sonnet', () => {
  const roster = getRoster();
  roster.forEach(role => {
    assert.ok(['haiku', 'sonnet'].includes(role.model),
      `role ${role.id} has invalid model: ${role.model}`);
  });
});

test('getRoster returns fresh array on each call (immutability)', () => {
  const roster1 = getRoster();
  const roster2 = getRoster();
  assert.deepStrictEqual(roster1, roster2);
  assert.notStrictEqual(roster1, roster2);
});

test('validateRoster on real roster returns ok: true, errors: []', () => {
  const roster = getRoster();
  const result = validateRoster(roster);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.errors.length, 0);
});

test('validateRoster rejects non-array input', () => {
  const result = validateRoster('not an array');
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('array')));
});

test('validateRoster rejects roster with wrong count', () => {
  const roster = getRoster().slice(0, 11);
  const result = validateRoster(roster);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('exactly 12')));
});

test('validateRoster rejects role with invalid model', () => {
  const roster = getRoster();
  roster[0].model = 'opus';
  const result = validateRoster(roster);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('model')));
});

test('validateRoster rejects duplicate ids', () => {
  const roster = getRoster();
  roster[1].id = roster[0].id;
  const result = validateRoster(roster);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('duplicate')));
});

test('validateRoster rejects role with missing id', () => {
  const roster = getRoster();
  roster[0].id = '';
  const result = validateRoster(roster);
  assert.strictEqual(result.ok, false);
});

test('validateRoster rejects role with missing persona', () => {
  const roster = getRoster();
  roster[0].persona = '';
  const result = validateRoster(roster);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('persona')));
});

test('validateRoster rejects role with missing process', () => {
  const roster = getRoster();
  roster[0].process = '';
  const result = validateRoster(roster);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('process')));
});

test('validateRoster rejects role with missing metrics', () => {
  const roster = getRoster();
  roster[0].metrics = '';
  const result = validateRoster(roster);
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('metrics')));
});

test('formatRoster returns string with all 12 ids', () => {
  const roster = getRoster();
  const formatted = formatRoster(roster);
  assert.strictEqual(typeof formatted, 'string');
  roster.forEach(role => {
    assert.ok(formatted.includes(role.id),
      `formatted output missing id: ${role.id}`);
  });
});

test('formatRoster includes model for each role', () => {
  const roster = getRoster();
  const formatted = formatRoster(roster);
  roster.forEach(role => {
    assert.ok(formatted.includes(`(${role.model})`),
      `formatted output missing model for: ${role.id}`);
  });
});

test('formatRoster is aligned and readable', () => {
  const roster = getRoster();
  const formatted = formatRoster(roster);
  const lines = formatted.split('\n');
  assert.strictEqual(lines.length, 12);
  lines.forEach(line => {
    assert.ok(line.includes('('), 'line should contain model in parens');
    assert.ok(line.includes(')'), 'line should contain closing paren');
  });
});

test('renderAgentMarkdown starts with ---', () => {
  const roster = getRoster();
  const md = renderAgentMarkdown(roster[0]);
  assert.ok(md.startsWith('---'));
});

test('renderAgentMarkdown contains name and model in frontmatter', () => {
  const roster = getRoster();
  const role = roster[0];
  const md = renderAgentMarkdown(role);
  assert.ok(md.includes(`name: ${role.id}`),
    `markdown should contain name: ${role.id}`);
  assert.ok(md.includes(`model: ${role.model}`),
    `markdown should contain model: ${role.model}`);
});

test('renderAgentMarkdown contains required sections', () => {
  const roster = getRoster();
  const role = roster[0];
  const md = renderAgentMarkdown(role);
  assert.ok(md.includes('## Persona'));
  assert.ok(md.includes('## Process'));
  assert.ok(md.includes('## Success Metrics'));
});

test('renderAgentMarkdown includes role text in sections', () => {
  const roster = getRoster();
  const role = roster[0];
  const md = renderAgentMarkdown(role);
  assert.ok(md.includes(role.persona));
  assert.ok(md.includes(role.process));
  assert.ok(md.includes(role.metrics));
});

test('renderAgentMarkdown is deterministic (no timestamps)', () => {
  const roster = getRoster();
  const role = roster[0];
  const md1 = renderAgentMarkdown(role);
  const md2 = renderAgentMarkdown(role);
  assert.strictEqual(md1, md2);
});

test('renderAgentMarkdown for architect role', () => {
  const roster = getRoster();
  const architect = roster.find(r => r.id === 'architect');
  assert.ok(architect);
  const md = renderAgentMarkdown(architect);
  assert.ok(md.includes('name: architect'));
  assert.ok(md.includes('model: sonnet'));
  assert.ok(md.includes('System designer'));
});

test('renderAgentMarkdown for cost-auditor role', () => {
  const roster = getRoster();
  const costAuditor = roster.find(r => r.id === 'cost-auditor');
  assert.ok(costAuditor);
  const md = renderAgentMarkdown(costAuditor);
  assert.ok(md.includes('name: cost-auditor'));
  assert.ok(md.includes('model: haiku'));
  assert.ok(md.includes('Financial steward'));
});
