# WORKING-SYSTEM — как работать с Claude (harness-метод)

> Замена AMOS. Лёгкий **per-project харнесс** по модели Fowler (guides + sensors +
> steering), без глобального per-turn налога. Опора: статья «Harness Engineering»
> + spec-kit как движок для кода + omnigent (декларативность + enforcement) как референс.

## Модель (одна строка)
Агент = Модель + **Harness**. Харнесс = **guides** (направляют ДО) + **sensors**
(ловят ПОСЛЕ) + **enforcement** (блок в нужный момент) + **steering loop** (растим
по повторам). Computational — дёшево/детерминированно, на каждое изменение;
inferential (LLM-судья) — дорого, выборочно; empirical (метрики) — реальный сенсор.

## Общий паттерн (любой домен)
```
desired-state guide → brief/spec → produce → sensor-check → gate → steering
```

## По доменам
| Домен | Guide (≈конституция) | Brief | Sensor (тип) | Gate |
|---|---|---|---|---|
| Код | архитектурные инварианты | spec.md | tests/lint/types/dep-граф — computational | блок pre-commit/CI |
| Маркетинг | brand voice, ICP, позиционирование | бриф кампании | LLM-судья по рубрике + SEO/факт-чек (inferential) → A/B (empirical) | перед публикацией |
| Бизнес | принципы, цели, рынок | PRD/GTM/decision | grill-me/red-team (inferential) → юнит-экономика (empirical) | перед тратой ресурсов |
| Дизайн | design-system, бренд | design brief | контраст/токены (comp) + ревью-рубрика + gstack (inferential) | перед хэндофом в код |

## Код — конкретно (через spec-kit)
- **Новый проект:** `specify init` → `/speckit-constitution` → на фичу: `specify→clarify→plan→checklist→tasks→analyze→implement`.
- **ЗУБЫ ПЕРВЫМИ:** foundational-таски = сенсоры + **блокирующий** pre-commit + CI, ДО кода фич.
- **Сенсоры по стеку:** TS (`tsc`+eslint-boundaries+dependency-cruiser+vitest) · Rust (`cargo check`/clippy+cargo-deny+`cargo test`, границы крейтов **компилятором**) · Python (ruff+mypy+import-linter+pytest).
- **Легаси:** не ретрофить всё — дешёвые сенсоры в блокирующий pre-commit + короткий `constitution.md`; спек-цикл только для НОВЫХ фич.

## Не-код (маркетинг/бизнес/дизайн)
- Сенсоры в основном inferential + empirical → опираемся на **качество guide** + **gate-перед-публикацией** + **метрики обратно**, не на авто-блок.
- **Церемония по необратимости:** дорого/необратимо (прод, ad-spend, найм) → больше гейта; черновик/идея → лёгкий guide, не зажимать креатив.
- Скиллы-плагины: `pm`, `research-autopilot`, `cto-playbook`, `design-an-interface`, `grill-me`, `gstack`/`agent-browser`, `obsidian-vault`.

## Память (durable, on-demand — НЕ инжект каждый ход)
- **Долгая:** `constitution.md` + `specs/*/` + `research.md` + `AGENTS.md`/`CLAUDE.md` + git.
- **Сессия:** `tasks.md` (прогресс) + git + `/checkpoint` (вручную при смене сессии).
- **Авто на компакте:** PreCompact-хук → `~/.claude/auto-checkpoints/precompact-*.md` (briefing: git + focus + рабочее дерево). **Единственный глобальный хук.**

## Steering / self-evolve (human-gated)
Повтор боли N× → `/learn` драфтит новый сенсор/правило → **ты ревьюишь и мёржишь**.
Никакой автономной мутации конфига и фонового авто-pull. Мёртвый/шумный сенсор — **удалить**.

## Плагины-скиллы
On-demand: `npx skills add vercel-labs/agent-skills` (пакет = vercel-labs/skills; пинить, вётить источник). **НЕ** авто-pull. spec-kit — это «код-плагин», один из.

## Красные линии (анти-AMOS)
1. НЕ инжектить в контекст каждый ход (ни доки, ни нуджи).
2. **Enforce, не nag** — контрол либо блокирует, либо молчит.
3. НЕ авто-мутировать конфиг / НЕ ставить в фоне.
4. Per-project конфиг; глобально — только PreCompact-хук + codegraph MCP.
5. Мёртвый/шумный контрол — удалять (steering).
6. **«Done» только с доказательством** (вывод build/test).
7. Бюджет токенов = метрика дизайна (раунды × префикс), а не побочка.

## Текущее состояние
- **Vanilla Claude** + 73 скилла + codegraph MCP; AMOS в бэкапе (`~/.claude/_backup-amos-full-2026-06-18`).
- **PreCompact-хук** активен (после рестарта).
- **Пилот:** `C:\Ametrin projects\Ametrin web ecosystem 3` (greenfield) — constitution v1.1.0 (Rust backend + React/TS front), feature 001 spec/plan/tasks готовы, deploy = Docker Compose.
- **Pending:** `/speckit-implement` Phase 1 (сенсоры + блокирующий pre-commit) + **live-fire гейта** в сессии пилота. ← единственный незакрытый шаг доказательства.
