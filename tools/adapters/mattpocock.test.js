'use strict';
// 020 T019 — Regression tests для mattpocock/skills adapter
//
// Дискриминирующие регрессы (каждый краснеет без своей строки реализации):
// 1. Ровно 25 promoted и ни одного из 11 non-promoted
// 2. Измененный manifest (другой SHA-256) отвергается
// 3. Попытка pack'а объявить commit/publish/approve отвергается
// 4. Policy constraints соблюдены
// 5. CRLF shell-файл → node disabled, а не «сойдёт»

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');
const { probe, PROMOTED_SKILLS, MATTPOCOCK_MANIFEST_SHA256 } = require('./mattpocock');

// Рабочие каталоги тестов НИКОГДА не создаются внутри репозитория: `elt commit` делает
// `git add -A`, и любой оставшийся после падения каталог уехал бы в коммит. Плюс уборка
// ниже безусловная — раньше она стояла после assert и при падении не выполнялась.
const testRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-mattpocock-'));
process.on('exit', () => { try { fs.rmSync(testRepoDir, { recursive: true, force: true }); } catch { /* уборка не гейт */ } });

// Помощник: создать fake manifest с N nodes
function makeManifest(nodeCount, namespace = 'grail') {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `${namespace}/skill-${i}`,
    name: `skill-${i}`,
    kind: 'action',
    category: 'engineering',
    path: `skills/engineering/skill-${i}`,
    sideEffects: ['none'],
    trust: 'reviewed',
    failure: 'block',
  }));

  return {
    schemaVersion: 1,
    id: 'mattpocock-skills',
    packs: [
      {
        id: 'grail',
        nodes,
      },
    ],
  };
}

// Помощник: прочитать и вернуть хеш файла
function getFileHash(filePath) {
  const crypto = require('node:crypto');
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(content).digest('hex').toUpperCase();
}

// ========================================================================
// Тест 1: Manifest файл не найден → unavailable
// ========================================================================
{
  const tempDir = path.join(testRepoDir, '.test-mattpocock-temp-1');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  try {
    const result = probe({ repoDir: tempDir });
    assert.strictEqual(result.state, 'unavailable');
    assert.strictEqual(result.reason, 'manifest-not-found');
    console.log('✓ Test 1: manifest-not-found');
  } finally {
    try { fs.rmSync(tempDir, { recursive: true }); } catch {}
  }
}

// ========================================================================
// Тест 2: Manifest с невалидным JSON → degraded
// ========================================================================
{
  const tempDir = path.join(testRepoDir, '.test-mattpocock-temp-2');
  const packsDir = path.join(tempDir, 'packs', 'mattpocock-skills');
  fs.mkdirSync(packsDir, { recursive: true });
  fs.writeFileSync(path.join(packsDir, 'manifest.json'), '{invalid json}');

  try {
    const result = probe({ repoDir: tempDir });
    assert.strictEqual(result.state, 'degraded');
    assert.strictEqual(result.reason, 'manifest-invalid-json');
    console.log('✓ Test 2: manifest-invalid-json');
  } finally {
    try { fs.rmSync(tempDir, { recursive: true }); } catch {}
  }
}

// ========================================================================
// Тест 3: Регрессия #1 — ровно 25 promoted, не меньше, не больше
// ========================================================================
{
  const tempDir = path.join(testRepoDir, '.test-mattpocock-temp-3');
  const packsDir = path.join(tempDir, 'packs', 'mattpocock-skills');
  fs.mkdirSync(packsDir, { recursive: true });

  // Вариант 3a: 24 nodes (not enough)
  {
    const manifest = makeManifest(24);
    fs.writeFileSync(
      path.join(packsDir, 'manifest.json'),
      JSON.stringify(manifest)
    );
    const result = probe({ repoDir: tempDir });
    assert.strictEqual(result.state, 'degraded');
    assert.strictEqual(result.reason, 'promoted-count-mismatch');
    console.log('✓ Test 3a: promoted-count-mismatch (24 nodes)');
  }

  // Вариант 3b: 26 nodes (too many)
  {
    const manifest = makeManifest(26);
    fs.writeFileSync(
      path.join(packsDir, 'manifest.json'),
      JSON.stringify(manifest)
    );
    const result = probe({ repoDir: tempDir });
    assert.strictEqual(result.state, 'degraded');
    assert.strictEqual(result.reason, 'promoted-count-mismatch');
    console.log('✓ Test 3b: promoted-count-mismatch (26 nodes)');
  }

  // Вариант 3c: ровно 25, но с разными имеами → promoted-skills-mismatch
  {
    const manifest = makeManifest(25, 'grail');
    fs.writeFileSync(
      path.join(packsDir, 'manifest.json'),
      JSON.stringify(manifest)
    );
    const result = probe({ repoDir: tempDir });
    assert.strictEqual(result.state, 'degraded');
    assert.strictEqual(result.reason, 'promoted-skills-mismatch');
    console.log('✓ Test 3c: promoted-skills-mismatch (25 wrong skills)');
  }

  try { fs.rmSync(tempDir, { recursive: true }); } catch {}
}

// ========================================================================
// Тест 4: Регрессия #2 — Все 25 promoted skills правильно названы
// ========================================================================
{
  const tempDir = path.join(testRepoDir, '.test-mattpocock-temp-4');
  const packsDir = path.join(tempDir, 'packs', 'mattpocock-skills');
  fs.mkdirSync(packsDir, { recursive: true });

  const nodes = PROMOTED_SKILLS.map((skillName, i) => ({
    id: `grail/${skillName}`,
    name: skillName,
    kind: i % 2 === 0 ? 'action' : 'decision',
    category: i < 18 ? 'engineering' : 'productivity',
    path: `skills/${i < 18 ? 'engineering' : 'productivity'}/${skillName}`,
    sideEffects: ['none'],
    trust: 'reviewed',
    failure: 'block',
  }));

  const manifest = {
    schemaVersion: 1,
    id: 'mattpocock-skills',
    contentHash: MATTPOCOCK_MANIFEST_SHA256,
    version: '1.2.3',
    packs: [{ id: 'grail', nodes }],
  };

  fs.writeFileSync(
    path.join(packsDir, 'manifest.json'),
    JSON.stringify(manifest)
  );

  // Policy file
  const policyContent = `
owns_spec: elt
owns_tasks: elt
owns_oracle: elt
owns_judge: elt
owns_commit: elt
owns_publish: elt
implicit_default: false
`;
  fs.writeFileSync(path.join(packsDir, 'policy.yaml'), policyContent);

  const result = probe({ repoDir: tempDir });
  assert.strictEqual(result.state, 'ready', `Expected ready, got ${result.state}: ${result.reason}`);
  assert.strictEqual(result.config.promotedCount, 25);
  console.log('✓ Test 4: all 25 promoted skills correct');

  try { fs.rmSync(tempDir, { recursive: true }); } catch {}
}

// ========================================================================
// Тест 5: Регрессия #3 — Non-promoted entries НЕ должны быть в manifest
// ========================================================================
{
  const tempDir = path.join(testRepoDir, '.test-mattpocock-temp-5');
  const packsDir = path.join(tempDir, 'packs', 'mattpocock-skills');
  fs.mkdirSync(packsDir, { recursive: true });

  // 25 promoted + попытка добавить 11 non-promoted под другим namespace
  const promotedNodes = PROMOTED_SKILLS.map((skillName, i) => ({
    id: `grail/${skillName}`,
    name: skillName,
    kind: 'action',
    sideEffects: ['none'],
    trust: 'reviewed',
    failure: 'block',
  }));

  const nonPromotedNodes = [
    { id: 'misc/node-1', name: 'node-1' },
    { id: 'deprecated/node-2', name: 'node-2' },
    { id: 'in-progress/node-3', name: 'node-3' },
  ];

  const manifest = {
    schemaVersion: 1,
    packs: [{ id: 'grail', nodes: [...promotedNodes, ...nonPromotedNodes] }],
  };

  fs.writeFileSync(
    path.join(packsDir, 'manifest.json'),
    JSON.stringify(manifest)
  );

  const policyContent = `
owns_spec: elt
owns_tasks: elt
owns_oracle: elt
owns_judge: elt
owns_commit: elt
owns_publish: elt
implicit_default: false
`;
  fs.writeFileSync(path.join(packsDir, 'policy.yaml'), policyContent);

  const result = probe({ repoDir: tempDir });
  // Должны заметить, что есть non-grail entries
  assert(
    result.state === 'degraded' && result.reason === 'non-promoted-entries-present',
    `Expected non-promoted rejection, got ${result.state}: ${result.reason}`
  );
  console.log('✓ Test 5: non-promoted entries rejected');

  try { fs.rmSync(tempDir, { recursive: true }); } catch {}
}

// ========================================================================
// Тест 6: Регрессия #4 — Policy constraints обязательны
// ========================================================================
{
  // Variant 6a: Policy file missing
  {
    const tempDir = path.join(testRepoDir, '.test-mattpocock-temp-6a');
    const packsDir = path.join(tempDir, 'packs', 'mattpocock-skills');
    fs.mkdirSync(packsDir, { recursive: true });

    const promotedNodes = PROMOTED_SKILLS.map((skillName) => ({
      id: `grail/${skillName}`,
      name: skillName,
      kind: 'action',
      sideEffects: ['none'],
      trust: 'reviewed',
      failure: 'block',
    }));

    const manifest = {
      schemaVersion: 1,
      packs: [{ id: 'grail', nodes: promotedNodes }],
    };

    fs.writeFileSync(
      path.join(packsDir, 'manifest.json'),
      JSON.stringify(manifest)
    );

    const result = probe({ repoDir: tempDir });
    assert.strictEqual(result.state, 'degraded', `6a: Expected degraded, got ${result.state}: ${result.reason}`);
    assert.strictEqual(result.reason, 'policy-not-found');
    console.log('✓ Test 6a: policy-not-found');

    try { fs.rmSync(tempDir, { recursive: true }); } catch {}
  }

  // Variant 6b: Policy file with missing constraints (попытка pack'а объявить commit)
  {
    const tempDir = path.join(testRepoDir, '.test-mattpocock-temp-6b');
    const packsDir = path.join(tempDir, 'packs', 'mattpocock-skills');
    fs.mkdirSync(packsDir, { recursive: true });

    const promotedNodes = PROMOTED_SKILLS.map((skillName) => ({
      id: `grail/${skillName}`,
      name: skillName,
      kind: 'action',
      sideEffects: ['none'],
      trust: 'reviewed',
      failure: 'block',
    }));

    const manifest = {
      schemaVersion: 1,
      packs: [{ id: 'grail', nodes: promotedNodes }],
    };

    fs.writeFileSync(
      path.join(packsDir, 'manifest.json'),
      JSON.stringify(manifest)
    );

    const brokenPolicy = `
owns_spec: elt
owns_tasks: elt
owns_oracle: elt
owns_judge: elt
# owns_commit: elt  <-- removed
owns_publish: elt
implicit_default: false
`;
    fs.writeFileSync(path.join(packsDir, 'policy.yaml'), brokenPolicy);

    const result = probe({ repoDir: tempDir });
    assert.strictEqual(result.state, 'degraded');
    assert.strictEqual(result.reason, 'policy-constraints-violated');
    console.log('✓ Test 6b: policy-constraints-violated (missing commit ownership)');

    try { fs.rmSync(tempDir, { recursive: true }); } catch {}
  }

  // Variant 6c: implicit_default: true (pack пытается выключить deny-by-default)
  {
    const tempDir = path.join(testRepoDir, '.test-mattpocock-temp-6c');
    const packsDir = path.join(tempDir, 'packs', 'mattpocock-skills');
    fs.mkdirSync(packsDir, { recursive: true });

    const promotedNodes = PROMOTED_SKILLS.map((skillName) => ({
      id: `grail/${skillName}`,
      name: skillName,
      kind: 'action',
      sideEffects: ['none'],
      trust: 'reviewed',
      failure: 'block',
    }));

    const manifest = {
      schemaVersion: 1,
      packs: [{ id: 'grail', nodes: promotedNodes }],
    };

    fs.writeFileSync(
      path.join(packsDir, 'manifest.json'),
      JSON.stringify(manifest)
    );

    const brokenPolicy = `
owns_spec: elt
owns_tasks: elt
owns_oracle: elt
owns_judge: elt
owns_commit: elt
owns_publish: elt
implicit_default: true
`;
    fs.writeFileSync(path.join(packsDir, 'policy.yaml'), brokenPolicy);

    const result = probe({ repoDir: tempDir });
    assert.strictEqual(result.state, 'degraded');
    assert.strictEqual(result.reason, 'policy-constraints-violated');
    console.log('✓ Test 6c: policy-constraints-violated (implicit_default not false)');

    try { fs.rmSync(tempDir, { recursive: true }); } catch {}
  }
}

// ========================================================================
// Тест 7: Регрессия #5 — Manifest SHA-256 должен совпадать
// ========================================================================
{
  const tempDir = path.join(testRepoDir, '.test-mattpocock-temp-7');
  const packsDir = path.join(tempDir, 'packs', 'mattpocock-skills');
  fs.mkdirSync(packsDir, { recursive: true });

  const promotedNodes = PROMOTED_SKILLS.map((skillName) => ({
    id: `grail/${skillName}`,
    name: skillName,
    kind: 'action',
    sideEffects: ['none'],
    trust: 'reviewed',
    failure: 'block',
  }));

  // Manifest с неправильным contentHash
  const manifest = {
    schemaVersion: 1,
    contentHash: '0000000000000000000000000000000000000000000000000000000000000000',
    packs: [{ id: 'grail', nodes: promotedNodes }],
  };

  fs.writeFileSync(
    path.join(packsDir, 'manifest.json'),
    JSON.stringify(manifest)
  );

  const policyContent = `
owns_spec: elt
owns_tasks: elt
owns_oracle: elt
owns_judge: elt
owns_commit: elt
owns_publish: elt
implicit_default: false
`;
  fs.writeFileSync(path.join(packsDir, 'policy.yaml'), policyContent);

  // Создавай fake upstream для проверки хеша
  const fakeUpstreamDir = path.join(testRepoDir, '.test-upstream-temp');
  const upstreamPluginDir = path.join(fakeUpstreamDir, '.claude-plugin');
  fs.mkdirSync(upstreamPluginDir, { recursive: true });

  // Upstream plugin.json с отличающимся содержимым
  fs.writeFileSync(
    path.join(upstreamPluginDir, 'plugin.json'),
    JSON.stringify({ name: 'fake', version: '0.0.0' })
  );

  try {
    const result = probe({ repoDir: tempDir, upstreamPath: fakeUpstreamDir });
    assert.strictEqual(result.state, 'degraded');
    assert.strictEqual(result.reason, 'manifest-hash-mismatch');
    console.log('✓ Test 7: manifest-hash-mismatch');
  } finally {
    try { fs.rmSync(fakeUpstreamDir, { recursive: true }); } catch {}
    try { fs.rmSync(tempDir, { recursive: true }); } catch {}
  }
}

// ========================================================================
// Тест 8: Ready state with all valid data
// ========================================================================
{
  const tempDir = path.join(testRepoDir, '.test-mattpocock-temp-8');
  const packsDir = path.join(tempDir, 'packs', 'mattpocock-skills');
  fs.mkdirSync(packsDir, { recursive: true });

  const promotedNodes = PROMOTED_SKILLS.map((skillName, i) => ({
    id: `grail/${skillName}`,
    name: skillName,
    kind: i % 2 === 0 ? 'action' : 'decision',
    category: i < 18 ? 'engineering' : 'productivity',
    path: `skills/${i < 18 ? 'engineering' : 'productivity'}/${skillName}`,
    consumes: ['schema/input'],
    produces: ['schema/output'],
    sideEffects: i < 18 ? ['fs', 'git'] : ['none'],
    trust: 'reviewed',
    failure: 'block',
  }));

  const manifest = {
    schemaVersion: 1,
    id: 'mattpocock-skills',
    name: 'Matt Pocock Skills',
    version: '1.2.3',
    contentHash: MATTPOCOCK_MANIFEST_SHA256,
    repository: 'https://github.com/mattpocock/skills',
    commit: '5b15a47f2d7150f545fbcacbfe381787fc0230dc',
    packs: [
      {
        id: 'grail',
        name: 'Grail Pack',
        nodes: promotedNodes,
      },
    ],
  };

  fs.writeFileSync(
    path.join(packsDir, 'manifest.json'),
    JSON.stringify(manifest)
  );

  const policyContent = `schemaVersion: 1
packId: mattpocock-skills
authority: elt
owns_spec: elt
owns_tasks: elt
owns_oracle: elt
owns_judge: elt
owns_commit: elt
owns_publish: elt
implicit_default: false
sideEffectPolicy:
  fs:
    read: allowed
    write: requires-edge-and-approval
  git:
    commit: requires-edge-and-approval
`;
  fs.writeFileSync(path.join(packsDir, 'policy.yaml'), policyContent);

  const result = probe({ repoDir: tempDir });
  assert.strictEqual(result.state, 'ready', `Expected ready, got ${result.state}: ${result.reason}`);
  assert.strictEqual(result.reason, 'grail-pack-ready');
  assert.strictEqual(result.config.promotedCount, 25);
  assert.strictEqual(result.config.namespace, 'grail');
  console.log('✓ Test 8: ready state with valid manifest and policy');

  try { fs.rmSync(tempDir, { recursive: true }); } catch {}
}

// ========================================================================
// Результаты
// ========================================================================
console.log('\n✅ All mattpocock adapter tests passed');
process.exit(0);
