# Checkpoint - 2026-05-13 S27 Final

### Build Status
- doctor: PASS=21 WARN=0 FAIL=0
- node --check: OK (rag-context-injector.js, rag-queue-enqueue.js)

### Git State
- Branch: session/2026-05-13-1905 (auto-branch от main)
- main: 9901d7f (squash S15-S27)
- Last commit: 46a253d chore(planning): add S27 checkpoints

### Completed This Session
- [x] S27-1: Graphify rebuild (stale nodes → codemap-core.js fix, false positive removed)
- [x] S27-2: Broken git ref `(1)` удалён
- [x] S27-3: pipeline-state.json обновлён до S27
- [x] S27-4: doctor-core.js tombstone guard → PASS=21 WARN=0
- [x] S27-5: Squash merge feature/s11-task-43 → main (140 коммитов → 1)
- [x] S28: projects-registry.json `pipelineDir` field добавлен
- [x] S28: rag-context-injector.js читает pipelineDir из registry (fallback = hardcode)
- [x] S28: rag-queue-enqueue.js читает pipelineDir + PROJECTS из registry

### Global Hook Robustness (итог)
- domain-agent-gate.js: registry ✅
- skill-selector-gate.js: registry ✅
- rag-context-injector.js: registry (pipelineDir + project match) ✅
- rag-queue-enqueue.js: registry (pipelineDir + PROJECTS) ✅
- harvest-injector.js: CWD-derived key (consistent) ✅
- Если Pipeline Setupper переедет: обновить только `pipelineDir` в projects-registry.json

### Next Steps
```
Focus: новый функциональный спринт
Done when: спринт спланирован + первая задача выполнена

git checkout main && git log --oneline -3
node tools/doctor.js
```
