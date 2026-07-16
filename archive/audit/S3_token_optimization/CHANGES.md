# S3 — Token Optimization Wave 1

**Date:** 2026-04-17
**Target bugs:** B02 (autocompact premature), B13 (verbose context warning)
**Status:** ✅ done — все 80/80 тестов зелёные

## Что изменилось

### 1. `~/.claude/settings.json` (B02 fix)

`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`: `"65"` → `"88"`

**Почему:** 65% от 200k (Opus) = форсированный компакт на 130k, живого окна ~50k после SessionStart + hooks. Сессии умирали за 3 запроса, как репортил юзер.

**Эффект:** 88% = компакт на 176k. Полезное окно вырастает с ~50k до ~100k (+2x). Честно, не 50x и не 5x, а ~2x на прямолинейных сессиях.

### 2. `~/.claude/hooks/config.json` (B02 tuning)

```diff
 "contextBudget": {
-  "thresholdTokens": 80000,
-  "repeatIntervalTokens": 20000,
+  "thresholdTokens": 130000,
+  "repeatIntervalTokens": 30000,
   "singlePromptWarnTokens": 40000,
   "charsPerToken": 6
 },
```

**Почему:** 80k warn + 65% autocompact стрелял первый раз почти сразу, повторял каждые 20k → шум. 130k warn (65% от 200k) = первое напоминание реально накануне компакта, повтор 30k = 2-3 напоминания за сессию вместо 5-7.

### 3. `~/.claude/hooks/context-budget-gate.js` (B13 fix)

Убрал 3-строчный verbose output, оставил 1 строку.

**Было** (~200 chars):
```
CONTEXT BUDGET: ~140k tokens used. MANDATORY: 1) Save to MEMORY.md 2) Update CLAUDE.md if needed 3) Summary of done/pending. Repeats every 30k tokens until memory is saved.
```

**Стало** (~32 chars):
```
Ctx ~140k. Save MEMORY.md soon.
```

Escalation на 2-й и 3-й повтор: `Ctx ~Xk (Nx). Save MEMORY now.` / `Ctx ~Xk CRITICAL (Nx). /learn + save MEMORY.`

**Эффект:** -85% char/warning × 2-3 warnings/session = ~500 chars экономии за сессию. Ерунда? Да, индивидуально. В сумме с B03 (originalFile burn, будет в S4+) и правильным autocompact — ощутимо.

## Proof тестов

```
test-all-hooks.js        26/26 PASS
test-hooks-behavior.js   29/29 PASS
test-codex-hooks.js      25/25 PASS
Total: 80/80 PASS
```

Ручная проверка новых значений:

```
Input:  140k-sized transcript
Output: {"hookSpecificOutput":{"hookEventName":"UserPromptSubmit",
         "additionalContext":"Ctx ~140k. Save MEMORY.md soon."}}

Input:  100k-sized transcript (под порогом 130k)
Output: [пусто] — silent, как и задумано
```

## Что НЕ вошло (перенесено)

- **B19 memory semantic windowing** — требует рефакторинг SessionStart. S5 или S8.
- **B09 skill_listing + B18 lazy skill descriptions** — harness-level, не починить хуками. S8 (recommendation-only).
- **B03 Edit originalFile burn (119KB/edit)** — harness-level, но можно workaround через skill-level правило "для больших файлов — Write целиком". S5.

## Next

S4 в новом чате:
- B01: errors.log dead (logger.js не используется в 27 хуках)
- B05: tool-results/ cleanup (6.9MB+ накопилось в sudovoi)
- B06: lowercase `d--` path encoding (blockirует session-focus-gate)
- B07: edit-enforcer metrics miss
- B10/B11: loop detection upgrades
- B15: loopGuardian.blockAt escalation
