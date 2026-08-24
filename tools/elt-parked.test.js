'use strict';
// 009 T004 — парковка вместо смерти прогона. PS-логику драйвера не тестируем (проверена
// DryRun-прогоном); тестируем контракт, на который драйвер опирается:
//   1. формат .harness/parked.json ({tid, reason, ts, logPath, attempts}) и рост attempts;
//   2. `slice next` пропускает припаркованное (иначе петля крутит тот же павший слайс);
//   3. `elt status` показывает секцию parked;
//   4. закрытие задачи (commit / --clear) снимает парковку, в т.ч. по одному id из батча.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const ELT = path.join(__dirname, 'elt.js');
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
const roots = [];

function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
function run(root, args) { return spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8' }); }
function parked(root) {
  const f = path.join(root, '.harness', 'parked.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-parked-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL, branchPolicy: 'feature', judge: { enabled: true, model: 'sonnet' },
  }));
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'),
    '- [ ] **T001** первая\n- [ ] **T002** вторая\n- [ ] **T003** третья\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  git(root, ['checkout', '-qb', 'work']);
  return root;
}

test('park: формат записи и рост attempts при повторной парковке', () => {
  const root = fixture();
  const p = run(root, ['park', '--task', 'T001', '--reason', 'judge-block', '--log', 'x.log']);
  assert.equal(p.status, 0, p.stderr);
  let list = parked(root);
  assert.equal(list.length, 1);
  // 020 T008 расширил схему записи на `specPath` (identity парковки = спека + id); остальное
  // поле в поле — контракт 009 T004. Spec-bound регрессы живут в elt-park.test.js.
  assert.deepEqual(Object.keys(list[0]).sort(), ['attempts', 'logPath', 'reason', 'specPath', 'tid', 'ts']);
  assert.equal(list[0].tid, 'T001');
  assert.equal(list[0].reason, 'judge-block');
  assert.equal(list[0].attempts, 1);

  run(root, ['park', '--task', 'T001', '--reason', 'red-stop', '--log', 'y.log']);
  list = parked(root);
  assert.equal(list.length, 1, 'повтор той же задачи не должен плодить записи');
  assert.equal(list[0].attempts, 2);
  assert.equal(list[0].reason, 'red-stop', 'причина — последняя');

  // парковка — состояние прогона: git не должен утащить её в коммит следующего слайса,
  // и сама парковка не смеет оставлять НИ ОДНОГО файла в дереве — драйвер отличает
  // «имплементатор ничего не сделал» по пустому `git status --porcelain`.
  assert.equal(spawnSync('git', ['check-ignore', '.harness/parked.json'], { cwd: root }).status, 0,
    'parked.json обязан игнорироваться git (иначе commit --task утащит его в слайс)');
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.trim(), '',
    'после парковки дерево обязано остаться чистым');

  // след в run-log: парковка обязана быть видна в истории прогона, не только в файле
  const log = fs.readFileSync(path.join(root, '.git', 'elt', 'run-log.jsonl'), 'utf8').trim().split('\n').pop();
  assert.equal(JSON.parse(log).status, 'parked');

  // --reason обязателен: молчаливая парковка без причины бесполезна
  assert.equal(run(root, ['park', '--task', 'T002']).status, 4);
});

test('slice next пропускает припаркованное, status его показывает', () => {
  const root = fixture();
  run(root, ['park', '--task', 'T001', '--reason', 'red-stop']);
  const next = JSON.parse(run(root, ['slice', 'next', '--json']).stdout);
  assert.equal(next.id, 'T002', 'петля обязана взять следующий слайс, а не павший');
  assert.deepEqual(JSON.parse(run(root, ['slice', 'next', '--json', '--count', '3']).stdout).map((x) => x.id), ['T002', 'T003']);

  const st = JSON.parse(run(root, ['status']).stdout);
  assert.equal(st.parked.length, 1);
  assert.equal(st.parked[0].tid, 'T001');
  assert.equal(st.plan.open, 3, 'парковка не закрывает задачу — она остаётся [ ] в плане');

  // весь остаток плана припаркован → slice next честно говорит «нечего брать» (exit 3),
  // а не отдаёт припаркованную задачу по кругу
  run(root, ['park', '--task', 'T002', '--reason', 'red-stop']);
  run(root, ['park', '--task', 'T003', '--reason', 'red-stop']);
  assert.equal(run(root, ['slice', 'next', '--json']).status, 3);
});

test('откат+парковка: stash не уносит parked.json, петля идёт дальше', () => {
  // Воспроизводим связку Park-Slice из PowerShell-драйвер (снят 019/T007) (шаги те же, без PS): откат stash -u,
  // затем запись парковки. Сними игнор parked.json — и на втором павшем слайсе прогона
  // stash -u утащит парковку первого, петля возьмёт тот же павший слайс по кругу.
  const root = fixture();
  const stash = (ids) => git(root, ['stash', 'push', '-u', '-m', `elt-park ${ids}`]);

  fs.writeFileSync(path.join(root, 'seed.txt'), 'работа павшего слайса\n');
  fs.writeFileSync(path.join(root, 'new.txt'), 'untracked работа\n');
  stash('T001');
  run(root, ['park', '--task', 'T001', '--reason', 'red-stop']);
  assert.equal(fs.readFileSync(path.join(root, 'seed.txt'), 'utf8').trim(), 'seed', 'дерево обязано откатиться');
  assert.ok(!fs.existsSync(path.join(root, 'new.txt')));
  assert.equal(parked(root).length, 1, 'парковка обязана пережить stash -u');

  // второй павший слайс того же прогона: парковка первого уже лежит в дереве
  fs.writeFileSync(path.join(root, 'seed.txt'), 'работа второго павшего\n');
  stash('T002');
  run(root, ['park', '--task', 'T002', '--reason', 'judge-block']);
  assert.deepEqual(parked(root).map((e) => e.tid), ['T001', 'T002']);
  assert.equal(JSON.parse(run(root, ['slice', 'next', '--json']).stdout).id, 'T003', 'петля берёт третий слайс');
});

test('парковка снимается: --clear и успешный commit (в т.ч. по одному id из батча)', () => {
  const root = fixture();
  run(root, ['park', '--task', 'T001', '--reason', 'judge-dead']);
  assert.equal(run(root, ['park', '--clear', '--task', 'T001']).status, 0);
  assert.equal(parked(root).length, 0);
  assert.ok(!fs.existsSync(path.join(root, '.harness', 'parked.json')), 'пустая парковка = нет файла');
  assert.equal(JSON.parse(run(root, ['slice', 'next', '--json']).stdout).id, 'T001');

  // батч "T001,T002" припаркован, потом T001 закрывается коммитом → запись снимается целиком
  run(root, ['park', '--task', 'T001,T002', '--reason', 'red-stop']);
  fs.writeFileSync(path.join(root, 'slice.txt'), 'work\n');
  assert.equal(run(root, ['oracle']).status, 0);
  assert.equal(run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'sonnet']).status, 0);
  const c = run(root, ['commit', '--task', 'T001', '--skip-oracle', '-m', 'feat: T001']);
  assert.equal(c.status, 0, c.stderr);
  assert.equal(parked(root).length, 0, 'закрытая задача не может оставаться припаркованной');
});

// 019 T007: четыре теста, гонявшие сам PowerShell-драйвер (живой Park-Slice, полный прогон
// с красным оракулом, «провал гейта = park + continue», BOM-инвариант), сняты вместе с ним.
// Осталось ровно то, ради чего они и писались, — КОНТРАКТ парковки: формат parked.json, рост
// attempts, пропуск припаркованного в `slice next`, снятие парковки коммитом. Контракт не
// зависит от того, кто крутит петлю, и переживает переезд писателя в T012.

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
