# CHECKPOINT — elt-code петля + elt-work офис (2026-07-01)

> Мост в новый чат. Резюме-указатель для `/elt-code продолжить`.
> Живой хребет: `.planning/STATE.md`. План: `~/.claude/plans/imperative-churning-oasis.md`.
> Дедлайн демо: **вторник 07.07.2026** (проектор, машина юзера). Метод: **dogfood** (строим систему самой системой).

## Что строим (2 продукта)
- **elt-code** — автономная spec-driven петля для разработчиков (`/elt-code` → `/elt-loop`).
- **elt-work** — офисная система для нетехнарей (`/elt-work` → office-скилы + бизнес-скилы).

## Решения (из grill, зафиксированы)
1. Демо = оба продукта **на машине юзера** (не установка на чужие ПК — то отдельный этап после лицензий).
2. Центр демо — **автономная петля**; оракул = **гибрид** (тесты жёсткий гейт + судья advisory + коммит/доки на закрытии).
3. Оракул петли — **механика (тесты)**, судья — рассказчик (чинит «судья 0/46»).
4. Демо-репо — `C:\Ametrin projects\Ametrin web ecosystem 3` (AWE3, Rust+Node, spec-kit, husky-зубы).
5. capability для `/workflow/view` — **decision A** (fetch_manifest в момент view, без миграции).
6. **Коммит-политика:** elt-code = авто-коммит-на-зелёном; elt-work = всегда ручное подтверждение.
7. Память/состояние — **В ПРОЕКТЕ** (`.planning/STATE.md`), не в корень ПК.

## Сделано (7/8 пунктов, с доказательством)
| Пункт | Статус | Артефакт/доказательство |
|---|---|---|
| P1 петля | ✅ доказана end-to-end | `~/.claude/skills/elt-loop/SKILL.md`; live-fire на AWE3: `cargo test -p gateway` 7/7 → коммит `99625c7` через husky-гейт |
| P3 память-в-проект | ✅ | `.planning/STATE.md` (этот проект), шаг 5 project-bootstrap |
| P4 bootstrap reconcile | ✅ v1.3.0 | `~/.claude/skills/project-bootstrap/SKILL.md` (память-в-проект + git-гигиена) |
| P5 elt-onboard | скилл ✅, live-грилл ждёт юзера | `~/.claude/skills/elt-onboard/SKILL.md` |
| P6 elt-work + office | ✅ доказан | `~/.claude/skills/elt-work/SKILL.md` + 6 office-скилов; `.planning/office-demo/report.xlsx`+`.docx` |
| P8 CLAUDE.md | ✅ обрезан ~46 строк | `CLAUDE.md` (история — в git/PROJECT-HISTORY) |
| P7 loop-audit+репетиция | частично | STATE-хребет ✓; loop-audit заблокирован auto-mode; репетиция впереди |

## Новые/изменённые файлы
- Новые скилы: `~/.claude/skills/{elt-loop,elt-work,elt-onboard}/SKILL.md`
- Изменены: `~/.claude/skills/elt-code/SKILL.md` (провод в elt-loop), `~/.claude/skills/project-bootstrap/SKILL.md` (v1.3.0)
- Office-скилы установлены: `~/.claude/skills/{docx,xlsx,pptx,pdf,doc-coauthoring,internal-comms}`
- Этот репо: `CLAUDE.md` (обрезан), `.planning/{STATE.md,elt-work-office-research.md,office-demo/,этот checkpoint}`
- AWE3: ветка `feature/us1-slice2-aggregation`, коммиты `f39fae3` (baseline) + `99625c7` (слайс US1-2)

## Осталось к вторнику
1. **P5 live-грилл** — прогнать `elt-onboard` (интерактив, нужен юзер).
2. **P7 репетиция** — демо-сценарий 2–3 раза; `loop-audit` запустить с одобрения юзера (`! npx @cobusgreyling/loop-audit .`).
3. (опц.) ещё 1–2 слайса петли на AWE3 (T028 / US2), чтобы на демо было несколько закрытых слайсов.
4. (опц.) закоммитить артефакты сессии этого репо.

## ⚠ DEMO-ГОТЧИ (проверить на репетиции)
- **Office-скилы:** ambient `python` = Hermes-venv БЕЗ libs → гнать через `py -3` (openpyxl/python-docx уже в Python311). См. `.planning/elt-work-office-research.md`.
- **AWE3 петля:** нужен `docker compose up -d db` (Postgres) + `just`/`cargo`. Rust-компайл на проекторе медленный на холодную — прогреть заранее.
- **loop-audit** — внешний npm, auto-mode классификатор блокирует; юзер запускает сам.

## Демо-сценарий (черновик)
1. `/elt-code` на AWE3 → `/elt-loop` берёт задачу из `tasks.md` → пишет код → `cargo test` зелёный → авто-коммит через зубы-гейт (показать блок husky на «грязном» коммите).
2. `/elt-work` → «собери Excel-отчёт» → `xlsx` → `report.xlsx` на диске (через `py -3`), с ручным подтверждением.
3. Показать: память в `.planning/STATE.md` (в проекте), не в корне ПК.

## Resume в новом чате
`/elt-code продолжить роадмап` → маршрут 1 → этот checkpoint → STATE.md.
Или прямо: «продолжаем P5 live-грилл» / «ещё слайс петли на AWE3».
