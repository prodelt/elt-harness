# PLAYBOOK — практичний ELT v3

## Одна схема

Для коду є один маршрут: `elt`. `agy` пише першу версію, поточний Claude Code або Codex читає diff, запускає oracle, виправляє за потреби й є єдиним judge. Це реалізація схеми A+C з `ELT v3 — протокол замера и три схемы харнесса.html`: L0 → impact oracle → smoke → risk routing → один `pass|block|inconclusive` → накопичення evidence.

Схема B з асинхронним verify та auto-revert не використовується: вона необов'язкова й повертає зайву чергу та складність.

## Звичайна робота

1. Тривіальна правка — просто зробити й запустити найменшу релевантну перевірку.
2. Один нетривіальний слайс — короткий regression test, oracle, один judge, `elt commit`.
3. Велика нова ціль — `specs/NNN-name/spec.md` + `tasks.md`, показати користувачу, отримати «затверджую», виконати `elt spec approve --spec specs/NNN-name`, потім працювати слайсами.
4. Продовження — `elt status`; без `--spec` він бере найновіший план. Старий план завжди вказувати явно.

```powershell
node "$env:USERPROFILE\.claude\bin\elt.js" status
node "$env:USERPROFILE\.claude\bin\elt.js" slice next --json --count 3 --spec specs/NNN-name
node "$env:USERPROFILE\.claude\bin\elt.js" judge run --task T001 --spec specs/NNN-name
node "$env:USERPROFILE\.claude\bin\elt.js" commit --task T001 --spec specs/NNN-name --skip-oracle
```

## Автономний прогін

Послідовний драйвер — дефолт. У prompt для `agy` драйвер явно вимагає прочитати `C:\Users\user\.gemini\skills\elt\SKILL.md`, бо Antigravity не завантажує цей skill сам.

```powershell
# робота з Claude Code
powershell -File tools/elt-loop.ps1 -Project . -SpecDir specs/NNN-name -WriterProvider agy -JudgeProvider claude -JudgeModel sonnet

# робота з Codex
powershell -File tools/elt-loop.ps1 -Project . -SpecDir specs/NNN-name -WriterProvider agy -JudgeProvider codex -JudgeModel gpt-5.6-sol
```

На червоному oracle поточна поверхня робить до двох вузьких виправлень. На `block` слайс паркується; сліпого циклу LLM немає. Stop-файл: `.harness/STOP`; логи: `.harness/loop-logs/`.

## Proof

`Done` означає одночасно:

- oracle exit 0;
- smoke exit 0, якщо налаштований;
- рівно один judge `pass` або `inconclusive`;
- `elt commit` створив commit і запис у `.harness/run-log.jsonl`.

`judge.verify` зі старих конфігів runtime ігнорує. Для очищення конфіга достатньо `project-bootstrap apply`.

## Інші маршрути

- Офісний документ, таблиця, презентація або PDF → `elt-work`.
- Новий еталонний проєкт → `project-bootstrap`.
- Зовнішня бібліотека → актуальні docs через `ctx7` перед кодом.
- Fleet → тільки за явним запитом; спочатку `node tools/doctor.js --fleet`.

## Видалені маршрути

`/pipeline`, `harness-runner`, `harness-gates`, `pipeline-state` та `install-harness-teeth` не запускати. Compatibility shims лише пояснюють міграцію та завершуються з exit 64. Єдиний code control plane — `elt`.

## Живий стан

`.planning/STATE.md` — поточний стан, найновіший `CHECKPOINT-*.md` — точка відновлення, `.planning/PROJECT-HISTORY.md` — історія. Реальний runtime перевіряється `node tools/doctor.js`, а не старими нотатками.
