'use strict';
// gate.js — гейт слайса ВНУТРИ worktree (T007). Неизменный харнесс-контур:
//   elt oracle → судья (claude -p --model sonnet, REJECT-default) → elt commit.
// Коммит БЕЗ [X]-марка (no --task): пометку в tasks.md ставит оркестратор на
// интеграционной ветке ПОСЛЕ merge (T008), иначе tasks.md конфликтует при merge.
// Судья гоняется через providers.run (claude), парсер вердикта портирован из elt-loop.ps1.
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const providers = require('./providers');

const ELT_CLI = path.join(os.homedir(), '.claude', 'bin', 'elt.js');
const JUDGE_TIMEOUT_MS = 5 * 60 * 1000;

// Схема для --json-schema: судья зовётся через structured output (T016 live-fire —
// prose-парсер регулярно мимо: модель пишет "принято"/"зачёт" вместо литерального pass/block,
// REJECT-default тогда блокирует легитимные слайсы). claude -p --output-format json оборачивает
// весь транскрипт в JSON-массив; последний элемент (type:"result") несёт structured_output.
const VERDICT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: { verdict: { type: 'string', enum: ['pass', 'block'] }, reasons: { type: 'array', items: { type: 'string' } } },
  required: ['verdict', 'reasons'],
});

// Структурированный путь: последний элемент JSON-массива --output-format json → structured_output.verdict.
function parseStructuredVerdict(text) {
  try {
    const arr = JSON.parse(text);
    const last = Array.isArray(arr) ? arr[arr.length - 1] : arr;
    const v = last && last.structured_output && last.structured_output.verdict;
    return (v === 'pass' || v === 'block') ? v : null;
  } catch { return null; }
}

// Парсер вердикта, REJECT-default (портирован из tools/elt-loop.ps1):
//  (0) структурированный output (--json-schema, надёжный путь — T016);
//  (1) JSON-ключ "verdict":"pass|block"; (2) проза «verdict/вердикт ... pass|block» (фолбэк,
//  на случай если структурированный вызов почему-то не сработал).
//  Не нашли явного вердикта → block (НЕ ловим любой {...}: в прозе бывают литералы кода).
function parseVerdict(text) {
  if (!text) return 'block';
  const structured = parseStructuredVerdict(text);
  if (structured) return structured;
  const mJson = text.match(/"verdict"\s*:\s*"(pass|block)"/i);
  if (mJson) return mJson[1].toLowerCase();
  const mProse = text.match(/(?:verdict|вердикт)\W{0,5}(pass|block)/i);
  if (mProse) return mProse[1].toLowerCase();
  return 'block';
}

function judgePrompt(tid, taskText, diff, status) {
  return `Ты — судья слайса в харнесс-петле. Стойка REJECT-default: одобряй ТОЛЬКО если слайс строго в границах задачи. Ищи scope creep, ослабленные/удалённые тесты, side-effects вне задачи, скрытые зависимости.

ID задачи (${tid}) — порядковый номер ВНУТРИ одной spec-папки и МОЖЕТ повторяться в других
spec-папках того же проекта. НЕ ищи историю/другие коммиты/другие ветки по этому ID (git log,
gh run view и т.п.) — суди ИСКЛЮЧИТЕЛЬНО дифф текущего рабочего дерева ниже. Пустой или
нерелевантный дифф — повод для block, а не повод искать подтверждение где-то ещё.

ЗАДАЧА (${tid}): ${taskText}

--- git status --porcelain ---
${status}

--- git diff HEAD ---
${diff}

Дай вердикт pass или block с обоснованием — формат ответа проверяется автоматически (structured output).`;
}

function slurpDiff(cwd, cap = 12000) {
  try { execFileSync('git', ['add', '-N', '--', '.'], { cwd }); } catch { /* нет untracked */ }
  const diff = execFileSync('git', ['diff', 'HEAD'], { cwd, encoding: 'utf8' });
  const status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
  return { diff: diff.length > cap ? diff.slice(0, cap) + '\n…(обрезано)…' : diff, status };
}

// Прогнать судью. runOk=false = судья НЕ смог отработать (timeout/spawn-error/nonzero-exit/
// пустой вывод) — инфраструктурный сбой, НЕ вердикт. T021: caller паркует слайс на
// judge_pending вместо REJECT — сама реализация не виновата, передел не нужен.
// runOk=true → verdict читается из вывода, REJECT-default (нет явного pass → block).
async function runJudge({ cwd, tid, taskText, model = 'sonnet', timeoutMs = JUDGE_TIMEOUT_MS }) {
  const { diff, status } = slurpDiff(cwd);
  const prompt = judgePrompt(tid, taskText, diff, status);
  const r = await providers.run({ provider: 'claude', prompt, cwd, model, timeoutMs, jsonSchema: VERDICT_SCHEMA });
  if (!r.ok) return { verdict: null, judgeLog: r.logPath, runOk: false };
  // Чистый stdout (без stderr-примеси) — нужен для строгого JSON.parse структурированного
  // ответа. Лог-файл (stdout+stderr вперемешку) — только фолбэк для старого prose-парсера.
  let output = r.stdout || r.lastMsg || '';
  if (!parseStructuredVerdict(output)) {
    try { if (r.logPath && fs.existsSync(r.logPath)) output = fs.readFileSync(r.logPath, 'utf8'); } catch { /* лог не читается */ }
  }
  const verdict = parseVerdict(output) === 'pass' ? 'pass' : 'block';
  return { verdict, judgeLog: r.logPath, runOk: true };
}

// Полный гейт слайса. Возвращает {ok, stage?, verdict?, tid, ...}.
// stage: 'oracle' (красный оракул) | 'judge-unavailable' (судья не отработал, парковка,
// НЕ reject) | 'judge' (легитимный block) | 'commit' (git-фейл).
async function gate({ tid, taskText = '', cwd = process.cwd(), elt = ELT_CLI, judgeModel = 'sonnet' }) {
  // 0. окружение: без elt CLI гейт не может ни оракул, ни commit — быстрый явный отказ
  if (!fs.existsSync(elt)) return { ok: false, stage: 'env', tid, err: `elt CLI не найден: ${elt}` };

  // 1. оракул (неизменный, из harness.json worktree)
  const o = spawnSync('node', [elt, 'oracle'], { cwd, encoding: 'utf8' });
  if (o.status !== 0) return { ok: false, stage: 'oracle', tid, oracleExit: o.status };

  // 2. судья (обязателен, REJECT-default)
  const j = await runJudge({ cwd, tid, taskText, model: judgeModel });
  if (!j.runOk) return { ok: false, stage: 'judge-unavailable', tid, judgeLog: j.judgeLog };
  if (j.verdict !== 'pass') return { ok: false, stage: 'judge', verdict: j.verdict, tid, judgeLog: j.judgeLog };

  // 3. commit БЕЗ [X]-марка (без --task): оракул уже прогнан → --skip-oracle
  const msg = `feat: ${tid} ${taskText}`.slice(0, 90);
  const c = spawnSync('node', [elt, 'commit', '--skip-oracle', '--verdict', 'pass', '-m', msg], { cwd, encoding: 'utf8' });
  if (c.status !== 0) return { ok: false, stage: 'commit', tid, err: (c.stderr || c.stdout || '').trim() };
  return { ok: true, tid, verdict: 'pass', judgeLog: j.judgeLog };
}

module.exports = { gate, runJudge, parseVerdict, judgePrompt };
