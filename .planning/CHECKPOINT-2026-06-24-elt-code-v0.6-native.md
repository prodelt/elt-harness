# CHECKPOINT 2026-06-24 — elt-code v0.6 + нативный апгрейд

## Сделано в сессии
- **Оценка отставания:** CC 2.1.187 = верх changelog (по версии не отстаём; ~40-50% возможностей в эксплуатации).
- **Дизайн-док:** `.planning/ELT-CODE-v0.6-UPGRADE.md` (визуальная архитектура цикла + тиры). Ключ: судья = оракул завершения петли.
- **Тир 1:** `~/.claude/settings.json` `defaultMode` `bypassPermissions`→**`auto`** (classifier-режим, значение из `sdk-tools.d.ts`; JSON валиден; бэкап в scratchpad). Применится в НОВОЙ сессии.
- **Тир 2:** `MEMORY.md` сжат 38→30 строк (история AMOS → `memory/archive/INDEX.md`); новая запись `project_elt_code_v0.6_native_upgrade_2026-06-24.md`.
- **Шаг 4.0 (по требованию юзера):** ОБЯЗАТЕЛЬНЫЙ live-fire — Клод реально исполняет каждую фичу; **H3** добавлен в рубрику судьи (блокирует). `elt-code/SKILL.md` → **v0.6.0**.
- **Шаг 6 (Тир 3 механизм):** автономная петля слайсов (нативный /loop dynamic + судья-оракул + loop-guardian + max-iterations). Описан, НЕ обкатан.
- **Шаг 2.6 — авто-grill (v0.7.0):** elt-code сам выбирает `grill-with-docs` (есть доки/домен) либо `grill-me` (greenfield); закалка плана ДО кода; COMPLEX/#2 обязателен, MEDIUM опц., остальное пропуск; выход→spec.md. Юзеру не звать гриллы отдельно.

## Проверки (proof)
- `settings.json`: `node -e` → `defaultMode = auto`, JSON валиден ✓
- `MEMORY.md`: 38→30 строк, все 17 живых ссылок существуют ✓
- `SKILL.md`: версия 0.6.0, 9 шагов на месте, 10× H3 согласованы ✓

## Не сделано / отложено
- **Живой прогон петли (Тир 3)** — нужен 1 реальный COMPLEX-таск под присмотром в **свежей сессии** (петля по дизайну = свежий контекст; эта сессия раздута до ~140k).
- Судья → structured output (механизм schema в скиле не подтверждён).
- #5 аудит → agent team (параллель).
- `.planning/ELT-CODE-v0.6-UPGRADE.md` и CHECKPOINT — **не закоммичены** (юзер не просил commit; auto-mode теперь страхует git).
- `/usage` — юзер запускает сам (UI); свежего report.html нет.

## Обновление 2026-06-24 (свежая сессия) — Тир 1 закрыт через guardrail

- **Поведенческий тест Тира 1 ПРОВАЛЕН:** `auto`-режим **НЕ блокирует** `git reset --hard` —
  выполнился молча (тест в одноразовых репо: scratchpad + вложенный на боевом пути; файл откатился).
  Причина НЕ классификатор, а `~/.claude/settings.json:209,214`
  `skipDangerousModePermissionPrompt:true`+`skipAutoPermissionPrompt:true` подавляют эти промпты.
  Посылка «auto страхует git» — **неверна**.
- **Ремедиация (решение юзера):** поставлен `git-guardrails-claude-code` как **node-порт**
  `.claude/hooks/block-dangerous-git.js` (PreToolUse matcher Bash; deny push/reset --hard/clean -f[d]/
  branch -D/checkout ./restore ./push --force; exit 2). Project-scope `.claude/settings.json` (gitignored).
  **Подхватился на лету** — заблокировал реальный Bash-вызов в этой же сессии; danger→exit2, safe→exit0,
  ложных нет. Это и есть детерминированное дно петли вместо неработающего auto. Note: блокирует и
  легитимный `git push` → push петли остаётся ручным (= git workflow rule).
- **Готовность к live-fire подтверждена:** loop-guardian.js работает (deps целы, blockAt:6); `/loop` —
  нативная команда; elt-code v0.7.0 Шаг 6 на месте.

### Resume Pointer (live-fire петли — следующая СВЕЖАЯ сессия)
- **Focus:** прогнать автономную петлю `/elt-code` (Шаг 6) на одной реальной COMPLEX-задаче под
  присмотром; проверить, что судья гейтит ScheduleWakeup (PASS+слайсы→след / PASS+нет→Шаг5 / BLOCK→тот же)
  и loop-guardian ловит застревание.
- **Рецепт запуска (свежий контекст):**
  1. Тир 1 уже закрыт guardrail'ом (рестарт не нужен — project-хук активен).
  2. Подключить `loop-guardian.js` **на время loop-сессии** как PostToolUse(Edit|Write|Bash) —
     снять после прогона (PostToolUse = per-turn налог вне петли).
  3. Задать max-iterations cap.
  4. `/loop` (dynamic) с kickoff-промптом выбранной COMPLEX-задачи.
- **Открытый вопрос:** judge → structured output (schema не подтверждена); как чисто подключать/снимать
  loop-guardian per-session без правки project settings каждый раз.
