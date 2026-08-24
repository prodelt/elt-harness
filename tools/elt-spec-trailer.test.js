// 018 T002: подпись спеки читается из ИСТОРИИ, а не из рабочего дерева.
// D4 (полевой отчёт 15.08, 9 отказов за прогон): страж подписи спеки (снят 019/T007) смотрел файл основного
// дерева, а срез внутри fleet-worktree читал своё состояние — подпись расходилась, и отказ
// прилетал уже ПОСЛЕ воркера, оракула и судьи, когда LLM-бюджет раунда уже сожжён.
// `git log` отдаёт одну и ту же историю обоим деревьям. Второй тест ниже — прямое
// доказательство: один вопрос задаётся из двух деревьев и обязан дать один ответ.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ELT = path.join(__dirname, 'elt.js');
const SPEC_REL = 'specs/018-trailer-fixture';

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr || r.stdout}`);
  return (r.stdout || '').trim();
}

// `spec status` возвращает nonzero на неподписанной спеке — это его контракт, а не сбой:
// JSON читаем из stdout в обоих случаях.
function status(cwd) {
  const r = spawnSync('node', [ELT, 'spec', 'status', '--spec', SPEC_REL], { cwd, encoding: 'utf8' });
  try { return JSON.parse(r.stdout); } catch { throw new Error(`spec status не отдал JSON: ${r.stdout}${r.stderr}`); }
}

function repoWithSpec() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-trailer-'));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'user.name', 'fixture']);
  const dir = path.join(root, 'specs', '018-trailer-fixture');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'spec.md'), [
    '# фикстура', '## Проблема', 'п', '## Решения', 'р', '## User stories', 'u',
    '## Критерии приёмки', '- **AC1.** критерий', '## Риски', 'риск', '## Вне scope', 'вне', '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'tasks.md'), '- [ ] **T001** слайс [files: a.js]\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'фикстура\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-m', 'init']);
  return { root, dir };
}

// Подпись T002 читает, но ещё не пишет (это T003), поэтому трейлер здесь ставим руками —
// так тест проверяет ЧИТАТЕЛЯ независимо от писателя.
function signByTrailer(root, { specHash, tasksHash, specRel = SPEC_REL } = {}) {
  const s = status(root);
  const msg = [
    'chore: approve spec 018-trailer-fixture', '',
    `Spec-Approved: ${specRel}`,
    `Spec-Hash: ${specHash || s.specHash}`,
    `Tasks-Hash: ${tasksHash || s.tasksHash}`,
  ].join('\n');
  git(root, ['commit', '--allow-empty', '-m', msg]);
}

test('018 T002: трейлер в истории подписывает спеку — файла для этого не нужно', () => {
  const { root } = repoWithSpec();
  assert.equal(status(root).status, 'unapproved', 'до подписи статус unapproved');

  signByTrailer(root);
  const after = status(root);
  assert.equal(after.status, 'approved');
  assert.equal(after.source, 'trailer', 'источник истины — история, а не файл');
  assert.equal(fs.existsSync(path.join(root, SPEC_REL, 'approval.json')), false);

  fs.rmSync(root, { recursive: true, force: true });
});

test('018 T002 (D4): worktree на том же коммите видит ТУ ЖЕ подпись, что основное дерево', () => {
  const { root } = repoWithSpec();
  signByTrailer(root);
  assert.equal(status(root).status, 'approved', 'основное дерево');

  // worktree кладём отдельным временным каталогом и снимаем его обычным rm, БЕЗ
  // `git worktree remove --force`: именно эта команда в D2 уносила содержимое сквозь junction.
  const wtBase = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-trailer-wt-'));
  const wtRepo = path.join(wtBase, 'checkout');
  git(root, ['worktree', 'add', '--detach', wtRepo, 'HEAD']);

  assert.equal(status(wtRepo).status, 'approved',
    'worktree обязан дать тот же ответ — это и есть закрытие D4');

  fs.rmSync(wtBase, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test('018 T002: закрытие задачи не роняет подпись, добавление задачи — роняет', () => {
  const { root, dir } = repoWithSpec();
  signByTrailer(root);

  fs.writeFileSync(path.join(dir, 'tasks.md'), '- [X] **T001** слайс [files: a.js]\n');
  assert.equal(status(root).status, 'approved', 'галочка нормализуется — подпись цела (D7/D11)');

  fs.appendFileSync(path.join(dir, 'tasks.md'), '- [ ] **T002** новая задача [files: b.js]\n');
  assert.equal(status(root).status, 'stale', 'новая задача обязана ломать подпись');

  fs.rmSync(root, { recursive: true, force: true });
});

// `--grep` — фильтр по подстроке всего сообщения, а не по трейлеру. Если бы авторитетом был
// он, подпись подделывалась бы обычной строкой в теле коммита.
test('018 T002: упоминание пути в тексте коммита не является подписью', () => {
  const { root } = repoWithSpec();
  const s = status(root);
  git(root, ['commit', '--allow-empty', '-m', [
    'chore: заметка', '',
    `упоминаю Spec-Approved: ${SPEC_REL} прямо внутри строки текста`,
    `Spec-Hash: ${s.specHash}`,
    `Tasks-Hash: ${s.tasksHash}`,
  ].join('\n')]);

  assert.equal(status(root).status, 'unapproved', 'строка в тексте — не трейлер');
  fs.rmSync(root, { recursive: true, force: true });
});

// Находка судьи на срезе T002: построчный разбор признал бы подписью три КОРРЕКТНЫЕ строки,
// стоящие не завершающим блоком, — и подпись подделывалась бы обычным текстом коммита.
// Здесь строки безупречны по форме; отличие только в позиции, и оно обязано решать.
test('018 T002: trailer-подобные строки ВНЕ завершающего блока подписью не считаются', () => {
  const { root } = repoWithSpec();
  const s = status(root);

  // Обычный абзац после «трейлеров» разрывает блок: для git это больше не трейлеры.
  git(root, ['commit', '--allow-empty', '-m', [
    'chore: подделка через тело сообщения', '',
    `Spec-Approved: ${SPEC_REL}`,
    `Spec-Hash: ${s.specHash}`,
    '',
    'а это обычный текст, после которого блок трейлеров уже не завершающий',
    '',
    `Tasks-Hash: ${s.tasksHash}`,
  ].join('\n')]);
  assert.equal(status(root).status, 'unapproved', 'разорванный блок — не подпись');

  // Тот же ключ в subject-строке: тоже не трейлер.
  git(root, ['commit', '--allow-empty', '-m', [
    `Spec-Approved: ${SPEC_REL}`, '',
    `Spec-Hash: ${s.specHash}`,
    `Tasks-Hash: ${s.tasksHash}`,
  ].join('\n')]);
  assert.equal(status(root).status, 'unapproved', 'ключ в subject — не трейлер');

  fs.rmSync(root, { recursive: true, force: true });
});

// Двойной трейлер — неоднозначность, а не подпись: «берём первый» было бы решением
// в пользу подписавшего.
test('018 T002: два разных Spec-Hash в одном коммите не засчитываются', () => {
  const { root } = repoWithSpec();
  const s = status(root);
  git(root, ['commit', '--allow-empty', '-m', [
    'chore: неоднозначная подпись', '',
    `Spec-Approved: ${SPEC_REL}`,
    `Spec-Hash: ${s.specHash}`,
    `Spec-Hash: ${'0'.repeat(64)}`,
    `Tasks-Hash: ${s.tasksHash}`,
  ].join('\n')]);

  assert.equal(status(root).status, 'unapproved');
  fs.rmSync(root, { recursive: true, force: true });
});

test('018 T002: трейлер с чужими хешами даёт stale, а не approved', () => {
  const { root } = repoWithSpec();
  signByTrailer(root, { tasksHash: 'f'.repeat(64) });

  const after = status(root);
  assert.equal(after.status, 'stale');
  assert.equal(after.source, 'trailer');

  fs.rmSync(root, { recursive: true, force: true });
});

test('018 T002: подпись чужой спеки не засчитывается этой', () => {
  const { root } = repoWithSpec();
  signByTrailer(root, { specRel: 'specs/999-other' });

  assert.equal(status(root).status, 'unapproved');
  fs.rmSync(root, { recursive: true, force: true });
});

// 018 T004 переворачивает эти два теста: пока трейлер поднимался (T002), файл рядом был
// равноправной подписью. Теперь источник ровно один — история, — и `approval.json` не значит
// ничего. Миграционной льготы нет намеренно: по реестру из 353 проектов живых файлов осталось
// 7 директорий, и валидны они были лишь под старой хеш-функцией, которую T001 уже сменил.
test('018 T004: одинокий approval.json больше НЕ подписывает спеку', () => {
  const { root, dir } = repoWithSpec();
  const s = status(root);
  fs.writeFileSync(path.join(dir, 'approval.json'), JSON.stringify({
    approvedAt: new Date().toISOString(), specHash: s.specHash, tasksHash: s.tasksHash,
  }, null, 2));

  assert.equal(status(root).status, 'unapproved', 'файл рядом с планом подписью не является');

  fs.rmSync(root, { recursive: true, force: true });
});

test('018 T004: свежий approval.json не чинит протухший трейлер', () => {
  const { root, dir } = repoWithSpec();
  const s = status(root);
  signByTrailer(root, { specHash: 'deadbeef'.repeat(8) });
  fs.writeFileSync(path.join(dir, 'approval.json'), JSON.stringify({
    approvedAt: new Date().toISOString(), specHash: s.specHash, tasksHash: s.tasksHash,
  }, null, 2));

  const after = status(root);
  assert.equal(after.status, 'stale');
  assert.equal(after.source, 'trailer');

  fs.rmSync(root, { recursive: true, force: true });
});
