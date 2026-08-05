'use strict';
// Коллизия id между спеками: default обязан брать НОВЕЙШИЙ plan; старый доступен только
// через явный --spec. Закрытый новый plan не должен воскрешать незакрытый старый backlog.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const ELT = path.join(__dirname, 'elt.js');
const roots = [];
function run(root, args) { return spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8' }); }

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-collision-'));
  roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: 'bash', branchPolicy: 'feature', judge: { enabled: true, model: 'sonnet' },
  }));
  for (const [dir, line] of [['008-old', '- [ ] **T005** ЧУЖАЯ задача из 008'], ['009-new', '- [ ] **T005** нужная задача из 009']]) {
    fs.mkdirSync(path.join(root, 'specs', dir), { recursive: true });
    fs.writeFileSync(path.join(root, 'specs', dir, 'tasks.md'), line + '\n');
  }
  return root;
}

test('default выбирает новейший plan, а --spec выбирает указанный', () => {
  const root = fixture();
  // Мост-заглушка: судью не спавним, нам нужен только дескриптор, который judge run
  // пишет ДО вызова моста — в нём и видно, к какой спеке привязалась задача.
  const stub = path.join(root, 'stub-invoke.js');
  fs.writeFileSync(stub, 'process.exit(0);\n');
  const specOf = (extra) => {
    run(root, ['judge', 'run', '--task', 'T005', '--invoke', stub, ...extra]);
    return JSON.parse(fs.readFileSync(path.join(root, '.git', 'elt', 'judge-desc.json'), 'utf8')).specFile;
  };
  assert.match(specOf([]), /009-new/, 'без --spec должен побеждать новейший plan');
  assert.match(specOf(['--spec', 'specs/009-new']), /009-new/, '--spec обязан выбрать спеку задачи');
  // Задача, которой в указанной спеке нет, не подхватывается из соседней
  assert.equal(run(root, ['judge', 'run', '--task', 'T005', '--invoke', stub, '--spec', 'specs/010-absent']).status, 4);

  fs.writeFileSync(path.join(root, 'specs', '009-new', 'tasks.md'), '- [X] **T005** shipped\n');
  const status = JSON.parse(run(root, ['status']).stdout);
  assert.match(status.plan.file, /009-new/, 'закрытый новый plan не воскрешает старый backlog');
  assert.equal(status.plan.next, null);
});

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
