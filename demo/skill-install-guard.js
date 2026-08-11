#!/usr/bin/env node
// PreToolUse-хук: якщо Claude Code збирається торкнутися теки зі SKILL.md —
// спершу проганяємо її через SkillSpector і блокуємо, якщо небезпечно.
// ponytail: тригер навмисно простий — «у команді згадано теку, в якій є SKILL.md».
// Цього досить для гейта встановлення; складніший парсер команд не потрібен.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function readStdin() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return {}; }
}

const ev = readStdin();
const input = ev.tool_input || {};
const haystack = [input.command, input.file_path, input.path, input.url]
  .filter(Boolean).join(' ');

if (!haystack) process.exit(0);

// витягуємо все, що схоже на шлях, і лишаємо теки зі SKILL.md
const candidates = new Set();
for (const raw of haystack.match(/[^\s"'`;|&()]+/g) || []) {
  const token = raw.replace(/^["']|["']$/g, '');
  if (!/[\\/]/.test(token) && !fs.existsSync(token)) continue;
  const abs = path.resolve(token);
  for (const dir of [abs, path.dirname(abs)]) {
    try {
      if (fs.existsSync(path.join(dir, 'SKILL.md'))) candidates.add(dir);
    } catch { /* недоступний шлях — не наша справа */ }
  }
}

if (candidates.size === 0) process.exit(0);

for (const dir of candidates) {
  // shell:true потрібен для .exe-shim на Windows, тому шлях квотуємо самі:
  // без лапок "C:\Claude playground\..." розпадається на два аргументи.
  const res = spawnSync('skillspector', ['scan', `"${dir}"`, '--no-llm'], {
    encoding: 'utf8', timeout: 120000, shell: true,
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  const dangerous = res.status === 1 || /DO NOT INSTALL|CRITICAL/i.test(out);

  if (dangerous) {
    const lines = out.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30);
    process.stderr.write(
      `\n=== SKILLSPECTOR: ВСТАНОВЛЕННЯ ЗАБЛОКОВАНО ===\n` +
      `Скіл: ${dir}\n\n${lines.join('\n')}\n\n` +
      `Цей скіл небезпечний. Не встановлюй його й не обходь цю перевірку. ` +
      `Поясни користувачу, що саме знайшов сканер.\n`
    );
    process.exit(2); // 2 = заблокувати виклик і віддати stderr моделі
  }
  process.stderr.write(`SkillSpector: ${path.basename(dir)} — чисто, встановлення дозволено.\n`);
}
process.exit(0);
