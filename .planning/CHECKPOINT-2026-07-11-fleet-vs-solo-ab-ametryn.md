# Checkpoint - 2026-07-11 22:40

## Задача
Первый живой прогон ELT Fleet на реальном проекте + запрошенный юзером mid-turn
A/B: та же задача целиком через соло-`/elt`, чтобы понять, есть ли смысл в
Fleet-системе на реальной работе (не только на бенчах specs/003).

**Проект-цель:** `D:\Ametrin projects\Ametryn_protocol_bot` — переписать
Python/Streamlit-бот (видео/аудио → Whisper → LLM-анализ → protocol.docx) на
Rust с полностью локальным AI (whisper-rs + llama-cpp-2, дефолт
Qwen2.5-1.5B-Instruct GGUF), целевое железо 4 ГБ RAM/CPU без GPU, GUI на
Tauri, полный паритет функций. Спека: `specs/001-rust-local-ai-rewrite/`
(spec.md + tasks.md, 14 слайсов T001-T014, size-теги [S]/[M]/[L],
[P]-параллелизуемые T003/T004/T005/T009).

Подробный живой лог инцидентов — память
`project_fleet_vs_solo_ab_ametryn_2026-07-11.md` (читать целиком перед
продолжением — там 3 разобранных инцидента).

### Build Status
- Compiles: yes (`cargo build --workspace` — оракул харнесса, зелёный на T001-T003 в fleet, T001 в solo)
- Lint: not configured
- Type check: n/a (Rust, покрыто build)

### Test Metrics
- Fleet: T001-T003 закрыты через оракул+судью, тестов пока минимум (T001 без тестов, T002/T003 — по одному unit-тесту каждый)
- Solo: T001 закрыт (1 unit-тест на Mode), T002 реализован но НЕ закоммичен (judge-block, вероятно ложный из-за rate-limit)
- Coverage: not measured

### Git State (три места, не одно)
- **Pipeline Setupper** (этот репо, cwd): branch `feature/elt-loop-driver`, 1 uncommitted (`.harness/run-log.jsonl`), last commit `29ce6bd`
- **Target repo master**: `D:\Ametrin projects\Ametryn_protocol_bot`, branch `master`, clean, last commit `2cf4162` (baseline для обоих треков)
- **Fleet track**: worktree `D:\Ametrin projects\Ametryn_protocol_bot-fleet`, branch `fleet/001-rust-local-ai-rewrite`, last commit `74a994a` (merge T003). Uncommitted: `.harness/run-log.jsonl` (M), `.fleet-wt/T003` (deleted — normal fleet cleanup), `.fleet-wt/T004/` (untracked — LIVE parked worktree, НЕ трогать)
- **Solo track**: worktree `D:\Ametrin projects\Ametryn_protocol_bot-solo`, branch `solo/001-rust-local-ai-rewrite`, last commit `2ea25b1` (T001). Uncommitted: T002 implementation (config.rs, protocol.rs, lib.rs, Cargo.toml/.lock) — НЕ закоммичено, judge заблокировал

### Completed Tasks
- Diagnosed and fixed dirty working tree in target repo (missing `.gitignore`, uncommitted Dec-2025 reorg into `happy-williamson/`, excluded `clients.xlsx` + installer .exe files from git) — commit `fa2f514`
- Wrote `specs/001-rust-local-ai-rewrite/{spec.md,tasks.md}` (14 slices) + `elt init` — commits `e434e55`, `2cf4162`
- Created `fleet/...` and `solo/...` branches + worktrees from identical baseline `2cf4162`
- Found and fixed infra blocker BEFORE launch: `cmake` missing (whisper-rs/llama-cpp-2 need it for C++ build) — installed via winget
- Launched Fleet (3 workers) and Solo (`elt-loop.ps1`, 14 slices) tracks
- Fleet: T001 (agy) → T002 (claude, after M-policy tuned) → T003 (?) all merged clean
- Solo: T001 committed clean; T002 hit judge-block

### Blockers
1. **Claude 5-hour rate limit at ~92% utilization, org-level overage disabled** — likely root cause of: solo T002's blank judge log + block, AND fleet T004's `judge-unavailable` park. Confirmed via one user-authorized diagnostic `claude -p --json-schema` call that succeeded but returned `rate_limit_info: {status: "allowed_warning", utilization: 0.92, isUsingOverage: false}`. **Resolution: wait for 5h window reset before resuming either track**, otherwise further "blocks" are not trustworthy signal.
2. **T004 in fleet is NOT a quality failure** — it's a well-handled infra park: implementer hit 5-min timeout (whisper-rs's first cmake/C++ build of whisper.cpp is slow, only got as far as adding the Cargo.toml dependency, `lib.rs` still placeholder), then judge got `judge-unavailable` (not `block` — fleet correctly distinguishes "judge didn't run" from "judge rejected", see `tools/fleet/gate.js:143-160`). Slice is parked (`judge_pending`, claim alive in `.fleet-wt/T004`), resumable on next `elt-fleet.ps1 -Action run`. **Consider raising implementer/judge timeouts for L-sized slices (T004/T005) that involve heavy C++ FFI compiles before resuming**, or the same timeout will likely recur.
3. **`elt-loop.ps1`'s judge failure handling is worse than fleet's**: when solo's judge got a blank/failed response (likely rate-limit related), it fell through to a silent `block` in `run-log.jsonl` (`"verdict":"block","result":"judge-block"`) with an EMPTY log file — indistinguishable from a real quality reject. Fleet's `gate.js` has an explicit `runOk: false` → `judge-unavailable` → park path that `elt-loop.ps1` lacks. **This is itself a real, reportable finding for the eventual fleet-vs-solo verdict** (fleet's failure mode is more honest/resumable than solo's for this exact class of failure).
4. Solo's T002 code was manually reviewed and looks correct/in-scope (Config/Mode/ProtocolData/TranscriptSegment, matches spec.md, has a test) — the block is suspected to be a false negative from the rate-limit condition, not a real scope/quality issue.

### Next Steps
1. Wait for Claude 5-hour rate-limit window to reset (was at 92% util as of ~13:2X UTC 2026-07-11; check via a lightweight `claude -p` call or just retry after several hours).
2. Optionally raise fleet's implement/judge timeouts (`tools/fleet/gate.js: JUDGE_TIMEOUT_MS`, `tools/fleet/providers.js: DEFAULT_TIMEOUT_MS`) for L-sized slices before resuming, to avoid repeating T004's timeout.
3. Resume Fleet: `powershell -File tools/elt-fleet.ps1 -Action run -Project "D:\Ametrin projects\Ametryn_protocol_bot-fleet" -Tasks specs/001-rust-local-ai-rewrite/tasks.md -Workers 3` (with `$env:PATH` prefixed with `C:\Program Files\CMake\bin;$env:USERPROFILE\.cargo\bin;` — persistent PS/Bash tool sessions do NOT see the winget-installed cmake/cargo otherwise). Should pick up parked T004 claim automatically.
4. Resume Solo: `powershell -File tools/elt-loop.ps1 -Project "D:\Ametrin projects\Ametryn_protocol_bot-solo" -Slices 13 -MaxMinutes 600 -JudgeModel sonnet` (same PATH prefix). T002's uncommitted work is still sitting in the worktree — either let the driver retry it fresh, or manually inspect/re-judge first.
5. Once both tracks progress further (ideally several more slices past the rate-limit-tainted window), compare: wall-clock, Claude call count/spend, judge pass/block rate (excluding the rate-limit-tainted blocks), final code quality/parity — write the verdict as a new memory continuing `project_elt_fleet_003_hardening_2026-07-11`.

### Resume Pointer
- Focus: Resume Fleet + Solo A/B tracks on Ametryn Protocol Bot Rust rewrite once Claude's 5h rate-limit window has reset; both are paused mid-plan (fleet 3/14 slices, solo 1/14 slices), not broken.
- Resume: Read `C:\Users\espad\.claude\projects\C--Claude-playground-Pipiline-setupper\memory\project_fleet_vs_solo_ab_ametryn_2026-07-11.md` in full, then check rate-limit is clear (small diagnostic `claude -p` call with user's authorization), then relaunch both drivers per "Next Steps" above with the PATH prefix.
