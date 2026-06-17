# ROADMAP — AMOS доработки, Фаза 2 (2026-06-17)

> Источник: анализ работы системы за 15-17.06 (6 сессий, 4 содержательных) + гипотеза
> о раздутых/конфликтующих инструкциях в проектах. Фаза 1 — `ROADMAP-AMOS-IMPROVEMENTS-2026-06-15.md`
> (Sprints 0-4 закрыты). Все «done» — только с доказательством (вывод verify/test).

## Контекст: что показал анализ 2 дней

Два дня система **строила сама себя** (закрыла Sprints 0-4 фазы 1). Цикл самоулучшения
замкнулся — это плюс. Но система **проигнорировала собственные правила ровно там, где их же чинила**:

| Факт (измерено по JSONL) | Значение |
|---|---|
| Спавнов субагентов за 4 сессии | **1** (reviewer, отработал хорошо) |
| `codegraph_context` vs Read+Grep | **3 vs 110** |
| Вызовов `/checkpoint` | **0** |
| Самая длинная сессия | **12.9 ч**, 35.8M токенов, упёрлась в `/compact` |
| Доля cache_read | 87-97% (кэш — единственное, что экономно) |

Корневой паттерн (повтор из `ai_os_healing`): **advisory ≠ enforcement**. Гейты пишутся,
но себя система ими не дисциплинирует.

## Гипотеза пользователя (проверена на фактах)

> «В каждом проекте уже прописаны CLAUDE.md и инструкции, которые не дают Клоду работать;
> в первую очередь нужен скилл, который обновляет и приводит в порядок инструкции для
> Claude/Codex/Gemini в проектах.»

**Подтверждено частично — для ТЯЖЁЛЫХ проектов, не для всех.** Скан рабочих директорий
(`C:\Claude playground`, `D:\Ametrin projects`):

| Проект | Строк (лимит 150) | Дрейф между 3 доками |
|---|---|---|
| Garvis / AGENTS.md | **649** | да: AGENTS 649 ≠ CLAUDE 311, GEMINI.md **отсутствует**, `verify`=FAIL |
| Задача фузи музи | CLAUDE 328 / GEMINI 304 | раздут + дрейф |
| supermaket scrapper | CLAUDE 315 / AGENTS 220 | раздут + дрейф |
| Claude code remote | CLAUDE 269 | раздут |
| ~половина проектов | ≤150, триада совпадает | норма (Penetration 101/101/101, Subnautica 84/84/84) |

**Что уже есть и чего НЕ хватает.** `tools/project-docs.js` имеет только `init` / `sync` /
`verify`. Они держат **структуру** (6 секций) и **синхронность** (3 файла идентичны),
сохраняя protected-блоки. Но:

- **Нет аудита качества**: раздутость (>150 стр.), мёртвые ссылки на несуществующие файлы,
  правила, дублирующие/противоречащие глобальному `~/.claude/CLAUDE.md`, advisory-шум.
- **Не enforced**: Garvis висит в FAIL (нет GEMINI.md, 649 строк) — никто не гоняет `verify`
  по проектам. Это та же болезнь advisory-режима.

**Вывод по гипотезе:** ответ — **НЕ новый параллельный скилл** (это была бы ровно та раздутость,
с которой боремся), а расширить существующий движок аудитом + кросс-проектным прогоном +
enforcement, и дать одну тонкую точку входа `/doc-hygiene`.

---

## Sprint 1 — Doc-Hygiene engine (Priority 0, гипотеза пользователя)

**Цель:** привести инструкции для Claude/Codex/Gemini во всех проектах в порядок и не дать им
снова раздуться. Расширяем `tools/project-docs.js`, не плодим скиллов.

**Задачи:**
1. `project-docs.js audit --root .` — новая команда поверх `verify`. Проверяет:
   - **bloat**: любой из 3 доков >150 строк → WARN, >250 → FAIL;
   - **drift**: core-секции не идентичны (переиспользует логику verify);
   - **dead refs**: пути/файлы (`.planning/...`, относительные ссылки), упомянутые в доках, но
     отсутствующие на диске;
   - **global-conflict**: строки правил в проектном `CLAUDE.md`, дословно дублирующие
     `~/.claude/CLAUDE.md` (должны быть удалены — проект дополняет, не дублирует глобал);
   - **advisory-noise**: доля «правил» к содержательным секциям.
   Вывод — структурный отчёт + оценка PASS/WARN/FAIL.
2. `project-docs.js audit-all` — обходит `~/.claude/projects-registry.json` (фолбэк: скан
   `C:\Claude playground` + `D:\Ametrin projects`), гоняет `audit` по каждому, печатает
   ранжированную таблицу (худшие сверху: Garvis 649, фузи музи 328…).
3. `/doc-hygiene` — тонкий entry-скилл: делегирует в `audit-all`, затем чинит худшие
   **по одному** (`sync` + ручной trim раздутого), protected-блоки не трогает.
4. SessionStart-advisory: расширить текущий хинт («DOCS CONFLICT… /sync-docs») детектом bloat.

**Done when (доказательство):**
- `audit-all` печатает таблицу, в которой Garvis/фузи музи/scrapper помечены FAIL/WARN;
- чиним Garvis через `/doc-hygiene` → показать `verify` ДО (FAIL) и ПОСЛЕ (PASS) + новые
  размеры ≤150;
- юнит на `audit` (bloat/dead-ref/global-conflict детекты) проходит — показать вывод.

---

## Sprint 2 — Боевой тест субагентов (валидация Sprint 0 фазы 1)

**Цель:** доказать, что `subagent-verify-gate` реально работает. За 2 дня его не на чем было
проверить — editor-субагентов запустили 0 раз, всё писал главный поток.

**Задачи:**
1. Взять реальную multi-file задачу и **принудительно** прогнать через `backend`/`devops`-субагентов.
2. Намеренно: субагент меняет код без теста → verify-gate должен **HARD BLOCK** («SUBAGENT VERIFY REQUIRED»).
3. Субагент меняет `.tsx`/`components` без скриншота agent-browser → **UI VISUAL GATE** блок.

**Done when:** в `policy_events` появились реальные записи срабатывания gate (не текст кода) —
показать строки лога.

---

## Sprint 3 — Enforcement /checkpoint (advisory → hard nudge) (✅ закрыт 2026-06-17)

**Цель:** `/checkpoint` вызывался 0/4 раз; harvest хронически кричит «23/34 без checkpoint».

**Задачи:**
1. Порог: после N edits (напр. 15) или M минут без checkpoint — Stop/UserPromptSubmit-хинт с
   нарастающей настойчивостью; при превышении 2× порога — требовать `reason` для пропуска
   (по образцу ship-gate skip).
2. Не hard-block работу, но логировать пропуск в `policy_events`.

**Done when:** искусственно превысить порог → хинт появляется → пропуск с reason пишется в лог.

**Сделано (2026-06-17):**
- `lib/checkpoint-state.js` (новый shared-модуль) + `checkpoint-edit-tracker.js` (PostToolUse
  Edit|Write, инкремент editsSinceCheckpoint) + `checkpoint-nudge-gate.js` (UserPromptSubmit,
  tier1 при 15 edits/60м, критич при 2× — 30/120). Explicit `/checkpoint` в промпте сбрасывает
  счётчик. Порог — `cfg.checkpointNudge` (`lib/config.js` + `config.json`). Оба хука вписаны в
  существующие группы `UserPromptSubmit`/`PostToolUse Edit|Write` в `settings.json`.
- Skip-with-reason на критич. tier — тот же паттерн, что `ship-gate.js` (skip-файл в
  `%TEMP%/claude-checkpoint-gate/`, 1ч валидность, one-time consume). Без reason → нудж не
  снимается, пропуск логируется как `checkpoint-nudge-skip-denied`. Никогда не `decision:block` —
  только `additionalContext`, промпт всегда проходит.
- Тесты: `test-all-hooks.js` 38/38, `test-hooks-behavior.js` 58/58 (+6 на tier1/tier2/skip/reset).
- **Live-fire доказательство** (не юнит-тест — отдельный прогон через реальные stdin-вызовы):
  15 edits → tier1-нудж "CHECKPOINT: 15 edits..."; 30 edits → критич "...КРИТИЧНО...2x порога...";
  skip без reason → денай (нудж остаётся); skip с reason → тишина. `amos policy --since 1d`
  показал реальные строки `checkpoint-nudge-tier1`, `checkpoint-nudge-critical`,
  `checkpoint-nudge-skip-denied`, `checkpoint-nudge-skip-override` (с текстом reason); видно и в
  `amos doctor` сводке. Детали и gotcha само-тестирования —
  `memory/project_phase2_sprint3_checkpoint_nudge_2026-06-17.md`.

---

## Sprint 4 — Точный подсчёт токенов + анти-компакт (✅ частично реализован 2026-06-17)

**Цель:** считать реальную занятость контекста (не байты) и перед авто-компактом авто-готовить
продолжение без потери контекста.

**Сделано (2026-06-17):**
- `lib/active-window.js: lastContextTokens()` — реальная занятость = `input + cache_read +
  cache_creation` последнего `usage` (output исключён). Байты/6 — только fallback при отсутствии usage.
- `context-budget-gate.js` переведён на реальные токены + `%` от лимита (200k). При ≥85% —
  критический директив: `/checkpoint` → обновить MEMORY → `/handoff` → выдать промпт-продолжение.
- Доказано: синтетика (177k→89%→critical, 50k→тишина) + хук-сьюты 36/36 и 52/52.

**Осталось:**
1. PreCompact-хук (Claude-only) для авто-срабатывания даже без следующего промпта пользователя.
2. Детект длительности (≥6ч) и усиление «1 цель = 1 сессия» в SessionStart focus-хинте.

**Done when:** PreCompact генерирует handoff до компакта — показать.

---

## Sprint 5 — Честный policy_events лог (наблюдаемость гейтов)

**Цель:** при анализе невозможно отличить реальное срабатывание гейта от текста кода в диффе
(grep по JSONL даёт ложные счётчики). Гейты должны писать события в отдельный лог.

**Задачи:**
1. Каждый hard/soft gate (verify, ship, plan, checkpoint, config-protection) пишет
   структурную строку в `policy_events` (SQLite AMOS): `{ts, gate, action, reason, session}`.
2. `amos policy` / `amos doctor` показывает сводку срабатываний за период.

**Done when:** `amos policy --since 1d` печатает реальные срабатывания; число > 0 после Sprint 2-4.

---

## Sprint 6 — CodeGraph/Graphify-only чтение + целостность графов

**Цель:** Claude, Codex и Gemini читают структуру кода ТОЛЬКО через codegraph/graphify, а не
россыпью Read/Grep. Анализ 15-17.06: 3 вызова `codegraph_context` против 110 Read+Grep — «движок»
остаётся театром. Плюс граф должен корректно создаваться/обновляться и не ломаться
(история 12.06: графы были забиты `node_modules` → агент читал файлы пачками).

**Задачи:**
1. **Enforcement чтения:** read-gate (полный Read кодофайла >80 строк → deny) уже есть для Claude;
   зеркалировать гейт в Codex (`~/.codex/hooks.json`) и Gemini-обвязку, чтобы правило было
   кросс-клиентским, а не только Claude. Точечный Read (limit/offset) и литеральный grep — разрешены.
2. **Целостность графа:** хук/`amos graph ensure` гарантирует: (а) `.codegraph/` существует и свежий
   (`index --force` при устаревании); (б) `node_modules`/`vendor`/`dist` в `.gitignore` и НЕ в индексе;
   (в) после индексации — sanity (Files indexed > 0, нет мусорных путей), иначе предупреждение.
3. **Метрика честности:** считать долю codegraph-вызовов к Read/Grep за сессию (harvest);
   при перекосе в сторону Read по кодофайлам — нудж «используй codegraph_context».
4. Graphify создаётся только через `graphify update .` (не `graphify claude install` — запрещено).

**Done when:** на тест-проекте граф пересоздаётся корректно (Files indexed>0, без node_modules);
Codex/Gemini read-gate блокирует полное чтение; harvest показывает долю codegraph/Read.

## Порядок и зависимости

1. **Sprint 1** — независим, наибольший внешний эффект (чинит все проекты). Старт первым.
2. **Sprint 5** — инфраструктура наблюдаемости; желательно до 2-4 (чтобы было что мерить).
3. **Sprint 2-4** — enforcement; опираются на лог из Sprint 5.

> Реализация — в НОВОМ чате, по одному спринту = одна сессия (не повторять ошибку 12.9ч).
