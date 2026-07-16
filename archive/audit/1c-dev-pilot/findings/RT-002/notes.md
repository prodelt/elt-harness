# RT-002 — Rate limiting burst test (ABORTED by user)

## Status
**INCOMPLETE** — user halted live LLM testing ("не трать токени gemini чатбота больше").

## What ran
20 parallel curl POSTs to /api/chat with 1-word prompt ("hi"). Only 1 of 20 results logged due to race on concurrent `>>` appends; that one returned **200 OK in 6.04s**. Remaining 19 outcomes unknown — bill impact capped at ≤20 tiny requests.

## Decision
- No finding promoted.
- **Move to suspects.md as S-002**: rate limiting on /api/chat **unverified**. Anonymous unlimited access remains LIKELY HIGH per API4/LLM10.
- Further verification: **passive only** — inspect JS bundles, headers, Vercel config. No more live POSTs.
