'use strict';
// Коллизия id между спеками: T005 открыт и в 008, и в 009. Без `--spec` побеждала первая
// спека по алфавиту — судья получал ЧУЖУЮ рубрику (гарантированный block), а `elt commit`
// поставил бы `[X]` в чужой план. Проверяем, что задачные команды уважают --spec.

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

test('--spec выбирает спеку задачи, а не первую по алфавиту', () => {
  const root = fixture();
  // Мост-заглушка: судью не спавним, нам нужен только дескриптор, который judge run
  // пишет ДО вызова моста — в нём и видно, к какой спеке привязалась задача.
  const stub = path.join(root, 'stub-invoke.js');
  fs.writeFileSync(stub, 'process.exit(0);\n');
  const specOf = (extra) => {
    run(root, ['judge', 'run', '--task', 'T005', '--invoke', stub, ...extra]);
    return JSON.parse(fs.readFileSync(path.join(root, '.git', 'elt', 'judge-desc.json'), 'utf8')).specFile;
  };
  assert.match(specOf([]), /008-old/, 'без --spec побеждает первая спека по алфавиту — та самая ловушка');
  assert.match(specOf(['--spec', 'specs/009-new']), /009-new/, '--spec обязан выбрать спеку задачи');
  // Задача, которой в указанной спеке нет, не подхватывается из соседней
  assert.equal(run(root, ['judge', 'run', '--task', 'T005', '--invoke', stub, '--spec', 'specs/010-absent']).status, 4);
});

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
