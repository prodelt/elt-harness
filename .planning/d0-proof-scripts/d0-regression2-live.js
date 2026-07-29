// Живой пруф регресса 2 (doc2md-tauri, e939955): реальный вызов Gemini Interactions API,
// показываем что старый парсер (только usageMetadata) даёт 0 токенов на реальном ответе,
// новый (usage сначала) — нет.
const fs = require('fs');
const path = require('path');

const REPO = 'C:/Ametrin projects/kp_zakupki/doc2md-tauri';
const IMG = path.join(REPO, '.planning/ocr-bench/letter-stamp/ORIGINAL.jpg');

function loadEnvKey(name) {
  const env = fs.readFileSync(path.join(REPO, '.env'), 'utf8');
  const m = env.match(new RegExp('^' + name + '=(.+)$', 'm'));
  if (!m) throw new Error(name + ' not found in .env');
  return m[1].trim();
}

// Порт parse_gemini_usage ДО фикса e939955 (только usageMetadata).
function parseGeminiUsage_preFix(body) {
  const meta = body.usageMetadata;
  if (!meta) return null;
  const input = meta.promptTokenCount;
  const output = meta.candidatesTokenCount;
  const total = meta.totalTokenCount;
  if (input == null && output == null && total == null) return null;
  return { input_tokens: input || 0, output_tokens: output || 0, total_tokens: total || 0 };
}

// Порт parse_gemini_usage ПОСЛЕ фикса e939955 (usage сначала, потом usageMetadata).
function parseGeminiUsage_postFix(body) {
  if (body.usage) {
    const u = body.usage;
    const output = (u.total_output_tokens ?? 0) + (u.total_thought_tokens ?? 0);
    const input = u.total_input_tokens;
    const total = u.total_tokens;
    if (input != null || output || total != null) {
      return { input_tokens: input || 0, output_tokens: output, total_tokens: total || 0 };
    }
  }
  return parseGeminiUsage_preFix(body);
}

async function main() {
  const key = loadEnvKey('GEMINI_API_KEY');
  const imageB64 = fs.readFileSync(IMG).toString('base64');

  // Точная копия build_request() из ocr.rs:937 (модель/промпт/схема/generation_config).
  const OCR_PROMPT = "Perform exact forensic OCR of this user-provided legal or business " +
    "document image. Preserve visible language, spelling, punctuation, names, numbers, dates, " +
    "handwriting, stamps, and clear table structure (as Markdown tables). Do not summarize, " +
    "translate, correct, or invent text. Omit empty form lines and decorative rules entirely. " +
    "Never repeat underscores, dashes, dots, or any other character to represent blank space. " +
    "Use [нерозбірливо] only for an impossible fragment. Put the transcription in the `markdown` " +
    "field. Set `verification` to `verified` only when the media is fully legible and you are " +
    "confident every character is correct; use `degraded` whenever anything is uncertain, damaged, " +
    "or partially illegible. Put every uncertainty in the `issues` array, and leave it empty only " +
    "when nothing is uncertain. Return the requested JSON object only, without code fences.";

  const body = {
    model: 'gemini-3.6-flash',
    system_instruction: OCR_PROMPT,
    input: [
      { type: 'text', text: 'Transcribe the attached media exactly.' },
      { type: 'image', data: imageB64, mime_type: 'image/jpeg', resolution: 'high' },
    ],
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: {
        type: 'object',
        properties: {
          markdown: { type: 'string' },
          verification: { type: 'string', enum: ['verified', 'degraded', 'failed'] },
          issues: { type: 'array', items: { type: 'string' } },
        },
        required: ['markdown', 'verification', 'issues'],
        additionalProperties: false,
      },
    },
    generation_config: { temperature: 0, max_output_tokens: 65536 },
  };

  const url = 'https://generativelanguage.googleapis.com/v1beta/interactions?key=' + key;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('HTTP', res.status, text.slice(0, 2000));
    process.exit(1);
  }
  const respBody = JSON.parse(text);

  // Живой ответ на реальном судебном/бизнес-скане содержит ПДн (транскрипт) и огромный
  // opaque thought-signature. Ни то ни другое не нужно доказательству (оно про форму usage) —
  // редактируем ПЕРЕД записью на диск, иначе PII утекает в чужой репо (судья блокировал это
  // живьём на T001) и raw-файл раздувается настолько, что рвёт argv-лимит Windows (ENAMETOOLONG
  // у agy-судьи, тоже поймано живьём на T001).
  const redacted = {
    ...respBody,
    steps: (respBody.steps || []).map((s) => ({
      ...s,
      ...(s.signature ? { signature: '[REDACTED — непрозрачный thought-signature блоб, не нужен для доказательства usage]' } : {}),
      ...(s.content ? { content: '[REDACTED — реальный OCR-транскрипт документа с ПДн, вырезан; структура usage не изменена]' } : {}),
    })),
  };

  const outDir = 'C:/Claude playground/Pipiline setupper/.planning';
  fs.writeFileSync(path.join(outDir, 'D0-regression2-live-response.json'), JSON.stringify(redacted, null, 2));

  console.log('=== форма реального ответа (верхнеуровневые ключи) ===');
  console.log(Object.keys(respBody));
  console.log('usage (flat) present:', !!respBody.usage);
  console.log('usageMetadata present:', !!respBody.usageMetadata);
  if (respBody.usage) console.log('usage:', JSON.stringify(respBody.usage));
  if (respBody.usageMetadata) console.log('usageMetadata:', JSON.stringify(respBody.usageMetadata));

  const pre = parseGeminiUsage_preFix(respBody);
  const post = parseGeminiUsage_postFix(respBody);
  console.log('=== парсинг ===');
  console.log('pre-fix (только usageMetadata):', JSON.stringify(pre));
  console.log('post-fix (usage сначала):', JSON.stringify(post));

  const preTotal = pre ? pre.total_tokens : 0;
  const postTotal = post ? post.total_tokens : 0;
  console.log('=== вердикт ===');
  console.log('pre-fix total_tokens =', preTotal, preTotal === 0 ? '(РЕГРЕСС: 0 токенов на реальном ответе)' : '(НЕ регресс — не подтверждено)');
  console.log('post-fix total_tokens =', postTotal, postTotal > 0 ? '(фикс работает)' : '(ФИКС НЕ РАБОТАЕТ)');
}

main().catch(e => { console.error(e); process.exit(1); });
