// 011/T019, живой прогон 01.08: approval, выданный в основном дереве, был `stale` в
// fleet-worktree — core.autocrlf=true отдаёт на checkout CRLF, а хеш считался от байтов.
// Следствие: fleet на Windows не мог закоммитить ни один слайс спеки с specApproval:true.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ELT = path.join(__dirname, 'elt.js');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function specRepo(eol) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-eol-'));
  const dir = path.join(root, 'specs', '011-x');
  fs.mkdirSync(dir, { recursive: true });
  // 018 T003: подпись — это коммит, поэтому фикстуре нужен настоящий репозиторий.
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  const write = (name, text) => fs.writeFileSync(path.join(dir, name), text.replace(/\n/g, eol));
  write('spec.md', ['# спека', '## Проблема', 'п', '## Решения', 'р', '## User stories', 'u',
    '## Критерии приёмки', '- **AC1.** критерий', '## Риски', 'риск', '## Вне scope', 'вне', ''].join('\n'));
  write('tasks.md', '- [ ] **T019** слайс [files: a.js]\n');
  return { root, dir };
}

// `spec status` возвращает nonzero на stale — это его контракт, читаем stdout в обоих случаях.
function status(root, dir) {
  try {
    return JSON.parse(execFileSync('node', [ELT, 'spec', 'status', '--spec', dir], { cwd: root, encoding: 'utf8' }));
  } catch (e) { return JSON.parse(e.stdout); }
}

test('approval переживает смену перевода строк: LF-подпись валидна на CRLF-чекауте', () => {
  const lf = specRepo('\n');
  execFileSync('node', [ELT, 'spec', 'approve', '--spec', lf.dir], { cwd: lf.root, encoding: 'utf8' });
  assert.equal(status(lf.root, lf.dir).status, 'approved');
  const signature = git(lf.root, ['log', '-1', '--format=%B']);

  // тот же контент, каким его отдаёт checkout при core.autocrlf=true — байты другие
  const crlf = specRepo('\r\n');
  git(crlf.root, ['add', '-A']);
  git(crlf.root, ['commit', '-qm', 'spec']);
  git(crlf.root, ['commit', '--allow-empty', '-m', signature]);
  assert.equal(status(crlf.root, crlf.dir).status, 'approved', 'CRLF-чекаут не должен делать approval stale');

  for (const r of [lf.root, crlf.root]) fs.rmSync(r, { recursive: true, force: true });
});

test('правка ПО СУЩЕСТВУ по-прежнему делает approval stale', () => {
  const { root, dir } = specRepo('\n');
  execFileSync('node', [ELT, 'spec', 'approve', '--spec', dir], { cwd: root, encoding: 'utf8' });
  fs.appendFileSync(path.join(dir, 'tasks.md'), '- [ ] **T020** новый слайс\n');
  assert.equal(status(root, dir).status, 'stale');
  fs.rmSync(root, { recursive: true, force: true });
});

// 018 T001: корень D7/D11. `elt commit` правит в tasks.md ровно один символ — галочку
// закрытой задачи — и этим делал подпись невалидной для СЛЕДУЮЩЕГО слайса: на спеке из
// 9 задач 8 лишних переутверждений, каждое после полного прогона оракула впустую.
test('018 T001: закрытие задачи ([ ] -> [X]) НЕ делает подпись stale', () => {
  const { root, dir } = specRepo('\n');
  const tasks = path.join(dir, 'tasks.md');
  fs.writeFileSync(tasks, '- [ ] **T019** слайс [files: a.js]\n- [ ] **T020** второй [files: b.js]\n');
  execFileSync('node', [ELT, 'spec', 'approve', '--spec', dir], { cwd: root, encoding: 'utf8' });
  assert.equal(status(root, dir).status, 'approved');

  fs.writeFileSync(tasks, '- [X] **T019** слайс [files: a.js]\n- [ ] **T020** второй [files: b.js]\n');
  assert.equal(status(root, dir).status, 'approved', 'первая закрытая задача не должна ронять подпись');

  fs.writeFileSync(tasks, '- [X] **T019** слайс [files: a.js]\n- [x] **T020** второй [files: b.js]\n');
  assert.equal(status(root, dir).status, 'approved', 'строчная [x] нормализуется так же, как [X]');

  fs.rmSync(root, { recursive: true, force: true });
});

// Обратная сторона той же монеты: нормализация не должна ослепить подпись к сути плана.
test('018 T001: изменение ТЕКСТА задачи по-прежнему делает подпись stale', () => {
  const { root, dir } = specRepo('\n');
  const tasks = path.join(dir, 'tasks.md');
  fs.writeFileSync(tasks, '- [ ] **T019** слайс [files: a.js]\n');
  execFileSync('node', [ELT, 'spec', 'approve', '--spec', dir], { cwd: root, encoding: 'utf8' });

  fs.writeFileSync(tasks, '- [X] **T019** слайс [files: b.js]\n');
  assert.equal(status(root, dir).status, 'stale', 'смена зоны задачи обязана ломать подпись, даже под галочкой');

  fs.rmSync(root, { recursive: true, force: true });
});
