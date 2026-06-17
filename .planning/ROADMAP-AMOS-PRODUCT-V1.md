# ROADMAP — AMOS Product v1 (устанавливаемая AI OS)

> Источник: design-interview (`/grill-me`) 2026-06-18. Это «brain-first» путь:
> v1 = устанавливаемое CLI-ядро, GUI-«окно» = v2. Фиксирует решения + доказательную
> базу аудита, чтобы пережить компакт контекста. Полный план фаз — внизу.

## Цель
Превратить размазанный по 3 обжитым репо личный пайплайн (AMOS) в ОДИН чистый
устанавливаемый продукт: `npm i -g amos` → `amos init` → умный мозг подцеплён в
Claude Code / Codex / Gemini, кросс-платформенно, с лёгким добавлением скиллов и
самоизмерением. «Окно с тремя терминалами» — отдельный продукт v2 поверх API мозга.

## Зафиксированные решения (D1–D8)
- **D1. Аудит = GO/NO-GO гейт.** В v1 едет только то, у чего есть воспроизводимый
  пруф ценности. Театр → чиним до пруфа или режем.
- **D2. «Готов/эффективен» = меняет поведение** (не зелёные тесты). Планка Green:
  тесты + срабатывает в реальных сессиях + override/skip < ~10%. Amber = заточить/урезать.
  Red = резать.
- **D3. v1 = мозг-first, устанавливаемый CLI.** GUI-«окно» отложено в v2 (окно —
  commodity: Warp/VS Code/Zellij; ров — мозг).
- **D4. Кросс-платформа v1** (win/mac/linux). Проектируем кросс-платформенно сразу,
  Green на Windows первым, CI-матрица GitHub Actions. Убрать 3 Windows-изма:
  junction'ы, `cmd /c`, разделители путей.
- **D5. Один чистый product-monorepo**, `packages/{kernel,hooks,skills,agents,tools,installer}`.
  Дистрибутивную поверхность вытащить из 3 обжитых репо; runtime-состояние остаётся
  в доме юзера, в репо не едет.
- **D6. Скелет-first.** Slice 0 = механический перенос + зелёный CI на 3 ОС + `amos init`
  в песочницу green. Ноль новой логики. Поведенческая починка — уже внутри нового репо.
- **D7. Синк = один канонический источник + capability-проекция под клиента**
  (Codex без Notification, агенты только Claude). Идемпотентный `amos sync`; copy/symlink,
  не junction; **без daemon в v1**.
- **D8. Метод аудита = гибрид.** Майнить 44 сессии JSONL для v1-среза + статик-ревью
  спорных + вшить единый «module-fired» лог → система самоизмеряющаяся (субстрат «умнее»).

## Находки аудита (доказательства, 2026-06-18)
- `node tools/doctor.js` → **PASS=32 / WARN=6 / FAIL=0**. НО проверяет наличие/парсинг,
  не эффект (registry OK, YAML OK, files reachable). Зелёный doctor ≠ работающая система.
- `test-hooks-behavior.js` → **71/71 PASS** (память говорила 44/44 — выросло).
- `amos doctor` → всё PASS, кроме `agent-browser --offline` (FAIL, чинится `--repair`).
  Хуки во всех 3 CLI: session-start/stop/pre-tool.
- **policy_events за 1д (enforcement ЖИВОЙ):** subagent-verify 66 (override 16),
  config-protection 41, read-gate 15, precompact-handoff 30, checkpoint-nudge crit 28 /
  tier1 14 / skip+override+denied ~39. → Память «policy_events=0 / read-gate 1× за 2 дня»
  **УСТАРЕЛА**. Новая болезнь — **усталость fire-and-dismiss**, не отсутствие гейтов.
- **Сцепление с машиной слабее ожидаемого:** `os.homedir()/USERPROFILE` в 15+ хуках;
  хардкод `user` в основном в тест-фикстурах (21/25). Windows-замки = junction'ы + 2× `cmd /c`.
- **Структура:** `~/.amos` — чистое ядро (bin/amos.js 983 LOC + 10 lib-модулей).
  `~/.claude` — обжитой дом с мусором (_backup×3, daemon, homunculus, get-shit-done, cache…).
  tools живут в ЭТОМ репо (57). Поверхность: **72 хука / 71 скилл / 16 агентов / 2 пака**.
- **Телеметрия (state.sqlite):** policy_events 350, cost_ledger 163, events_metrics 218,
  sessions 44, handoffs 35, projects 12, **instincts 7**.
- **ГЛАВНАЯ ДЫРА:** policy_events покрывает только ~12 гейтов; **~60 хуков + 71 скилл
  телеметрически слепые**. Использование скиллов — только в JSONL. `instincts=7` → петля
  обучения почти не сработала (Amber всей подсистемы «умнее»).
- **Конкретные Amber-дефекты гейтов:** `checkpoint-nudge` срабатывает по ВРЕМЕНИ, не по
  работе (1 edit / 530+ мин → critical 2x = ложняк); `config-protection` 100+ блоков
  одних и тех же eslint/prettier; `subagent-verify` override ~24%.
- **UX-баг:** `amos --help` не выдаёт ничего.

## Зафиксированные решения (D9–D11) — подтверждено 2026-06-18
- **D9. Единый `amos skill add/list/vet/remove`.** Источники: локальная генерация |
  skills.sh/skillgrab | git URL. Авто-vet SkillSpector-гейтом → проекция в 3 клиента (D7)
  → регистрация телеметрии (D8). Скилл без заработка по телеметрии → на вылет.
- **D10. Дистрибуция = npm global** (`npm i -g amos`) + `amos init`/`amos uninstall`
  (реверсивно, идемпотентно, детект клиентов) + `npx amos` для пробы. brew/winget — после v1.
- **D11. Лицензия = Apache-2.0** (патентный грант), публичный GitHub, контрибуция скиллов
  через PR + vet-гейт. Governance лёгкий (BDFL), формализуем позже.

> **ДЕРЕВО РЕШЕНИЙ ЗАКРЫТО (D1–D11).** Следующая сессия: **Phase 0 / Slice 0** — новый
> монорепо + экстракция 3 репо + CI-матрица win/mac/ubuntu green. НЕ начинать в этом
> контексте (на пределе) — свежая сессия.

## План фаз (черновик)
- **Phase 0 — Slice 0 (механика):** новый монорепо `packages/*`, перенос поверхности,
  CI-матрица win/mac/ubuntu гоняет 71/71, `amos init` → песочница doctor-green. Без логики.
- **Phase 1 — Инструментировать + аудит:** единый «module-fired» лог во все хуки/скиллы;
  history-mining tool по 44 JSONL → классификация 143 модулей Green/Amber/Red.
- **Phase 2 — Fix-to-Green / cut:** чиним именованные Amber (checkpoint-nudge время→работа,
  config-protection шум, subagent-verify override), режем Red; `amos --help`.
- **Phase 3 — Кросс-платформа:** junction'ы → портативные линки, абстракция `cmd /c`,
  зелёный CI на mac/linux.
- **Phase 4 — Product surface:** `amos skill add/list/vet`, реверсивный `amos init/uninstall`,
  README/docs, лицензия.
- **Phase 5 — Release v1:** публикация на GitHub + npm + `npx` bootstrap.
- **v2 (отложено):** GUI-«окно» поверх API/daemon мозга.

## Definition of Done (гейт Green для каждого модуля)
Модуль едет в v1 ⇔ (1) тесты зелёные, (2) срабатывает в реальных сессиях (есть телеметрия),
(3) override/skip < ~10% ИЛИ целевой плохой исход доказанно падает. Иначе — заточка или рез.
