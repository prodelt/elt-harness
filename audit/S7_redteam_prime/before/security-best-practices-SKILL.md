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

## Overrides

If project docs require bypassing a best practice — comply without fighting. Document the override reason in code comments.
