'use strict';
// 019 T004 — Оцінювач упевненості знахідок ревʼю на рубриці 0–100 із відсічкою 80.
//
// Мотив: сигнал/шум блокуючих вердиктів = 1:7 (сім із восьми блокувань — хибні). Офіційний
// рецепт плагіна `code-review` вимагає оцінку 0–100 за рубрикою: 0–74 = nitpick або невпевненість,
// 75–100 = реальна проблема. Фільтр шаг 6 дослівно: «Filter out any issues with a score less than 80».
//
// Модуль не має зовнішніх залежностей — входить в рішення гейта за потреби.

const { isIgnoredForReview } = require('./harness-files');

// Границя, яка відділяє реальні блокування від слабих сигналів.
// УМОВНО: 75–100 = реальна проблема (за офіційним рецептом), но фільтр каже 80.
// Число 80 живе ТІЛЬКИ ТУТАЙ.
const CUTOFF = 80;

// Модель оцінювача. За умовою: `claude-haiku-4-5-20251001`.
const SCORER_MODEL = 'claude-haiku-4-5-20251001';

// Типові ложні срабатування, які лінзи можуть видати. Явний список передається
// оцінювачу у промпті для скоригування оцінок. Причина коротка — для рядка в звіті.
const KNOWN_FALSE_POSITIVES = [
  {
    type: 'generated-file',
    pattern: /package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml/i,
    reason: "файл генерується інструментом, не людиною",
  },
  {
    type: 'harness-owned',
    pattern: /\.harness\/|\.git\/elt\/|review-queue\.jsonl|learnings\.jsonl|run-log\.jsonl/i,
    reason: "файл належить самому харнесу, слайс його не вибирав",
  },
  {
    type: 'pure-formatting',
    pattern: null, // чекується промптом, а не функцією
    reason: "чисте форматування без логічної зміни",
  },
  {
    type: 'test-addition-no-failure',
    pattern: null, // чекується промптом: «додай тест» без названого сценарію відмови
    reason: "вимога додати тест без вказаного непокритого зв'язку",
  },
  {
    type: 'style-no-rule',
    pattern: null, // чекується промптом: стиль без правила у CLAUDE.md
    reason: "стилістична знахідка без правила в проєктній інструкції",
  },
  {
    type: 'rename-only',
    pattern: null, // чекується промптом: файл переіменовано, поведінка не змінилась
    reason: "переіменування без зміни поведінки",
  },
];

// Промпт для оцінювача на haiku. Моделі передаються:
// - findings (масив з {file, line, summary, failure_scenario, confidence})
// - diff (повний дифф коміта)
// - taskText (опис задачі зі specs/*/tasks.md)
//
// Оцінювач повертає JSON-масив {index, confidence, why} для кожної знахідки.
// Число CUTOFF=80 має бути у цьому промпті видимо.
function scorerPrompt(findings, { diff = '', taskText = '' } = {}) {
  const false_positives_desc = KNOWN_FALSE_POSITIVES
    .map((fp) => `- ${fp.type}: ${fp.reason}`)
    .join('\n');

  return `# Оцініть упевненість знахідок ревʼю за офіційною рубрикою

Рубрика (0–100):
- 0–74: nitpick, неясна критичність, або невпевненість
- 75–100: реальна проблема, яка повинна блокувати або бути виправлена

Фільтр: знахідки з score < 80 не блокують і падають у чергу слабих сигналів.
Тільки score >= 80 — справжнє блокування.

## Типові ложні срабатування, яким давайте низькі оцінки:

${false_positives_desc}

## Знахідки для оцінки:

${JSON.stringify(findings, null, 2)}

## Контекст коміта:

**Опис задачі:**
${taskText || '(не надано)'}

**Дифф (перших 2000 символів):**
\`\`\`
${(diff || '').slice(0, 2000)}
\`\`\`

## Вихід (JSON-масив):

Поверніть ТІЛЬКИ JSON-масив вида:
[
  { "index": 0, "confidence": 95, "why": "реальна проблема,明ієте блокуе" },
  { "index": 1, "confidence": 45, "why": "чисте форматування" }
]

Не додавайте пояснень, тільки JSON.`;
}

// Розбір відповіді оцінювача. Шукає JSON-масив у трьох формах:
// 1. Прямий масив: JSON-текст на початку рядка
// 2. У кодовому блоці: \`\`\`json ... \`\`\`
// 3. У хвості прози: JSON на кінці після деякого тексту
//
// Мусор → пустий масив (не виключення).
function parseScores(text) {
  if (!text || typeof text !== 'string') return [];

  const t = text.trim();
  if (!t) return [];

  // Спроба 1: прямий масив на початку
  try {
    if (t.startsWith('[')) {
      const end = t.indexOf(']');
      if (end > 0) {
        const json = JSON.parse(t.slice(0, end + 1));
        if (Array.isArray(json)) return json;
      }
    }
  } catch (e) {
    // не масив, рухаємось далі
  }

  // Спроба 2: код-блок ```json ... ```
  const codeMatch = t.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeMatch) {
    try {
      const json = JSON.parse(codeMatch[1]);
      if (Array.isArray(json)) return json;
    } catch (e) {
      // не валідний JSON у блоці, рухаємось далі
    }
  }

  // Спроба 3: JSON-хвіст у прозі (шукаємо [ до кінця)
  const lastBracket = t.lastIndexOf('[');
  if (lastBracket > -1) {
    try {
      const json = JSON.parse(t.slice(lastBracket));
      if (Array.isArray(json)) return json;
    } catch (e) {
      // не масив у хвості
    }
  }

  return [];
}

// Класифікація знахідок за файлом, наявністю `failure_scenario` й оцінкою.
// Повертає: { blocking: [], weak: [], ignored: [] }
//
// Знахідка від ігнорованого файлу → ignored (незалежно від оцінки).
// Немає failure_scenario або confidence не число → weak (не блокує).
// confidence >= CUTOFF → blocking.
// Інше → weak.
function classify(findings) {
  const result = { blocking: [], weak: [], ignored: [] };

  for (let i = 0; i < (findings || []).length; i++) {
    const f = findings[i];
    if (!f) continue;

    // Перевірка файлу: якщо він у списку ігнорованих, знахідка не враховується
    if (f.file && isIgnoredForReview(f.file)) {
      result.ignored.push({ ...f, reason: 'ignored-file', index: i });
      continue;
    }

    // Перевірка наявності failure_scenario
    if (!f.failure_scenario) {
      result.weak.push({
        ...f,
        reason: 'no-failure-scenario',
        confidence: f.confidence || 0,
        index: i,
      });
      continue;
    }

    // Перевірка числової оцінки
    const conf = f.confidence;
    if (typeof conf !== 'number' || !Number.isFinite(conf)) {
      result.weak.push({
        ...f,
        reason: 'invalid-confidence',
        confidence: 0,
        index: i,
      });
      continue;
    }

    // Класифікація за порогом
    if (conf >= CUTOFF) {
      result.blocking.push({ ...f, index: i });
    } else {
      result.weak.push({ ...f, index: i });
    }
  }

  return result;
}

// Вердикт від класифікації. Контракт не змінюється:
// - 'block' → є блокуючі знахідки
// - 'inconclusive' → нема блокуючих, але є слабі сигнали
// - 'pass' → немає знахідок взагалі
function verdictFrom(classified) {
  if (!classified) return 'pass';
  if (classified.blocking && classified.blocking.length > 0) return 'block';
  if (classified.weak && classified.weak.length > 0) return 'inconclusive';
  return 'pass';
}

module.exports = {
  // 020 T010: `parseScores` — по факту толерантный разборщик JSON-МАССИВА из ответа модели, и
  // он же нужен рантайму ревью для находок линз. Второй такой же разборщик рядом разошёлся бы
  // с этим при первой правке (та же болезнь, что у двух копий списка владений харнеса, 019 T001),
  // поэтому здесь ровно псевдоним, а не копия.
  parseJsonArray: parseScores,
  CUTOFF,
  SCORER_MODEL,
  KNOWN_FALSE_POSITIVES,
  scorerPrompt,
  parseScores,
  classify,
  verdictFrom,
};
