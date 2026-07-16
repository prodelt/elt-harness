# Developer Knowledge OS Architecture

## Мета

Зафіксувати цільову архітектуру робочого середовища Claude/Codex після інтерв'ю 2026-04-24: що має жити глобально, що повинно бути проектним, що вмикається лише on-demand, і як це зменшує startup tax без втрати якості.

## Ідеальний робочий день

Ознаки правильної системи для full-stack розробника:

1. Сесія стартує з мінімальним шумом і без зайвого глобального payload.
2. Агент спочатку шукає відповідь у graph/RAG/CLI registry, а не читає код цілком.
3. Повторювані інструменти знаходяться через GitHub-first discovery і проходять quarantine.
4. Проектні знання відокремлені від global development knowledge.
5. Після складної задачі корисний патерн переходить у керований learn loop, а не в хаотичний набір винятків.

## Pain Summary

- втрата контексту між сесіями та між проектами;
- швидке вичерпання usage limits через startup payload і повні читання коду;
- дрейф pipeline rules та накопичення broad exceptions;
- відсутність синхронізованого knowledge layer для проектів;
- відсутність керованого loop для discovery, quarantine, promotion і learn.

## Варіанти архітектури

### Варіант A - Global everything cockpit

Тримати більшість skills, MCP, browser automation і project APIs глобально.

Вердикт: reject. Це максимізує зручність першого запуску, але саме цей підхід вже привів до startup clutter, config drift і зайвого токен-спалювання.

### Варіант B - Project islands only

Майже все перенести в project-local scope, а глобальний рівень звести до мінімуму без спільних правил.

Вердикт: reject. Зменшує startup tax, але занадто дорого коштує в підтримці: однакові security/git/docs правила почнуть дублюватися по проектах.

### Варіант C - Layered Knowledge OS

Три шари: `global minimal core` -> `project core` -> `on-demand capability`, плюс окремий `task-local scratch`.

Вердикт: accept. Дає строгий baseline, але прибирає важкі можливості зі startup path. Це є цільова модель для S11 Wave 9.

## Phase 2.5 Evidence

### Context7 / official scan

| Candidate | Source | Keep / Change | Decision |
|---|---|---|---|
| LightRAG | Context7 `/hkuds/lightrag` | Keep as project-scoped knowledge store | Підходить для project RAG, бо поєднує knowledge graph і vector retrieval, має кілька query modes, Python library + REST API, та не потребує global-by-default placement. |
| Playwright | Context7 `/microsoft/playwright` | Keep as deterministic browser baseline | Підходить як default on-demand automation layer завдяки cross-browser API, auto-waiting, web-first assertions та явному CLI/test fit. |
| OpenCLI | Official spec `opencli.org` | Adapt as local descriptor format | Підходить як machine-readable contract для CLI capability registry; не runtime dependency, а формат опису команд, exit codes, options і examples. |

### Secondary references

| Candidate | Source | Decision |
|---|---|---|
| browser-use/browser-harness | GitHub README | Adapt only as optional browser pilot for tasks, де потрібен self-healing CDP flow; не вмикати глобально. |
| NousResearch/hermes-agent | GitHub README | Read-only architecture spike only; перейняти патерни learning loop, memory search і toolset orchestration, але не тягнути в основний Windows runtime без окремого WSL2 plan. |

## Цільова модель шарів

### 1. Global minimal core

Тут живе лише те, що потрібно майже щодня і що дає позитивний ROI навіть у короткій сесії:

- security scanners;
- git branch/commit discipline;
- docs bootstrap and verifier;
- output limiter and context budget guardrails;
- Context7 / official docs lookup policy;
- GitHub-first discovery policy;
- lightweight knowledge-router policy;
- query-first rule: graph/RAG/registry before full reads.

Принцип: global core може блокувати або підказувати, але не повинен тягнути важкі project APIs, browser stacks або research frameworks у кожен startup.

### 2. Project core

Тут живе все, що має сенс лише в межах конкретного репозиторію:

- `AGENTS.md`, `CLAUDE.md`, `.gemini/GEMINI.md`;
- `.claude/settings.json` з project-only plugins і MCP;
- graph index по коду;
- RAG index по docs, ADR, issue notes, learnings;
- project memory;
- project CLI capability registry;
- дозволений command inventory і routing hints.

Принцип: проект сам несе знання про свій стек, команди, індекси та інтеграції. Global layer не має вгадувати це щоразу заново.

### 3. On-demand capability

Тут живуть важкі або ситуативні можливості:

- browser automation;
- Supabase/Vercel/Firecrawl інтеграції;
- Chrome DevTools;
- marketplace install/update flows;
- heavy research flows;
- експериментальні agent frameworks;
- tool spikes і quarantine clones.

Принцип: on-demand capability має explicit entrypoint, manifest, rollback і вимірюваний cost. Жодних silent global installs.

### 4. Task-local scratch

Окремий короткоживучий шар для:

- чернеток плану;
- тимчасових comparison tables;
- одноразових вимірювань;
- spike artifacts, які ще не стали ні project knowledge, ні global policy.

Принцип: task-local записи мають або еволюціонувати в project/global knowledge, або видалятися після завершення задачі.

## Capability Placement Matrix

| Capability | Scope | Reason | Startup Cost Risk | Rollback |
|---|---|---|---|---|
| Security scanners | Global | Захищають усі сесії й проекти однаково | Low | Disable hook or restore previous settings snapshot |
| Git discipline hooks | Global | Branch/commit rules мають бути консистентними | Low | Revert hook registration and tracked source |
| Docs bootstrap / verifier | Global | Порожній проект без docs має ловитися одразу | Low | Revert bootstrap checker or downgrade to advisory |
| Output limiter / context budget guards | Global | Зменшують витрати в будь-якому проекті | Low | Restore prior thresholds |
| Context7 / official docs policy | Global | Це policy layer, а не heavy runtime feature | Low | Revert policy text and matcher config |
| GitHub-first discovery policy | Global | Єдине джерело істини перед новими installs/spikes | Low | Remove policy and return to manual discovery |
| Knowledge-router rule (query-first) | Global | Має спрямовувати до graph/RAG/registry before read | Low | Disable router advisory |
| Global development memory | Global | Зберігає загальні engineering патерни, не проектні деталі | Medium | Move entries back to markdown memory only |
| Project AI docs (`AGENTS.md`, `CLAUDE.md`, `.gemini/GEMINI.md`) | Project | Фіксують stack, commands, architecture, gotchas | Low | Regenerate from `init-project` or restore from git |
| Project `.claude/settings.json` | Project | Тут мають жити project-only plugins/MCP | Medium | Restore previous project settings snapshot |
| Graph index (code graph) | Project | Відповідає на structural questions дешевше за full read | Medium | Delete/rebuild per-project index |
| RAG index (docs/ADR/issues/learnings) | Project | Пам'ять має бути scoped до проекту | Medium | Rebuild index from approved sources |
| Project memory | Project | Зберігає локальні рішення, а не глобальні правила | Low | Move or prune project memory entries |
| CLI capability registry | Project | Команди й дозволені routes залежать від стеку проекту | Low | Remove descriptor files and fall back to docs |
| Supabase/Vercel/Firecrawl integrations | On-demand | Потрібні не в кожній сесії й мають зовнішню поверхню ризику | High | Disable plugin/MCP and revoke project access |
| Playwright | On-demand | Надійний baseline для deterministic browser tasks, але важкий для постійного startup | Medium | Remove project plugin or stop browser service |
| browser-harness | On-demand | Корисний для self-healing browser tasks, але занадто вільний для global default | High | Delete quarantine/pilot repo and config |
| Chrome DevTools / browser MCP | On-demand | UI/debug-only інструмент, зайвий у звичайній coding session | Medium | Disable MCP in project/global config |
| Marketplace skill install/update flows | On-demand | Потребують quarantine, scan і approval | High | Revert manifest, delete quarantined assets |
| Heavy research skills | On-demand | Високий token cost і не щоденний сценарій | High | Remove skill from project scope or quarantine it |
| Hermes-style experimental agents | On-demand | Поки що це лише research spike, не production runtime | High | Keep docs only, no install |
| Task notes / scratch comparisons | Task-local | Тимчасовий проміжний артефакт | Low | Delete scratch file |

## Routing Policy

### Default route order

1. Перевірити CLI capability registry.
2. Перевірити project graph/RAG.
3. Перевірити project docs і memory.
4. Лише потім робити targeted grep/read.
5. Перед новим зовнішнім інструментом - GitHub-first discovery.
6. Перед promotion у project/global scope - quarantine + scan + rollback plan.

### Browser / external service rule

Якщо задача не вимагає реального браузера або project API, browser/service layer не завантажується.

### Learning rule

Після складної задачі система не встановлює нічого автоматично. Вона:

1. формує proposal;
2. визначає scope (`global`, `project`, `task-local`);
3. перевіряє token budget impact;
4. просить approval перед promotion.

## Startup Cost Policy

### Дозволено глобально

- те, що дешеве на startup;
- те, що проектно-агностичне;
- те, що дає стабільний daily ROI;
- те, що можна швидко rollback без side effects.

### Заборонено глобально

- browser automation;
- project APIs;
- heavy research and marketplace tooling;
- експериментальні agents;
- все, що не має виміряного startup cost.

## Rollout Plan

1. Task 47: підтвердити offender ranking і exact cleanup knobs.
2. Task 48: стандартизувати GitHub-first discovery + quarantine.
3. Task 49: підняти project graph/RAG pilot з чітким scope split.
4. Task 50: ввести OpenCLI-style registry для дозволених CLI routes.
5. Task 51-52: порівняти browser automation і Hermes patterns без global install.
6. Task 53-55: оформити керований self-improvement loop, нормалізацію config і operating policy.

## Рішення

Приймається `Layered Knowledge OS`:

- `global minimal core` для універсальних правил і discovery;
- `project core` для knowledge, settings та індексів;
- `on-demand capability` для важких і ризикових інтеграцій;
- `task-local scratch` для короткоживучих артефактів.

Це зменшує startup tax, прибирає config drift із global scope і переводить Claude/Codex із режиму "все увімкнено завжди" у режим "спочатку знайди найменш дорогий route, потім розширюйся за потреби".
