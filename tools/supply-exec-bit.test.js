'use strict';
// 024 T005 — замок гейта либо висит, либо честно говорит, что не висит.
//
// `.githooks/pre-commit` был закоммичен режимом `100644`. На POSIX git такой хук НЕ выполняет:
// он печатает `hint: The '.githooks/pre-commit' hook was ignored because it's not set as
// executable.` — и коммитит. `hint:` не ошибка, exit 0, никто не предупреждён. То есть
// документированная в самом хуке инструкция (`git config core.hooksPath .githooks`) на Linux
// и macOS давала ложное чувство защиты: обещание «managed pre-commit gate» не выполнялось
// вовсе, а весь смысл харнеса — не пускать непроверенное в main.
//
// Проверяется ИНДЕКС git (`git ls-files -s`), а не файловая система: на Windows исполняемый
// бит не наблюдаем, но git хранит его в индексе и восстанавливает при checkout на POSIX.
// Поэтому один и тот же тест верен на обеих платформах.
//
// Область — ровно `.githooks/`: это единственные файлы, которые git запускает САМ. Скрипты
// `tools/` и `bin/` зовутся через `node <file>`, там бит косметический, и требовать его
// значило бы менять режим у 80 файлов ради ничего.

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const EXEC_MODE = '100755';

function tracked(prefix) {
  const out = execFileSync('git', ['ls-files', '-s', '--', prefix], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean).map((line) => {
    const [meta, file] = line.split('\t');
    return { mode: meta.split(' ')[0], file };
  });
}

const test = require('node:test').test;

test('024 T005: каждый файл под .githooks/ исполним в индексе git', () => {
  const hooks = tracked('.githooks');
  assert.ok(hooks.length > 0, '.githooks/ пуст — замок гейта не поставляется вовсе');
  const notExec = hooks.filter((h) => h.mode !== EXEC_MODE);
  assert.deepEqual(notExec, [], `git молча ПРОПУСТИТ эти хуки на POSIX (нужен режим ${EXEC_MODE}): `
    + notExec.map((h) => `${h.file} = ${h.mode}`).join(', '));
});

test('024 T005: сам замок ловит режим 644 — иначе он декоративный', () => {
  // Проверка проверки: если бы сравнение было написано так, что проходит любой режим,
  // предыдущий тест был бы зелёным и на сломанной поставке.
  const fake = [{ mode: '100644', file: '.githooks/pre-commit' }];
  const notExec = fake.filter((h) => h.mode !== EXEC_MODE);
  assert.equal(notExec.length, 1, 'сравнение режимов обязано отвергать 100644');
});
