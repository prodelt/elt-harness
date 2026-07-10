# ELT-FLEET — режим мульти-CLI оркестрации (design v1)

> Дата: 2026-07-10. Статус: план утверждён к реализации в новом чате.
> Спека и слайсы: `specs/002-elt-fleet/`. Resume: `CHECKPOINT-2026-07-10-elt-fleet-plan.md`.
> Директива юзера: **харнесс сохраняем, расширяем** — оракул/судья/`elt commit` не трогаем.

## 0. TLDR

Fleet = новый режим ELT: N параллельных **headless**-воркеров (claude / codex / agy —
Antigravity/Gemini по подписке), каждый в своём **git worktree**, гоняют `[P]`-слайсы
одного плана. Оркестратор — **код**
(`tools/fleet/fleet.js`, node), не чат-сессия. Каждый слайс проходит тот же гейт:
оракул → судья (claude sonnet, REJECT-default) → `elt commit`. Роутер раздаёт слайсы по
размеру (S→agy, M→codex, L→claude), при 429/лимите — failover на следующего
провайдера в цепочке. Терминалы «как у юзера» НЕ нужны: у всех трёх CLI есть штатный
headless-режим; видимость — панели Windows Terminal, тейлящие логи. Пункт управления —
интерактивная сессия Claude Code (запуск/статус/разбор block-ов).

## 1. Цель и не-цель

**Цель:** ускорить прохождение планов с независимыми слайсами в разы (wall-clock) и
разгрузить Claude-бюджет, вынося мелкие/средние слайсы на другие бюджеты (Gemini по
подписке Google AI через Antigravity `agy`, codex по подписке ChatGPT, claude
haiku/sonnet), с автоматическим failover при исчерпании лимитов.

**Не-цель:** экономия суммарных токенов (мультиагент ЖРЁТ больше — см. §7), замена
elt-loop (он остаётся для последовательных планов), новая система поверх харнесса
(fleet — расширение, инварианты те же).

## 2. Ресерч-дайджест (что говорит индустрия)

### 2.1 Anthropic — доктрина, которую копируем
Источник: [How we built our multi-agent research system](https://www.anthropic.com/engineering/built-multi-agent-research-system).
- **Orchestrator-workers** — лид декомпозирует, воркеры параллельно, лид синтезирует.
- **Экономика: чат ×1, одиночный агент ×4, мультиагент ×15 токенов.** Выигрыш —
  качество (+90.2% vs одиночный Opus на их evals) и время (−90% на параллелизуемых
  задачах), НЕ токены. Наш вывод: fleet включать только при ≥3 независимых слайсах.
- **Делегирование = контракт:** каждому воркеру «objective, output format, tool
  guidance, clear task boundaries» — иначе дублируют работу. Наш impl-промпт уже так
  устроен (elt-loop.ps1), портируем.
- **Надёжность:** retry-логика + чекпоинты (у нас: claims + run-log.jsonl + resume),
  «agents are stateful and errors compound» → детерминированные гарды вокруг LLM.
- **Eval:** LLM-judge по рубрике + ~20 тест-кейсов на старте достаточно. Наш судья
  уже это делает (REJECT-default + рубрика из spec.md).

Источник: [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
(экс-пост Бориса Черни, теперь офиц. дока):
- **Worktrees — благословлённый способ параллелить сессии** («run separate CLI sessions
  in isolated git checkouts so edits don't collide»).
- **Fan-out:** цикл по задачам с `claude -p`, `--allowedTools` для scope — ровно наш
  драйвер. `--output-format stream-json` для парсинга.
- **Writer/Reviewer в разных контекстах** — наш судья и есть это, свежий контекст.
- **Native agent teams** ([docs](https://code.claude.com/docs/en/agent-teams)) —
  рассмотрено и отклонено для v1: claude-only (нет codex/gemini → нет разгрузки
  бюджета), живёт в чат-сессии (context rot — против нашей доктрины «петля в
  драйвере»). Может стать бэкендом claude-воркеров позже.

### 2.2 OpenAI
- [A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf):
  **single-agent first**, мультиагент только когда сложность требует; **manager
  pattern** (менеджер зовёт агентов как инструменты, единая точка контроля) — наш
  оркестратор; guardrails как first-class (у нас: git-guardrails хуки, sandbox-флаги,
  REJECT-default судья).
- **Codex CLI headless** ([docs](https://developers.openai.com/codex/noninteractive)):
  `codex exec "<task>"` — без TUI; `--json` = JSONL-события в stdout;
  `-o/--output-last-message <file>` = финальное сообщение в файл; `codex exec resume
  --last` = продолжить сессию; сэндбокс: по умолчанию read-only, нам нужен
  `--sandbox workspace-write`; auth уже стоит у нас (ChatGPT-подписка, codex — доказанный
  драйвер /elt-code по памяти проекта). Читает AGENTS.md — **у нас parity уже сделан**
  (глобальный AGENTS.md = elt-роутер, 2026-07-06).

### 2.3 Google — Antigravity `agy` (Gemini по подписке; решение юзера 2026-07-10)
**gemini-cli выведен из уравнения:** free-tier на этой машине мёртв
(`IneligibleTierError: … migrate to the Antigravity suite`, память 2026-06-20).
Gemini-семейство едет через CLI **`agy`** (Antigravity; стоит v1.0.10, `--help` снят живьём):
- headless: `-p/--print` (одиночный промпт non-interactive), `--print-timeout` (деф. 5м),
  `--dangerously-skip-permissions` (нейминг как у claude), `--model`, `--sandbox`,
  `--continue`/`--conversation` (resume), сабкоманда `models`.
- **промпт через STDIN**: `echo "<prompt>" | agy -p …` — форма-аргументом раньше висла
  (открытый stdin ждёт EOF) или давала пусто; точную инвокацию для 1.0.10 зафиксировать в T003.
- **auth-блокер:** браузерный OAuth делает ЮЗЕР до прогона (`!agy` в своём терминале),
  агент залогинить не может; не залогинен → пустой ответ при **exit 0** (ловушка
  «успешного» провала). `agy models` сейчас виснет >60с на машине → pre-flight =
  `agy models` с hard-таймаутом; пусто/hang = провайдер недоступен, цепочка уводит дальше.
- лимиты подписки 2026: compute-based, окно ~5ч + недельный кап (AI Pro ×4 от standard,
  Ultra ×20; лимиты Antigravity поднимали ×3, кредиты докупаются) → cooldown при лимите
  ставить до конца окна (конфиг), не фикс-минуты.
- доктрину agy читает из `{appDataDir}/skills` и `{workspace}/.agents/skills`
  (НЕ `~/.gemini`) — наш контракт делегирования целиком в промпте воркера, зеркало не критично.

### 2.4 Prior art на GitHub (что берём / что нет)
- [vibe-kanban](https://github.com/BloopAI/vibe-kanban) (BloopAI) — kanban поверх 10+
  CLI-агентов (claude/codex/gemini/…), **worktree на задачу**, ревью диффов. Ближайший
  аналог. Берём паттерн executor-абстракции и worktree-изоляции. Не берём сам тул:
  Bloop закрылся в начале 2026 (проект теперь community-maintained), свой таск-менеджмент
  дублирует наш tasks.md, и в нём нет нашего гейта (оракул+судья+elt commit).
- [claude-squad](https://github.com/smtg-ai/claude-squad), [amux](https://github.com/mixpeek/amux),
  uzi — tmux+worktrees TUI для параллельных агентов. Подтверждают консенсус:
  **изоляция = worktree, управление = headless/exec, tmux — только для ПРОСМОТРА**.
  На нативной Windows tmux нет → см. §5.
- Tmux-Orchestrator (send-keys кукловодство TUI) — анти-паттерн: хрупко, не machine-readable.
- claude-flow — оверинжиниринг/хайп, замыкает на себя — против «сохраняем харнесс».
- Ralph-loop (Geoff Huntley) — «агент в while-цикле»: наш elt-loop уже
  дисциплинированная версия этого (fresh `claude -p` на слайс + механический гейт).

### 2.5 Стандарты
- **AGENTS.md** — кросс-CLI инструкции: у нас внедрён ×3 (claude/codex/gemini) — воркеры
  других вендоров получат ту же доктрину бесплатно.
- **MCP** — инструменты; **A2A** (Linux Foundation) — межагентный протокол: для
  локального fleet оверкилл, обмен = файлы (claims, events.jsonl) — machine-readable
  и дебажится глазами.
- **Durable execution** (Anthropic): наш вариант — идемпотентный resume по claims +
  run-log; никакого Temporal на десктопе.

## 3. Ключевые решения (ADR-стиль)

| # | Решение | Почему | Отклонено |
|---|---|---|---|
| D1 | Воркеры = **headless-процессы** (`claude -p`, `codex exec`, `agy -p`), НЕ PTY-кукловодство | Штатные режимы, exit-коды, JSONL; так делают все зрелые тулы | send-keys в TUI (хрупко, непарсибельно) |
| D2 | Изоляция = **git worktree на слайс**, ветка `fleet/<Tid>` | Консенсус индустрии + благословение Anthropic; параллельные правки не дерутся | общий checkout (гонки), клоны (дорого) |
| D3 | Оркестратор = **код** (`tools/fleet/fleet.js`, node, 0 LLM-токенов на цикл управления), пункт управления = сессия Claude Code | Дешевле LLM-лида Anthropic; тестируется `node --test` (догфуд); PS5.1 непригоден для параллельного процесс-менеджмента | LLM-оркестратор в чате (context rot + токены), расширение elt-loop.ps1 (PS5.1 боль) |
| D4 | Гейт слайса неизменен: **оракул → судья (claude sonnet, REJECT-default) → elt commit** внутри worktree | Директива «сохраняем харнесс»; судья НЕ роутится на другие провайдеры — качество меряет Claude | судья на agy/codex (нет доверия рубрике) |
| D5 | Параллелятся только слайсы с тегом **[P]** и непересекающимися `[files:]`-глобами, размеченными на план-шаге | Механическая проверка вместо рантайм-магии; spec-kit прецедент | автодетект пересечений по диффу (сложно, v2) |
| D6 | **Merge queue**: последовательный merge в интеграционную ветку + smoke-оракул после каждого merge; конфликт → слайс в serial-retry | Ловит и текстовые, и семантические конфликты; просто | octopus-merge, rebase-каскады |
| D7 | `[X]`-отметку в tasks.md ставит **оркестратор после merge**, не воркер | tasks.md — общая точка → соседние строки конфликтуют при параллельных merge | воркер маркает у себя (конфликты) |
| D8 | Роутер = **таблица в fleet.json** (size-тег → цепочка провайдеров), failover по regex-сигнатурам лимитов + cooldown | Скучно и предсказуемо; сигнатуры снимаем на live-fire T003 | «умный» LLM-роутинг |
| D9 | Видимость = **wt-панели с `Get-Content -Wait` по логам** + `fleet status`; интерактивный PTY (если реально понадобится) = WezTerm cli / Desktop Commander MCP, СВОЙ node-pty тул не строим | wt не умеет отдавать содержимое панелей → он только дисплей; WezTerm cli умеет spawn/send-text/get-text и работает на Windows | свой терминал-клиент (YAGNI до провала готовых) |

## 4. Архитектура

```
Claude Code (интерактив) — пункт управления
  │  запуск/стоп, fleet status, разбор judge-block и failed-слайсов,
  │  Monitor-хвост .harness/fleet/events.jsonl
  ▼
tools/fleet/fleet.js  (node, headless-оркестратор)
  ├─ planner: tasks.md → батч [P]-слайсов с disjoint [files:] (elt slice-формат + теги)
  ├─ claims:  .harness/fleet/claims/<Tid>.json {worker,pid,worktree,provider,startedAt}
  │           stale-детект (pid мёртв) → reclaim → resume после падения/STOP
  ├─ router:  size-тег → цепочка провайдеров (fleet.json) + cooldown + ledger
  ├─ executors (единый интерфейс → {exit, logPath, lastMsg}):
  │     claude:  claude -p <prompt> --model <m> --dangerously-skip-permissions
  │     codex:   codex exec --sandbox workspace-write -o <last.md> "<prompt>"
  │     agy:     <prompt через STDIN> | agy -p --dangerously-skip-permissions
  │              --print-timeout 5m [--model <m>]   (пустой stdout при exit 0 = fail!)
  │     (cwd = worktree слайса; ВСЕ вызовы с hard-таймаутом; стабы *.cmd в тестах)
  ├─ worktrees: git worktree add .fleet-wt/<Tid> -b fleet/<Tid> <integration>
  ├─ gate (в worktree): elt oracle → судья claude -p sonnet (промпт/парсер — порт
  │     из elt-loop.ps1, REJECT-default) → elt commit --skip-oracle --verdict pass
  ├─ merge queue: merge --no-ff fleet/<Tid> → integration; [X]-марк; smoke-оракул;
  │     конфликт → requeue-serial на свежем worktree
  ├─ events: .harness/fleet/events.jsonl (assign/green/judge/merge/failover/stop)
  └─ kill: .harness/STOP (весь fleet), STOP-<worker> (один); grace 30с → kill pid
  ▼
Видимость: tools/elt-fleet.ps1 -Panes → wt split-pane × N (Get-Content -Wait лог воркера)
```

**Данные.** `fleet.json` (в `.harness/`): `{workers:2, maxMinutes:120, integrationBranch,
providers:{S:["agy","codex","claude:haiku"], M:["codex","claude:sonnet"], L:["claude"]},
cooldownMin:30}  (для agy cooldown при лимите — до конца 5ч-окна)`. Ledger-записи в run-log.jsonl расширяются полями
`{provider, model, durationSec, failoverFrom?, limitHit?}`.

**Промпт воркера** (контракт делегирования по Anthropic): objective = текст слайса +
рубрика (constitution/spec.md), границы = «только эта задача, НЕ коммить, НЕ править
tasks.md, тесты не ослаблять», tool guidance = `[files:]`-глоб, output = «код + прогони
форматтер». База — implPrompt из elt-loop.ps1, один шаблон на все три CLI (codex читает AGENTS.md —
parity уже сделан; agy читает свой `{workspace}/.agents/` — потому контракт целиком в промпте).

**Жизненный цикл слайса:** claim → worktree → executor(provider) → красный оракул?
(1 heal тем же провайдером → 1 heal claude → failed, fleet живёт дальше) → зелёный →
судья → block? (стоп слайса, лог юзеру) → pass → elt commit в worktree → merge queue →
[X] → cleanup worktree.

## 5. Терминальный слой («Claude не может открывать терминалы»)

Проблема декомпозируется на три разных задачи:

1. **Исполнение воркеров** — PTY не нужен: у всех трёх CLI headless-режим первым
   классом (`claude -p` / `codex exec` / `agy -p` со STDIN), процессы с exit-кодом и логом.
   Наш elt-loop.ps1 так живёт с 2026-07-08.
2. **Видимость для юзера** («вижу, как агенты работают») — `wt.exe` открывает
   панели/вкладки штатно из PowerShell: `wt split-pane -- powershell -NoExit -Command
   "Get-Content -Wait <лог>"`. Ограничение wt: **отдать содержимое панели назад нельзя**
   (нет read-API) — поэтому только дисплей, истина — в логах.
3. **Настоящий интерактив** (логин-флоу, TUI-only операции) — редкий случай; НЕ строим
   свой инструмент, берём готовое, если live-fire покажет нужду:
   - [WezTerm CLI](https://wezterm.org/cli/cli/index.html): `wezterm cli spawn` (возвращает
     pane-id), [`send-text`](https://wezterm.org/cli/cli/send-text.html), `get-text` —
     полный tmux-аналог, работает на Windows.
   - Desktop Commander MCP (start_process/interact_with_process) — MCP-вариант.
   - tmux — только через WSL/MSYS2, на нативной Windows отсутствует → не основной путь.

Вердикт: v1 = headless + wt-панели. Отдельный «CLI-клиент терминалов» из ТЗ юзера
не нужен — это решённая задача (ponytail: rung 3, платформа уже умеет).

## 6. Роутер и failover

- Классы задач размечает **план-шаг** (Режим 0), не рантайм: `[S]`/`[M]`/`[L]` +
  опц. `[cli:agy]` принудительный override. Default = M.
- Цепочки v1: S → agy(подписка Google AI) → codex → claude:haiku; M → codex → claude:sonnet;
  L / судья / heal-эскалация / merge-конфликты → только claude.
- Детект лимита: exit≠0 И (stderr|лог) ~ `/(429|rate.?limit|quota|resource.?exhausted|usage.?limit|overloaded)/i`
  → провайдер в cooldown (30 мин; agy — до конца 5ч-окна), слайс requeue на следующего
  в цепочке, ledger-запись. У agy два ДОП. сигнала недоступности: пустой stdout при
  exit 0 (не залогинен) и hang до hard-таймаута — оба трактуем как unavailable.
  Точные сигнатуры каждого CLI снимаем живьём в T003 и фиксируем в providers.js.
- Не-лимитный красный — это не роутер, это heal-путь (§4, жизненный цикл).
- Бюджет-предохранители: maxMinutes на прогон (есть в elt-loop), счётчик agy-вызовов
  в ledger (compute-based окна подписки не публикуют числа — считаем вызовы и метим
  limitHit, чтобы юзер видел реальный расход окна).

## 7. Экономика токенов (честно)

Урок Anthropic: мультиагент ≈ **×15 токенов** чата — параллелизм покупает время, не
экономию. Реальная разгрузка Claude-бюджета в fleet:
1. **Роутинг S/M-слайсов на чужие бюджеты** (Google-AI-подписка через agy / codex-подписка) и на
   дешёвые Claude-модели (haiku) — прямое снижение расхода дорогих токенов.
2. **Fresh context на слайс** (уже наша доктрина) — нет ×4-налога раздутой сессии.
3. **Оркестратор = код, не LLM** — цикл управления стоит 0 токенов (у Anthropic лид-агент
   думает на Opus; нам это не нужно, план уже нарезан на план-шаге).
4. **Порог включения:** <3 независимых [P]-слайсов → обычный elt-loop, fleet не запускать
   (single-agent first, OpenAI guide).

## 8. Инварианты

**Неизменны (харнесс):** слайс закрыт ⇔ `elt commit` прошёл; судья обязателен на
код-слайсах (sonnet, REJECT-default, свежий контекст); оракул механический (exit-код);
красный → self-heal ≤2 → стоп слайса; scope не расширять; STOP-файл — kill-switch;
петля не живёт в чат-сессии.

**Новые (fleet):** воркеры не коммитят в main/integration напрямую (только своя
fleet/<Tid>-ветка); merge — только через очередь оркестратора; параллельно — только
[P] с disjoint [files:]; [X]-марк ставит оркестратор; судья и heal-эскалация — только
claude; провайдер-лимит — это данные (ledger), не повод останавливать fleet.

## 9. Риски и контрмеры

| Риск | Контрмера |
|---|---|
| Семантический конфликт параллельных слайсов (оба зелёные порознь, красные вместе) | smoke-оракул после каждого merge (D6); конфликт → requeue-serial |
| Установка зависимостей в каждом worktree (node_modules и т.п.) дорогая | бенч на лёгком проекте; для тяжёлых — worktree переиспользовать между слайсами одного воркера (v2) |
| Auth CLI протухает посреди прогона | pre-flight в `fleet doctor`: `<cli> --version` + мини-пинг каждого провайдера до старта |
| Quoting/пути Windows в спавне трёх разных CLI | executor-тесты со стабами *.cmd; пути только через path.join |
| agy auth-блокер: браузерный OAuth, агент залогинить не может | pre-flight `agy models` с hard-таймаутом ДО старта; не залогинен → сказать юзеру сделать `!agy`, провайдер unavailable, цепочка уводит на codex |
| agy «успешный провал»: пустой stdout при exit 0 + висящие команды (models >60с живьём) | executor: пустой stdout = fail; все вызовы agy с hard-таймаутом (--print-timeout + kill по pid) |
| Лимиты подписки agy: compute-based окно ~5ч + недельный кап | счётчик вызовов + limitHit в ledger; cooldown до конца окна; кредиты докупаемы |
| Судья — узкое место (серийный) | приемлемо v1 (секунды на вызов); параллелить только при доказанной боли |
| Воркер-зомби после STOP | grace 30с → kill по pid из claim; stale-claim reclaim на resume |

## 10. Роадмап (фазы → слайсы в specs/002-elt-fleet/tasks.md)

- **A. Фундамент:** elt init репо, executor-слой + стабы, live-fire реальных CLI
  (снять флаги/сигнатуры). T001–T003.
- **B. Изоляция:** worktree-менеджер, парсер тегов + выбор [P]-батча, claims. T004–T006.
- **C. Петля:** гейт-в-worktree (оракул→судья→commit), merge queue, fleet run MVP
  (2 воркера, events, STOP, resume). T007–T009.
- **D. Роутер:** policy+ledger, limit-детект+failover, heal-эскалация. T010–T012.
- **E. Обвязка:** fleet status + wt-панели, doctor fleet-чеки, доки (/elt SKILL режим
  fleet, PLAYBOOK, CLAUDE.md). T013–T015.
- **F. Live-fire:** бенч-прогон 4–6 [P]-слайсов vs sequential baseline; драки (STOP
  посреди, 429-инъекция); чекпоинт с метриками. T016–T017.

Реализация — в новом чате: `/elt` → Режим 1 по `specs/002-elt-fleet/tasks.md`,
гипотезы проверяются на каждом слайсе (оракул `node --test tools/fleet/`), live-fire
слайсы помечены `[live]`.

## 11. Открытые вопросы юзеру (не блокируют старт)

1. Бенч-проект для T016: свежий scratch или AWE4? (предложение: scratch с честными
   независимыми слайсами — чистое сравнение).
2. `--dangerously-skip-permissions` у claude-воркеров оставить (прецедент elt-loop)
   или пробовать `--permission-mode auto`? (v1: skip, воркер заперт в worktree).
3. WezTerm ставить сейчас или ждать реальной нужды в интерактиве? (предложение: ждать).
4. Какая подписка Google AI (Pro/Ultra)? Влияет только на размер 5ч-окна agy — не
   блокирует; юзер логинится в agy браузером до T003.

## Источники

- Anthropic: [multi-agent research system](https://www.anthropic.com/engineering/built-multi-agent-research-system) · [Claude Code best practices](https://code.claude.com/docs/en/best-practices) · [agent teams](https://code.claude.com/docs/en/agent-teams)
- OpenAI: [practical guide to building agents (PDF)](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf) · [codex exec / non-interactive](https://developers.openai.com/codex/noninteractive) · [codex CLI reference](https://developers.openai.com/codex/cli/reference)
- Google: Antigravity `agy` v1.0.10 (`--help` снят живьём 2026-07-10) · [подписки/лимиты с I/O 2026](https://blog.google/products-and-platforms/products/google-one/google-ai-subscriptions/) · [Gemini Apps limits](https://support.google.com/gemini/answer/16275805?hl=en) · [AI Ultra Lite / usage limits](https://9to5google.com/2026/05/05/google-ai-ultra-lite-gemini-usage-limits/) · [gemini-cli](https://github.com/google-gemini/gemini-cli) (выведен: free-tier на машине мёртв, IneligibleTierError)
- Prior art: [vibe-kanban](https://github.com/BloopAI/vibe-kanban) · [claude-squad](https://github.com/smtg-ai/claude-squad) · [amux](https://github.com/mixpeek/amux) · [awesome-agent-orchestrators](https://github.com/andyrewlee/awesome-agent-orchestrators)
- Терминалы: [wezterm cli](https://wezterm.org/cli/cli/index.html) · [send-text](https://wezterm.org/cli/cli/send-text.html) · [spawn](https://wezterm.org/cli/cli/spawn.html)
