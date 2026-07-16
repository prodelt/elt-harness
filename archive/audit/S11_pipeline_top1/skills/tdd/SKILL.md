---
name: tdd
description: "Guide test-first implementation with concrete business assertions instead of return-type-only checks. Usage: /tdd"
version: 1.0.0
requires: []
changelog:
  - 1.0.0 (2026-04-23): add business-predicate TDD workflow with concrete assertion examples
---

# TDD - Business Predicate Loop

Use this skill when implementation should start from tests or when existing tests are too shallow to prove behavior.

## Success Criteria

Return `success: true` only when all applicable predicates below are true:
- The first meaningful code change is preceded by a failing test that describes user-visible or domain-visible behavior.
- New or changed tests include concrete business assertion values, not only shape, existence, truthiness, or return type.
- Required verification command(s) complete successfully and the final response includes exact command names plus pass/fail evidence.
- Final response reports `success`, `criteria_checked`, `proof`, and `remaining_work`.
- If the test only proves return-type-only behavior, return `success: false` with `remaining_work` and the blocking reason.

## Red-Green-Refactor

### 1. Red
- Identify the business rule before editing implementation code.
- Write the expected values before implementation. The test must fail for the intended reason.
- Assert observable behavior: totals, state transitions, validation errors, permissions, persistence effects, emitted events, or rendered output.
- Do not accept a test whose strongest assertion is that a result exists, is truthy, has a broad type, or does not throw.

### 2. Green
- Implement the smallest production change that satisfies the failing business predicate.
- Keep the implementation scoped to the failing assertion.
- Add boundary cases when the rule has thresholds, rounding, dates, permissions, or invalid inputs.

### 3. Refactor
- Refactor only after the business assertion passes.
- Re-run the same verification command after refactoring.
- Keep test names written in business language, not implementation language.

## Bad vs Good

Bad: return-type-only assertions prove that code returned something, not that it returned the right thing.

```js
const invoice = calculateInvoice({ subtotal: 100, discountCode: "VIP" });

expect(invoice).toBeDefined();
expect(invoice.total).toBeTruthy();
```

Good: a concrete business assertion proves the rule with expected values.

```js
const invoice = calculateInvoice({ subtotal: 100, discountCode: "VIP" });

expect(invoice.total).toBe(<concrete>);
expect(invoice.discountAmount).toBe(<concrete>);
```

Replace `<concrete>` with the real expected value before implementation, for example `90` and `10`.

## Business Predicate Checklist

Before writing production code, confirm the test answers these questions:
- What exact business rule can fail?
- What input data triggers that rule?
- What concrete output, state, or side effect proves the rule?
- Would the test fail if the function returned the wrong value with the right type?
- Does the failure message point to the business rule rather than a missing mock or setup detail?

## Assertion Rules

- Prefer `.toBe(<concrete>)`, `.toEqual({ ...expected })`, `.toStrictEqual(...)`, or framework equivalents for exact values.
- Use `.toThrow(<specific message or code>)` only when the business rule is error handling.
- Allow `.toBeDefined()`, `.toBeTruthy()`, and type assertions only as supporting assertions after a concrete business assertion.
- Treat tests with only return-type-only assertions as incomplete and return `success: false`.
- Never delete or skip a failing test to make the cycle green; fix the behavior or revise the test only when the business predicate was wrong.

## Output Protocol

Report:
- `success`: true only when red, green, and verification evidence exist.
- `criteria_checked`: list of business predicates and verification commands.
- `proof`: failing test evidence, passing test evidence, and changed files.
- `remaining_work`: explicit next step, or `none`.
