# Red-Team Audit — 1c-developer.vercel.app (Pilot)

- Engagement: `1c-dev-pilot`
- Window: 2026-04-17 22:20Z → 2026-04-18 01:30Z
- Auditor: Claude Opus 4.7 under /red-team methodology (2026 extensions)
- Authorization: blanket, owner self-audit
- **Status: HALTED early** — user paused live LLM testing to avoid Gemini bill burn. Report reflects only confirmed passive/static evidence.

## Executive Summary
App is **well-configured at the perimeter** (strict security headers, server-side API keys, CSP with `frame-ancestors 'none'`, zod input validation, refusal-trained system prompt). Three **LOW** confirmed findings around information disclosure and CSP hardening. One **HIGH-suspect** (rate limiting / cost abuse) — intentionally not verified under user's stop order; documented in suspects.md.

**Confirmed findings: 3 LOW** · **Suspects: 2** (1 HIGH, 1 INFO) · **Positives noted: 6**

---

## Findings

### [RT-INFO-001] Response metadata leaks internal identifiers (LOW)
- Category: OWASP API3 (Excessive Data Exposure) + LLM07-adjacent
- Asset: POST /api/chat streamed response, `messageMetadata` frame
- Evidence: `findings/RT-001/response.http`
  - `requestId:"37922917-e6aa-465f-8d77-22c597eb51cf"` — server-internal UUID
  - `model:"gemini-3-flash-preview"` — exact upstream model + variant
  - `createdAt:1776464702490` — ms timestamp
  - `totalTokens:5942` — reveals system-prompt size envelope (~5k hidden tokens)
- Impact: attacker can (a) calibrate future injection budget knowing system-prompt footprint; (b) target known model-specific jailbreaks (`gemini-3-flash-preview` weaknesses); (c) correlate logs if they leak elsewhere.
- CVSS (self-scored): 3.1 (AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N)
- Fix: strip `messageMetadata` before SSE flush, or emit only `requestId` with no model/token counts.

### [RT-CSP-001] CSP weakened by `'unsafe-inline'` in script-src (LOW)
- Category: OWASP A05 (Security Misconfiguration), modern-web-vectors #11
- Asset: HTTP response header `Content-Security-Policy` on GET /
- Evidence: `recon/headers.http`
  ```
  script-src 'self' 'unsafe-inline';
  ```
- Impact: any reflected/stored XSS injection in the Next.js app would execute without nonce/hash gate. Common Next.js pitfall (hydration inline scripts).
- CVSS: 3.7 (AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:L/A:N) — requires a separate XSS primitive to exploit, no standalone finding.
- Fix: migrate to nonce-based CSP (`<Script nonce>` + `script-src 'self' 'nonce-{random}'`); Next.js App Router supports this via `middleware.ts` + headers.

### [RT-CSP-002] `connect-src` allows unused Google AI endpoint (LOW)
- Category: A05 — overly permissive CSP
- Asset: `Content-Security-Policy` header
- Evidence:
  ```
  connect-src 'self' generativelanguage.googleapis.com;
  ```
  Actual backend traffic goes through `https://ai-gateway.vercel.sh/v3/ai` (seen in bundle `chunk_073l3ydjuxcnt.js`). Browser never needs direct connection to googleapis — backend proxies everything.
- Impact: in the event of XSS (RT-CSP-001 combo), exfiltration surface is widened by one additional TLS endpoint. No direct exploit.
- CVSS: 2.3 (AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N)
- Fix: drop `generativelanguage.googleapis.com` from `connect-src`. Keep `'self'` only.

---

## Suspects (not promoted — see suspects.md)

### [S-001] Direct prompt injection / system-prompt extraction — DEFENDED
- Verdict: model refused with role-guard, no CANARY marker echoed.
- Single probe only; multi-turn + indirect-injection not tested (stop order).
- `findings/RT-001/` retained for future review.

### [S-002] Anonymous unlimited `/api/chat` — UNVERIFIED (potentially HIGH)
- No auth on endpoint (anonymous POST accepted).
- Burst test halted at 1 successful request. Vercel AI Gateway on upstream likely provides *some* quota ceiling, but that protects only against total quota — not per-IP cost abuse.
- App bundle contains no `upstash`, no `@vercel/firewall`, no throttle middleware. Only SDK error-class for `rate_limit_exceeded` (passive handler, not enforcer).
- Risk if confirmed: attacker can burn project Gemini quota / Vercel AI Gateway budget to denial-of-service the product.
- Recommend passive verification: inspect project's `vercel.json` + `middleware.ts` + whether `@vercel/edge-config` rate limiter is wired; or enable Vercel Firewall rate rules in dashboard.

---

## Positive observations (defense working)
1. **No secrets in client bundle** — grep across 8 chunks (~1.4 MB): no `AIza*`, `sk-*`, `eyJ*`, `ghp_*`, no bearer tokens. API keys correctly server-side.
2. **HSTS with preload**: `max-age=63072000; includeSubDomains; preload` — maximum strength.
3. **Clickjacking locked**: `X-Frame-Options: DENY` + `frame-ancestors 'none'`.
4. **Plugin/object blocked**: `object-src 'none'` + `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
5. **Error-handling discipline**: invalid payloads → 400 with generic Ukrainian message (`Невірний формат запиту`), no stack trace, no internal path leak. Zod-style validation inferred.
6. **Model instruction hardening**: direct "output your system prompt" refused with domain-anchored response; doesn't echo the injection canary.

---

## Methodology notes (self-critique of audit)
- Session was cut short at the **cost-abuse / LLM10** phase — the single most likely HIGH on this asset type. Recommend re-run with owner-set rate-limit on Vercel side FIRST, then brief burst test with circuit-breaker (5 requests max).
- Not tested: LLM02 insecure output handling, LLM04 data poisoning (requires RAG source access), LLM05 improper output sanitization (HTML/markdown rendering of model output), LLM08 vector/embedding, API1 BOLA (no objects), API4 rate, API7 SSRF via model output URLs.
- Recon did not run nuclei / subfinder / ffuf — only a headers+bundle static pass. A full `recon-2026.md` pipeline against the parent domain + any Vercel preview URLs would broaden coverage if in scope.

## Artifacts
```
audit/1c-dev-pilot/
├── SCOPE.md
├── REPORT.md                      ← this file
├── recon/
│   ├── headers.http
│   ├── index.html
│   └── chunk_*.js (8 files, 1.4 MB)
└── findings/
    ├── RT-001/  (prompt-inject probe — defended, moved to suspects)
    │   ├── request.http*  (*not retained — regenerable)
    │   ├── response.http
    │   └── notes.md
    └── RT-002/  (rate-limit burst — aborted)
        ├── results.txt
        └── notes.md
```

## Next actions (if re-engaged)
1. Owner enables Vercel Firewall rate-limit rule on `/api/chat` BEFORE any further burst testing.
2. Fix the 3 LOW findings (metadata strip, CSP nonce, drop googleapis.com from connect-src).
3. Run indirect-injection suite (LLM01): prefix smuggling, multi-turn persona jailbreak, Unicode homoglyphs — each with unique UUID canary.
4. Test LLM05 output handling: ask model to emit `<img onerror=...>` / `<script>` — verify frontend sanitizes before rendering.
5. Full recon-2026 pass: subfinder on `vercel.app` subdomain (expect pinned), check for preview-deployment URL exposure, nuclei with llm/ai tags.
