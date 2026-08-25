'use strict';
// 020 T012 — паритет поверхностей Claude / Codex / Gemini и его починка.
//
// Замер до правки: репозиторный `skills/elt/SKILL.md` = 5.0.0 (`90dcc5e4…`), все три домашние
// копии = 4.0.0 (`b5de68e2…`). То есть два клиента из трёх читали снятый маршрут, а заметить
// это было нечем: единственная сверка проверяла НАЛИЧИЕ файла. Поэтому здесь сверяется
// SHA-256, и у каждой проверки есть половина «сломанная фикстура → НЕ ok».
//
// Файл герметичен: `home` и `repoRoot` — фикстуры, домашний каталог машины не читается.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SKILL_ROOTS, checkClientParity, syncClientSurfaces } = require('./host-surface');

const SKILL_V5 = '---\nname: elt\nversion: 5.0.0\n---\n\n# elt\n';
const SKILL_V4 = '---\nname: elt\nversion: 4.0.0\n---\n\n# elt (старое)\n';

function repoFixture(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-repo-'));
  const file = path.join(root, 'skills', 'elt', 'SKILL.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return root;
}

function clientHome({ bodies = {}, legacy = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-home-'));
  for (const [client, body] of Object.entries(bodies)) {
    if (body === null) continue;
    const dir = SKILL_ROOTS.find((r) => r.client === client).dir;
    const file = path.join(home, dir, 'skills', 'elt', 'SKILL.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
  if (legacy) {
    const legacyFile = path.join(home, '.claude', 'bin', 'elt.js');
    fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
    fs.writeFileSync(legacyFile, '// снятая развёртка\n');
  }
  return home;
}

const skillOf = (home, client) =>
  path.join(home, SKILL_ROOTS.find((r) => r.client === client).dir, 'skills', 'elt', 'SKILL.md');

// --- сверка -----------------------------------------------------------------------------

test('три копии побайтово равны источнику → ok, версия и хеш прочитаны', () => {
  const repoRoot = repoFixture(SKILL_V5);
  const home = clientHome({ bodies: { claude: SKILL_V5, codex: SKILL_V5, gemini: SKILL_V5 } });
  const r = checkClientParity({ home, repoRoot });
  assert.equal(r.status, 'ok');
  assert.equal(r.source.version, '5.0.0');
  assert.match(r.source.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(r.clients.map((c) => c.status), ['ok', 'ok', 'ok']);
  for (const c of r.clients) assert.equal(c.sha256, r.source.sha256);
});

test('копия старой версии → drift, и обе версии названы (иначе неясно, насколько отстала)', () => {
  const repoRoot = repoFixture(SKILL_V5);
  const home = clientHome({ bodies: { claude: SKILL_V5, codex: SKILL_V4, gemini: SKILL_V4 } });
  const r = checkClientParity({ home, repoRoot });
  assert.equal(r.status, 'drift');
  assert.equal(r.clients.find((c) => c.client === 'claude').status, 'ok');
  for (const name of ['codex', 'gemini']) {
    const c = r.clients.find((x) => x.client === name);
    assert.equal(c.status, 'drift');
    assert.equal(c.version, '4.0.0');
    assert.notEqual(c.sha256, r.source.sha256);
  }
});

test('правка на один байт при той же версии — тоже drift: сверка по содержимому, не по номеру', () => {
  const repoRoot = repoFixture(SKILL_V5);
  const home = clientHome({ bodies: { claude: SKILL_V5, codex: SKILL_V5, gemini: SKILL_V5 + ' ' } });
  const r = checkClientParity({ home, repoRoot });
  assert.equal(r.status, 'drift');
  const gemini = r.clients.find((c) => c.client === 'gemini');
  assert.equal(gemini.version, '5.0.0', 'номер версии совпал — поймать могла только сверка хеша');
  assert.equal(gemini.status, 'drift');
});

test('копии нет вовсе → absent, и это никогда не ok', () => {
  const r = checkClientParity({ repoRoot: repoFixture(SKILL_V5), home: clientHome() });
  assert.equal(r.status, 'absent');
  assert.deepEqual(r.clients.map((c) => c.status), ['absent', 'absent', 'absent']);
});

test('нет источника в репозитории → no-source, а не «всё сходится»', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-nosrc-'));
  const r = checkClientParity({ repoRoot: empty, home: clientHome() });
  assert.equal(r.status, 'no-source');
  assert.deepEqual(r.clients, []);
});

test('снятая развёртка ~/.claude/bin/elt.js видна как факт, но статуса не меняет', () => {
  const repoRoot = repoFixture(SKILL_V5);
  const bodies = { claude: SKILL_V5, codex: SKILL_V5, gemini: SKILL_V5 };
  const withLegacy = checkClientParity({ home: clientHome({ bodies, legacy: true }), repoRoot });
  assert.equal(withLegacy.legacyRuntime.present, true);
  assert.equal(withLegacy.status, 'ok', 'чужой файл рядом — не повод объявить паритет сломанным');
  assert.equal(checkClientParity({ home: clientHome({ bodies }), repoRoot }).legacyRuntime.present, false);
});

// --- починка ----------------------------------------------------------------------------

test('--dry-run ничего не пишет, но перечисляет ровно то, что изменит', () => {
  const repoRoot = repoFixture(SKILL_V5);
  const home = clientHome({ bodies: { claude: SKILL_V4, codex: SKILL_V4, gemini: SKILL_V5 } });
  const res = syncClientSurfaces({ home, repoRoot, dryRun: true });
  assert.equal(res.status, 'dry-run');
  assert.deepEqual(res.changes.map((c) => c.client), ['claude', 'codex'], 'совпавший gemini не трогается');
  assert.equal(fs.readFileSync(skillOf(home, 'claude'), 'utf8'), SKILL_V4,
    'сухой прогон не пишет в профиль пользователя');
});

test('применение выравнивает все копии и оставляет обратимую резервную копию', () => {
  const repoRoot = repoFixture(SKILL_V5);
  const home = clientHome({ bodies: { claude: SKILL_V4, codex: null, gemini: SKILL_V4 } });
  const res = syncClientSurfaces({ home, repoRoot });
  assert.equal(res.status, 'applied');
  assert.equal(checkClientParity({ home, repoRoot }).status, 'ok', 'после применения паритет сходится');

  const drifted = res.changes.find((c) => c.client === 'claude');
  assert.ok(drifted.backup, 'переписанная копия обратима');
  assert.equal(fs.readFileSync(drifted.backup, 'utf8'), SKILL_V4, 'в .bak лежит именно прежнее содержимое');
  assert.equal(res.changes.find((c) => c.client === 'codex').backup, null, 'файла не было — резервировать нечего');
});

test('идемпотентность: второй прогон не делает ни одного изменения', () => {
  const repoRoot = repoFixture(SKILL_V5);
  const home = clientHome({ bodies: { claude: SKILL_V4, codex: SKILL_V4, gemini: SKILL_V4 } });
  assert.equal(syncClientSurfaces({ home, repoRoot }).changes.length, 3);
  assert.deepEqual(syncClientSurfaces({ home, repoRoot }).changes, []);
});

test('починка ничего не удаляет — ни чужие скилы рядом, ни снятую развёртку', () => {
  const repoRoot = repoFixture(SKILL_V5);
  const home = clientHome({ bodies: { claude: SKILL_V4, codex: SKILL_V4, gemini: SKILL_V4 }, legacy: true });
  const foreign = path.join(home, '.claude', 'skills', 'чужой-скил', 'SKILL.md');
  fs.mkdirSync(path.dirname(foreign), { recursive: true });
  fs.writeFileSync(foreign, 'не наш\n');

  syncClientSurfaces({ home, repoRoot });
  assert.equal(fs.readFileSync(foreign, 'utf8'), 'не наш\n', 'чужой скил не тронут');
  assert.ok(fs.existsSync(path.join(home, '.claude', 'bin', 'elt.js')),
    'снятую развёртку не удаляем: спека запрещает удалять то, чей источник неизвестен');
});
