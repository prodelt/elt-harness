# Developer Knowledge OS Audit - 2026-04-24

## Мета

Перевірити не лише технічну справність Claude Code/Codex налаштувань, а й їхню реальну цінність для щоденної роботи full-stack розробника.

Цільова модель після інтерв'ю: Claude Code і Codex мають бути строгими за якістю, але не перетворювати робочий день на обслуговування самого пайплайна. Вони мають самі знаходити інструменти, читати документацію, шукати готові рішення на GitHub, поповнювати знання, будувати проектні графи/RAG і не палити контекст повними читаннями коду.

Архітектурне рішення за підсумком цього аудиту винесено в `audit/S11_pipeline_top1/runtime/DEVELOPER_KNOWLEDGE_OS_ARCH.md`.

## Чесний вердикт

Поточна система сильна технічно, але концептуально змістилася в бік "інфраструктура заради інфраструктури".

Що працює:
- Hook-перевірки відтворюються поза sandbox: `test-all-hooks.js` 32/32 PASS, `test-codex-hooks.js` 41/41 PASS, `test-hooks-behavior.js` 37/37 PASS.
- Базові guardrails корисні: secrets, git discipline, docs bootstrap, Context7 reminder, output limiter, session handoff, branch/commit checks.
- S11 правильно знайшов реальні проблеми: session bloat, project sprawl, skill drift, відсутність project bootstrap, слабкий test discipline.

Що не працює як концепт:
- Глобальний runtime став занадто важким: у `~/.claude/settings.json` глобально включено 25 plugins, включно з ситуативними `playwright`, `supabase`, `vercel`, `chrome-devtools`, `context7`, `superpowers`, кількома LSP.
- Project-local `.claude/settings.local.json` у Pipeline-setupper має 147 allow-правил, включно з історичними broad/debug дозволами. Це вже не політика доступу, а накопичений журнал винятків.
- `C:\Users\espad\.claude.json` має duplicate project keys з різним case/path для `D:/Mammoth ERP system`, що підтверджує config drift.
- Старий score `~87/100` справедливий для "інфраструктура тестується", але завищений для "розробник швидко вирішує задачі без тертя". Робочий score ближче до 65-70/100.

## Порівняння з попереднім аудитом

З чим згоден:
- B03 Edit payload залишається runtime-level проблемою.
- Skill listing, MCP/plugin clutter і startup payload реально палять контекст.
- Cross-tool sync потрібен, бо Claude/Codex/Gemini швидко роз'їжджаються.
- Потрібні вимірювання на реальних JSONL, а не відчуття.

З чим не згоден:
- Висновок "audit complete" був передчасним. Він закривав hook-layer, але не робочий процес.
- "Більше хуків" не дорівнює "кращий агент". Після певного порогу наступний виграш дає knowledge architecture, а не новий блокер.
- Per-project tools треба проектувати від ideal working day, а не від списку цікавих репозиторіїв.

## Інтерв'ю: фактичні потреби

Робочий профіль:
- Усі типи full-stack задач повторюються мінімум раз на 3 дні: UI, API, DB, деплой, баги, дослідження, аудит.
- Усі основні проекти залишаються активними, тому single-project оптимізація недостатня.
- Головні болі: втрата контексту, швидке впирання у usage limits, іноді забування правил пайплайна, відсутність автоматичного навчання з GitHub/skills/tools.
- Критично потрібна синхронізована база знань: global development knowledge + project-specific memory/graph/RAG.
- Строгий режим має бути завжди, але блокування не повинні створювати шум або зайві повторні дії.

## Цільова архітектура

### 1. Global minimal core

Глобально залишаються тільки щоденні guardrails і discovery primitives:
- security scanners;
- git/commit/branch discipline;
- docs/project bootstrap checks;
- output limiter;
- Context7 or docs lookup policy;
- GitHub discovery policy;
- lightweight knowledge-router hook;
- Graph/RAG query-first policy.

Не мають жити global-by-default:
- Playwright automation;
- Supabase/Vercel project APIs;
- Chrome DevTools/browser automation;
- heavy research skills;
- marketplace/skill install flows;
- project-specific MCPs;
- experimental agent frameworks.

### 2. Project knowledge layer

Кожен активний проект має отримати:
- `AGENTS.md`, `CLAUDE.md`, `.gemini/GEMINI.md`;
- `.claude/settings.json` з project-only plugins;
- graph index для коду;
- RAG index для docs, issues, ADR, README, важливих діалогів;
- project memory, відокремлену від global memory;
- command/tool registry: які CLI дозволено використовувати для цього проекту.

### 3. GitHub-first discovery loop

Перед створенням нового інструменту агент має:
- шукати існуючі рішення через `gh search repos`, `gh repo view`, releases, issues;
- оцінювати adoption, maintenance, license, Windows support, security risk;
- клонувати тільки в quarantine/workbench;
- робити read-only spike;
- просувати в global/project тільки через manifest + rollback.

### 4. Self-improvement loop

Після кожної складної задачі:
- витягти повторюваний патерн;
- перевірити, чи існує skill/tool на skills.sh або GitHub;
- запропонувати diff до skill/policy;
- записати знання в project graph/RAG;
- не встановлювати автоматично без quarantine scan і user approval.

## Вердикт по запропонованих інструментах

### OpenCLI

Джерела: GitHub `jackwener/opencli`, специфікація `opencli.org`.

Вердикт: high-potential, не global runtime. Потрібен як стандарт опису CLI capability і генерації usage adapters.

Причина: OpenCLI Description задає machine-readable JSON/YAML опис CLI, який можна використовувати для документації, codegen, MCP automation, change detection і autocomplete. Це добре збігається з твоєю вимогою "якщо є CLI, агент має використовувати CLI, а не читати все руками".

Task: додати OpenCLI pilot для 3-5 CLI: `gh`, `supabase`, `vercel`, `playwright`, `firecrawl`.

### browser-use/browser-harness

Джерело: GitHub `browser-use/browser-harness`.

Вердикт: project/on-demand browser automation, не global plugin.

Причина: система тонка і self-healing, працює напряму через CDP, але browser automation завжди потенційно шумна по токенах і діях. Її треба вмикати для UI/E2E/research задач, а не на кожну coding session.

Task: порівняти з Playwright CLI і chrome-devtools-mcp на одному сценарії: login, inspect UI, capture state, produce deterministic test.

### NousResearch/hermes-agent

Джерело: GitHub `NousResearch/hermes-agent`.

Вердикт: architecture/reference spike, не заміна Claude/Codex зараз.

Причина: Hermes має саме ті концепти, які потрібні: self-improving skills, persistent memory, past conversations search, toolsets, MCP, context compression. Але native Windows не підтримується, потрібен WSL2. Пряме встановлення в основний workflow зараз ризиковане.

Task: read-only WSL2 spike: вивчити memory/skills/toolset architecture і перенести 2-3 ідеї в наш pipeline без запуску Hermes як основного агента.

### HKUDS/LightRAG

Джерело: GitHub `HKUDS/LightRAG`.

Вердикт: основний кандидат для project RAG/knowledge store pilot.

Причина: LightRAG має server/WebUI/Docker/source install сценарії, offline stack і provider integrations. Для твоєї задачі він краще підходить як проектна база знань, ніж черговий global MCP.

Task: один pilot на Pipeline-setupper або Law-assistant: ingest docs + selected code summaries + session learnings, потім порівняти answers проти Grep/Graphify.

## Нова стратегія S11

Не продовжувати tasks 38-42 як marketplace expansion, поки не стабілізовано runtime і knowledge architecture.

Новий порядок:
1. Task 46: Developer Knowledge OS target architecture.
2. Task 47: Global/project/on-demand scope policy for plugins, MCP, CLI, skills.
3. Task 48: GitHub-first discovery and quarantine workflow.
4. Task 49: Project graph/RAG pilot with LightRAG + existing Graphify.
5. Task 50: CLI capability registry with OpenCLI-style descriptors.
6. Task 51: Browser automation pilot: Playwright CLI vs browser-harness vs chrome-devtools.
7. Task 52: Hermes architecture spike, extract reusable patterns only.
8. Task 53: Self-improvement loop: skills.sh/GitHub discovery, skill promotion, knowledge sync.
9. Task 54: Normalize `C:\Users\espad\.claude.json` and project settings.
10. Task 55: Final operating policy and rollback.

## Non-negotiables

- No new global tool without measured startup cost.
- No automatic install from GitHub into global roots.
- No full-code reads when graph/RAG/index can answer first.
- No browsing/clone spike without evidence log.
- No knowledge write without scope: global, project, or task-local.
- No "audit complete" without reproduced proof commands outside sandbox if nested spawns are involved.

## Джерела

- OpenCLI repo: https://github.com/jackwener/opencli
- OpenCLI spec: https://opencli.org/
- browser-harness repo: https://github.com/browser-use/browser-harness
- Hermes Agent repo: https://github.com/NousResearch/hermes-agent
- LightRAG repo: https://github.com/HKUDS/LightRAG
