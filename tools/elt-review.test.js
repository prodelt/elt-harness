'use strict';
// 011 T005 (AC5) — очередь ревью: печать, закрытие, идемпотентность + видимость в doctor.
//
// Очередь неблокирующая по решению пользователя (R4): её единственная защита от превращения
// в свалку — то, что её ВИДНО. Значит проверяем ровно две вещи: закрытая запись не
// возвращается, и доктор считает открытые честно.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const { checkReviewQueue } = require('./doctor-core');

const ELT = path.join(__dirname, 'elt.js');
const roots = [];
function run(root, args) {
  return spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8' });
}
// Полноценный elt-репозиторий здесь не нужен: `review` читает файл очереди и больше ничего —
// ни оракула, ни судьи, ни git. Это и есть смысл неблокирующей команды.
function fixture(rows) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-review-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  if (rows) fs.writeFileSync(path.join(root, '.harness', 'review-queue.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return root;
}
const row = (task, reason) => ({ task, commit: `sha-${task}`, reason, ts: '2026-07-31T00:00:00.000Z' });
const openRows = (root) => JSON.parse(run(root, ['review', '--json']).stdout);
after(() => { for (const r of roots) try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* windows lock */ } });

test('review: пустая очередь — не ошибка и не молчание', () => {
  const root = fixture(null);
  const r = run(root, ['review']);
  assert.equal(r.status, 0, 'отсутствие очереди не стопорит работу');
  assert.match(r.stdout, /пуста/);
  assert.deepEqual(openRows(root), []);
});

test('review: печатает открытые записи; --json машиночитаем', () => {
  const root = fixture([row('T001', 'ctx7 недоступен'), row('T002', 'дифф обрезан по сути')]);
  const r = run(root, ['review']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /T001/);
  assert.match(r.stdout, /ctx7 недоступен/, 'причина видна человеку, а не только id');
  assert.match(r.stdout, /T002/);
  const json = openRows(root);
  assert.deepEqual(json.map((x) => x.task), ['T001', 'T002']);
  assert.equal(json[0].commit, 'sha-T001', 'коммит в машинном выводе — по нему и смотрят дифф');
});

test('review close: закрытая запись не возвращается, остальные остаются', () => {
  const root = fixture([row('T001', 'а'), row('T002', 'б')]);
  const c = run(root, ['review', 'close', '--task', 'T001']);
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /закрыто 1/);
  assert.deepEqual(openRows(root).map((x) => x.task), ['T002'], 'закрыта ровно названная');
  // Запись не удалена, а помечена — история разбора остаётся пруфом.
  const all = fs.readFileSync(path.join(root, '.harness', 'review-queue.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(all.length, 2);
  assert.ok(all.find((x) => x.task === 'T001').closedAt, 'у закрытой проставлена метка времени');
});

// 020 T008 НАМЕРЕННО перевернул этот контракт. Живьём: `elt review close --task T018` из
// worktree вернул exit 0, закрыв НОЛЬ строк (очередь физически лежала в другом чекауте), и
// промолчал — человек считал находку разобранной, а она осталась открытой. Ноль закрытых —
// отказ; идемпотентность остаётся, но объявленной (`--allow-empty`), а не подразумеваемой.
test('review close: ноль закрытых — громкий отказ, а не тихий exit 0', () => {
  const root = fixture([row('T001', 'а')]);
  assert.equal(run(root, ['review', 'close', '--task', 'T001']).status, 0);
  const second = run(root, ['review', 'close', '--task', 'T001']);
  assert.equal(second.status, 5, 'повтор без явного разрешения — отказ');
  assert.match(second.stderr, /закрыто 0 строк/);
  assert.match(second.stderr, /review-queue\.jsonl/, 'в отказе имя файла очереди: половина дефекта была в том, ЧТО очередь не та');
  const third = run(root, ['review', 'close', '--task', 'T001', '--allow-empty']);
  assert.equal(third.status, 0, '--allow-empty возвращает идемпотентность тем, кто её просит явно');
  assert.deepEqual(openRows(root), []);
});

test('review close: отсутствующая задача — отказ (fail-open стоил закрытия T016/T018)', () => {
  const root = fixture([row('T001', 'а')]);
  const r = run(root, ['review', 'close', '--task', 'T999']);
  assert.equal(r.status, 5);
  assert.deepEqual(openRows(root).map((x) => x.task), ['T001'], 'ничего не тронуто');
});

// --- 020 T008: identity строки очереди = (specPath, task) --------------------------------

const SPEC_A = 'specs/019-two-a';
const SPEC_B = 'specs/020-two-b';
const specRow = (task, specPath, reason) => ({ ...row(task, reason), specPath: specPath ? `${specPath}/tasks.md` : null });
function withSpecs(root) {
  for (const [dir, body] of [[SPEC_A, '- [ ] **T020** A\n'], [SPEC_B, '- [ ] **T020** B\n- [ ] **T031** B\n']]) {
    fs.mkdirSync(path.join(root, ...dir.split('/')), { recursive: true });
    fs.writeFileSync(path.join(root, ...dir.split('/'), 'tasks.md'), body);
  }
  return root;
}

test('review close --spec: закрывается ровно названная спека, одноимённая чужая цела', () => {
  const root = fixture([specRow('T020', SPEC_A, 'находка A'), specRow('T020', SPEC_B, 'находка B')]);
  const c = run(root, ['review', 'close', '--task', 'T020', '--spec', SPEC_A]);
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /закрыто 1/);
  const open = openRows(root);
  assert.deepEqual(open.map((x) => x.specPath), [`${SPEC_B}/tasks.md`], 'находка другой спеки не закрывается заодно');
});

test('review close без --spec: одинаковый id в двух спеках — отказ, а не «закроем всё похожее»', () => {
  const root = fixture([specRow('T020', SPEC_A, 'A'), specRow('T020', SPEC_B, 'B')]);
  const r = run(root, ['review', 'close', '--task', 'T020']);
  assert.equal(r.status, 5);
  assert.match(r.stderr, /--spec/);
  assert.equal(openRows(root).length, 2, 'обе строки на месте');
});

test('review: legacy-строка без спеки резолвится только однозначно; иначе нужен --adopt-legacy', () => {
  const root = withSpecs(fixture([row('T020', 'legacy находка'), row('T031', 'legacy уникальная')]));
  const shown = openRows(root);
  assert.equal(shown.find((x) => x.task === 'T031').specPath, `${SPEC_B}/tasks.md`, 'уникальный id мигрируется');
  assert.equal(shown.find((x) => x.task === 'T020').legacy, true, 'неоднозначный — честно legacy, без догадки');

  // Неоднозначная legacy-строка не прилипает к спеке молча…
  assert.equal(run(root, ['review', 'close', '--task', 'T020', '--spec', SPEC_A]).status, 5);
  // …но человек может назначить её явно, и тогда identity записывается в файл.
  const adopt = run(root, ['review', 'close', '--task', 'T020', '--spec', SPEC_A, '--adopt-legacy']);
  assert.equal(adopt.status, 0, adopt.stderr);
  const all = fs.readFileSync(path.join(root, '.harness', 'review-queue.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const closed = all.find((x) => x.task === 'T020');
  assert.equal(closed.specPath, `${SPEC_A}/tasks.md`, 'решение человека фиксируется, а не остаётся в голове');
  assert.ok(closed.closedAt);
});

test('review close: батч-запись закрывается по любой из своих задач', () => {
  const root = fixture([row('T001,T002', 'батч')]);
  assert.match(run(root, ['review', 'close', '--task', 'T002']).stdout, /закрыто 1/);
  assert.deepEqual(openRows(root), [], 'батч не остаётся вечно открытым из-за составного id');
});

test('review close: без --task — явный отказ, а не тихое закрытие всего', () => {
  const root = fixture([row('T001', 'а')]);
  const r = run(root, ['review', 'close']);
  assert.equal(r.status, 4);
  assert.deepEqual(openRows(root).map((x) => x.task), ['T001'], 'ничего не тронуто');
});

// --- 014 T007 (AC5): красный фон → задача в ту же очередь, не блок ------------------

const { enqueueBgRed, runBackgroundVerify } = require('./elt-verify-bg');

// Минимальный git-репозиторий: `runBackgroundVerify` делает `worktree add --detach <hash>`,
// поэтому нужен реальный коммит. Дубль хелпера из elt-verify-bg.test.js осознан: [files:]
// слайса T007 не включает тот файл, а общий фикстур-модуль ради 8 строк — лишняя сущность.
function bgRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-review-bg-'));
  roots.push(root);
  for (const a of [['init', '-q'], ['config', 'user.email', 't@t'], ['config', 'user.name', 't']]) {
    spawnSync('git', a, { cwd: root });
  }
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  // 016 T005: фон исполняет команду ШЕЛЛОМ проекта, поэтому фикстуре нужен `shell` — без поля
  // сработал бы дефолт `bash`, а на Windows это WSL: `node -e "…"` ушёл бы в чужую ОС.
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'),
    JSON.stringify({ shell: process.platform === 'win32' ? 'powershell' : 'bash' }));
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['commit', '-qm', 'seed'], { cwd: root });
  const hash = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  return { root, hash };
}

test('bg-red: пишется от каждого слоя и виден в review как задача, а не блок', () => {
  const root = fixture(null);
  for (const layer of ['suite', 'mutate', 'smoke', 'judge']) {
    enqueueBgRed(root, { task: 'T007', commit: 'sha1', layer, reason: `${layer} упал`, logPath: `.harness/loop-logs/bg-sha1.log` });
  }
  const open = openRows(root);
  assert.deepEqual(open.map((x) => x.layer), ['suite', 'mutate', 'smoke', 'judge'], 'все четыре слоя доходят');
  assert.ok(open.every((x) => x.kind === 'bg-red'), 'помечены kind — отличимы от inconclusive');
  const printed = run(root, ['review']).stdout;
  assert.match(printed, /bg-red\/mutate/, 'слой виден человеку, иначе строку нечем разбирать');
  assert.match(printed, /bg-sha1\.log/, 'путь к логу — единственный вход в причину красного');
});

test('bg-red: закрытая запись не возвращается (тот же механизм, что у inconclusive)', () => {
  const root = fixture([row('T001', 'inconclusive-строка')]);
  enqueueBgRed(root, { task: 'T007', commit: 'sha1', layer: 'suite', reason: 'suite упал', logPath: 'x.log' });
  assert.equal(run(root, ['review', 'close', '--task', 'T007']).status, 0);
  assert.deepEqual(openRows(root).map((x) => x.task), ['T001'], 'закрыта ровно bg-red, соседняя цела');
});

test('bg-red: красный фоновый прогон сам ставит запись; зелёный не ставит ничего', async () => {
  // 020 T007 изменил контракт НАМЕРЕННО. Фикстура не задаёт `background.layers`, значит
  // включены все четыре слоя, и слой судьи на корневом коммите не может отработать
  // (`reset --soft HEAD~1` не резолвится) — раньше это была ТИШИНА и прогон считался
  // зелёным, теперь у неконклюзивного судьи своя строка `bg-dead`. Поэтому красный прогон
  // даёт две строки: реальное красное сьюта и «не смогли проверить» судьи.
  const red = bgRepo();
  await runBackgroundVerify({ cwd: red.root, commitHash: red.hash, taskId: 'T007', oracleCmd: 'node -e "process.exit(1)"' });
  const open = openRows(red.root);
  const suite = open.filter((r) => r.layer === 'suite');
  assert.equal(suite.length, 1, 'красный сьют — ровно одна строка');
  assert.equal(suite[0].kind, 'bg-red');
  assert.equal(suite[0].commit, red.hash, 'в строке настоящий хеш — по нему и смотрят дифф');
  assert.deepEqual(open.filter((r) => r.layer === 'judge').map((r) => r.kind), ['bg-dead'],
    'судья, который не смог заключить, больше не молчит');

  // Зелёный проверяется на конфиге БЕЗ судьи: иначе «зелёный» означал бы «судья промолчал»,
  // то есть ровно тот fail-open, который T007 и закрывает.
  const green = bgRepo();
  const cfg = path.join(green.root, '.harness', 'harness.json');
  fs.writeFileSync(cfg, JSON.stringify({
    ...JSON.parse(fs.readFileSync(cfg, 'utf8')), background: { layers: ['suite'] },
  }));
  spawnSync('git', ['add', '-A'], { cwd: green.root });
  spawnSync('git', ['commit', '-qm', 'suite-only'], { cwd: green.root });
  const gh = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: green.root, encoding: 'utf8' }).stdout.trim();
  const r = await runBackgroundVerify({ cwd: green.root, commitHash: gh, taskId: 'T007', oracleCmd: 'node -e "process.exit(0)"' });
  assert.equal(r.status, 'background-verify-pass');
  assert.deepEqual(openRows(green.root), [], 'зелёный фон очередь не засоряет');
});

test('doctor: длина очереди видна; превышение порога — WARN, но не FAIL', () => {
  assert.deepEqual(checkReviewQueue(fixture(null)), [], 'нет очереди — доктор молчит, а не ругается');

  const small = checkReviewQueue(fixture([row('T001', 'а'), row('T002', 'б')]));
  assert.equal(small.length, 1);
  assert.equal(small[0].status, 'pass');
  assert.equal(small[0].data.open, 2, 'длина считается, а не «есть/нет»');

  const many = Array.from({ length: 11 }, (_, i) => row(`T${100 + i}`, 'много'));
  const big = checkReviewQueue(fixture(many));
  assert.equal(big[0].status, 'warn', 'накопление видно');
  assert.notEqual(big[0].status, 'fail', 'но работу не стопорит — очередь неблокирующая (R4)');

  // Закрытые в длину не входят — иначе WARN застревал бы навсегда после первого же разбора.
  const closed = many.map((r) => ({ ...r, closedAt: '2026-07-31T01:00:00.000Z' }));
  assert.equal(checkReviewQueue(fixture(closed))[0].data.open, 0);
});
