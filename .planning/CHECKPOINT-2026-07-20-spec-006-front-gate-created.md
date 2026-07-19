# CHECKPOINT 2026-07-20 — spec 006 «ELT Front Gate» создана, ждёт утверждения юзера

## Контекст
Сессия e6d18838 (19–20.07): глубокий аудит харнесса по 63 JSONL-сессиям за 5 дней
+ GitHub-ресёрч. Вердикт: код 7/10, практика 4.5/10. Задний гейт (оракул→судья→
`elt commit`) жив (39 судейских вызовов, реальные block'и); передняя половина —
проза и не исполняется: grill 0, PlanMode 0, спеки без утверждения, ≤3 вопросов
на новый проект, драйвер 0 запусков за 5 дней, ctx7 ×2, новые проекты мимо
системы (copywrighter без git). Юзер скомандовал «запускай разработку роадмапа».

## Сделано
- `specs/006-elt-front-gate/spec.md` — решения: approve-гейт в CLI (hash-подпись
  как judge-proof), grill v2 (≥2 раундов, категории, концепты), spec lint
  (stories/риски/схема), `elt loop N` + implModel=sonnet/medium в драйвере,
  ctx7-гейт на commit (deps без лога → warn/block), SessionStart-онрамп (1 строка).
- `specs/006-elt-front-gate/tasks.md` — 18 слайсов (A: T001–T006 approve-гейт;
  B: T007–T008 grill v2; C: T009–T012 луп UX/экономика/run-log-fix;
  D: T013–T015 ctx7; E: T016–T018 онрамп/doctor/live-fire).
- Отчёт-аудит целиком — в чате той сессии; цифры: 19/38 elt-сессий, 26 AskUserQuestion
  вызовов/30 вопросов, git-commit-руками ×30, sonnet×23+opus×13 сессий, 81ч.

## ДАЛЬШЕ (Resume)
1. **Спека НЕ утверждена** — юзер должен сказать «утверждаю» (или поправить).
   Механики approve ещё нет (её строит T001) — фиксация словом в чате.
2. После утверждения — гнать слайсы: интерактивно `/elt` (Режим 1 подхватит
   `specs/006-elt-front-gate/tasks.md`, T001 первый) ИЛИ автономно:
   `powershell -File "C:\Claude playground\Pipiline setupper\tools\elt-loop.ps1" -Slices 4`.
   Судья sonnet обязателен; правки elt.js коммитить и в `~/.claude` (второй репо).
3. Вне scope здесь → спека 007 (кандидаты в spec.md §Вне scope: визуальный
   UI-гейт, no-test-no-slice, skills-discovery, fleet-ready-graph).
4. Ветка: `feature/006-elt-front-gate`. НЕ трогать чужой modified
   `.planning/elt-system-audit-latest.md`.
