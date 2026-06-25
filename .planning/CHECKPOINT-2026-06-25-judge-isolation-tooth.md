# CHECKPOINT 2026-06-25 — Зуб изоляции судьи

## Контекст
Кросс-проектный аудит 2026-06-25 нашёл корень провала судьи: **self-judge театр**
(14 вердиктов, 0 block, 0 изолированных субагентов). Подтверждено по JSONL всего ПК —
`isSidechain:true` и `"name":"Task"` встречаются **0 раз** во всех транскриптах: судья ни разу
не запускался отдельным субагентом, всегда инлайн в своём же контексте → 100% pass.

## Сделано
1. **Зуб в `judge-closeout-gate.js`** — хук теперь сверяет транскрипт: залогированный
   `judge_verdict:pass` без реального изолированного субагента (`isSidechain`/`Task` с `timestamp` ≥
   момента классификации) = inline self-judge, **НЕ засчитывается** → `decision:block` с явным текстом.
   Sidechain-события пишет только харнесс — модель их не подделает. Старое поведение (нет вердикта →
   block) сохранено. + runnable `--self-check`.
2. **SKILL.md elt-code → 0.9.1** — Шаг 4: «в Claude ВСЕГДА Task-субагент, не инлайн» теперь условие
   гейта, не стиль. Подавать субагенту только дифф + спеку. Зеркало в codex/gemini (0.9.0→0.9.1).
3. **Пропагация** — обновлённый хук через `tools/install-harness-teeth.js --gate` в Geocode 1c /
   fasoli-2.0 / Itstep_AI (байт-идентично, self-check на копии зелёный). Itstep_AI — не git-репо.
4. **.gitignore чужих репо** — Fasoli/Geocode: `.claude/settings.local.json` в игнор (per-machine
   шум), `.claude/hooks/*.js` остаются коммитимыми. Itstep пропущен (не git).
5. **Ветка** `feature/elt-code-judge-teeth` от текущего HEAD; убран мусор `--full-page` (PNG).

## Проверка (live-fire end-to-end)
```
A inline self-judge -> BLOCK  ✓   (новый зуб кусает)
B isolated subagent -> ALLOW  ✓   (без ложных блоков)
C no verdict        -> BLOCK  ✓   (регрессия сохранена)
judge-closeout-gate self-check: ok
3 копии IDENTICAL источнику
```

## Открыто / дальше
- Live-validation на реальной задаче: судья как Task-субагент, увидеть первый **block** в ledger
  (block-ratio пока 0% — изменится только при реальном использовании).
- Ceiling зуба: ЛЮБОЙ sidechain после классификации засчитывается за судью (proxy). Если рядом с
  closeout начнут крутиться Explore/Plan-субагенты — ужесточить матчингом промпта Task на «судья».
- Фаза B (eval-флайвил из накопленных `judge_verdict`) — по-прежнему отложена.
