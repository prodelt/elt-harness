# S11 — Критерии успеха (12 измеримых)

Каждая метрика имеет **порог** и **точную команду** для измерения. Расплывчатых формулировок нет.

## Token / Session Health

| # | Метрика | Порог | Команда |
|---|---------|-------|---------|
| 1 | Средний размер сессии (7d avg) | ≤ 400 KB | `find ~/.claude/projects/ -name "*.jsonl" -mtime -7 -printf '%s\n' \| awk '{s+=$1;c++} END {print s/c/1024}'` |
| 2 | Сессий >1 MB за неделю | ≤ 1 | `find ~/.claude/projects -name "*.jsonl" -size +1M -mtime -7 \| wc -l` |
| 10 | Token burn per session (avg) | ≤ 60 K | `node ~/.claude/hooks/analyze-session.js ~/.claude/projects/ \| grep avg_tokens` |

## Continuity & Memory

| # | Метрика | Порог | Команда |
|---|---------|-------|---------|
| 5 | Harvest freshness | <24h | `node -e "console.log((Date.now()-require('fs').statSync(require('os').homedir()+'/.claude/session-harvest/latest.md').mtimeMs)/3600000)"` |
| 6 | % сессий с /checkpoint | ≥ 85% | считать в harvest.js: orphans/total |

## Skills & Cross-Tool Sync

| # | Метрика | Порог | Команда |
|---|---------|-------|---------|
| 4 | Skill drift Claude↔Codex↔Antigravity | 0 файлов | `diff -rq ~/.claude/skills/ ~/.codex/skills/ \| wc -l` |

## Hooks Health

| # | Метрика | Порог | Команда |
|---|---------|-------|---------|
| 3 | Тесты хуков | 100% pass | `node ~/.claude/hooks/test-all-hooks.js && node ~/.codex/test-codex-hooks.js && node ~/.claude/hooks/test-hooks-behavior.js` |

## Best Practices Loop

| # | Метрика | Порог | Команда |
|---|---------|-------|---------|
| 8 | ctx7 cache hit ratio | ≥ 40% | `grep -c "cache hit" ~/.claude/ctx7-cache/access.log` / total |

## TDD & Quality

| # | Метрика | Порог | Команда |
|---|---------|-------|---------|
| 7 | Coverage новых тестов | ≥ 80% | `jq '.total.lines.pct' coverage/coverage-summary.json` |

## Graphify & Indexing

| # | Метрика | Порог | Команда |
|---|---------|-------|---------|
| 9 | Graphify update lag после commit | ≤ 60 s | сравнить `git log -1 --format=%ct` с mtime graphify index |

## Git Discipline (НОВЫЕ)

| # | Метрика | Порог | Команда |
|---|---------|-------|---------|
| 11 | Коммитов в main напрямую за неделю | 0 | `git log main --since='7 days ago' --no-merges --first-parent \| grep -v Merge \| wc -l` (в каждом активном проекте) |
| 12 | Conventional-commits compliance | ≥ 95% | `git log --oneline --since='7 days ago' \| grep -cE '^[a-f0-9]+ (feat\|fix\|chore\|docs\|refactor\|test\|style\|perf\|build\|ci\|revert)(\([a-z0-9-]+\))?:'` / total commits |

## Измерение до / после

Выполнить до WAVE 1 (это ЗАДАЧА 01 — baseline) и после ЗАДАЧА 28 (final verify):

```bash
#!/bin/bash
# ~/.claude/scripts/s11-metrics.sh
OUT="${1:-/tmp/s11-metrics-$(date +%Y%m%d-%H%M).txt}"

echo "=== S11 Metrics ($(date -Iseconds)) ===" > "$OUT"

# 1. Average session size
find ~/.claude/projects/ -name "*.jsonl" -mtime -7 -printf '%s\n' 2>/dev/null | \
  awk '{s+=$1;c++} END {printf "1. avg_session_KB=%d\n", s/c/1024}' >> "$OUT"

# 2. Sessions >1MB
N=$(find ~/.claude/projects -name "*.jsonl" -size +1M -mtime -7 2>/dev/null | wc -l)
echo "2. sessions_over_1MB=$N" >> "$OUT"

# 3. Hook tests
node ~/.claude/hooks/test-all-hooks.js 2>&1 | tail -1 >> "$OUT"
node ~/.codex/test-codex-hooks.js 2>&1 | tail -1 >> "$OUT"

# 4. Skill drift
D=$(diff -rq ~/.claude/skills/ ~/.codex/skills/ 2>/dev/null | wc -l)
echo "4. skill_drift_files=$D" >> "$OUT"

# 5. Harvest freshness
if [ -f ~/.claude/session-harvest/latest.md ]; then
  AGE=$(( ($(date +%s) - $(stat -c %Y ~/.claude/session-harvest/latest.md)) / 3600 ))
  echo "5. harvest_age_hours=$AGE" >> "$OUT"
else
  echo "5. harvest_age_hours=NA (file missing)" >> "$OUT"
fi

# 11. Commits to main in active projects
for p in "/c/Claude playground/Pipiline setupper" \
         "/d/Ametrin projects/Izi-tracker" \
         "/d/Ametrin projects/Law-assistant" \
         "/d/Ametrin projects/sudoviy-master-try-3" \
         "/d/Ametrin projects/tg-bot-reclamaties-master"; do
  if [ -d "$p/.git" ]; then
    N=$(git -C "$p" log main --since='7 days ago' --no-merges --first-parent 2>/dev/null | grep -c '^commit')
    echo "11. $(basename "$p")/main_direct_commits=$N" >> "$OUT"
  fi
done

cat "$OUT"
```

## Baseline vs Target

| # | Baseline (2026-04-21) | Target (после S11) |
|---|------------------------|--------------------|
| 1 | ~1330 KB (avg) | ≤ 400 KB |
| 2 | 20+ | ≤ 1 |
| 3 | 86/86 | 95+/95+ |
| 4 | 6 файлов дрейф | 0 |
| 5 | NA (не существует) | <24h |
| 6 | unknown (нет tracking) | ≥ 85% |
| 7 | project-specific | ≥ 80% |
| 8 | 0% (нет кеша) | ≥ 40% |
| 9 | NA (вручную) | ≤ 60s |
| 10 | ~90K | ≤ 60K |
| 11 | ≥5 (все коммиты в main) | 0 |
| 12 | ~60% (неровная compliance) | ≥ 95% |
