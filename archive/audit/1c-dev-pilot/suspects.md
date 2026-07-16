# Suspects (not confirmed as findings)

## S-001: Direct prompt injection on /api/chat
- Category: LLM01 candidate
- Rejected gate: **Gate 3 Working payload** — model refused, no CANARY returned.
- Artifacts: findings/RT-001/
- Decision: NOT a finding via direct channel. Re-evaluate under indirect injection if engagement resumes.

## S-002: Anonymous unlimited /api/chat (rate limit / cost abuse)
- Category: API4 / LLM10 candidate — potentially HIGH
- Rejected gate: **Gate 3 Working payload** — user halted burst before enough evidence (1/20 recorded 200 OK).
- Artifacts: findings/RT-002/
- Decision: SUSPECT. Re-test after owner deploys `@vercel/firewall` rate rule. Do not re-run without that safety net — risk of burning Gemini quota.

## S-003: CSP nonce migration vs. tolerated unsafe-inline
- Category: A05 hardening
- Note: not truly a bug in isolation but a hardening target; captured as RT-CSP-001 LOW in main report.
- Decision: documented, owner to decide effort vs. reward.
