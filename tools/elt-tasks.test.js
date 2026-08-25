'use strict';
// 020 T023 — полный текст задачи доезжает до гейта.
//
// Дефект, который здесь закреплён, был найден живьём при закрытии T012 и записан в
// `.elt/ledger.jsonl` как `task-text-truncated-to-first-line`: `parseTasksFile` клал в задачу
// ТОЛЬКО строку с маркером, поэтому `[files: …]` со строки-продолжения терялся. Следствие
// измеримое — `judge-desc.json` слайса T012 нёс одну строку:
//
//   taskText: "T012 Чиста установка і client parity: додати versioned plugin hooks для"
//
// Без `[files:]` scope-триггер L0 молчит, и слайс из 12 файлов (шесть вне объявленной зоны)
// получил `l0-clean` — судью не позвали вовсе. Планы 019 и 020 состоят из многострочных
// задач целиком, то есть триггер не работал ни разу за оба плана.
//
// Проверяется СКВОЗНОЙ путь (`elt judge run` → дескриптор судьи), а не только разбор: сломан
// был именно он, а разбор блока сам по себе существовал с T016 и был зелёным.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const ELT = path.join(__dirname, 'elt.js');
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
const roots = [];

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const run = (root, args) => spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8' });

// Мост-судья, который ничего не судит: он нужен лишь чтобы `elt judge run` дошёл до записи
// дескриптора. Сам дескриптор тест и читает — в нём вся проверяемая величина.
const STUB_BRIDGE = [
  "'use strict';",
  "const fs = require('fs');",
  "JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));",
  "process.stdout.write(JSON.stringify({ runOk: true, verdict: 'pass', reasons: ['stub'], judges: [], grounding: {} }));",
].join('\n');

// План из двух многострочных задач подряд: так проверяется и то, что блок первой ЗАКАНЧИВАЕТСЯ
// на второй, а не съедает её.
const TASKS = [
  '- [ ] **T001** Первая задача: заголовок в одну строку,',
  '  а тут продолжение с деталями, ради которых задача и написана.',
  '  [files: tools/a.js tools/b.js]',
  '',
  '- [ ] **T002** Вторая задача целиком в одной строке',
  '  [files: tools/c.js]',
  '',
].join('\n');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-tasks-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL,
    judge: { enabled: true, model: 'codex' }, redProof: 'off',
  }));
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), TASKS);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# fixture\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  fs.writeFileSync(path.join(root, 'slice.txt'), 'работа\n');

  const bridge = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'elt-tasks-bridge-')), 'stub.js');
  fs.writeFileSync(bridge, STUB_BRIDGE);
  // `judge run` отказывает без свежего оракул-пруфа — тот же порядок, что в живой цепочке
  // гейта. Мост выше лежит ВНЕ дерева: файл внутри сдвинул бы treeHash и сделал пруф stale.
  const oracle = run(root, ['oracle']);
  assert.equal(oracle.status, 0, oracle.stderr);
  return { root, bridge };
}

// Дескриптор судьи — единственное место, где видно, ЧТО именно уехало судье и в L0.
function descriptorOf(root) {
  const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], { cwd: root, encoding: 'utf8' }).trim();
  const full = path.isAbsolute(gitDir) ? gitDir : path.join(root, gitDir);
  return JSON.parse(fs.readFileSync(path.join(full, 'elt', 'judge-desc.json'), 'utf8'));
}

after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

test('judge run: судье уезжает ВЕСЬ блок задачи, включая [files:] со строки-продолжения', () => {
  const { root, bridge } = fixture();
  const r = run(root, ['judge', 'run', '--task', 'T001', '--invoke', bridge]);
  assert.equal(r.status, 0, r.stderr);

  const desc = descriptorOf(root);
  assert.match(desc.taskText, /Первая задача/, 'заголовок на месте');
  assert.match(desc.taskText, /продолжение с деталями/, 'строка-продолжение на месте — ровно её и теряли');
  assert.match(desc.taskText, /\[files: tools\/a\.js tools\/b\.js\]/, '[files:] доехал');
});

test('judge run: блок задачи заканчивается на следующей задаче, а не съедает её', () => {
  const { root, bridge } = fixture();
  run(root, ['judge', 'run', '--task', 'T001', '--invoke', bridge]);
  const desc = descriptorOf(root);
  assert.doesNotMatch(desc.taskText, /Вторая задача/, 'чужая задача в блок не попадает');
  assert.doesNotMatch(desc.taskText, /tools\/c\.js/, 'и её зона тоже — иначе scope-триггер разрешал бы лишнее');
});

test('judge run: батч склеивает блоки обеих задач, а не их заголовки', () => {
  const { root, bridge } = fixture();
  const r = run(root, ['judge', 'run', '--task', 'T001,T002', '--invoke', bridge]);
  assert.equal(r.status, 0, r.stderr);
  const desc = descriptorOf(root);
  assert.match(desc.taskText, /продолжение с деталями/);
  assert.match(desc.taskText, /tools\/a\.js tools\/b\.js/);
  assert.match(desc.taskText, /tools\/c\.js/, 'зона второй задачи батча тоже объявлена');
});

// Второй текст задачи никуда не делся: человеку по-прежнему показывается ЗАГОЛОВОК. Если
// сюда приедет весь блок, `slice next` и `status` станут нечитаемыми простынями.
test('slice next: человеку показывается заголовок, а не весь блок', () => {
  const { root } = fixture();
  const r = run(root, ['slice', 'next', '--json', '--count', '2']);
  assert.equal(r.status, 0, r.stderr);
  const picks = JSON.parse(r.stdout);
  assert.equal(picks.length, 2);
  assert.match(picks[0].text, /Первая задача/);
  assert.doesNotMatch(picks[0].text, /продолжение с деталями/, 'вывод человеку остался однострочным');
  assert.doesNotMatch(picks[0].text, /\[files:/);
});

test('commit: сообщение коммита строится из заголовка, а не из блока', () => {
  const { root, bridge } = fixture();
  run(root, ['judge', 'run', '--task', 'T001', '--invoke', bridge]);
  const r = run(root, ['commit', '--task', 'T001', '--skip-oracle']);
  assert.equal(r.status, 0, r.stderr);

  const subject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: root, encoding: 'utf8' }).trim();
  assert.ok(!subject.includes('\n'), 'заголовок коммита однострочный');
  assert.ok(!subject.includes('[files:'), 'зона задачи в тему коммита не протекает');
  assert.ok(subject.length <= 120, `тема коммита ${subject.length} символов — блок бы её разорвал`);
});

test('задача без строк-продолжения: блок равен заголовку, поведение прежнее', () => {
  const { root, bridge } = fixture();
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'),
    '- [ ] **T001** Однострочная задача без зоны\n');
  // План переписан — прежний оракул-пруф относится к другому дереву. Без повторного прогона
  // `judge run` отказал бы на `missing oracle proof`, а дескриптор всё равно оказался бы на
  // диске (он пишется раньше проверки), и тест был бы зелёным, ничего не доказав.
  const oracle = run(root, ['oracle']);
  assert.equal(oracle.status, 0, oracle.stderr);
  const r = run(root, ['judge', 'run', '--task', 'T001', '--invoke', bridge]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(descriptorOf(root).taskText.trim(), '- [ ] **T001** Однострочная задача без зоны');
});
