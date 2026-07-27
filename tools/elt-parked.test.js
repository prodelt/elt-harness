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
  assert.deepEqual(Object.keys(list[0]).sort(), ['attempts', 'logPath', 'reason', 'tid', 'ts']);
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
  // Воспроизводим связку Park-Slice из elt-loop.ps1 (шаги те же, без PS): откат stash -u,
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

test('Park-Slice из драйвера исполняется живьём (PS): откат + парковка + $true', { skip: process.platform !== 'win32' ? 'PowerShell 5.1 только на Windows' : false }, () => {
  // Не текст, а исполнение: вытаскиваем функцию Park-Slice из ps1 как есть и гоняем её
  // настоящим PowerShell против временного репо. Ловит то, что структурная проверка не
  // видит: порядок stash→park, живучесть parked.json после отката, возврат $true.
  const root = fixture();
  const ps1 = fs.readFileSync(path.join(__dirname, 'elt-loop.ps1'), 'utf8');
  const at = ps1.indexOf('function Park-Slice');
  const fn = ps1.slice(at, ps1.indexOf('Push-Location $Project', at));
  assert.ok(fn.includes('git stash push'), 'Park-Slice не найдена в драйвере');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'работа павшего слайса\n');
  // Скрипт-зонд — ВНЕ репо: `stash -u` внутри Park-Slice унёс бы исполняемый файл.
  const script = path.join(os.tmpdir(), `park-slice.probe.${process.pid}.ps1`);
  // BOM обязателен и здесь: PS 5.1 без него читает кириллицу зонда как ANSI и не парсит.
  // Путь к CLI — в ОДИНАРНЫХ кавычках PS (в двойных `\` пришлось бы экранировать).
  fs.writeFileSync(script, `﻿$eltCli = '${ELT.replace(/'/g, "''")}'\n${fn}\nif (Park-Slice -Ids 'T001' -Reason 'judge-block' -LogPath 'x.log') { exit 0 } else { exit 9 }\n`, 'utf8');
  const r = spawnSync('powershell', ['-NoProfile', '-File', script], { cwd: root, encoding: 'utf8' });
  fs.rmSync(script);
  assert.equal(r.status, 0, `Park-Slice вернула не $true: ${r.stdout}${r.stderr}`);
  assert.equal(fs.readFileSync(path.join(root, 'seed.txt'), 'utf8').trim(), 'seed', 'дерево обязано откатиться');
  assert.equal(parked(root).length, 1, 'парковка обязана пережить откат');
  assert.equal(JSON.parse(run(root, ['slice', 'next', '--json']).stdout).id, 'T002', 'петля берёт следующий слайс');
});

test('полный прогон драйвера: красный оракул паркует и ИДЁТ ДАЛЬШЕ, итог exit 1', { skip: process.platform !== 'win32' ? 'PowerShell 5.1 только на Windows' : false }, () => {
  // Исполняемое доказательство самого слайса: гоняем elt-loop.ps1 целиком против репо с
  // заведомо красным оракулом. Раньше первый же красный убивал прогон (`break`) — теперь
  // петля обязана припарковать T001, взять T002, припарковать и его, и вернуть exit 1.
  // claude подменён стабом: имплементатор ничего не делает, оракул остаётся красным.
  const root = fixture();
  // Красный оракул — КОММИТОМ, а не правкой в дереве: парковка первого слайса делает
  // `git stash -u`, и незакоммиченная правка harness.json уехала бы вместе с ним.
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(1)"', shell: SHELL, branchPolicy: 'feature', judge: { enabled: true, model: 'sonnet' },
  }));
  git(root, ['commit', '-qam', 'красный оракул']);
  // Стаб — через штатный люк FLEET_BIN_CLAUDE (node-стаб), а НЕ через claude.cmd в PATH:
  // providers.js намеренно резолвит шим в реальный claude.exe (баг #10), так что PATH-подмена
  // молча запустила бы настоящий CLI и повисла на его таймауте.
  const stub = path.join(os.tmpdir(), `elt-claude-stub.${process.pid}.js`);
  fs.writeFileSync(stub, 'process.stdin.resume().on("end", () => { console.log("stub"); process.exit(0); });\n');
  const r = spawnSync('powershell', ['-NoProfile', '-File', path.join(__dirname, 'elt-loop.ps1'),
    '-Project', root, '-Slices', '2', '-Batch', '1'],
  { cwd: root, encoding: 'utf8', env: { ...process.env, FLEET_BIN_CLAUDE: JSON.stringify([process.execPath, stub]) } });
  fs.rmSync(stub, { force: true });
  // Ассерты по состоянию и ASCII: stdout PowerShell приходит в OEM-кодировке, кириллица
  // в нём нечитаема — проверять сообщения драйвера построчно бессмысленно.
  const out = r.stdout + r.stderr;
  assert.deepEqual(parked(root).map((e) => `${e.tid}:${e.reason}`), ['T001:red-stop', 'T002:red-stop'],
    `петля обязана припарковать первый слайс и ВЗЯТЬ следующий, а не умереть на первом:\n${out}`);
  assert.equal(r.status, 1, `непустая парковка обязана давать ненулевой exit:\n${out}`);
  const st = JSON.parse(run(root, ['status']).stdout);
  assert.equal(st.plan.open, 3, 'парковка не закрывает задачи — план остаётся открытым');
  assert.equal(git(root, ['status', '--porcelain', 'seed.txt']), '',
    'дерево павшего слайса обязано откатываться (правки не текут в следующий слайс)');
});

test('драйвер: провал гейта = park + continue, а не break', () => {
  // Структурная проверка вместо запуска PowerShell (тесты обязаны идти и не на Windows,
  // а -DryRun обрывается до гейта). Ловит ровно ту регрессию, ради которой слайс: возврат
  // `break` в любую из четырёх веток провала снова убьёт весь прогон одной задачей.
  const ps = fs.readFileSync(path.join(__dirname, 'elt-loop.ps1'), 'utf8');
  for (const reason of ['red-stop', 'empty-diff', 'judge-dead', 'judge-block']) {
    const at = ps.indexOf(`-Reason "${reason}"`);
    assert.ok(at > 0, `нет ветки парковки для ${reason}`);
    const tail = ps.slice(at, at + 240);
    assert.match(tail, /continue/, `${reason}: петля обязана продолжать (continue), а не break`);
  }
  assert.match(ps, /if \(\$parkedAll\.Count -gt 0\) \{ exit 1 \}/, 'непустая парковка обязана давать ненулевой exit');
});

test('драйвер остаётся читаемым для PS 5.1 (BOM)', () => {
  // Пойман живьём в этом же слайсе: правка elt-loop.ps1 без BOM → PS 5.1 читает файл как
  // ANSI, кириллица в промптах ломает парсер, драйвер падает ДО первого слайса. Оракул
  // ps1 не гоняет, так что это единственное место, где такая регрессия видна.
  const head = fs.readFileSync(path.join(__dirname, 'elt-loop.ps1')).subarray(0, 3);
  assert.deepEqual([...head], [0xef, 0xbb, 0xbf], 'tools/elt-loop.ps1 обязан быть UTF-8 с BOM');
});

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
