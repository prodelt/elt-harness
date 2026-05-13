# SkillAnything — USAGE

## Мета
Швидкий workflow для сценарію "новий CLI -> 3 дистрибутиви" без проходження всієї 7-фазної оптимізації. Підходить для першого робочого пакування, коли треба швидко отримати `dist/claude-code`, `dist/codex` і `dist/generic`.

## Передумови
- Працюй з кореня `~/.claude/skills/skill-anything`.
- Python 3.9+ має бути доступний як `python`.
- Цільовий CLI має бути у `PATH`.
- Якщо авто-детект помиляється, зафіксуй тип через `--target-type cli`.

## Мінімальний workflow: новий CLI -> 3 дистрибутиви

### 1. Підготуй робочий каталог
```powershell
$workspace = "C:\path\to\sa-workspace"
New-Item -ItemType Directory -Force -Path $workspace | Out-Null
```

### 2. Проаналізуй CLI
```powershell
python -m scripts.analyze_target `
  --target "git" `
  --target-type cli `
  --output "$workspace\analysis.json"
```

Очікування:
- створено `$workspace\analysis.json`
- `target_type` = `cli`
- в аналізі є capability-список і `raw_help`

### 3. Згенеруй архітектуру скіла
```powershell
python -m scripts.design_skill `
  --analysis "$workspace\analysis.json" `
  --output "$workspace\architecture.json"
```

Очікування:
- створено `$workspace\architecture.json`
- у ньому є `skill_name`, `structure`, `platforms`

### 4. Заcкафольдь сам скіл
```powershell
python -m scripts.init_skill git-assistant `
  --template cli `
  --output "$workspace\sa-workspace" `
  --analysis "$workspace\analysis.json" `
  --architecture "$workspace\architecture.json"
```

Після scaffold перевір і за потреби відредагуй:
- `sa-workspace\git-assistant\SKILL.md`
- `sa-workspace\git-assistant\scripts\`
- `sa-workspace\git-assistant\references\`

Мінімум перед пакуванням:
- уточни `description`
- звузь тригери під реальні задачі CLI
- прибери зайві capabilities, якщо аналіз згенерував шум
- розгорни або видали placeholder-и `{{ ... }}` у frontmatter (`allowed-tools`, `hooks`, `metadata`)

### 4.1 Тимчасовий workaround для поточного scaffold
На поточному стані `init_skill.py` може залишити в `config.yaml` нерозгорнуті loop-placeholder-и (`{{ platform }}`, `{{ section }}` тощо). `package_multiplatform.py` читає цей файл через YAML і падає.

Для fast-path smoke достатньо прибрати згенерований `config.yaml` перед пакуванням:

```powershell
Remove-Item "$workspace\sa-workspace\git-assistant\config.yaml" -Force
```

Це безпечно для цього сценарію: packager використовує `config.yaml` лише як optional metadata source і без нього бере `version = 1.0.0`.

### 5. Запакуй тільки потрібні 3 дистрибутиви
```powershell
python -m scripts.package_multiplatform `
  "$workspace\sa-workspace\git-assistant" `
  --platforms claude-code,codex,generic `
  --output-dir "$workspace\dist"
```

Очікування:
- `dist\claude-code\git-assistant\SKILL.md`
- `dist\codex\git-assistant\SKILL.md`
- `dist\codex\git-assistant\agents\openai.yaml`
- `dist\generic\git-assistant.skill`

## Швидка smoke-перевірка
```powershell
Test-Path "$workspace\dist\claude-code\git-assistant\SKILL.md"
Test-Path "$workspace\dist\codex\git-assistant\SKILL.md"
Test-Path "$workspace\dist\codex\git-assistant\agents\openai.yaml"
Test-Path "$workspace\dist\generic\git-assistant.skill"
```

Усі команди мають повернути `True`.

Примітка:
- якщо пакувати відразу після scaffold без ручного редагування, packager може видати warning про frontmatter quality; для smoke це допустимо, для реального publish — ні.

## Коли потрібні фази 4-6
Не зупиняйся на fast-path, якщо:
- треба довести trigger accuracy
- скіл іде у спільний каталог або marketplace
- baseline без скіла вже достатньо сильний і треба довести приріст

Тоді продовжуй стандартний пайплайн:
- `python -m scripts.generate_tests`
- `python -m scripts.run_eval`
- `python -m scripts.run_loop`

## Типові збої
- `Target not found` -> CLI не в `PATH`; перевір установку або дай абсолютний шлях.
- `Wrong target type` -> повтори `analyze_target` з `--target-type cli`.
- `Missing openai.yaml` -> перевір, що в `package_multiplatform` є `codex` у `--platforms`.
- `Dist generated, but content weak` -> це нормально для fast-path; відредагуй scaffold перед повторним пакуванням.
