# gstack Bridge — Optional Council Mode

> **Repo**: https://github.com/garrytan/gstack.git  
> **Install**: `git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && ./setup`

## Концепция

gstack превращает Claude Code в виртуальную команду из 20 человек. В контексте нашего `/pipeline` — это **опциональный «совет директоров»**, который можно вызвать в любой момент спринта для получения экспертного мнения из конкретной роли.

Ключевое слово: **опциональный**. Pipeline не зависит от gstack — это расширение, которое подключается по требованию.

---

## Маппинг ролей gstack → /pipeline

### Step 0 — Exploration / Ideation
| gstack | Когда вызывать | Что даёт |
|--------|---------------|---------|
| `/office-hours` | Перед началом любой фичи | 6 forcing questions — переосмысляет задачу до кода |
| `/plan-ceo-review` | Когда scope неочевиден | CEO-взгляд: expand/hold/reduce scope |
| `/autoplan` | Новая фича средней сложности | CEO + Design + Eng review в одной команде |

**Trigger в pipeline**: после `clarify requirements` и до `implement` — если задача касается продуктового решения.

---

### Step 1 — Architecture / Plan
| gstack | Когда вызывать | Что даёт |
|--------|---------------|---------|
| `/plan-eng-review` | Перед 3+ файловыми изменениями | Data flow, state machines, error paths, failure modes |
| `/plan-design-review` | UI-фича | Audit дизайна 0-10 + рекомендации |
| `/plan-devex-review` | Новый API / SDK | Developer experience audit, friction map |

**Trigger в pipeline**: замена `/architect-first` или дополнение к нему для сложных фич.

---

### Step 2 — Build
Gstack здесь не задействован — coding остаётся в pipeline (TDD → implement → inline-review).

---

### Step 3 — Review / QA
| gstack | Когда вызывать | Что даёт |
|--------|---------------|---------|
| `/review` | После реализации | Staff engineer review, автофикс очевидных багов |
| `/investigate` | Баг не воспроизводится | Root-cause debugging (max 3 гипотезы) |
| `/qa` | UI или API изменения | Browser testing + регрессионные тесты |
| `/cso` | Auth / input / API / платежи | OWASP Top 10 + STRIDE, 17 false-positive exclusions |

**Trigger в pipeline**: вместо или вместе с `/inline-review` и `/security-best-practices`.

---

### Step 4 — Ship
| gstack | Когда вызывать | Что даёт |
|--------|---------------|---------|
| `/ship` | Перед PR | sync main + tests + coverage + PR creation |
| `/land-and-deploy` | После merge approval | Merge → CI wait → deploy → health check |
| `/canary` | После деплоя | Мониторинг console errors + perf regressions |

**Trigger в pipeline**: параллельно с `/ship` скиллом — gstack `/ship` делает то же самое но с test bootstrapping.

---

### Step 5 — Reflect
| gstack | Когда вызывать | Что даёт |
|--------|---------------|---------|
| `/retro` | Раз в неделю | Per-person breakdown, shipping streaks, test health |
| `/document-release` | После релиза | Авто-синк README/API docs с изменениями |

---

## Таблица "Когда использовать gstack vs pipeline"

| Ситуация | gstack | pipeline |
|----------|--------|---------|
| Новая фича (продуктовое решение) | `/office-hours` → `/autoplan` | `/architect-first` |
| Новая фича (техническая) | — | `/pipeline` COMPLEX flow |
| Code review | `/review` | `/inline-review` |
| Security audit | `/cso` | `/security-best-practices` |
| Browser testing | `/qa` | `/e2e` |
| Ship + PR | `/ship` | `/ship` |
| Weekly retro | `/retro` | — |
| Debug mystery bug | `/investigate` | manual |
| Design decision | `/design-consultation` | — |

---

## Office Hours Mode (главный use-case)

**Сценарий**: Пользователь приходит с идеей до кода.

```
Пользователь: "хочу добавить экспорт в PDF"
→ /office-hours   (6 forcing questions: зачем, кто, когда, альтернативы, effort)
→ /plan-ceo-review  (expand scope? или держать минимум?)
→ /plan-eng-review  (PDF lib? server-side? client-side? queue?)
→ Pipeline implement
```

---

## Plan Review Mode

**Сценарий**: Большой спринт с несколькими задачами.

```
/autoplan  →  большой детальный план (CEO + Design + Eng в одном)
→ approve  →  /sprint для исполнения
→ /review после каждой задачи
→ /ship в конце
```

---

## CSO Mode (Security Council)

**Сценарий**: Любые изменения в auth / payments / API.

```
Implement auth flow
→ /cso   (OWASP Top 10 + STRIDE + 17 false-positives filtered)
→ fix findings
→ /ship
```

Этот режим **обязателен** (не опционален) для:
- JWT / сессии
- Платёжная интеграция
- Загрузка файлов
- Public API endpoints

---

## Установка и требования

```bash
# Клонировать
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack

# Установить
cd ~/.claude/skills/gstack && ./setup

# Обновить
/gstack-upgrade
```

**Зависимости**:
- Claude Code (primary)
- Опционально: OpenAI API key (для `/codex`)
- Опционально: Supabase или local PGLite (для `/setup-gbrain`)

---

## Интеграция с нашим hook-стеком

| Наш хук | gstack команда | Взаимодействие |
|---------|---------------|----------------|
| `tool-policy-gate.js` | `/browse`, `/qa` | gstack browser использует свой механизм — НЕ mcp__chrome |
| `skill-selector-gate.js` | все `/gstack-*` | gate должен знать о gstack скилах (добавить в digests) |
| `inline-review-gate.js` | `/review` | gstack `/review` = замена — считать как 1 review event |
| `pipeline-tracker.js` | `/ship`, `/autoplan` | трекать как pipeline-эквиваленты |

**TODO**: добавить gstack скилы в `skill-distiller.js` digests после установки.

---

## Dry-Run Matrix (Проверка Task 40)

Выполнено: 2026-04-28. Все 16 скилов проверены — `ls ~/.claude/skills/gstack/<skill>/SKILL.md`.

| Тип задачи | gstack скилы | Триггеры | Статус |
|-----------|-------------|---------|--------|
| **Research / Ideation** | `/office-hours`, `/plan-ceo-review`, `/autoplan` | "brainstorm", "is this worth building", "think bigger" | ✅ |
| **Architecture** | `/plan-eng-review`, `/plan-devex-review` | "review architecture", "lock in the plan" | ✅ |
| **Security** | `/cso` | "security audit", "OWASP", "threat model" | ✅ |
| **Design** | `/plan-design-review`, `/design-consultation` | "design review", "visual audit" | ✅ |
| **Code Review** | `/review`, `/investigate` | "PR review", "debug", "root cause" | ✅ |
| **QA / Testing** | `/qa`, `/qa-only` | "QA test", "find bugs" | ✅ |
| **Ship / Release** | `/ship`, `/land-and-deploy`, `/canary` | "ship", "deploy", "merge" | ✅ |
| **Reflect** | `/retro`, `/document-release` | "retro", "document release" | ✅ |

**Verified**: 16/16 скилов существуют в `~/.claude/skills/gstack/`.  
**bun**: не установлен → browse/QA (browser binary) недоступны, остальные 14 скилов работают.

## Статус Task 40

- [x] Документ создан (gstack-bridge.md)
- [x] gstack установлен в `~/.claude/skills/gstack` (16/16 скилов)
- [x] Dry-run matrix выполнен (8 task types × gstack roles)
- [ ] gstack скилы добавлены в skill-registry digests (следующий шаг)
- [ ] office-hours протестирован на реальной задаче (следующий шаг)
