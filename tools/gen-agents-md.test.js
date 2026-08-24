'use strict';
// 019 T013 — тест на дрейф инструкций.
//
// Дискриминирующее свойство: тест обязан КРАСНЕТЬ на расхождении. Проверка «файл существует»
// была бы зелёной и на трёх разошедшихся копиях — то есть ровно в том состоянии, ради которого
// задача и заведена (`AGENTS.md` указывал на удалённый `tools/fleet/providers.js`,
// `.gemini/GEMINI.md` — на удалённый `tools/elt-loop.ps1`).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gen = require('./gen-agents-md');

function fixture(sourceText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-agents-'));
  fs.writeFileSync(path.join(root, gen.SOURCE), sourceText, 'utf8');
  return root;
}

test('копии в репозитории совпадают с CLAUDE.md байт-в-байт', () => {
  const bad = gen.drift();
  assert.deepEqual(bad, [], 'расхождение чинится одной командой: node tools/gen-agents-md.js');
});

test('каждая копия несёт весь текст источника, а не ссылку на него', () => {
  const source = gen.sourceText();
  for (const { file } of gen.DERIVED) {
    const have = gen.normalize(fs.readFileSync(path.join(gen.ROOT, file), 'utf8'));
    assert.ok(have.includes(source), `${file} содержит текст CLAUDE.md целиком`);
    assert.match(have, /СГЕНЕРИРОВАНО/, `${file} помечен как генерируемый`);
  }
});

test('дрейф в одну строку виден — иначе тест ничего не держит', () => {
  const root = fixture('# Проект\n\nПравило один.\n');
  gen.generate(root);
  assert.deepEqual(gen.drift(root), []);

  // Кто-то правит копию руками, как правили годами.
  const victim = path.join(root, gen.DERIVED[0].file);
  fs.appendFileSync(victim, 'Правка мимо источника.\n', 'utf8');

  const bad = gen.drift(root);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].file, gen.DERIVED[0].file);
  assert.match(bad[0].reason, /разошлось/);
});

test('правка источника делает ВСЕ копии устаревшими сразу', () => {
  const root = fixture('# Проект\n\nПравило один.\n');
  gen.generate(root);
  fs.writeFileSync(path.join(root, gen.SOURCE), '# Проект\n\nПравило два.\n', 'utf8');

  const bad = gen.drift(root);
  assert.equal(bad.length, gen.DERIVED.length, 'ни одна копия не осталась «случайно верной»');

  gen.generate(root);
  assert.deepEqual(gen.drift(root), []);
});

test('пропавшая копия — это дрейф, а не тишина', () => {
  const root = fixture('# Проект\n');
  gen.generate(root);
  fs.rmSync(path.join(root, gen.DERIVED[0].file));
  const bad = gen.drift(root);
  assert.equal(bad[0].reason, 'файла нет');
});

test('CRLF в копии не считается дрейфом', () => {
  const root = fixture('# Проект\n\nСтрока.\n');
  gen.generate(root);
  const victim = path.join(root, gen.DERIVED[0].file);
  fs.writeFileSync(victim, fs.readFileSync(victim, 'utf8').replace(/\n/g, '\r\n'), 'utf8');
  assert.deepEqual(gen.drift(root), [], 'свежий checkout под Windows не должен краснеть (класс D23)');
});
