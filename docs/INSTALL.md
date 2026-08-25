# Установка ELT

Плагин `elt@elt` ставится из собственного приватного marketplace. Ни один шаг ниже не
записывает файлы в `~/.claude/bin`: развёртка рантайма снята спекой 019 T015, установленный
каталог плагина и есть исходник.

## 1. Claude Code

```powershell
claude plugin marketplace add prodelt/elt-harness
claude plugin install elt@elt
```

Репозиторий приватный: доступ к `prodelt/elt-harness` должен быть настроен на машине заранее
(`gh auth status`). Для разработки вместо имени репозитория принимается локальный путь:

```powershell
claude plugin marketplace add "C:\Claude playground\ELT-v5-one-hour"
claude plugin install elt@elt
```

Проверка:

```powershell
claude plugin list
claude plugin details elt@elt
node bin/doctor.js
```

`plugin details` показывает, что именно приехало: 6 скилов, 6 агентов, 2 хука. Хуки помечены
`harness-only — no model context cost`: они исполняются процессом Claude Code и не занимают
контекст модели.

## 2. Что даёт установка

| поверхность | состав |
| --- | --- |
| скилы | `elt`, `elt-verify`, `elt-defects`, `elt-doctor`, `harness-method`, `project-bootstrap` |
| агенты | пять линз `review-*` и `confidence-scorer` |
| хуки | `SessionStart` — сводка проекта; `Stop` — dirty-exit gate |

Хуки версионируются вместе с плагином и живут в `hooks/hooks.json`, а их код — в
`bin/session-start.js` и `bin/session-stop.js`. Абсолютных путей в них нет: команды идут от
`${CLAUDE_PLUGIN_ROOT}`, поэтому один и тот же манифест работает на любой машине.

**SessionStart** печатает ветку, состояние дерева, режим `verify`, счёт открытых задач плана и
очередь фоновых красных. В проекте без `.harness/harness.json` он молчит: не ELT-проект — нечего
говорить.

**Stop** не даёт закончить сессию, которая правила файлы в ELT-проекте и оставила дерево
грязным. Незакоммиченная правка не попадает ни в run-log, ни под судью — то есть выпадает и из
ревью, и из замера «доля работы через харнес». Гейт fail-open по построению: не ELT-проект,
чистое дерево, правок этой сессии не было, транскрипт нечитаем — он молчит.

## 3. Codex и Gemini

Claude получает `/elt` установкой плагина. Codex и Gemini читают скилы из своих домашних
каталогов, поэтому туда кладётся копия того же самого файла:

```powershell
node tools/host-surface.js --sync-clients --dry-run   # что изменится
node tools/host-surface.js --sync-clients             # применить
```

Команда переписывает ровно `~/.codex/skills/elt/SKILL.md` и `~/.gemini/skills/elt/SKILL.md`
(и `~/.claude/...`, если там осталась старая копия) содержимым репозиторного
`skills/elt/SKILL.md`, сохраняя прежнее рядом как `.bak-<timestamp>`. Она ничего не удаляет:
ни чужие скилы, ни снятую развёртку `~/.claude/bin/elt.js`.

Проверка паритета — `node tools/host-surface.js`. Строка `паритет клиентов` сверяет SHA-256, а
не наличие файла:

```
  [ok           ] паритет клиентов — источник 5.0.0 90dcc5e4b4f7
      claude: ok (5.0.0 90dcc5e4b4f7) — C:\Users\espad\.claude\skills\elt\SKILL.md
      codex: ok (5.0.0 90dcc5e4b4f7) — C:\Users\espad\.codex\skills\elt\SKILL.md
      gemini: ok (5.0.0 90dcc5e4b4f7) — C:\Users\espad\.gemini\skills\elt\SKILL.md
```

Почему по хешу: замер 2026-08-24 показал источник 5.0.0 и все три копии 4.0.0 — два клиента
из трёх месяц читали снятый маршрут, и сверка «файл есть» этого не видела в принципе.

## 4. Проект

Плагин ставится ДО бутстрапа, поэтому `node bin/doctor.js` в чистом проекте зелёный:
отсутствие `.harness/harness.json` — это `INFO`, а не отказ. Конфиг проекта создаёт `/elt`.

## 5. Обновление и откат

```powershell
claude plugin update elt          # обновить (нужен перезапуск)
claude plugin uninstall elt@elt   # снять
```

Версия обязана совпадать в `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` и во
frontmatter `skills/elt/SKILL.md` — расхождение валит `claude plugin tag` при релизе, и
`node bin/doctor.js` показывает его заранее отдельной строкой.

## 6. Если ELT-хуки уже стоят глобально

На машине, где ELT жил до плагина, `~/.claude/settings.json` может вызывать
`~/.claude/hooks/elt-session-brief.js` и `~/.claude/hooks/dirty-exit-gate.js`. После установки
плагина то же самое делают его хуки, и сводка печатается дважды.

Плагин их не трогает — это пользовательский профиль, и удалять оттуда файлы, чей источник ему
неизвестен, он не имеет права. Убрать дубль можно вручную: снять две записи из
`hooks` в `~/.claude/settings.json` (сами файлы можно оставить — они перестанут вызываться).
