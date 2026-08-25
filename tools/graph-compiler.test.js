'use strict';
// 020 T013 — регресс компилятора графа.
//
// Каждый негативный кейс здесь — это способ тихо забрать у ядра власть или ослабить отказ.
// Поэтому проверяется не «есть ошибка», а КОД ошибки: формулировку можно переписать,
// причину — нет.

const assert = require('node:assert/strict');

const { AUTHORITY_CAPABILITIES, compile, loadCanonicalGraph, loadSchema } = require('./graph-compiler');

const clone = (v) => JSON.parse(JSON.stringify(v));
const codes = (result) => result.errors.map((e) => e.split(':')[0]);

function withDoc(mutate, options) {
  const doc = loadCanonicalGraph();
  mutate(doc);
  return compile(doc, options);
}

function nodeOf(doc, id) {
  return doc.nodes.find((n) => n.id === id);
}

// Базовая точка: канонический граф компилируется как есть, иначе весь остальной тест
// проверяет фикстуру, а не продукт.
function testCanonicalGraphCompiles() {
  const result = compile(loadCanonicalGraph());
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.graph.entry, 'recon');
  assert.deepEqual(
    Object.keys(result.graph.nodes).sort(),
    ['build', 'certified', 'debrief', 'landing', 'mirror', 'plan', 'publish', 'recon'],
  );
}

function testDuplicateIdRejected() {
  const result = withDoc((doc) => { doc.nodes.push(clone(nodeOf(doc, 'build'))); });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('duplicate-id'), result.errors.join('; '));
}

function testSchemaMismatchOnMissingField() {
  const result = withDoc((doc) => { delete nodeOf(doc, 'build').trust; });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('schema-mismatch'), result.errors.join('; '));
}

function testSchemaMismatchOnUnknownProperty() {
  const result = withDoc((doc) => { nodeOf(doc, 'build').retryForever = true; });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('unknown property retryForever')), result.errors.join('; '));
}

function testSchemaMismatchOnBadEnum() {
  const result = withDoc((doc) => { nodeOf(doc, 'build').kind = 'daemon'; });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('schema-mismatch'));
}

// Узел, потребляющий необъявленный schema ref, — это разрыв контракта данных: следующий
// узел получит конверт, о котором граф ничего не знает.
function testUndeclaredSchemaRefRejected() {
  const result = withDoc((doc) => { nodeOf(doc, 'debrief').consumes.push('elt/whatever'); });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('undeclared schema elt/whatever')), result.errors.join('; '));
}

function testUnknownEdgeEndpointRejected() {
  const result = withDoc((doc) => { doc.edges.push({ from: 'debrief', to: 'nirvana', event: 'escape' }); });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('unknown-node'));
}

function testUnknownEntryRejected() {
  const result = withDoc((doc) => { doc.entry = 'bootstrap'; });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('unknown-node'));
}

// Неявный цикл: посадка обратно в разбор без объявленной петли. Reducer детерминирован,
// поэтому такой цикл не «иногда завершится» — он не завершится никогда.
function testImplicitCycleRejected() {
  const result = withDoc((doc) => { doc.edges.push({ from: 'certified', to: 'mirror', event: 'recheck' }); });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('implicit-cycle'), result.errors.join('; '));
}

function testDeclaredLoopEdgeIsAllowed() {
  const result = compile(loadCanonicalGraph());
  assert.equal(result.ok, true);
  const loops = result.graph.edges.filter((e) => e.loop);
  assert.ok(loops.length >= 3, 'канонический граф держит откаты build/mirror/debrief явными петлями');
}

function testAmbiguousEdgeRejected() {
  const result = withDoc((doc) => { doc.edges.push({ from: 'recon', to: 'plan', event: 'unknown-zone' }); });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('ambiguous-edge'), result.errors.join('; '));
}

function testEdgeGuardMustBeDeclaredByNode() {
  const result = withDoc((doc) => {
    doc.edges.find((e) => e.event === 'landed').guards.push('vibes-good');
  });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('undeclared-guard'), result.errors.join('; '));
}

// --- границы власти ----------------------------------------------------------------------

// Внешний pack, объявивший authority capability: ровно тот сценарий, ради которого в спеке
// написано «плагіни ніколи не володіють oracle truth, terminal verdict, commit або release».
function testPackNodeCannotClaimAuthority() {
  const result = withDoc((doc) => {
    doc.nodes.push({
      id: 'grail/implement',
      kind: 'action',
      consumes: [], produces: [],
      guards: [],
      capabilities: ['commit'],
      sideEffects: ['workspace', 'git'],
      trust: 'core',
      platforms: ['win32', 'linux', 'darwin'],
      timeoutMs: 60000,
    });
    doc.edges.push({ from: 'build', to: 'grail/implement', event: 'delegate' });
    doc.edges.push({ from: 'grail/implement', to: 'landing', event: 'done', guards: [] });
  });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('authority-capture'), result.errors.join('; '));
}

function testNonCoreTrustCannotHoldAuthority() {
  const result = withDoc((doc) => { nodeOf(doc, 'certified').trust = 'reviewed'; });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('authority-capture'), result.errors.join('; '));
}

// Регресс из формулировки задачи: попытка ослабить отказ КАЖДОЙ authority capability.
// Одиннадцать способностей × два ослабления — все обязаны быть отвергнуты поимённо.
function testEveryAuthorityCapabilityRefusesSkipAndDegrade() {
  assert.deepEqual(AUTHORITY_CAPABILITIES.length, 11, 'список authority из спеки не должен молча сжиматься');
  for (const capability of AUTHORITY_CAPABILITIES) {
    for (const failure of ['skip', 'degrade']) {
      const result = withDoc((doc) => {
        const node = nodeOf(doc, 'debrief'); // enrichment-узел без своих capability
        node.capabilities = [capability];
        node.failure = failure;
        node.sideEffects = ['workspace', 'git', 'network'];
      });
      assert.equal(result.ok, false, `${capability}: failure:${failure} обязан быть отвергнут`);
      assert.ok(
        codes(result).includes('authority-failure-policy'),
        `${capability}/${failure}: ожидался код authority-failure-policy, получено ${result.errors.join('; ')}`,
      );
    }
  }
}

// Вторая половина «принудительно ставить block»: не объявленный отказ у authority-узла не
// остаётся пустым, а становится block в скомпилированном графе.
function testAuthorityFailureIsForcedToBlock() {
  const result = compile(loadCanonicalGraph());
  assert.equal(result.ok, true);
  for (const node of Object.values(result.graph.nodes)) {
    if (node.capabilities.some((c) => AUTHORITY_CAPABILITIES.includes(c))) {
      assert.equal(node.failure, 'block', `${node.id}: authority обязан быть failure:block`);
    }
  }
  assert.equal(result.graph.nodes.mirror.failure, 'block');
  assert.equal(result.graph.nodes.publish.failure, 'block');
}

// Enrichment без authority — единственное место, где skip/degrade законны.
function testEnrichmentNodeMayDegrade() {
  const result = withDoc((doc) => {
    doc.nodes.push({
      id: 'grail/research',
      kind: 'action',
      consumes: [], produces: [],
      guards: [],
      capabilities: ['summarize'],
      sideEffects: ['network'],
      trust: 'unreviewed',
      platforms: ['win32', 'linux', 'darwin'],
      timeoutMs: 60000,
      failure: 'skip',
    });
    doc.edges.push({ from: 'recon', to: 'grail/research', event: 'enrich' });
    doc.edges.push({ from: 'grail/research', to: 'plan', event: 'enriched' });
  });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.graph.nodes['grail/research'].failure, 'skip');
}

// Отказ без объявления у обычного узла — тоже block: умолчание fail-closed.
function testUnspecifiedFailureDefaultsToBlock() {
  const result = compile(loadCanonicalGraph());
  assert.equal(result.graph.nodes.build.failure, 'block');
}

function testUndeclaredSideEffectRejected() {
  const commitWithoutGit = withDoc((doc) => { nodeOf(doc, 'landing').sideEffects = ['workspace']; });
  assert.equal(commitWithoutGit.ok, false);
  assert.ok(codes(commitWithoutGit).includes('undeclared-side-effect'), commitWithoutGit.errors.join('; '));

  const pushWithoutNetwork = withDoc((doc) => { nodeOf(doc, 'publish').sideEffects = ['git']; });
  assert.equal(pushWithoutNetwork.ok, false);
  assert.ok(codes(pushWithoutNetwork).includes('undeclared-side-effect'));

  const noneMixed = withDoc((doc) => { nodeOf(doc, 'build').sideEffects = ['none', 'network']; });
  assert.equal(noneMixed.ok, false);
  assert.ok(codes(noneMixed).includes('undeclared-side-effect'));
}

// Платформа: узел, который не заявлен на целевой ОС, обязан ронять компиляцию, а не
// падать в рантайме посреди батча (ровно так CRLF-узлы upstream ломались под bash -n).
function testPlatformCapabilityChecked() {
  const linux = compile(loadCanonicalGraph(), { platform: 'linux' });
  assert.equal(linux.ok, true, linux.errors.join('; '));
  const result = withDoc((doc) => { nodeOf(doc, 'mirror').platforms = ['win32']; }, { platform: 'linux' });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('platform-unsupported'), result.errors.join('; '));
}

// Схема, в которой появилось не понятое компилятором ключевое слово, не должна выглядеть
// проверенной: молчаливое расширение схемы — это тот же дрейф гейта, что и на 015.
function testUnsupportedSchemaKeywordRejected() {
  const schema = loadSchema();
  schema.$defs.node.properties.timeoutMs.exclusiveMaximum = 10;
  const result = compile(loadCanonicalGraph(), { schema });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('schema-unsupported'), result.errors.join('; '));
}

function main() {
  testCanonicalGraphCompiles();
  testDuplicateIdRejected();
  testSchemaMismatchOnMissingField();
  testSchemaMismatchOnUnknownProperty();
  testSchemaMismatchOnBadEnum();
  testUndeclaredSchemaRefRejected();
  testUnknownEdgeEndpointRejected();
  testUnknownEntryRejected();
  testImplicitCycleRejected();
  testDeclaredLoopEdgeIsAllowed();
  testAmbiguousEdgeRejected();
  testEdgeGuardMustBeDeclaredByNode();
  testPackNodeCannotClaimAuthority();
  testNonCoreTrustCannotHoldAuthority();
  testEveryAuthorityCapabilityRefusesSkipAndDegrade();
  testAuthorityFailureIsForcedToBlock();
  testEnrichmentNodeMayDegrade();
  testUnspecifiedFailureDefaultsToBlock();
  testUndeclaredSideEffectRejected();
  testPlatformCapabilityChecked();
  testUnsupportedSchemaKeywordRejected();
  process.stdout.write('graph compiler tests: PASS\n');
}

main();
