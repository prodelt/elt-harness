'use strict';
// 019 T004 — Тест оцінювача упевненості. Обовʼязковий контракт:
// - граница ровно на CUTOFF=80 (79 не блокує, 80 блокує)
// - файли від харнесу ігноруються незалежно від оцінки
// - немає failure_scenario → не блокує
// - verdictFrom даёт все три вердикта
// - parseScores переваривает три форми JSON
// - scorerPrompt содержит 80 і haiku-модель

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const rc = require('./review-confidence');

describe('review-confidence', () => {
  test('CUTOFF = 80 (константа видима в коді)', () => {
    assert.equal(rc.CUTOFF, 80, 'CUTOFF має бути рівно 80');
  });

  test('SCORER_MODEL = claude-haiku-4-5-20251001', () => {
    assert.equal(rc.SCORER_MODEL, 'claude-haiku-4-5-20251001');
  });

  describe('classify()', () => {
    test('confidence 79 → weak (не блокує)', () => {
      const findings = [
        { file: 'src/widget.js', line: 42, summary: 'bug', failure_scenario: 'crashes on null', confidence: 79 }
      ];
      const classified = rc.classify(findings);
      assert.equal(classified.blocking.length, 0, 'знахідка з 79 не повинна блокувати');
      assert.equal(classified.weak.length, 1, 'знахідка з 79 повинна бути weak');
      assert.equal(classified.ignored.length, 0);
    });

    test('confidence 80 → blocking (граница ровно на 80)', () => {
      const findings = [
        { file: 'src/widget.js', line: 42, summary: 'bug', failure_scenario: 'crashes on null', confidence: 80 }
      ];
      const classified = rc.classify(findings);
      assert.equal(classified.blocking.length, 1, 'знахідка з 80 повинна блокувати');
      assert.equal(classified.weak.length, 0);
      assert.equal(classified.ignored.length, 0);
    });

    test('confidence 81 → blocking (вище 80)', () => {
      const findings = [
        { file: 'src/widget.js', line: 42, summary: 'bug', failure_scenario: 'crashes on null', confidence: 81 }
      ];
      const classified = rc.classify(findings);
      assert.equal(classified.blocking.length, 1);
      assert.equal(classified.weak.length, 0);
    });

    test('file з ігнорованого списку → ignored (незалежно від оцінки)', () => {
      const findings = [
        { file: 'package-lock.json', line: 1, summary: 'update', failure_scenario: 'changes deps', confidence: 95 },
        { file: 'app/package-lock.json', line: 1, summary: 'update', failure_scenario: 'changes deps', confidence: 95 },
        { file: '.harness/review-queue.jsonl', line: 5, summary: 'config', failure_scenario: 'invalid json', confidence: 100 },
        { file: '.git/elt/run-log.jsonl', line: 1, summary: 'log', failure_scenario: 'corrupted', confidence: 95 }
      ];
      const classified = rc.classify(findings);
      assert.equal(classified.ignored.length, 4, 'усі ці файли повинні бути ignored');
      assert.equal(classified.blocking.length, 0, 'навіть з confidence=95 не блокують');
      assert.equal(classified.weak.length, 0);
    });

    test('без failure_scenario → weak (не блокує)', () => {
      const findings = [
        { file: 'src/widget.js', line: 42, summary: 'check this', confidence: 100 }
      ];
      const classified = rc.classify(findings);
      assert.equal(classified.blocking.length, 0, 'без failure_scenario не блокує навіть з 100');
      assert.equal(classified.weak.length, 1);
      assert.equal(classified.weak[0].reason, 'no-failure-scenario');
    });

    test('confidence не число → weak', () => {
      const findings = [
        { file: 'src/widget.js', line: 42, summary: 'bug', failure_scenario: 'test', confidence: 'high' },
        { file: 'src/widget.js', line: 50, summary: 'bug2', failure_scenario: 'test2', confidence: null }
      ];
      const classified = rc.classify(findings);
      assert.equal(classified.blocking.length, 0);
      assert.equal(classified.weak.length, 2);
      assert.equal(classified.weak[0].reason, 'invalid-confidence');
    });

    test('змішаний список: blocking, weak, ignored', () => {
      const findings = [
        { file: 'src/a.js', line: 1, summary: 'real bug', failure_scenario: 'crash', confidence: 85 },  // blocking
        { file: 'src/b.js', line: 2, summary: 'nitpick', failure_scenario: 'style', confidence: 30 },   // weak
        { file: 'package-lock.json', line: 3, summary: 'update', failure_scenario: 'deps', confidence: 95 }, // ignored
        { file: 'src/c.js', line: 4, summary: 'no proof' }                                              // weak (no-failure-scenario)
      ];
      const classified = rc.classify(findings);
      assert.equal(classified.blocking.length, 1);
      assert.equal(classified.weak.length, 2);
      assert.equal(classified.ignored.length, 1);
    });
  });

  describe('verdictFrom()', () => {
    test('з блокуючим → "block"', () => {
      const classified = { blocking: [{ file: 'a.js', confidence: 80 }], weak: [], ignored: [] };
      assert.equal(rc.verdictFrom(classified), 'block');
    });

    test('без блокуючих, але зі слабими → "inconclusive"', () => {
      const classified = { blocking: [], weak: [{ file: 'a.js', confidence: 50 }], ignored: [] };
      assert.equal(rc.verdictFrom(classified), 'inconclusive');
    });

    test('порожній список → "pass"', () => {
      const classified = { blocking: [], weak: [], ignored: [] };
      assert.equal(rc.verdictFrom(classified), 'pass');
    });

    test('null/undefined → "pass"', () => {
      assert.equal(rc.verdictFrom(null), 'pass');
      assert.equal(rc.verdictFrom(undefined), 'pass');
    });

    test('усі три вердикти досяжні', () => {
      const verdicts = new Set();
      verdicts.add(rc.verdictFrom({ blocking: [{}], weak: [], ignored: [] }));
      verdicts.add(rc.verdictFrom({ blocking: [], weak: [{}], ignored: [] }));
      verdicts.add(rc.verdictFrom({ blocking: [], weak: [], ignored: [] }));
      assert.deepEqual([...verdicts].sort(), ['block', 'inconclusive', 'pass']);
    });
  });

  describe('parseScores()', () => {
    test('прямий JSON-масив на початку', () => {
      const text = '[{"index": 0, "confidence": 85, "why": "real issue"}]';
      const scores = rc.parseScores(text);
      assert.equal(scores.length, 1);
      assert.equal(scores[0].confidence, 85);
    });

    test('JSON у кодовому блоці ```json ... ```', () => {
      const text = `Ось результат:
\`\`\`json
[{"index": 0, "confidence": 45, "why": "nitpick"}]
\`\`\`
Все готово.`;
      const scores = rc.parseScores(text);
      assert.equal(scores.length, 1);
      assert.equal(scores[0].confidence, 45);
    });

    test('JSON-хвіст у прозі (шукаємо [ до кінця)', () => {
      const text = `Перший елемент має confidence 75.
Результат: [{"index": 0, "confidence": 75}]`;
      const scores = rc.parseScores(text);
      assert.equal(scores.length, 1);
      assert.equal(scores[0].confidence, 75);
    });

    test('код-блок без json-маркера (просто ```) — спроба розбір як хвіст', () => {
      const text = `\`\`\`
[{"index": 0, "confidence": 90}]
\`\`\``;
      const scores = rc.parseScores(text);
      // з маркером json не буде, але спроба хвіста знайде масив
      assert.equal(scores.length, 1);
      assert.equal(scores[0].confidence, 90);
    });

    test('мусор, що не парситься → пустий масив (не виключення)', () => {
      const garbage = [
        'not json at all',
        '{ "invalid": json }',
        '[broken json',
        '',
        null,
        undefined
      ];
      for (const text of garbage) {
        const scores = rc.parseScores(text);
        assert.ok(Array.isArray(scores), 'parseScores завжди повертає масив');
        assert.equal(scores.length, 0, `мусор "${text}" має дати пустий масив`);
      }
    });

    test('масив з кількома елементами', () => {
      const text = '[{"index": 0, "confidence": 85}, {"index": 1, "confidence": 40}, {"index": 2, "confidence": 92}]';
      const scores = rc.parseScores(text);
      assert.equal(scores.length, 3);
      assert.deepEqual(scores.map((s) => s.confidence), [85, 40, 92]);
    });
  });

  describe('scorerPrompt()', () => {
    test('промпт містить число CUTOFF=80', () => {
      const findings = [
        { file: 'a.js', line: 1, summary: 'test', failure_scenario: 'crash', confidence: 50 }
      ];
      const prompt = rc.scorerPrompt(findings, { diff: 'some diff', taskText: 'T001 task' });
      assert.ok(prompt.includes('80'), 'промпт повинен містити число 80');
      assert.ok(prompt.includes('score < 80'), 'промпт повинен посилатися на фільтр 80');
      assert.ok(prompt.includes('score >= 80'), 'промпт повинен посилатися на порог 80');
    });

    test('модель оцінювача є haiku (SCORER_MODEL константа)', () => {
      assert.ok(rc.SCORER_MODEL.includes('haiku'), `модель ${rc.SCORER_MODEL} повинна містити "haiku"`);
    });

    test('промпт включає findings у JSON', () => {
      const findings = [
        { file: 'a.js', line: 1, summary: 'test', failure_scenario: 'crash' }
      ];
      const prompt = rc.scorerPrompt(findings, {});
      // Перевіряємо, що знахідки згадуються, принаймні файл
      assert.ok(prompt.includes('a.js') && prompt.includes('test'), 'знахідки повинні бути у промпті');
    });

    test('промпт включає контекст (diff, taskText)', () => {
      const prompt = rc.scorerPrompt([], { diff: 'my-diff-content', taskText: 'T123 my task' });
      assert.ok(prompt.includes('my-diff-content') || prompt.includes('Дифф'), 'дифф повинен бути у промпті');
      assert.ok(prompt.includes('T123 my task') || prompt.includes('Опис'), 'task повинна бути у промпті');
    });

    test('промпт опише типові ложні срабатування', () => {
      const prompt = rc.scorerPrompt([], {});
      assert.ok(prompt.includes('generated-file') || prompt.includes('generated') || prompt.includes('форматув'),
        'промпт повинен згадувати типові ложні срабатування');
    });
  });

  describe('інтеграційні сценарії', () => {
    test('реальний сценарій: оцінювач дав 79, не блокує', () => {
      const findings = [
        { file: 'src/index.js', line: 10, summary: 'variable unused', failure_scenario: 'cleanup needed', confidence: undefined }
      ];
      // Симуляція відповіді оцінювача
      const scorerResponse = '[{"index": 0, "confidence": 79, "why": "nitpick"}]';
      const scores = rc.parseScores(scorerResponse);

      // Застосуємо оцінки до знахідок
      for (let i = 0; i < findings.length; i++) {
        if (scores[i]) findings[i].confidence = scores[i].confidence;
      }

      const classified = rc.classify(findings);
      assert.equal(classified.blocking.length, 0);
      assert.equal(classified.weak.length, 1);
      assert.equal(rc.verdictFrom(classified), 'inconclusive');
    });

    test('реальний сценарій: оцінювач дав 80, блокує', () => {
      const findings = [
        { file: 'src/index.js', line: 10, summary: 'null crash', failure_scenario: 'dereference without check', confidence: undefined }
      ];
      const scorerResponse = '[{"index": 0, "confidence": 80, "why": "real bug"}]';
      const scores = rc.parseScores(scorerResponse);

      for (let i = 0; i < findings.length; i++) {
        if (scores[i]) findings[i].confidence = scores[i].confidence;
      }

      const classified = rc.classify(findings);
      assert.equal(classified.blocking.length, 1);
      assert.equal(rc.verdictFrom(classified), 'block');
    });

    test('реальний сценарій: оцінювач дав мусор, парсер не падає', () => {
      const response = 'Я не впевнений, що це значить. Може бути помилка, може бути нормально.';
      const scores = rc.parseScores(response);
      assert.ok(Array.isArray(scores));
      assert.equal(scores.length, 0);
    });
  });

  describe('регресійні тести на граници CUTOFF', () => {
    test('тест падає, якщо хтось зсунув CUTOFF на 75', () => {
      // Цей тест перевіряє, що модуль не приховує магічне число.
      // Якщо CUTOFF випадково змінити на 75, то кейс з 79 перестане розпізнаватись як weak.
      assert.notEqual(rc.CUTOFF, 75, 'CUTOFF має бути 80, не 75');
      assert.notEqual(rc.CUTOFF, 85, 'CUTOFF має бути 80, не 85');

      // Перевірка через функцію
      const f79 = [{ file: 'a.js', line: 1, summary: 'x', failure_scenario: 'y', confidence: 79 }];
      const c79 = rc.classify(f79);
      assert.equal(c79.weak.length, 1, 'якщо CUTOFF не 80, цей тест впаде');
    });

    test('тест падає, якщо хтось змінив CUTOFF на 81', () => {
      const f80 = [{ file: 'a.js', line: 1, summary: 'x', failure_scenario: 'y', confidence: 80 }];
      const c80 = rc.classify(f80);
      assert.equal(c80.blocking.length, 1, 'якщо CUTOFF не 80, то 80 не заблокує');
    });
  });
});
