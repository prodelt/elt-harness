# Hook Friction Log - 2026-04-24

## Мета

Зафіксувати реальні проблеми hook/runtime шару, які з'явилися під час виконання Task 46 і створили зайві токенові витрати або зламали нормальний workflow.

## 1. Context7 enforcement не визнає MCP-виклики

### Симптом

Після `mcp__context7__resolve_library_id` і `mcp__context7__query_docs` наступний `apply_patch` двічі був заблокований з повідомленням:

`CONTEXT7 REQUIRED: 9 code edits without fetching docs`

### Реальний workaround

Лише явний CLI-виклик:

```bash
cmd /c npx ctx7 docs /microsoft/playwright "auto-waiting web-first assertions"
```

зняв блок і дозволив наступні edits.

### Impact

- зайвий круг викликів перед звичайним doc edit;
- дублювання одного й того ж evidence через MCP + CLI;
- непотрібне розширення контексту та зайві токени.

### Ймовірна причина

`edit-enforcer` або суміжний tracker дивиться лише на CLI/Bash pattern і не враховує MCP Context7 tool usage.

### Що виправити

1. Визнати `mcp__context7__resolve_library_id` і `mcp__context7__query_docs` як валідний Context7 proof.
2. Зберігати Context7 usage у спільний state незалежно від transport layer (MCP або CLI).
3. Якщо MCP proof уже є в цій сесії, не вимагати повторного CLI lookup.

## 2. Hook test suites дають масовий `exit=null` у sandbox

### Симптом

Команди:

```bash
node "C:\Users\user\.claude\hooks\test-all-hooks.js"
node "C:\Users\user\.codex\test-codex-hooks.js"
```

повернули повний обвал:

- `0/32 PASS`, `32 FAIL`
- `0/41 PASS`, `41 FAIL`

Майже всі fail мають однаковий шаблон:

`reason: exit=null, stdout=`

### Impact

- локальна верифікація hooks у sandbox не заслуговує довіри;
- замість одного діагнозу система виливає десятки fail lines;
- на читання noisy output іде більше токенів, ніж на корисне розслідування.

### Ймовірна причина

Harness або spawn model тест-ранерів несумісний з поточним sandbox/CLI режимом, але тести не роблять fast-fail на цю умову.

### Що виправити

1. Додати preflight: якщо child hook execution недоступний, завершувати suite одним status `environment invalid`.
2. Окремо друкувати `spawn failure`/`permission failure`/`timeout`, а не 32-41 псевдо-регресії.
3. Не рахувати такий запуск як product regression для окремих hooks.

## 3. Behavioral suite генерує false negatives при broken harness

### Симптом

Команда:

```bash
node "C:\Users\user\.claude\hooks\test-hooks-behavior.js"
```

дала `15/37 PASS`, `22 FAIL`, причому багато fail мають форму:

- `expected DENY, got ALLOW`
- `exit=null stdout="undefined"`
- `state.json not created after code edits`

### Impact

- один broken runtime path виглядає як десятки логічних багів;
- важко відрізнити реальний regression від проблеми test harness;
- шум перекриває корисні findings.

### Що виправити

1. Якщо базовий hook process не стартує, behavior suite має stop early.
2. Додати окремий health check для fixture I/O і child process execution.
3. Позначати такі падіння як `suite infrastructure failure`, а не як failing hook rules.

## 4. Output limiter спрацьовує після токенової втрати, а не до неї

### Симптом

Під час читання `NEXT_SESSION_PROMPT.md`, `MEMORY.md`, `architect-first SKILL.md`, `git diff` і великих doc outputs система кілька разів повернула developer warnings на кшталт:

- `BASH OUTPUT 28.4K`
- `BASH OUTPUT 19.7K`
- `BASH OUTPUT 13.3K`

Повідомлення приходить уже після того, як великий output потрапив у контекст.

### Impact

- токени вже витрачені;
- hook/guard лише констатує проблему постфактум;
- повторні large-read патерни залишаються легкими для випадкового запуску.

### Що виправити

1. Додати pre-command guard для `Get-Content`, `git diff`, `rg -C`, який вимагає ліміт або дає auto-rewrite hint.
2. Ввести стандартний wrapper pattern: `-TotalCount`, `rg -n`, `git diff --stat` first.
3. Якщо команда явно unbounded і вже відомо, що файл великий, повертати deny/advisory до виконання.

## 5. Підсумок впливу на роботу

Найболючіші friction points цієї сесії:

1. Context7 hook змусив дублювати MCP evidence через CLI.
2. Hook suites згенерували великі noisy dumps без корисного verdict.
3. Output guard не зупинив великі reads наперед.

## Пріоритет на наступний прохід

1. Внести ці пункти в Task 47 audit як runtime findings.
2. Переробити Context7 tracker на transport-agnostic logic.
3. Додати fast-fail для hook test harness.
4. Посилити pre-read/output limiting policy до виконання команди, а не після.
