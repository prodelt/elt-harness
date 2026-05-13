// claude-json-normalizer.test.js
'use strict';
const assert = require('assert');
const { findDuplicateProjectKeys, buildNormalizedJson, analyzeDrift } = require('./claude-json-normalizer');

// --- fixtures (match real .claude.json structure with "projects" sub-object) ---

const FIXTURE_WITH_DUPS = JSON.stringify({
  numStartups: 625,
  projects: {
    'D:/Mammoth ERP system': { hasTrustDialogAccepted: true, allowedTools: [] },
    'D:/Mammoth ERP system/.worktrees/pm': { allowedTools: [] },
    'D:/Mammoth erp system': { hasTrustDialogAccepted: false, allowedTools: [] },
    'D:/mammoth erp system': { hasTrustDialogAccepted: false, allowedTools: [] },
    'C:/Projects/my-app': { allowedTools: ['Read'] },
  },
});

const FIXTURE_CLEAN = JSON.stringify({
  numStartups: 100,
  projects: {
    'C:/Projects/my-app': { allowedTools: ['Read'] },
    'D:/Other/project': { allowedTools: [] },
  },
});

const FIXTURE_NO_PROJECTS = JSON.stringify({ numStartups: 1, theme: 'dark' });

// --- Test 1: findDuplicateProjectKeys detects case-variant duplicates ---
{
  const dups = findDuplicateProjectKeys(FIXTURE_WITH_DUPS);
  assert.strictEqual(dups.length, 1, `Expected 1 dup group, got ${dups.length}: ${JSON.stringify(dups)}`);
  const grp = dups[0];
  assert.strictEqual(grp.canonical, 'D:/Mammoth ERP system', `Wrong canonical: ${grp.canonical}`);
  assert.ok(grp.duplicates.includes('D:/Mammoth erp system'), 'Should flag erp system');
  assert.ok(grp.duplicates.includes('D:/mammoth erp system'), 'Should flag mammoth erp system');
  assert.ok(!grp.duplicates.includes('D:/Mammoth ERP system/.worktrees/pm'), 'Worktrees not flagged');
  process.stdout.write('Test 1 PASS: findDuplicateProjectKeys detects case-variant dups\n');
}

// --- Test 2: clean fixture returns empty ---
{
  const dups = findDuplicateProjectKeys(FIXTURE_CLEAN);
  assert.strictEqual(dups.length, 0, `Expected 0 dups, got ${dups.length}`);
  process.stdout.write('Test 2 PASS: findDuplicateProjectKeys clean fixture returns empty\n');
}

// --- Test 3: no "projects" key returns empty ---
{
  const dups = findDuplicateProjectKeys(FIXTURE_NO_PROJECTS);
  assert.strictEqual(dups.length, 0, 'Should return empty for no projects key');
  process.stdout.write('Test 3 PASS: findDuplicateProjectKeys handles missing projects key\n');
}

// --- Test 4: buildNormalizedJson removes dups, keeps canonical and worktrees ---
{
  const { normalizedRaw, removed } = buildNormalizedJson(FIXTURE_WITH_DUPS);
  const obj = JSON.parse(normalizedRaw);
  assert.ok(obj.projects['D:/Mammoth ERP system'], 'Canonical must survive');
  assert.ok(obj.projects['D:/Mammoth ERP system/.worktrees/pm'], 'Worktrees must survive');
  assert.ok(!obj.projects['D:/Mammoth erp system'], 'Dup must be removed');
  assert.ok(!obj.projects['D:/mammoth erp system'], 'All-lower dup must be removed');
  assert.ok(obj.projects['C:/Projects/my-app'], 'Unrelated entry must survive');
  assert.ok(removed.includes('D:/Mammoth erp system'), 'removed list: erp system');
  assert.ok(removed.includes('D:/mammoth erp system'), 'removed list: mammoth erp system');
  process.stdout.write('Test 4 PASS: buildNormalizedJson removes dups, keeps canonical\n');
}

// --- Test 5: buildNormalizedJson is idempotent on clean data ---
{
  const { normalizedRaw, removed } = buildNormalizedJson(FIXTURE_CLEAN);
  const obj = JSON.parse(normalizedRaw);
  assert.ok(obj.projects['C:/Projects/my-app'], 'Entry must survive');
  assert.strictEqual(removed.length, 0, 'No removals on clean data');
  process.stdout.write('Test 5 PASS: buildNormalizedJson idempotent on clean data\n');
}

// --- Test 6: analyzeDrift reports correct counts ---
{
  const report = analyzeDrift(FIXTURE_WITH_DUPS);
  assert.strictEqual(report.projectCount, 5, `Expected 5 project entries, got ${report.projectCount}`);
  assert.strictEqual(report.duplicateGroups, 1, `Expected 1 dup group, got ${report.duplicateGroups}`);
  assert.strictEqual(report.removableKeys, 2, `Expected 2 removable, got ${report.removableKeys}`);
  process.stdout.write('Test 6 PASS: analyzeDrift reports correct counts\n');
}

process.stdout.write('\nclaude-json-normalizer.test.js PASS (6/6)\n');
