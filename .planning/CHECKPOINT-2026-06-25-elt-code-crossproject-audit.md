# Checkpoint — 2026-06-25 — Кросс-проектный аудит elt-code + зубы + loop

## Что сделано
- **Аудит по JSONL всего ПК** (~209 кодовых сессий, 16 активных проектов). Метод: посессионный парс + ground-truth ledger.
- **Находки:** adoption elt-code ~18% (Itstep 0/35, Md-drive 0/6); судья = self-judge театр (14 вердиктов, block=0, изолированных=0); зубы были в 1 репо (командный центр).
- **Машинерия гейта/CLI проверена live-fire** — не сломана (block→log-verdict→allow, retry-cap OK).
- **Зубы перенесены в 4 репо** (Fasoli, Geocode, Itstep, Marketing) через новый `tools/install-harness-teeth.js` (идемпотентно, merge-safe; починен баг dedup). Верифицировано: Stop=1/PreBash=1, git-guard live-fire в Fasoli кусает. Теперь 6/11 репо с зубами.
- **Loop для повтора:** `tools/elt-code-audit.js` — весь разбор одной командой, с self-check. Прогнан, работает.
- **Правка** `.claude/hooks/judge-closeout-gate.js`: сообщение → требует изолированного судью-субагента.
- **Артефакт:** `ELT-CODE-AUDIT-2026-06-25.html` (гайд v0.9.0 + лайфхаки + градация C+).

## Изменённые файлы (этот репо, НЕ закоммичены)
- new: `ELT-CODE-AUDIT-2026-06-25.html`, `tools/install-harness-teeth.js`, `tools/elt-code-audit.js`
- edit: `.claude/hooks/judge-closeout-gate.js`
- память: `memory/project_elt_code_crossproject_audit_2026-06-25.md` + `MEMORY.md`
- 4 чужих репо: 2 хука + `.claude/settings.json` (размещены, НЕ закоммичены)

## Открытый долг (поведенческий, кодом не чинится)
- Судью всегда Task-субагентом, не inline. «pass без block» = тревога.
- Рефлекс «код = /elt-code первой строкой» (adoption 18%→выше).
- Экспорт Insights в `~/.claude/usage-data/report.html` → оживить `/usage-audit`.
- spec-kit в активные кодовые репо.

### Resume Pointer
- **Focus:** аудит закрыт; решить — коммитить ли артефакт+скрипты (и куда: чужие `.claude/` гитигнорить или коммитить); опционально weekly-cron на `elt-code-audit.js`.
- **Resume command:** `node tools/elt-code-audit.js --days 7` (перепроверить тренд adoption/block-ratio).
