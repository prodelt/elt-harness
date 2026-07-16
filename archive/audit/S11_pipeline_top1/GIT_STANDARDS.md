# S11 — Git Workflow Standards

## Модель: GitHub Flow + Conventional Commits

Выбрано как минимально-достаточное для solo-dev + AI-агентов.

## Правила (обязательные)

1. **main защищён**: прямые коммиты блокируются хуком `git-branch-guard`.
2. **Branch naming**: только `(feature|fix|hotfix|chore|docs|refactor|test)/[a-z0-9-]{3,50}`.
3. **Commit format**: `<type>(<scope>): <subject>` (≤80 chars), Conventional Commits 1.0.
   - types: `feat, fix, chore, docs, refactor, test, style, perf, build, ci, revert`
   - scope — optional, kebab-case, отражает модуль
   - body опционален, но обязателен если изменение нетривиальное
   - Footer: `Co-Authored-By:` для AI-assisted
4. **1 PR = 1 feature**, squash-merge при закрытии.
5. **Pre-commit**: lint + fast tests обязаны проходить. `--no-verify` только с явного разрешения пользователя.
6. **Branch-per-session**: агент при старте задачи создаёт ветку, не работает в main.
7. **Перед push**: `git pull --rebase origin main` для актуализации.
8. **git add — никогда `-A` или `.`**: только явные файлы или `git add -p`.
9. **Протект прод**: никогда `git push --force` в main.
10. **1 проект = 1 репо**: `C:\` — исторический моно-git, legacy, не стандарт.

## Conventional Commits — примеры

### Правильно
```
feat(harvest): add cross-session briefing skill
fix(auth): handle token expiry in middleware
chore(deps): bump eslint to 9.0.0
docs(readme): explain hook registration workflow
refactor(hooks): extract shared logger into lib/logger.js
test(session-size-guard): cover >500KB boundary
```

### Неправильно (будет заблокировано)
```
fix bug                        — no type prefix
Fix: token                     — Capital letter in type
feature/harvest added          — not conv-commits at all
feat: 123                      — subject <5 chars
feat(HARVEST): something       — scope not kebab-case
```

## Workflow на одну задачу

```bash
# 1) Ветка
git checkout main
git pull --rebase origin main
git checkout -b feature/s11-task-03-session-size-guard

# 2) Работа — хуки следят:
#    - git-branch-guard: НЕ пускает commit в main
#    - branch-name-validator: проверил имя ветки при checkout -b
#    - conventional-commit-validator: валидирует формат commit message
#    - pre-commit-gate: lint + tests

# 3) Коммит
git add ~/.claude/hooks/session-size-guard.js
git commit -m "$(cat <<'EOF'
feat(hooks): add session-size-guard for >500KB JSONL warnings

UserPromptSubmit event: if transcript size >500KB injects additionalContext
recommending /checkpoint and fresh session. Prevents compaction loss.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"

# 4) Rebase + push
git fetch origin
git rebase origin/main
git push -u origin feature/s11-task-03-session-size-guard

# 5) PR
gh pr create --title "feat(hooks): session-size-guard" --body "Closes S11 task 03. See audit/S11_pipeline_top1/PLAN.md"

# 6) После merge
git checkout main
git pull --rebase origin main
git branch -d feature/s11-task-03-session-size-guard
```

## Правила для 7 активных проектов

| Проект | Планируемый workflow | Protected branches |
|--------|---------------------|--------------------|
| Law-assistant | GitHub Flow + worktrees для параллельных фич | main |
| Izi-tracker | GitHub Flow | main |
| sudoviy-master-try-3 | GitHub Flow | main |
| Pipeline-setupper | GitHub Flow | main |
| tg-bot-reclamaties-master | GitHub Flow | main |
| CV | GitHub Flow (упрощённый) | main |
| Ametrin-platform | GitHub Flow | main |

## Хуки, обслуживающие git-discipline

| Хук | Событие | Блокирует | Задача |
|-----|---------|-----------|--------|
| `git-branch-guard.js` | PreToolUse[Bash] | commit в main/master | 30 |
| `conventional-commit-validator.js` | PreToolUse[Bash] | некорректный формат commit | 31 |
| `branch-name-validator.js` | PreToolUse[Bash] | плохое имя ветки | 32 |
| `pre-commit-gate.js` | PreToolUse[Bash] | lint-fail, test-fail | 33 |
| `session-branch-advisor.js` | SessionStart | — (advisory only) | 35 |

## Добавление в `~/.claude/rules/rules.md`

```markdown
## Git Workflow (GitHub Flow + Conventional Commits)
- main защищён: прямые коммиты блокируются хуком git-branch-guard
- Ветки: feature/<kebab>, fix/<kebab>, chore/<kebab>, hotfix/<kebab>, docs/<kebab>, refactor/<kebab>, test/<kebab>
- Commits: <type>(<scope>): <subject> (≤80 chars) + body для нетривиальных изменений
- PR: 1 feature = 1 PR, squash-merge, локально протестировано
- Pre-commit: lint + fast tests (pre-commit-gate hook). --no-verify только с явного разрешения
- Branch-per-session: старт задачи — git checkout -b, завершение — PR
- Rebase: git pull --rebase перед push; никогда git push --force в main
- git add: явные файлы или git add -p, НИКОГДА git add .
- C:\ = исторический моно-git, legacy; новые проекты должны иметь свой .git/
- 7 активных проектов: Izi-tracker, Law-assistant, sudoviy-master-try-3, tg-bot-reclamaties-master, Pipeline-setupper, CV, Ametrin-platform
```

## Критерии успеха git-discipline

| # | Метрика | Порог | Команда |
|---|---------|-------|---------|
| 1 | Коммитов в main напрямую (не через merge) за 7 дней | 0 | `git log main --since='7 days' --no-merges --first-parent` |
| 2 | Conventional-commits compliance | ≥95% | grep по regex на git log |
| 3 | PR без pre-commit фэйлов | ≥95% | gh pr list + status |
| 4 | Количество `--no-verify` за неделю | 0 | grep в истории bash команд |
| 5 | Активных проектов с per-project `.git/` | 7/7 | script перебора |
