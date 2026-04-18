---
name: "security-best-practices"
description: "Perform language and framework specific security best-practice reviews and suggest improvements. Trigger only when the user explicitly requests security best practices guidance, a security review/report, or secure-by-default coding help. Trigger only for supported languages (python, javascript/typescript, go). Do not trigger for general code review, debugging, or non-security tasks."
author: openai
source: https://github.com/davila7/claude-code-templates
stars: 23824
---

# Security Best Practices

## Overview

Identify ALL languages and frameworks in scope, then load language-specific security guidance from references. Write secure-by-default code or produce a prioritized security report.

## Workflow

1. Identify ALL languages + frameworks (frontend AND backend)
2. Check references directory for `<language>-<framework>-<stack>-security.md`
3. Also check `<language>-general-<stack>-security.md`
4. If no reference available — use known best practices, note uncertainty

## Operating Modes

1. **Secure by default** — apply guidance when writing new code
2. **Passive detection** — flag critical vulnerabilities while working
3. **Full report** — on request, produce `security_best_practices_report.md` with severity sections

## Report Format

- Executive summary at top
- Sections by severity (Critical → High → Medium → Low)
- Numeric IDs for findings
- Line numbers for all code references
- One-sentence impact statement for critical findings
- Offer fixes after user reviews report

## Fix Rules

- Fix one finding at a time
- Add concise comments explaining the security principle
- Consider regressions before changing insecure but relied-upon code
- Follow existing commit/test flows
- Never bunch unrelated findings in one commit

## General Secure Coding Principles

- **No incrementing IDs** for public-facing resources → use UUID4 / random hex
- **TLS**: Do not report missing TLS in dev/local environments — only flag in production context
- **Secrets**: Environment variables only. Never hardcode.
- **Input validation**: Validate at all system boundaries (user input, external APIs)
- **SQL**: Parameterized queries always — never string interpolation
- **Auth**: Check authorization on every sensitive operation, not just authentication
- **Dependencies**: Flag known vulnerable packages (check npm audit / pip audit / go mod tidy)
- **Error messages**: Never expose stack traces or internal details to end users

## Stack-Specific Cheatsheets

### Next.js / React
- Server Actions: validate ALL inputs with zod, never trust client data
- RSC: no secrets in client components, check `'use server'` boundaries
- next.config.js: CSP headers, X-Frame-Options, X-Content-Type-Options
- API routes: rate limit, CORS allowlist, validate Content-Type

### Supabase
- RLS: enabled on every table with real policies (not `using (true)`)
- Anon key: public reads only. Service role key: NEVER in frontend.
- Edge Functions: validate JWT manually, don't trust raw claims
- Storage: bucket policies + signed URLs with expiry

### Express / Node
- `helmet()` for security headers
- `express-rate-limit` on auth routes
- `cors()` with explicit allowlist (not `*`)
- express-validator / zod for input validation
- No `eval()`, no `child_process` with user input

### Python / FastAPI / Django
- Django: CSRF middleware, clickjacking protection, `DEBUG=False` in prod
- FastAPI: `Depends()` for auth, Pydantic for validation
- SQLAlchemy: parameterized queries, never f-strings in SQL
- CORS: explicit origins list, not `allow_all_origins=True`

### Go
- `database/sql` with `?` placeholders, never `fmt.Sprintf` into SQL
- `net/http`: timeouts on all handlers, validate `Content-Type`
- `crypto/rand` for tokens, never `math/rand`
- Context propagation for cancellation + timeouts

## Overrides

If project docs require bypassing a best practice — comply without fighting. Document the override reason in code comments.

## Scope vs /red-team

- `/security-best-practices` = defensive-by-default coding + framework cheatsheets (this skill).
- `/red-team` = offensive scanners, OWASP Top 10 verification, exploit evidence, pentest report.
- Do not invoke both simultaneously: defensive reviews happen continuously, offensive audits on demand.
