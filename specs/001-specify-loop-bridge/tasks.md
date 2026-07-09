# tasks — мост specify ↔ loop

> Каждый `[ ]` — атомарный вертикальный срез, проверяемый оракулом или коротким тестом.
> Оракул репо: `node tools/doctor.test.js`. Слайсы вне этого репо (глобальные скилы) —
> проверяются PS-парсером / визуально, коммитятся точечным `git add` (не `elt commit`).

- [X] **T001** doctor-core.js: чек «half-cycle» в checkFleetProject (harness есть, specs/ нет → warn) + testFleetCheck
- [X] **T002** /elt SKILL.md: Режим 0 (план-шаг) + судья получает constitution+spec; версия 2.2.0
- [X] **T003** elt-loop.ps1: judge-промпт подмешивает constitution.md + spec.md; BOM сохранён, PS-парс чист
- [X] **T004** project-bootstrap SKILL.md: передняя половина для кода + live-fire цикла в closeout; версия 1.7.0
