## Checkpoint - 2026-06-20 16:10 — ELT-CODE Фаза 2 (spec-kit)

### Что сделано (Фаза 2)
- spec-kit интегрирован в `~/.claude/skills/elt-code/SKILL.md` (v0.3.0), новый раздел «Шаг 2.5 — Spec-kit»:
  - per-project `specify init . --integration claude` (идемпотентно, если нет `.specify/`);
  - фазы по сложности (перило I): TRIVIAL пропуск; MEDIUM `specify→plan→implement`; COMPLEX
    +`constitution`+`tasks` (опц. `clarify`/`analyze`);
  - артефакты: `.specify/memory/constitution.md` (принципы + секция `## Quality rubric (project
    extensions)`) и `specs/<feature>/spec.md` (Functional Requirements + Success Criteria).
- Судья H1 переключён на источник spec-kit: `specs/<feature>/spec.md` → fallback `goal`/`doneWhen`.
- Маршрут #2 (новая фича) обновлён: spec-kit → `/pipeline` → судья H1.

### Реальная поверхность spec-kit (узнано, не угадано)
- CLI `specify` установлен (`~/.local/bin/specify`); шаблоны bundled (офлайн). Claude-интеграция ставит
  команды как **скилы** `/speckit-*` (через дефис): `constitution/specify/plan/tasks/implement/converge`
  + опц. `clarify/analyze/checklist`.
- constitution живёт в `.specify/memory/constitution.md` (НЕ корень — поправка к черновику агента A).

### Proof (live-fire, scratch spec-kit проект)
- `specify init` отработал в `~/.claude/tmp/elt-speckit-probe` (создал `.specify/`, скилы).
- Написан `specs/001-parse-config/spec.md` (FR-001..003 + SC-001..003) + намеренно неполный `impl.js`
  (FR-002 «комменты» пропущен).
- Судья-субагент (Sonnet, с вложенной ponytail-дисциплиной + mcp-search) прочитал spec.md, прошёл
  по-требованиям → **BLOCK**: FR-002+SC-002 miss. Трасса spec→adherence доказана.
- Ledger `~/.claude/tmp/elt-judge-livefire/session-ledger.jsonl`: теперь **5 событий** judge_verdict
  (валидный JSON): 2 Phase1 live-fire + 2 verify-gate + 1 Phase2 spec-proof.

### Побочно (важно, в памяти)
- Субагенты НЕ наследуют ponytail-режим и claude-mem авто-инъекцию (проверено пробой); mcp-search
  работает on-demand. Компенсация: вкладывать ponytail+mem явно в агентские промпты (применено в
  Phase2-судье). См. `memory/feedback_subagents_no_ponytail_claudemem_2026-06-20.md`.

### Git State
- main: PLAYBOOK.md + WORKING-SYSTEM.md закоммичены (`9f51361`); ELT design+Phase0/1 (`461c01b`).
- Skill вне git этого репо.

### Remaining Work
- Фаза 3: зеркало `/elt-code` в `~/.codex/skills` + `~/.gemini/skills` (механизм `sync-agent-surface.js`,
  сверить CLI-флаги перед apply — см. `.planning/ELT-CODE-PHASE34-PREP.md`). spec-kit кросс-агентный.
- Фаза 4: реализовать индекс `judge_verdict` (on-demand, канон-схема, без авто-инъекции).
- Опц.: прогнать `specify init` в реальном проекте через `/project-bootstrap`.

### Resume Pointer
- Focus: ELT-CODE Фаза 3 — кросс-CLI зеркало `/elt-code` (codex/gemini), проверка инлайн-судьи в Codex.
- Resume: `.planning/ELT-CODE-DESIGN.md` раздел «Фаза 3» + `.planning/ELT-CODE-PHASE34-PREP.md` (runbook).
