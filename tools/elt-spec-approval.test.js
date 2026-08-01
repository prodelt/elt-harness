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

function specRepo(eol) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-eol-'));
  const dir = path.join(root, 'specs', '011-x');
  fs.mkdirSync(dir, { recursive: true });
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
  const approval = fs.readFileSync(path.join(lf.dir, 'approval.json'), 'utf8');
  assert.equal(status(lf.root, lf.dir).status, 'approved');

  // тот же контент, каким его отдаёт checkout при core.autocrlf=true — байты другие
  const crlf = specRepo('\r\n');
  fs.writeFileSync(path.join(crlf.dir, 'approval.json'), approval);
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
