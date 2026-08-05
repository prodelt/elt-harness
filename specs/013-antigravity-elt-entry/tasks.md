# ELT v3 — нативний вхід в Antigravity IDE

- [X] **T001** [S] Додати глобальний `/elt` workflow для Antigravity IDE до чинної синхронізації surface: workflow явно читає канонічний ELT skill, лишає `agy` writer-ом, а Codex (або Claude за явним вибором) — зовнішнім fixer/judge; додати regression і live-proof. [files: config/antigravity-elt-workflow.md, tools/sync-agent-surface.js, tools/sync-agent-surface.test.js, tools/doctor-core.js, PLAYBOOK.md, specs/013-antigravity-elt-entry/tasks.md]
