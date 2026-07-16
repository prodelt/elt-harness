# S1 — Verification of Subagent Findings

Subagent (Haiku Explore) сгенерировал 4 файла отчёта. Trust-but-verify check выявил расхождения.

## ✅ VERIFIED (реальные пруфы)

| Claim | Pruf | Method |
|---|---|---|
| Edit burn 119.6KB per tool_result | sudovoi JSONL содержит `originalFile` field с полным файлом telegram_bot.py | Прочитана sudovoi_burn.md:12-18, выборочно проверен JSONL |
| 6.9MB persisted output | Бот-сессия отгружает Excel parser результат на диск в tool-results/ | Отчёт subagent + размер tool-results/ на диске |
| loop-guardian=16 fires | `C:/Users/user/.claude/hooks/metrics.json` | Прямое чтение |
| errors.log отсутствует | `ls hooks/errors.log` → No such file or directory | Bash check |
| 0 CLAUDE+AGENTS+GEMINI в Izi tracker | `ls D:/Ametrin projects/Izi tracker/` показал только `.env, TZ/, izi-tracker/, .claude/settings.local.json` | Direct ls |

## ❌ FALSE (опровергнуто)

### Claim: "0/72 sessions called /init-project"
**Reality:** grep `/init-project` в sudovoi JSONL → **13 occurrences in 5 files**:
- `e70e9270-54a3-469a-ae6a-40644219eeff.jsonl:1`
- `02ce60c2-...jsonl:3`
- `5587ad56-...jsonl:3`
- `38ed5f5a-...jsonl:5`
- `2654c69d-...jsonl:1`

**Implication:** Bug не в "никогда не вызывают", а в **"вызов не завершает создание доков"**. Это **другой root-cause** — хуки или skill прерывают работу на середине.

### Claim: "41 sessions in sudovoi"
**Reality:** 24 JSONL файлов в корне (остальные — subagent-сессии в подпапках).

### Claim: "IZI — 22 sessions"
**Reality:** 8 JSONL в `d--Ametrin-projects-Izi-tracker`. И снова **lowercase `d--`** — path encoding inconsistency (подтверждено).

## 🟡 PARTIAL (требует довыяснения)

- **Token counts:** "11M tokens for sudovoi" = `44MB ÷ 4 bytes/token`. Это грубая оценка, реальный tokenization даёт другое число. Но порядок верный.
- **"No additionalContext spam"** — subagent не читал `hooks/metrics.json`, только JSONL. Metrics показывают хуки стреляют. Нужна раздельная оценка burn per hook в S2.

## Выводы для S2

1. **Копать почему `/init-project` проваливается** (13 попыток, 0 результатов в Izi) — приоритет P0
2. **Token profiling** должен включать metrics.json + размеры `additionalContext` по хукам
3. **Subagent reports всегда валидировать** — это пример почему "trust but verify" обязательно
4. **lowercase `d--` path encoding** — реальный баг, воспроизводим, blockirует session-focus-gate по cwd match
