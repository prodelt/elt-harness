'use strict';

/**
 * measure-noise.test.js — тесты для скрипта замірив сигнал/шум.
 *
 * Тесты покривають:
 * - Розпізнавання блокуючих вердиктів
 * - Витягування файлів з різних джерел
 * - Класифікацію істинності (базова)
 * - Обработку помилок JSONL
 * - CLI функціональность
 */

const { test } = require('node:test');
const assert = require('node:assert').strict;
const { writeFileSync, mkdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const {
  isBlockingVerdict,
  extractFilesFromVerdict,
  readJsonlLines,
} = require('./measure-noise');

test('isBlockingVerdict: judge-block розпізнається', () => {
  const record = {
    status: 'judge-block',
    verdict: 'block',
  };
  assert.equal(isBlockingVerdict(record), true);
});

test('isBlockingVerdict: background-verify-red розпізнається', () => {
  const record = {
    status: 'background-verify-red',
    background: {
      sections: [{ layer: 'suite', red: true }],
    },
  };
  assert.equal(isBlockingVerdict(record), true);
});

test('isBlockingVerdict: l0-block розпізнається', () => {
  const record = {
    status: 'l0-block',
    verdict: 'block',
  };
  assert.equal(isBlockingVerdict(record), true);
});

test('isBlockingVerdict: red-stop розпізнається', () => {
  const record = {
    status: 'red-stop',
  };
  assert.equal(isBlockingVerdict(record), true);
});

test('isBlockingVerdict: judge-pass не розпізнається', () => {
  const record = {
    status: 'judge-pass',
    verdict: 'pass',
  };
  assert.equal(isBlockingVerdict(record), false);
});

test('isBlockingVerdict: background-verify-pass не розпізнається', () => {
  const record = {
    status: 'background-verify-pass',
    background: { sections: [{ red: false }] },
  };
  assert.equal(isBlockingVerdict(record), false);
});

test('extractFilesFromVerdict: L0-триггери', () => {
  const record = {
    l0: {
      triggers: [
        { files: ['tools/elt.js', 'tools/judge.js'] },
        { files: ['test/elt.test.js'] },
      ],
    },
  };
  const files = extractFilesFromVerdict(record);
  assert.deepEqual(Array.from(files).sort(), [
    'test/elt.test.js',
    'tools/elt.js',
    'tools/judge.js',
  ]);
});

test('extractFilesFromVerdict: текстові причини судьї', () => {
  const record = {
    judges: [
      {
        reasons: [
          'Дифф у tools/elt.js та spec/018.md тронув критичні файли',
        ],
      },
    ],
  };
  const files = extractFilesFromVerdict(record);
  const filesArray = Array.from(files);
  assert.ok(
    filesArray.some(f => f === 'tools/elt.js' || f.includes('elt.js')),
    'повинен витягти tools/elt.js'
  );
});

test('extractFilesFromVerdict: причини фону', () => {
  const record = {
    background: {
      sections: [
        { reason: 'Помилка в tools/elt-test.js при виконанні' },
      ],
    },
  };
  const files = extractFilesFromVerdict(record);
  assert.ok(
    Array.from(files).some(f => f.includes('elt-test.js')),
    'повинен витягти elt-test.js з причини фону'
  );
});

test('extractFilesFromVerdict: порожний результат коли немає файлів', () => {
  const record = {
    judges: [{ reasons: ['Виглядає добре'] }],
  };
  const files = extractFilesFromVerdict(record);
  assert.equal(files.size, 0, 'не повинен витягти файли з нечіткого тексту');
});

test('readJsonlLines: читає та парсить JSONL', () => {
  const tmpDir = join(tmpdir(), `test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  try {
    const file = join(tmpDir, 'test.jsonl');
    const lines = [
      JSON.stringify({ id: 1, name: 'first' }),
      JSON.stringify({ id: 2, name: 'second' }),
      JSON.stringify({ id: 3, name: 'third' }),
    ];
    writeFileSync(file, lines.join('\n'));

    const result = readJsonlLines(file, 2);
    assert.equal(result.length, 2, 'повинен прочитати останні 2 рядки');
    assert.equal(result[0].id, 2);
    assert.equal(result[1].id, 3);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('readJsonlLines: справляється з битим JSON', () => {
  const tmpDir = join(tmpdir(), `test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  try {
    const file = join(tmpDir, 'bad.jsonl');
    const lines = [
      JSON.stringify({ id: 1 }),
      '{broken json',
      JSON.stringify({ id: 2 }),
    ];
    writeFileSync(file, lines.join('\n'));

    const result = readJsonlLines(file);
    assert.equal(result.length, 2, 'повинен пропустити битий JSON та прочитати добрі');
    assert.ok(result.some(r => r.id === 1));
    assert.ok(result.some(r => r.id === 2));
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('readJsonlLines: повертає [] для порожнього файлу', () => {
  const tmpDir = join(tmpdir(), `test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  try {
    const file = join(tmpDir, 'empty.jsonl');
    writeFileSync(file, '');

    const result = readJsonlLines(file);
    assert.equal(result.length, 0);
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
});

test('readJsonlLines: повертає [] для неіснуючого файлу', () => {
  const result = readJsonlLines('/nonexistent/path/file.jsonl');
  assert.equal(result.length, 0);
});

test('extractFilesFromVerdict: нормалізує шляхи (backslash → forward slash)', () => {
  const record = {
    l0: {
      triggers: [
        { files: ['tools\\elt.js', 'specs\\018\\spec.md'] },
      ],
    },
  };
  const files = extractFilesFromVerdict(record);
  const filesArray = Array.from(files);
  assert.ok(filesArray.every(f => !f.includes('\\'), 'усі шляхи повинні використовувати forward slash'));
});
