# ARCHITECTURE — Agent OS v5 «AI-Company»

> Run: run-20260611224718-ce41e0 · Дата: 2026-06-12 · Статус: ОЖИДАЕТ АППРУВА
> Цель: агентная ОС уровня IT-компании поверх Claude Code + Codex + Gemini Antigravity,
> без утечек токенов: оркестратор (умная модель) + дешёвые исполнители (haiku),
> авто-графы кода, самообучение, автопоиск скиллов (skillgrab).

## 1. Исходное состояние (97/100)

| Подсистема | Состояние |
|---|---|
| AMOS v4 (SQLite-ядро, `~/.amos`) | Спринты 0-4 закрыты; hooks (SessionStart/PreTool/Stop) подключены ко всем 3 клиентам — doctor 9/9 PASS |
| Хуки | 48 команд Claude / 44 Codex; workflow advisory, hard-block только freeze/secrets/destructive |
| Скиллы | 47 + mattpocock (tdd, diagnose, grill-me, to-prd, to-issues, improve-codebase-architecture, caveman, write-a-skill уже стоят) |
| Графы | Graphify (1435 nodes) + CodeGraph MCP — активны в ЭТОМ проекте, авто-провижининга в чужих проектах нет |
| Token economy | Контекст-фикс 2026-06-11 (промпт ужат); но нет cost-ledger, нет enforcement haiku-сабагентов |
| skillgrab | MCP установлен; в skill-router v2 (S4) автопоиска по skills.sh нет |

## 2. Gap-анализ против 4 референсов

- **mattpocock/skills** — ядро уже установлено. Недостающие: `grill-with-docs` (shared language → CONTEXT.md + ADR), `zoom-out`, `prototype`, `handoff`. Принцип: малые композируемые скиллы, не монолитный процесс.
- **agency-agents (232 агента)** — брать НЕ агентов, а паттерн: триада {persona, process, success-metrics} + деплой из одного источника в 12 инструментов. У нас 6 шаблонов агентов — расширить до ~12 ролей «компании» с `model: haiku`.
- **CLI-Anything** — 7-фазный pipeline генерации скиллов: уже покрыт `skill-anything` + `write-a-skill`. Заимствуем: SKILL.md-автогенерацию из git-истории и «authentic backend» (реальные CLI вместо симуляции).
- **ECC** — главный донор. Заимствуем: cost-tracking в SQLite, instinct-based continuous learning (`/evolve`, confidence scoring, кластеризация → SKILL.md), MAX_THINKING_TOKENS cap, model routing enforcement, hook-profile (minimal/standard/strict).

## 3. Целевая архитектура AMOS v5

```
~/.amos (SQLite state.sqlite)
├─ sessions      (есть)            ├─ cost_ledger   (S5: tokens/model/tool/session)
├─ tool_policy   (есть, S3)        ├─ instincts     (S7: pattern, confidence, uses)
├─ preflight     (есть, S4)        └─ skill_index   (S7: локальные + skillgrab-кандидаты)
Команды: amos doctor|event|resume (есть) + amos cost (S5) + amos graph ensure (S6)
         + amos evolve (S7) + amos roster (S8)
```

**Модельный роутинг (enforcement, не бумага):**
- Оркестратор = текущая сессия (Opus/Fable). Исполнители = сабагенты `model: haiku` (просто/механика) или `sonnet` (код).
- PreToolUse-гейт AMOS: спавн Agent без явного дешёвого `model` → advisory warn; 3+ нарушения за сессию → block.
- ENV: `MAX_THINKING_TOKENS=10000`, `CLAUDE_CODE_SUBAGENT_MODEL=haiku` в settings.json.

**Токен-принципы (инварианты):** доки <150 строк; хуки инжектят 0Б после старта; codegraph-first вместо чтения файлов; тяжёлые tool-результаты → haiku-сабагент; compaction на milestone, не mid-implementation.

## 4. Спринты (каждый = ветка + harness-gates + verifyCloseout ok:true)

### S5 — Token Economy Engine (~/.amos)
- Таблица `cost_ledger`; Stop-hook пишет итог сессии (tokens in/out, модель, клиент).
- `amos cost [--session|--week]` — отчёт; порог-алерты (advisory) при аномальном расходе.
- Model-policy гейт: Agent-спавн без model → warn; env-tuning в settings.json всех 3 клиентов.
- Фикс `harness-runner.ps1` (битая переменная `$entry`, найдено сегодня).
- Done when: unit-тесты ledger PASS; doctor PASS; гейт срабатывает на тест-кейсе.

### S6 — Graph Bootstrap everywhere
- `amos graph ensure <cwd>`: нет `.codegraph/`+graphify-карты → авто-инициализация (bounded, <60s, без `graphify claude install`).
- SessionStart-hook: в чужом проекте без графа → 1 строка-подсказка + фоновый ensure.
- Done when: новый пустой проект получает граф автоматически; повторный заход — 0 лишних токенов.

### S7 — Self-Learning Loop + skillgrab autodiscovery
- Таблица `instincts`: Stop-hook извлекает паттерн-кандидаты (повторённые фиксы/команды) с confidence.
- `amos evolve`: confidence>0.8 и uses>=5 → кластеризация → черновик SKILL.md (через write-a-skill) → PR-style предложение, не авто-коммит.
- skill-router v2: при miss в локальном registry → `skillgrab recommend` → предложить install (только trusted owners).
- Установить недостающие mattpocock-скиллы: grill-with-docs, zoom-out, prototype, handoff.
- Done when: e2e — сессия с повторённым паттерном порождает instinct; evolve строит валидный SKILL.md; skill-router предлагает skillgrab-кандидата.

### S8 — Company Roster + Cross-tool parity
- 12 ролей-агентов (architect/planner/reviewer/security/qa/devops/frontend/backend/docs/triage/researcher/cost-auditor), все `model: haiku|sonnet`, триада persona+process+metrics.
- agent-surface-audit на 3 клиента; sync-копии AMOS в `amos/`; финальный doctor + score.
- Done when: roster доступен из 3 клиентов; doctor зелёный; .planning/PROJECT-HISTORY обновлён.

## 5. Риски
- Codex sandbox: тесты со spawn child node — гонять вне sandbox (известный gotcha).
- Хуки <4s: cost/instinct-запись — append-only, без сетевых вызовов.
- skillgrab supply-chain: install только после agent-skill-supply-chain audit + trusted owners.
- Antigravity: нет FileChanged/Notification — все новые хуки только на общих ивентах (SessionStart/PreTool/Stop).

## 6. Вне скоупа v5
232 агента agency-agents целиком; генерация CLI для стороннего ПО (CLI-Anything harnesses); авто-коммит самообучения без ревью человека.
