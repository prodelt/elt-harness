# Аудит глобальной системы Claude Code + Codex за 7 дней

Дата: 2026-05-08  
Фокус: сделать глобальную систему предсказуемой на этом компьютере в любом проекте, не стирая локальные правила проектов.

## Короткий вердикт

Система сильная по количеству компонентов, но слабее как единый продукт. У нас уже есть hooks, skills, shared memory, RAG, Graphify, Context7, checkpoint-дисциплина, но нет надежного cross-project контракта:

- что является глобальным;
- что является проектным;
- где хранится состояние проекта;
- как проверять, что docs/RAG/Graphify реально работают;
- как обновлять `AGENTS.md` / `CLAUDE.md` / `.gemini/GEMINI.md` без потери project-specific правил.

Главный риск: система выглядит "настроенной", но часть механизмов работает только для заранее прописанных проектов или загрязняется глобальным state.

## Оценки 1-10

| Область | Оценка | Почему |
|---|---:|---|
| Глобальные hooks | 8 | Много защит, метрик и gate-ов. Но часть метрик поверхностная, docs дрейфуют от количества hooks. |
| Claude Code workflow | 7 | Хорошая дисциплина checkpoints/docs/ship, но есть перегрузка командами и зависимость от памяти сессии. |
| Codex workflow | 6 | Skills синхронизированы частично, но есть invalid YAML, MCP auth проблемы, и другая модель sandbox/approval. |
| Cross-project portability | 4 | RAG hardcoded на 4 проекта, pipeline-state глобальный, skill command не глобальный, Graphify не self-healing. |
| Project docs init/sync | 5 | Правильная идея create/upgrade/noop уже есть, но нужен section-aware merge и protected project blocks. |
| Graphify / codemaps | 4 | Команда запускается, но query дал нерелевантный шум. Нет relevance smoke test и project scoping guarantee. |
| RAG | 4 | LightRAG есть, но registry hardcoded, queue stats бедные, новые проекты не подключаются автоматически. |
| Skill system/search | 6 | Ranker работает, но `skill.sh`/`skill.cmd` не являются глобальным интерфейсом для любого проекта. |
| `pipeline` skill | 5 | Полезен как идея, но сейчас слишком церемониальный и завязан на один глобальный state file. |
| `architect-first` skill | 5 | Принципы хорошие, но недостаточно привязан к конкретному результату: acceptance tests, sprint slices, docs/codemap delta. |
| `red-team` skill | 6 методология / 2 Windows hygiene | Методология широкая, но vendored offensive tree с `.cpp`, `.bat`, `.ps1`, `.pdb`, PoC-кодом провоцирует Defender. |
| Общая инженерная зрелость | 6.2 | Много сильных блоков, но нужен слой bootstrap/doctor/registry и упрощение маршрутов. |

## Факты из локального аудита

### 1. Глобальный pipeline-state загрязняет проекты

`~/.claude/pipeline-state.json` сейчас указывает на другой проект:

```json
{
  "cwd": "D:\\Ametrin projects\\Izi tracker\\izi-tracker",
  "phase": "architected",
  "ts": "2026-05-09T09:00:00Z"
}
```

Это архитектурная ошибка для цели "любой проект на компьютере". State должен быть per-project:

- `~/.claude/project-state/<projectKey>/pipeline-state.json`
- TTL + проверка `cwd`
- запрет future timestamp
- автоматическое игнорирование state другого проекта

### 2. RAG работает только для hardcoded проектов

`rag-context-injector.js`, `rag-queue-enqueue.js` и `tools/rag-ingest.py` содержат статический список:

- `pipeline`
- `izi-tracker`
- `law-assistant`
- `sudoviy-master`

Новые проекты не получают RAG автоматически. Это не баг одного проекта, а неправильная модель discovery.

Нужно: глобальный project registry, который создается/обновляется через `init-project`, и локальный `.rag/manifest.json` в каждом проекте.

### 3. Graphify запускается, но retrieval ненадежный

Команда:

```powershell
cmd /c graphify query "what does graphify-session-init do?"
```

вернула результаты из `tools/red-team` и старых audit-файлов вместо точного ответа про hook. Значит, проблема не "Graphify не установлен", а "Graphify не гарантирует релевантный project-scoped ответ".

Нужно добавить `graphify doctor`:

- проверка graph age;
- проверка, что индекс относится к текущему cwd;
- smoke query по известному файлу;
- threshold релевантности: если top result не из текущего проекта/файла, граф считается stale/bad;
- fallback на `rg`/Serena/aider-repomap вместо слепого доверия графу.

### 4. Skill search работает как скрипт, но не как глобальная команда

Работает:

```powershell
node tools\skill-search.js "architecture refactor" --top 5
```

Но `tools/skill.sh` и `tools/skill.cmd` лежат только в command-center repo. Для любого проекта нет надежной команды `skill`.

Нужно:

- `~/.claude/bin/skill.cmd`
- `~/.claude/bin/skill.ps1`
- опционально `skill.sh`
- добавить путь в глобальные docs;
- health-check: `skill "architecture refactor"` должен работать из любого cwd.

### 5. Git state в command center поврежден

`git log --all` упал из-за ref:

```text
refs/heads/feature/s11-task-43-init-project-upgrade-mode (1)
```

Это не срочно для системы, но влияет на audit/ship/history tooling. Нужен `git doctor` в глобальном health-check.

### 6. Red-team skill вендорит опасный corpus

В `red-team/references/external` найдено много файлов, похожих на то, что Defender должен банить:

- `.cpp` 202
- `.bat` 36
- `.py` 35
- `.ps1` 15
- `.pdb` 7
- `.asm` 10
- build artifacts и PoC examples

Правильное решение: не отключать Defender и не добавлять exclusions, а изменить упаковку skill:

- локально оставить только `SKILL.md`, безопасные markdown references и curated index;
- offensive repos хранить как remote references;
- downloads делать on-demand в quarantine/cache;
- блокировать vendoring binaries/build artifacts;
- Shannon интегрировать как optional adapter, не как скопированный внутрь skill corpus.

## Паттерны твоей работы за 7 дней

По `~/.claude/history.jsonl` с 2026-05-01:

- `C:\Claude playground\Itstep_AI`: 147 сообщений
- `D:\Ametrin projects\Izi tracker\izi-tracker`: 137 сообщений
- `D:\Ametrin projects\Izi tracker`: 40 сообщений
- `D:\Ametrin projects\Penetration_zvit_task`: 35 сообщений
- `C:\Claude playground\Pipiline setupper`: 26 сообщений
- `D:\Ametrin projects\Semenov`: 12 сообщений

Повторяющиеся команды в Claude Code:

- `/pipeline`: 14
- `/update-docs`: 13
- `/checkpoint`: 13
- `/architect-first`: 11
- `/update-codemaps`: 8
- `vercel`: 5
- `deploy`: 3

Выводы:

- Ты работаешь рывками по нескольким проектам, часто переносишь контекст между сессиями.
- Ты ожидаешь, что агент сам восстановит checkpoint и не забудет прошлые критерии.
- Ты часто даешь длинный список требований в одном сообщении. Система должна превращать это в checklist и сверять перед финалом.
- Главный триггер раздражения: агент говорит "готово", но не доказал, что все критерии выполнены.
- Тебе нужен режим "делай по порядку, но не сломай": план, proof, preview/deploy, checkpoint.
- Тебе важно, чтобы документы и codemaps обновлялись сами, но без стирания локальных правил.

Рекомендация под твой стиль:

1. В начале каждой большой задачи агент должен извлечь checklist из сообщения пользователя.
2. Перед работой: `Focus: ... Done when: ...`.
3. Для каждого проекта: сначала читать local rules, потом global rules.
4. После каждого крупного блока: checkpoint в `.planning/`.
5. Перед финалом: сверка checklist + доказательства команд.
6. Если context >500KB: автосохранение checkpoint без ожидания.

## Что делать с `pipeline`

Текущий `pipeline` слишком похож на большой церемониальный router. Его надо упростить.

### Новый смысл `/pipeline`

`pipeline` должен быть не "заставь использовать все skills", а "доведи задачу до результата":

1. Intake: извлечь требования пользователя в checklist.
2. Project guard: прочитать local project rules и проверить docs.
3. Classify: trivial / medium / bug / complex / security.
4. Route: выбрать минимальный skill set.
5. State: записать per-project state.
6. Execute: делать работу.
7. Verify: build/test/lint/app proof.
8. Handoff: checkpoint + docs/codemap delta.

### Что убрать/ослабить

- Один глобальный `~/.claude/pipeline-state.json`.
- Автоматическое навязывание 5+ skills для complex задач.
- Future timestamps и ручные pseudo-checkpoints.
- Роутинг, который полагается на narration вместо проверяемого state.

### Что добавить

- per-project state store;
- checklist extractor;
- `project doctor` перед стартом;
- "minimal route" вместо "max process";
- health summary перед финалом.

## Что делать с `architect-first`

Сейчас он звучит как правильная философия, но пользователь не всегда видит пользу. Нужно превратить его в конкретный artifact generator.

### Новый смысл `/architect-first`

`architect-first` должен создавать короткий архитектурный контракт:

- текущая карта системы;
- 2-3 варианта решения;
- trade-offs;
- выбранный вариант;
- acceptance tests;
- data flow;
- API/DB/UI impact;
- rollback plan;
- какие docs/codemaps/RAG нужно обновить;
- sprint slices по 1-3 часа.

### Где использовать `awesome-scalability`

`binhnguyennus/awesome-scalability` можно подключить как reference corpus для сложных backend/system design решений. Но не надо просто `gh repo clone` внутрь skill. Лучше:

- `~/.claude/reference-cache/awesome-scalability/`
- pinned commit;
- индекс только markdown/links;
- `architect-first` вызывает его только когда задача про scalability/performance/reliability.

Источник: [binhnguyennus/awesome-scalability](https://github.com/binhnguyennus/awesome-scalability).

## Что делать с `init-project`

`init-project` должен стать главным cross-project bootstrap.

### Требования v2

- detect real root;
- create/upgrade/noop;
- preserve project-specific content;
- never overwrite local gotchas/commands/architecture;
- section-aware merge;
- protected blocks:
  - `<!-- PROJECT-SPECIFIC:START -->`
  - `<!-- PROJECT-SPECIFIC:END -->`
- создать/проверить:
  - `AGENTS.md`
  - `CLAUDE.md`
  - `.gemini/GEMINI.md`
  - `.rag/manifest.json`
  - `.claude/project.json` или `.ai/project.json`
  - `.planning/`
- зарегистрировать проект в `~/.claude/projects-registry.json`;
- запустить `doctor` и показать что работает/не работает.

## Что делать с `sync-docs`

Текущий принцип "source of truth priority" рискованный: он может размножить устаревший doc.

Нужно сделать `sync-docs v2`:

- parse sections by heading;
- compare core sections;
- merge by section, not full-file copy;
- tool-specific notes сохранять отдельно;
- project-specific protected blocks не трогать;
- показать diff summary до записи;
- после записи проверить, что 6 core sections есть во всех 3 файлах.

## Внешний research

### Shannon

Shannon Lite описан как autonomous white-box AI pentester для web apps и APIs. Shannon Pro делает двухэтапный pipeline: agentic static analysis + autonomous dynamic pentesting; Pro использует CPG, data flow, business logic testing, reachability and static-dynamic correlation. Важные ограничения: Shannon Lite AGPL-3.0, white-box/source-available.

Источник: [KeygraphHQ/shannon](https://github.com/KeygraphHQ/shannon), [Keygraph Shannon overview](https://keygraph.io/shannon).

Решение: интегрировать идеи и optional adapter, не вендорить код в skill:

- `red-team` получает `shannon-adapter.md`;
- запуск только после explicit authorization;
- Shannon ставится отдельно в external cache;
- результаты нормализуются в наш evidence protocol;
- AGPL учитывается: не смешивать код Shannon с proprietary skill code.

### Claude Code ecosystem

Claude Code Stack показывает публичный каталог MCPs, skills, subagents, hooks, plugins и CLAUDE.md components, с install commands и project manager. Это подтверждает, что нам нужен не просто набор skills, а catalog/registry/doctor layer.

Источник: [Claude Code Stack](https://www.claudecodestack.com/).

`awesome-claude-code-toolkit` полезен как каталог идей: backup/sync config (`claudebase`), session intelligence, hooks, safe setup, knowledge graph, quota tracking. Особенно релевантно для нас: config backup, multi-machine conflict detection, session search, context recovery.

Источник: [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit).

### Тренды GitHub AI tooling

OSSInsight показывает, что в top movers за 28 дней входят coding agents и agent tooling: OpenCode, Claude Code, Codex, RAGFlow, MCP servers, OpenHands. Это подтверждает направление: не один монолитный assistant, а agent/tool ecosystem с надежным context/search layer.

Источник: [OSSInsight Trending AI Repositories](https://ossinsight.io/trending/ai).

### Codebase understanding alternatives

Кандидаты для оценки вместо или рядом с Graphify:

- Aider repo map: tree-sitter based map of entire codebase for larger projects. Источник: [Aider](https://github.com/Aider-AI/aider).
- Serena MCP: semantic code retrieval/editing, LSP-like symbol tools, supports many languages. Источник: [oraios/serena](https://github.com/oraios/serena).
- Sourcegraph MCP: keyword, semantic, commit, diff, repo, file tools for agents. Источник: [Sourcegraph MCP docs](https://sourcegraph.com/docs/api/mcp).
- Repomix: pack codebase into AI-friendly format, useful for audit snapshots, not live semantic retrieval. Источник: [Repomix overview](https://fr0stb1rd.gitlab.io/posts/pack-your-codebase-for-ai-with-repomix/).
- DeepWiki/CodeWiki direction: automatic repo documentation/wiki. Источник: [DeepWiki](https://deepwiki.org/).

### Research warning

Recent empirical research on AI coding agents says failed agent PRs often touch more files, fail CI, or misalign with reviewer expectations. This directly supports our need for smaller sprint slices, tests, and checklist verification.

Источники:

- [AIDev dataset](https://arxiv.org/abs/2602.09185)
- [Where Do AI Coding Agents Fail?](https://arxiv.org/abs/2601.15195)

## Context7+

Context7 оставить обязательным для library API. Но для "лучшие практики кода" нужно добавить research ladder:

1. Official docs / Context7.
2. GitHub repo issues/discussions/releases for the exact library version.
3. Sourcegraph public code search for real implementations.
4. Firecrawl GitHub-category search when docs/issues need full markdown extraction.
5. Security-specific: CodeQL/Semgrep/GitHub Advisories/OWASP docs.
6. Community sources like Reddit/StackOverflow only as weak signal, never as sole source.

Источник по Sourcegraph MCP: [Sourcegraph MCP Server](https://sourcegraph.com/mcp).  
Источник по Firecrawl search category filtering: [Firecrawl Search API](https://docs.firecrawl.dev/api-reference/v2-endpoint/search).

## Sprint roadmap

### Sprint 0 — Freeze and audit hygiene

Goal: stop state pollution before changing skills.

Tasks:

- Add audit checkpoint and this report.
- Run global `doctor` manually and list failures.
- Fix invalid git ref only after explicit approval.
- Inventory risky `red-team` vendored files.
- Record current hook/skill/RAG versions.

Done when:

- audit report saved;
- list of blockers exists;
- no destructive cleanup done without approval.

### Sprint 1 — Global project registry and doctor

Goal: one command tells whether the system works in any project.

Tasks:

- Create `~/.claude/projects-registry.json`.
- Build `doctor` checks:
  - docs exist;
  - local rules preserved;
  - skill registry valid;
  - invalid SKILL.md YAML;
  - hooks reachable;
  - Graphify health;
  - RAG manifest/index health;
  - git health;
  - pipeline state freshness;
  - red-team Defender-risk files.
- Add `doctor.cmd` / `doctor.ps1`.

Done when:

- running doctor from any project returns pass/warn/fail;
- new projects are discovered or registered;
- failures include repair commands.

### Sprint 2 — Project capsule / state isolation

Goal: no global state leaks between projects.

Tasks:

- Replace `~/.claude/pipeline-state.json` with per-project state path.
- Add project key normalization.
- Add TTL and future timestamp rejection.
- Update `pipeline`, `architect-first`, `sprint`, `inline-review`, `ship` to read project state.
- Add migration fallback for old state, read-only.

Done when:

- opening project A never resumes project B state;
- state survives session resume;
- doctor catches stale/wrong state.

### Sprint 3 — `init-project v2` and `sync-docs v2`

Goal: docs work everywhere and never erase local rules.

Tasks:

- Implement section parser for markdown docs.
- Add protected project-specific blocks.
- Add create/upgrade/noop with diff summary.
- Add `.rag/manifest.json` generation.
- Add `.planning/` initialization.
- Add registry registration.
- Add verification that 6 core sections exist in all 3 docs.

Done when:

- new project bootstrap works;
- existing project upgrade preserves unique local gotchas and commands;
- docs are synchronized without flattening project-specific notes.

### Sprint 4 — Graphify/RAG/codemap repair

Goal: code maps become trustworthy or are replaced.

Tasks:

- Add `codemap doctor`.
- Add Graphify relevance smoke test.
- Add Graphify project-scope enforcement.
- Replace hardcoded RAG project list with registry discovery.
- Improve queue stats: pending/indexed/failed/stale.
- Evaluate Serena and Aider repo map on 2 real projects.
- Keep Graphify only if it passes relevance tests.

Done when:

- any registered project can run docs/RAG/codemap setup;
- bad graph is detected automatically;
- query results cite current project files.

### Sprint 5 — Skills simplification

Goal: make `pipeline` and `architect-first` obviously useful.

Tasks:

- `pipeline v2`: checklist extraction, project guard, minimal route, per-project state, final criteria check.
- `architect-first v2`: architecture contract artifact, acceptance tests, sprint slices, docs/codemap delta.
- Add optional `awesome-scalability` reference cache.
- Add skill budget: no more than one orchestrator + one domain + one verifier unless user asks.

Done when:

- user sees concrete artifacts, not ceremony;
- complex task creates sprint plan with testable slices;
- simple tasks bypass heavy workflow.

### Sprint 6 — Red-team safe packaging + Shannon adapter

Goal: keep security skill useful without Defender bans.

Tasks:

- Remove/quarantine vendored binaries/build artifacts/offensive PoC source from local skill package.
- Keep safe markdown methodology and indexes.
- Add external reference manifest with pinned repo URLs.
- Add Shannon adapter docs and result normalization.
- Add authorization gate before any scan/exploit workflow.
- Add CodeQL/Semgrep/Gitleaks as safer first-pass scanners.

Done when:

- Defender no longer flags normal skill folder;
- red-team still supports authorized audits;
- Shannon is optional and isolated.

### Sprint 7 — Context7+ research layer

Goal: use current best practices beyond Context7.

Tasks:

- Add research ladder to `pipeline` and `architect-first`.
- Add GitHub issues/discussions search step for libraries.
- Add Sourcegraph/Firecrawl evaluation.
- Cache research results per library/version.
- Require citations in architecture/security plans.

Done when:

- library/API tasks show official docs + current issue/release evidence;
- outdated tutorials are not used as primary source.

### Sprint 8 — Verification and docs release

Goal: prove the system works end-to-end.

Tasks:

- Run hook test suites outside sandbox if needed.
- Run doctor on at least:
  - command center;
  - Izi tracker;
  - Itstep_AI;
  - Semenov or another fresh clone.
- Update `AGENTS.md`, `CLAUDE.md`, `.gemini/GEMINI.md`.
- Create final checkpoint and changelog.

Done when:

- all target projects pass bootstrap/docs/state checks;
- known warnings are documented;
- final report includes exact proof commands.

## Non-negotiable design rules for the rebuild

1. Global layer must never overwrite project-specific rules.
2. Every project must be able to opt in/out of RAG and Graphify.
3. One global mutable state file is forbidden.
4. A tool is not "working" unless doctor can prove it from current cwd.
5. Red-team references must be safe-by-default on Windows.
6. `pipeline` should reduce cognitive load, not add ceremony.
7. `architect-first` should output a usable implementation contract.
8. Final answers must check the original user checklist before saying done.

## Recommended first implementation order

Start with Sprint 1 + Sprint 2 before touching big skills. Without registry and per-project state, any skill rewrite will keep leaking context between projects.

Then do Sprint 3 because docs are the foundation for "any project". Only after that fix Graphify/RAG/codemaps.

Red-team cleanup can run in parallel after audit, but actual file deletion/quarantine should be approved explicitly because it touches many vendored files.

