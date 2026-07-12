# CHECKPOINT 2026-07-10 — ELT Fleet: план и роадмап готовы (реализация — в новом чате)

## ЧТО СДЕЛАНО (этот чат = только план, по ТЗ юзера)
- Ресерч: Anthropic (multi-agent system: orchestrator-workers, токены ×15, время −90%;
  best practices: worktrees + fan-out `claude -p`), OpenAI (practical guide: single-agent
  first, manager pattern; codex exec headless: --json, -o, --sandbox workspace-write),
  Gemini = **Antigravity `agy` v1.0.10 по подписке** (решение юзера; gemini-cli
  free-tier мёртв: IneligibleTierError → migrate to Antigravity; agy headless:
  промпт STDIN → `-p`, --print-timeout деф.5м, --dangerously-skip-permissions, --model,
  --sandbox; auth = браузер-OAuth юзером, не залогинен → пусто при exit 0; `agy models`
  виснет >60с живьём → hard-таймауты везде; лимиты 2026 compute-based, окно ~5ч +
  недельный кап, Pro ×4 / Ultra ×20), prior art
  (vibe-kanban / claude-squad / amux: консенсус = worktree-изоляция + headless,
  tmux только для просмотра), терминалы Windows (wt = только дисплей; WezTerm cli =
  tmux-аналог с get-text; свой PTY-тул не нужен).
- Дизайн: `.planning/ELT-FLEET-DESIGN.md` — 9 ADR-решений, архитектура, роутер/failover,
  экономика (fleet НЕ экономит токены — экономит время + разгружает Claude-бюджет
  роутингом S/M на agy/codex/haiku), инварианты (харнесс неизменен), риски.
- Спека: `specs/002-elt-fleet/spec.md` (5 критериев приёмки, жёсткий вне-scope).
- Слайсы: `specs/002-elt-fleet/tasks.md` — T001–T017, 6 фаз (A фундамент → F live-fire),
  оракул `node tools/doctor.test.js && node --test tools/fleet/`, [live]-слайсы помечены.
- 001-specify-loop-bridge закрыта полностью → elt slice next возьмёт 002 без конфликтов.

## ЗАДАЧА (суть режима)
Fleet = N параллельных headless-воркеров (claude -p / codex exec / agy -p по подписке), каждый
в git worktree, на [P]-слайсах одного плана; оркестратор = код `tools/fleet/fleet.js`
(0 LLM-токенов на управление); гейт слайса неизменен (оракул → судья sonnet
REJECT-default → elt commit); merge queue + [X]-марк оркестратором; роутер по
size-тегу + failover по 429-сигнатурам. Директива юзера: харнесс СОХРАНЯЕМ, расширяем.

## ДАЛЬШЕ (новый чат)
1. `/elt` → Режим 1: `specs/002-elt-fleet/tasks.md`, первый слайс **T001** (elt init
   репо + tools/fleet/ smoke) — гипотезы проверяются на каждом слайсе живьём.
2. T003 [live] гнать при юзере (жрёт окна codex/agy; PREREQ: юзер логинится в agy
   браузером — `!agy`, проверка `agy models`; снять точную STDIN-инвокацию agy 1.0.10
   и сигнатуры лимитов — единственное непроверенное место дизайна).
3. Открытые вопросы юзеру (не блокируют): бенч-проект T016 (scratch vs AWE4);
   claude-воркеры со skip-permissions или --permission-mode auto; WezTerm ставить
   только при реальной нужде в интерактиве; какая подписка Google AI (Pro/Ultra —
   влияет лишь на размер 5ч-окна agy).
4. Плановые файлы этого чекпоинта НЕ закоммичены (по конвенции репо planning-файлы
   коммитятся пачкой позже) — T001 начнёт обычный elt-цикл.

## Resume
Читать: `.planning/ELT-FLEET-DESIGN.md` (архитектура+источники) → `specs/002-elt-fleet/spec.md`
→ tasks.md. Драйвер-прецедент: `tools/elt-loop.ps1` (судья-промпт/парсер портировать в gate.js).
