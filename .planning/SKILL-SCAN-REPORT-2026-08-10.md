# Скан агентських скілів `~/.claude/skills` — 2026-08-10

Інструмент: NVIDIA SkillSpector **v2.8.2** (глобальний, `uv tool install`), статика (`--no-llm`),
гейт — `tools/skill-scan.js`. Сирі звіти зведені в `SKILL-SCAN-REPORT-2026-08-10.json`.

## Підсумок

| | |
|---|---:|
| Директорій із `SKILL.md` | 88 |
| Успішно проскановано | **86** |
| Таймаут (150 с) | 2 — `gstack`, `red-team` |
| `pass` (тільки LOW/MEDIUM) | **70** |
| `review` (HIGH лише в тексті) | **11** |
| `blocked` (HIGH у виконуваному коді) | **5** |
| Містять виконувані скрипти | 13 з 86 |
| Знахідки за severity | 59 HIGH · 158 MEDIUM · 3 LOW |
| Максимальний сирий бал | 67/100 — жодного `DO_NOT_INSTALL` за шкалою NVIDIA |

Час: ~19 с на звичайний скіл, 56 с на `docx` (16 скриптів). Офлайн, без API-ключів.

## Топ категорій

`MCP Rug Pull` 60 · `Rogue Agent` 45 · `Dangerous Code Execution` 26 · `Excessive Agency` 12 ·
`Privilege Escalation` 12 · `Prompt Injection` 11 · `Tool Misuse` 10 · `MCP Least Privilege` 9

## Розбір усіх пʼяти блоків — усі хибні

| Скіл | Правило | Знахідка | Чому хибна |
|---|---|---|---|
| `docx`, `pptx`, `xlsx` | `E2` Data Exfiltration | `os.environ.copy()` у `scripts/office/soffice.py` | копія оточення для `subprocess` — звичайний Python |
| `contract-review` | `SC3` + `YR4` | `"iVBORw0KGgoAAAANSUhEUgAA…"` у `generate_report.py` | base64 логотипу PNG, а не обфускований код |
| `design-studio` | `YR4` hidden_instructions | `description:; description: "…"` | YAML-ключ у довідковому документі про дизайн |

Це очікувана поведінка: статична стадія навмисно високорекольна, precision витягує LLM-стадія
або baseline (`skillspector baseline ./skill -o .skillspector-baseline.yaml`).

**Практичний виграш:** ручного розбору потребували 5 скілів із 86, а не всі 86.

## Окремо: `gstack` — не скіл

`~/.claude/skills/gstack` виявився склонованим репозиторієм: `.env.example`, конфіги під шість
різних агентів (`.claude/`, `.cursor/`, `.factory/`, `.agents/`, `.gbrain/`), дерево такого
розміру, що `du` не встиг його порахувати за 120 с. Це не знахідка сканера, а знахідка про стан
`~/.claude/skills`. Розібрати окремо.

## Відтворення

```powershell
uv tool install --python 3.12 'git+https://github.com/NVIDIA/skillspector.git@v2.8.2'
skillspector scan <шлях-до-скіла> --no-llm --format json -o out.json
node tools/skill-scan.js <шлях-до-скіла>     # той самий скан + чесний гейт, exit 0/4/3
```
