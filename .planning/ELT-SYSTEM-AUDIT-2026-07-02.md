# Аудит elt-системы (elt-code / elt-loop / elt-work) + ресерч лучших практик — 2026-07-02

> Запрос: найти проблемы, путь к «эталону харнеса», сверка с практиками Anthropic + внешний ресерч.
> Источники: три SKILL.md живьём, `.planning/STATE.md`, хуки (глобальные + проектные), git-история зубов,
> клон `cobusgreyling/loop-engineering` (README, LOOP.md, concepts, loop-design-checklist, failure-modes,
> anti-patterns, examples/claude-code), `humanlayer/12-factor-agents`, канон Anthropic engineering
> (building effective agents / agent SDK verify-loop / context engineering / long-running harnesses / agent skills).

## Вердикт

Система здорова и **доказана живым прогоном** (12+ слайсов AWE3, 0 красных оракулов, US1+US2 закрыты).
Архитектурно она уже совпадает с канономи в главном: тонкий роутер, механический оракул вместо LLM-судьи,
STATE.md-хребет, kill-switch, hard-cap, escalation ≤3. По шкале loop-engineering это **крепкий L2
(assisted)**. До «эталона» (L3 unattended + воспроизводимость) не хватает: наблюдаемости петли
(run-log/метрики/бюджет), fresh-context на слайс, добитой до конца доктрины судьи (зуб разошёлся с
доктриной), механического сенсора в elt-work и гигиены конфигов/зеркал.

## Решения юзера (приняты 2026-07-02, вечер)

1. **Делать A–F по порядку.** Имплементация — в отдельной сессии (kickoff:
   `.planning/CHECKPOINT-2026-07-02-elt-system-upgrade-kickoff.md`).
2. **Ветку `feature/elt-code-judge-teeth` — в архив** (сохранить, не удалять; на ней вся свежая история).
3. **Судья-гейт ДОЛЖЕН существовать** — «проверка со стороны»: независимый судья-субагент как второй
   гейт closeout ПОВЕРХ оракула (не вместо). Файлы judge-gate НЕ удалять — re-wire по новой доктрине (шаг E).
4. **Зеркалить** elt-code/elt-loop/elt-work в codex/gemini (после v0.2). **Cron-аудит — ставить** (шаг D).

## Словарь (loop-engineering, полезно принять)

- **Harness** = обвязка одной сессии (guide + sensor + gate + steering) — у нас `/harness-method`.
- **Loop** = harness + schedule + state + verification chain — у нас `/elt-loop`.
- **Intent debt** — агент стартует холодным; скилы = выплата этого долга. **Comprehension debt** —
  петля шипит код быстрее, чем человек его понимает; лечится «читай, что петля сделала» (weekly digest).

## Что уже эталонно (не трогать)

| Наша практика | Подтверждение в каноне |
|---|---|
| elt-code = тонкий роутер 71 строка, интент → готовый скилл | Anthropic «Building effective agents»: routing + simplest composable pattern; своя же история 350→71 |
| Оракул = тесты (exit 0), судья не закрывает петлю | Agent SDK verify-loop: rules-based verification первым; loop-eng failure-mode «Verifier Theater» — мы выстрадали сами (0/46) |
| STATE.md-хребет в проекте, читается на старте, пишется на closeout | Anthropic context engineering (structured note-taking); loop-eng «State/Memory» примитив; 12-factor №5 (unify execution+business state) |
| Kill-switch `loop: PAUSED`, hard-cap 8, self-heal ≤3 → стоп+отчёт | loop-eng checklist §6/§8; failure-mode «Infinite Fix Loop» |
| Husky pre-commit прогоняет полный оракул на каждом commit | Настоящий блокирующий gate — механика, не LLM (live-fire 07-01: блокнул fmt) |
| git-guardrails + codegraph-гейты (сегодня живьём блокнул Read) | «Enabling Claude to work autonomously»: низкоуровневые deny-рейлы |
| Коммит-политика: авто на зелёном (dev) vs ручное подтверждение (нетехнари) | Церемония растёт с необратимостью (PLAYBOOK) — правильная асимметрия |
| Версии+changelog в SKILL.md, скилы <100 строк | Anthropic agent skills: краткость, boring-specific triggers, skills-as-code |

## Находки (по убыванию важности)

**F1. Зуб судьи — файлы-сироты после смены доктрины.** `elt-loop` объявил судью advisory, оракул —
тесты; wiring judge-gate снят в 4 репо ещё 06-26 (память). Но `judge-closeout-gate.js` (3 коммита:
bf54f1d, c87a991, 9301d69, ветка `feature/elt-code-judge-teeth` — текущая!) так и лежит в
`.claude/hooks/` этого репо неподключённым, и аналогичные файлы могли остаться в Fasoli/Geocode/Itstep.
Ветка с зубами судьи не смёржена и уже противоречит доктрине. → Одним сканом подтвердить снятие во
всех репо, файлы удалить/в archive, ветку закрыть осознанно (merge полезного: staleness-guard/сканер
уже в main? — проверить) вместо тихого гниения.

**F2. Наблюдаемость петли отсутствует (главный недостаток до эталона).** Нет run-log
(anti-pattern №10 loop-eng), нет token-бюджета (§8), метрики adoption собираются раз в месяц ручным
подвигом по JSONL (все прошлые аудиты). Эталон = метрики сами капают. У нас уже есть session-harvest +
usage-audit скилы — их просто никто не гоняет регулярно.

**F3. Петля крутится в одной растущей сессии** («остановлено на пороге автокомпакта» в журнале).
Context rot: Anthropic long-running-harness канон = fresh context на фичу + state-файл; Ralph-паттерн —
то же. Native `/loop` (dynamic, ScheduleWakeup) уже существует в CC — свой цикл-раннер строить не надо,
надо им пользоваться для прогонов >2 слайсов (либо чекпоинт+`/clear` каждые N слайсов).

**F4. Cheating-вектор tasks.md.** Тот же агент, который имплементит, отмечает `[X]` и может
редактировать формулировки задач. Спасает механический оракул + husky, но прецедент «T043 отмечен
постфактум» показывает мягкость. Anthropic long-horizon: feature-list неизменяем для агента.
Дёшево: красная линия в SKILL «в tasks.md разрешено только [ ]→[X]» (+ опционально 20-строчный
husky-чек диффа tasks.md). Не строить тяжёлого.

**F5. elt-work без механического сенсора.** Оракул=человек — правильно для нетехнарей, но перед
чеклистом нет автоматической проверки «файл существует, >0 байт, парсится openpyxl/python-docx».
5–15 строк python — и «заглушка вместо файла» ловится до человека. Adoption elt-work не измеряется.

**F6. Зеркала снова дрейфуют.** В `~/.codex/skills` и `~/.gemini/skills` есть только `elt-code`
(версия не сверена), elt-loop/elt-work отсутствуют. Прошлый инцидент (0.4.1 vs 0.9.0) уже был.
Либо прогнать sync-agent-surface, либо явно пометить elt-loop/elt-work как Claude-only. Дешёвый чек
версий-между-поверхностями просится в doctor.js.

**F7. Гигиена конфигов:**
- глобальный `settings.json`: `"model": "claude-fable-5[1m]"` — ANSI-мусор от /model (починить руками);
- `WebSearch`/`WebFetch` в глобальном allow противоречат правилу памяти «WebSearch запрещён»;
- `settings.local.json` этого репо распух до ~240 разовых allow-правил (археология аудитов, включая
  red-team curl на прод-URL и оптовые `Bash(git *)`, `Bash(python *)`, `Bash(node:*)`, `Bash(powershell *)`,
  `Bash(cmd *)` = произвольное выполнение без промпта) — сократить до ~20 живых;
- мусор-копии `.claude/checkpoints (1).log`, `.claude/settings (1).local.json`;
- `spec-template.md` — сирота в elt-code (роутер v1.0.0 его не упоминает).

**F8. STATE.md превращается в журнал** (59 строк, растёт с каждым слайсом) — loop-eng failure-mode
«State Rot» / anti-pattern №5. Хребет должен быть коротким: закрытое переносить в PROJECT-HISTORY.md
на closeout петли (prune-шаг из checklist §5).

**F9. Flake-политика не определена.** Красный оракул, зеленеющий при ре-ране без правок = flake;
loop-eng: классифицировать и карантинить, НЕ «чинить» кодом. Пока Rust-тесты детерминированы,
но e2e (Playwright, dev-БД) уже мутят среду: тесты пишут в dev-БД (132 мусорные записи нашлись на
репетиции). Развести `TEST_DATABASE_URL` до демо 07.07 — иначе повторится на проекторе.

**F10. Verifier-модель.** `CLAUDE_CODE_SUBAGENT_MODEL=haiku`: для advisory-рассказчика ок, но если
судья когда-нибудь снова станет чекером — loop-eng прямо говорит «stronger model on verifier».
Зафиксировать как осознанное решение.

## Ресерч: что берём, что нет

**loop-engineering (главная добыча).** Уже черри-пикнуто: STATE-хребет, kill-switch. Взять ещё:
(1) **Loop Design Checklist + L0–L3 ladder** как рубрику готовности (наш elt-loop ≈ L2); (2)
**loop-run-log.md** — структурная строка на прогон; (3) идею **budget-cap**; (4) каталог
failure-modes как чек при инцидентах. НЕ брать: npm-CLI (loop-init/loop-audit/loop-cost — чужой
стек, наш doctor.js уже есть), 7 паттернов maintenance-петель (другая ниша; daily-triage может
пригодиться позже для Ametrin-репо), MCP-сервер.

**12-factor-agents.** Система уже соответствует ключевым факторам: №3 own context window (STATE.md),
№5 unify state (tasks.md+STATE.md), №8 own control flow (петля в скилле), №9 compact errors
(self-heal читает ошибку), №10 small focused agents (тонкие роутеры). Нового долга нет.

**Канон Anthropic — соответствие:**
- «Building effective agents»: ✓ роутинг, ✓ простейший работающий паттерн.
- Agent SDK loop (gather → act → verify): ✓ verify = механика первым; судья-LLM последним и advisory.
- «Context engineering»: ✓ note-taking, ✓ codegraph just-in-time, ✓ compaction-guard; ✗ fresh-context на слайс (F3).
- «Long-running harnesses»: ✓ state+progress, ✓ e2e-верификация; ✗ immutable task list (F4), ✗ fresh sessions (F3).
- Agent skills: ✓ тонкие, версионированные; ✗ зеркала дрейфуют (F6).
- Native-фичи CC 2026: `/loop` dynamic + ScheduleWakeup + cron — использовать вместо самодельного раннера (лестница ponytail, ступень «платформа умеет сама»).

## План «эталон харнеса» (минимальный, из готового)

| Шаг | Что | Размер |
|---|---|---|
| A | Гигиена: model-строка, allow-листы, мусор-копии, сирота spec-template; ветку judge-teeth — в архив (merge полезного в main, judge-файлы НЕ удалять — уходят в шаг E) | 30 мин |
| B | `elt-loop` v0.2 (guide): run-log строка на слайс в `.planning/loop-run-log.md`; красная линия «tasks.md только [ ]→[X]»; прогон >2 слайсов → native `/loop` или чекпоинт+`/clear`; flake-правило; prune журнала STATE→HISTORY; шаг 5 петли = независимый судья-субагент (дизайн в kickoff-чекпоинте) | малый дифф SKILL.md |
| C | `elt-work` v0.2: механический сенсор артефакта (существует/>0/парсится) перед человеческим чеклистом. После B+C — зеркалирование elt-* в codex/gemini (sync-agent-surface) | ~15 строк py |
| D | Наблюдаемость: еженедельный session-harvest/usage-audit по расписанию (предпочтительно Windows Task Scheduler + `claude -p`; сессионный CronCreate recurring авто-истекает через 7 дней) с 3 метриками: % route-line у elt-code, слайсы/красные/эскалации elt-loop, вызовы+подтверждения elt-work | скилы уже есть |
| E | Судья-гейт v2 (gate): re-wire judge-closeout-gate по новой доктрине — оракул первый, судья = независимый субагент «со стороны» (зуб изоляции c87a991 остаётся), log-verdict, staleness-guard остаётся; wiring project-scope + live-fire 4 сценария | 1–2 ч |
| F | doctor.js: чек версий скилов между поверхностями (claude/codex/gemini) + мини-«Loop Ready» скор по чеклисту | опционально |

**Анти-скоуп (НЕ делать):** не тащить loop-* npm; не строить eval-flywheel (Mode B) до боли;
не делать судью заменой оракула (судья — поверх, не вместо; red оракула судья не «прощает»);
не добавлять глобальных хуков; не писать свой цикл-раннер.

**До демо 07.07:** не трогать работающую петлю (B/E — после демо или осторожно); обязательно
`TEST_DATABASE_URL` или повторная очистка dev-БД (F9).

## Открытые вопросы юзеру — ЗАКРЫТЫ 2026-07-02

1. Ветка judge-teeth → **архив** (сохранить); judge-gate **возвращается в строй** как независимая
   проверка «со стороны» (см. «Решения юзера» + шаг E).
2. Зеркалить — **да** (после v0.2).
3. Cron-аудит — **да** (шаг D).
