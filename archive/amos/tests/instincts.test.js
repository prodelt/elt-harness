const test = require('node:test');
const assert = require('node:assert');
const {
  extractInstincts,
  clusterInstincts,
  selectEvolvable,
  draftSkillMarkdown
} = require('../lib/instincts');

test('extractInstincts: counts string patterns and sorts by uses', () => {
  const events = ['npm test', 'npm test', 'npm test', 'git push'];
  const result = extractInstincts(events);

  assert.strictEqual(result.length, 2, 'should have 2 distinct patterns');
  assert.deepStrictEqual(result[0], {
    pattern: 'npm test',
    uses: 3,
    confidence: 0.6
  }, 'npm test should be first with uses=3, confidence=0.6');
  assert.deepStrictEqual(result[1], {
    pattern: 'git push',
    uses: 1,
    confidence: 0.2
  }, 'git push should be second with uses=1, confidence=0.2');
});

test('extractInstincts: handles object form with kind and detail', () => {
  const events = [
    { kind: 'fix', detail: 'null check' },
    { kind: 'fix', detail: 'null check' },
    { kind: 'fix', detail: 'null check' },
    { kind: 'refactor', detail: 'naming' }
  ];
  const result = extractInstincts(events);

  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].pattern, 'fix:null check');
  assert.strictEqual(result[0].uses, 3);
  assert.strictEqual(result[1].pattern, 'refactor:naming');
  assert.strictEqual(result[1].uses, 1);
});

test('extractInstincts: ignores empty and whitespace strings', () => {
  const events = ['npm test', '', '  ', 'npm test', null, undefined];
  const result = extractInstincts(events);

  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].pattern, 'npm test');
  assert.strictEqual(result[0].uses, 2);
});

test('extractInstincts: normalizes case for deduplication but preserves display', () => {
  const events = ['npm Test', 'NPM TEST', 'npm test'];
  const result = extractInstincts(events);

  assert.strictEqual(result.length, 1);
  // The pattern should be one of the originals (likely the first seen)
  assert(result[0].pattern.toLowerCase() === 'npm test');
  assert.strictEqual(result[0].uses, 3);
});

test('clusterInstincts: groups by normalized pattern and sums uses', () => {
  const rows = [
    { pattern: 'npm test', uses: 3, confidence: 0.6 },
    { pattern: 'npm test', uses: 3, confidence: 0.6 }
  ];
  const result = clusterInstincts(rows);

  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].pattern, 'npm test');
  assert.strictEqual(result[0].uses, 6);
  assert.strictEqual(result[0].confidence, 1, 'confidence should be min(1, 6/5) = 1');
});

test('clusterInstincts: handles mixed case patterns as same cluster', () => {
  const rows = [
    { pattern: 'npm Test', uses: 2, confidence: 0.4 },
    { pattern: 'NPM TEST', uses: 3, confidence: 0.6 }
  ];
  const result = clusterInstincts(rows);

  assert.strictEqual(result.length, 1, 'should cluster to 1 entry');
  assert.strictEqual(result[0].uses, 5, 'should sum to 5');
  assert(result[0].confidence >= 0.99, 'confidence should be ~1');
});

test('clusterInstincts: sorts by uses descending', () => {
  const rows = [
    { pattern: 'git push', uses: 1, confidence: 0.2 },
    { pattern: 'npm test', uses: 6, confidence: 1 },
    { pattern: 'npm lint', uses: 3, confidence: 0.6 }
  ];
  const result = clusterInstincts(rows);

  assert.strictEqual(result[0].pattern, 'npm test', 'npm test (6 uses) first');
  assert.strictEqual(result[1].pattern, 'npm lint', 'npm lint (3 uses) second');
  assert.strictEqual(result[2].pattern, 'git push', 'git push (1 use) third');
});

test('selectEvolvable: filters by confidence >= 0.8 and uses >= 5', () => {
  const rows = [
    { pattern: 'npm test', uses: 5, confidence: 1 },      // PASSES
    { pattern: 'npm lint', uses: 2, confidence: 0.4 },    // FAILS (uses < 5)
    { pattern: 'git push', uses: 10, confidence: 0.7 },   // FAILS (confidence < 0.8)
    { pattern: 'build', uses: 5, confidence: 0.8 }        // PASSES
  ];
  const result = selectEvolvable(rows);

  assert.strictEqual(result.length, 2);
  assert(result.some(r => r.pattern === 'npm test'));
  assert(result.some(r => r.pattern === 'build'));
});

test('selectEvolvable: respects custom minConfidence and minUses', () => {
  const rows = [
    { pattern: 'npm test', uses: 3, confidence: 0.6 },
    { pattern: 'npm lint', uses: 2, confidence: 0.4 }
  ];
  const result = selectEvolvable(rows, { minConfidence: 0.5, minUses: 2 });

  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].pattern, 'npm test');
});

test('selectEvolvable: returns empty array if nothing qualifies', () => {
  const rows = [
    { pattern: 'npm test', uses: 2, confidence: 0.4 },
    { pattern: 'npm lint', uses: 1, confidence: 0.2 }
  ];
  const result = selectEvolvable(rows);

  assert.strictEqual(result.length, 0);
});

test('draftSkillMarkdown: outputs valid YAML frontmatter with slug and description', () => {
  const cluster = { pattern: 'npm test', uses: 5, confidence: 1 };
  const result = draftSkillMarkdown(cluster);

  assert(result.startsWith('---'), 'should start with YAML frontmatter');
  assert(result.includes('name: npm-test'), 'should contain kebab-case slug');
  assert(result.includes('description: Observed pattern'), 'should mention pattern');
  assert(result.includes('across 5 invocations'), 'should reference uses count');
  assert(result.includes('## Pattern'), 'should have Pattern section');
  assert(result.includes('## When to apply'), 'should have When to apply section');
});

test('draftSkillMarkdown: produces deterministic output (same input → same output)', () => {
  const cluster = { pattern: 'fix null check', uses: 7, confidence: 1 };
  const result1 = draftSkillMarkdown(cluster);
  const result2 = draftSkillMarkdown(cluster);

  assert.strictEqual(result1, result2, 'multiple calls should produce identical output');
});

test('draftSkillMarkdown: handles special characters in pattern gracefully', () => {
  const cluster = { pattern: 'npm run test:watch & npm lint', uses: 3, confidence: 0.6 };
  const result = draftSkillMarkdown(cluster);

  assert(result.startsWith('---'));
  assert(result.includes('name:'));
  assert(result.includes('across 3 invocations'));
});

test('draftSkillMarkdown: generates slugs max ~40 chars and kebab-case', () => {
  const cluster = {
    pattern: 'this is a very long pattern that should be truncated when converted to slug form to stay under 40 characters',
    uses: 2,
    confidence: 0.4
  };
  const result = draftSkillMarkdown(cluster);

  const nameMatch = result.match(/name: ([\w\-:]+)/);
  assert(nameMatch, 'should have a name field');
  const slug = nameMatch[1];
  assert(slug.length <= 40, `slug should be max 40 chars, got ${slug.length}`);
  assert(/^[a-z0-9\-:]+$/.test(slug), 'slug should be kebab-case alphanumeric');
});

test('extractInstincts: returns empty array for invalid input', () => {
  assert.deepStrictEqual(extractInstincts(null), []);
  assert.deepStrictEqual(extractInstincts(undefined), []);
  assert.deepStrictEqual(extractInstincts('not an array'), []);
  assert.deepStrictEqual(extractInstincts([]), []);
});

test('clusterInstincts: returns empty array for invalid input', () => {
  assert.deepStrictEqual(clusterInstincts(null), []);
  assert.deepStrictEqual(clusterInstincts(undefined), []);
  assert.deepStrictEqual(clusterInstincts([]), []);
});

test('selectEvolvable: returns empty array for invalid input', () => {
  assert.deepStrictEqual(selectEvolvable(null), []);
  assert.deepStrictEqual(selectEvolvable(undefined), []);
  assert.deepStrictEqual(selectEvolvable([]), []);
});

test('draftSkillMarkdown: handles invalid input gracefully', () => {
  const result1 = draftSkillMarkdown(null);
  const result2 = draftSkillMarkdown(undefined);
  const result3 = draftSkillMarkdown({});

  assert.strictEqual(result1, '');
  assert.strictEqual(result2, '');
  assert.strictEqual(result3, '');
});
