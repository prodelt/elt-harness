# Opus Audit Prompt — Full System Review + Skill Creation

> Копіюй все нижче після `---START---` і вставляй в Opus-сесію

---START---

Ти — Anthropic Claude Opus, найпотужніший AI для архітектурних рішень та глибокого аналізу.

Ти маєш доступ до повної інфраструктури розробки одного розробника: хуки, скіли, агенти, конфіги.
Твоя задача — провести **повний аудит**, знайти **всі баги і слабкі місця**, **покращити існуючі скіли** і **створити нові**.

---

## КОНТЕКСТ СИСТЕМИ

### Що це таке
Централізована система хуків та скілів для Claude Code CLI. Хуки — Node.js скрипти що виконуються на різних подіях (SessionStart, PreToolUse, PostToolUse, Stop). Скіли — Markdown файли що розгортаються в промпти через `/skill-name`.

### Розташування файлів
```
~/.claude/
├── hooks/           ← 27 хуків (Node.js .js файли)
├── hooks/lib/       ← config.js, logger.js, metrics.js
├── hooks/config.json ← всі threshold'и
├── skills/          ← 20+ скілів (Markdown)
├── skills/agents/   ← 7 агент-шаблонів (frontend/backend/security/qa/devops/architect/3d-animation)
└── settings.json    ← глобальна конфігурація

~/.codex/hooks.json  ← Codex CLI mirror (ті ж .js файли, без FileChanged/Notification)
```

### Список хуків (27 активних)
**SessionStart**: project-docs-gate, session-focus-gate, autoskills-check, graphify-session-init, memory-discipline
**UserPromptSubmit**: context-budget-gate
**PreToolUse**: graphify-preuse, config-protection, domain-agent-gate, edit-enforcer, secret-scanner, quality-gate-runner, graphify-read-gate
**PostToolUse**: post-edit-combined, context7-reminder, inline-review-gate, verification-tracker, loop-guardian, secret-output-scanner, inline-review-tracker, pipeline-tracker, scope-guard, context7-tracker
**Stop**: stop-verification, ship-gate
**Notification**: task-completed-gate
**FileChanged**: env-change-watcher

### Список скілів
pipeline, ship, sprint, company, architect-first, cto-playbook, security-best-practices, inline-review, checkpoint, learn, prime, fix-issue, sync-docs, init-project, mikrotik-audit, clone-research, contract-review, careful, freeze, awwwards-web-design, reference-design-adaptation

### Агент-шаблони
frontend.md, backend.md, security.md, qa.md, devops.md, architect.md, 3d-animation.md

---

## ТВОЇ ЗАДАЧІ (виконуй послідовно)

---

### ЗАДАЧА 1: Аудит хуків

**Прочитай** усі файли в `~/.claude/hooks/` (включаючи lib/).

Для кожного хука відповідай:
1. **Чи правильний формат виводу?**
   - PreToolUse block: `hookSpecificOutput.permissionDecision: 'deny'`
   - PostToolUse advisory: `hookSpecificOutput.additionalContext: '...'`
   - Stop block: `{ decision: 'block', reason: '...' }` → stdout
   - SessionStart block: `process.exit(2)` + stderr (НЕ stdout)
2. **Чи є баги?** (cwd bug, race condition, JSON parse fails, missing try/catch)
3. **Чи є дублювання логіки** між хуками?
4. **Silent by default?** Хуки мають мовчати якщо немає проблем
5. **Чи є false positives?** Блокує те чого не повинен

**Перевір окремо:**
- `graphify-read-gate.js`: partial read bypass (`limit != null`) і cwd з input
- `loop-guardian.js`: actionKey для Edit включає old_string fingerprint (не просто filePath)
- `memory-discipline.js`: SessionStart, warn >80 / block >100 рядків MEMORY.md
- `edit-enforcer.js`: threshold'и з config.json, не hardcoded
- `domain-agent-gate.js`: detectує graphify path через `which graphify` або `cmd /c where graphify`

**Шукай:**
- Хуки що завжди пишуть stdout (навіть коли нічого не сталось) — waste tokens
- Хуки що можуть deadlock (stdin read без timeout)
- Хуки що використовують `process.cwd()` замість `input.cwd`

---

### ЗАДАЧА 2: Аудит скілів — Pipeline + Sprint + Ship

**Прочитай**: `~/.claude/skills/pipeline/SKILL.md`, `~/.claude/skills/sprint/SKILL.md`, `~/.claude/skills/ship/SKILL.md`

Питання:
1. **Pipeline CLASSIFY:** Чи достатньо чіткі критерії TRIVIAL/MEDIUM/COMPLEX? Яких edge cases бракує?
2. **Pipeline AUTO-ROUTE:** Чи всі матчі покривають реальні сценарії? Що випадає?
3. **Sprint:** Чи є механізм відновлення (якщо перервали)? Чи є checkpoint integration?
4. **Ship:** Чи перевіряє git status перед push? Чи є захист від force push на main?
5. **Загальне:** Скіли написані як ІНСТРУКЦІЇ для Claude чи як ДОКУМЕНТАЦІЯ? (правильно — інструкції)
6. **Чи є конфлікти** між pipeline → sprint → ship (дублювання кроків, суперечливі правила)?

---

### ЗАДАЧА 3: Аудит CTO-Playbook + Architect-First

**Прочитай**: `~/.claude/skills/cto-playbook/SKILL.md`, `~/.claude/skills/architect-first/SKILL.md`

**CTO-Playbook аудит:**
1. Tech Stack Defaults — чи актуальні версії для 2026? (React 19, Next.js 15/16, Tailwind v4, Cloudflare Workers, tRPC, Neon)
2. Чи є секція про **AI-generated code review** (не просто "review everything" а конкретний процес)?
3. DORA Metrics — чи є конкретний action plan як їх покращити, не просто targets?
4. Чи є секція про **cost optimization** (Cloudflare vs Vercel, serverless cold starts, DB connection pooling)?
5. Чи є **Security section** (OWASP Top 10, secrets management, dependency scanning)?
6. Чи є **Observability checklist** (що логувати, які alert'и, SLO/SLI)?
7. Що **відсутнє** порівняно з best practices топових engineering blogs (Stripe, Linear, Vercel)?

**Architect-First аудит:**
1. Multi-perspective validation — чи описаний конкретний процес (A/B/C options format)?
2. ADR format — чи є template? Чи інтегрований з CTO-Playbook?
3. Zero Coupling Check — чи є конкретні приклади того що ЗАБОРОНЕНО?
4. Design Doc BEFORE Code — чи є checklist що ОБОВ'ЯЗКОВО у design doc?
5. Чи є секція про **incremental migration** (як переходити з поточного стану на нову архітектуру)?
6. **Hard Stop Rules** — чи є вони достатньо чіткими щоб Claude РЕАЛЬНО зупинявся?

**Запропонуй конкретні покращення** для обох (нові секції, оновлені правила, приклади).

---

### ЗАДАЧА 4: Аудит агент-шаблонів

**Прочитай всі файли**: `~/.claude/skills/agents/frontend.md`, `backend.md`, `security.md`, `qa.md`, `devops.md`, `architect.md`, `3d-animation.md`

Для кожного агента:
1. **Чи є mandatory Context7** секція на початку?
2. **Чи є version detection** (читати package.json перед застосуванням правил)?
3. **Чи є конкретні заборони** ("НІКОЛИ не роби X") поряд з правилами?
4. **Чи є тести** ("як перевірити що агент спрацював правильно")?
5. **Чи актуальні API** (React 19 new patterns, Next.js 15 App Router conventions, Tailwind v4 `@theme`)?

**Специфічні питання:**
- `frontend.md`: Чи описані Server Components vs Client Components decision tree?
- `backend.md`: Чи є секція про connection pooling, rate limiting, pagination?
- `security.md`: Чи покриває OWASP Top 10? Input validation з Zod? SQL injection prevention?
- `qa.md`: Чи є різниця між unit/integration/e2e тестами? TDD workflow?
- `devops.md`: Чи є секція про Windows-специфіку (цей розробник на Windows)?
- `architect.md`: Чи інтегрований з architect-first скілом?
- `3d-animation.md`: Чи актуальні версії Three.js, R3F, GSAP?

---

### ЗАДАЧА 5: Аудит дизайн-скілів

**Прочитай**: `~/.claude/skills/awwwards-web-design/SKILL.md`, `~/.claude/skills/reference-design-adaptation/SKILL.md`

**Awwwards аудит:**
1. TYPE A/B/C selector — чи є чіткі критерії для edge cases (напр. "creative business site")?
2. GSAP section — чи актуальний API? Версія? Чи є ScrollTrigger examples?
3. Lenis section — чи актуальна версія і API?
4. Three.js/R3F — чи є конкретні performance tips (texture optimization, instancing, LOD)?
5. Чи є секція про **mobile performance** (анімації вбивають перформанс на мобільних)?
6. Чи є **accessibility** рекомендації (prefers-reduced-motion)?
7. Чи є **loading strategy** (above-fold first, lazy load below)?

**Reference-Design аудит:**
1. Screenshot workflow — чи описаний конкретний інструмент (Playwright vs DevTools)?
2. Value extraction — чи є checklist: colors, fonts, spacing, shadows, border-radius, animation timing?
3. Pixel-match verification — як саме порівнювати?
4. Чи є секція про **font loading** (FOUT prevention)?


---

### ЗАДАЧА 6: GitHub Research — Best Practices

**Пошукай на GitHub** (через WebSearch) trending repositories за останні 6 місяців по темах:

1. **Claude Code hooks** — нові creative hooks, best practices
   - Query: `site:github.com claude code hooks 2025 OR 2026`
   - Query: `github.com/anthropics/claude-code hooks examples`
2. **AI coding assistant skills/prompts** — топові skill libraries
   - Query: `github.com awesome claude prompts skills 2025`
   - Query: `github.com claude code skills SKILL.md`
3. **Red team / security scanning** — найкращі OSS інструменти для автоматизованого сканування
   - Query: `github.com awesome red team automated 2025`
   - Query: `github.com security scanning OWASP automated pipeline`
4. **Developer workflow automation** — hooks, pipelines, AI-assisted development patterns
   - Query: `github.com AI developer workflow automation hooks 2026`

**Для кожного знайденого репо:**
- Назва + stars
- Ключова ідея яку можна запозичити
- Чи конфліктує з нашою системою?

---

### ЗАДАЧА 7: Покращити існуючі скіли (конкретні зміни)

На основі аудиту (задачі 1-5) та GitHub research (задача 6), надай **конкретні diff-патчі** для:

**Пріоритет 1 — Критичні фікси (якщо знайдені):**
- Будь-який хук з неправильним output format
- Будь-який скіл з неактуальним API

**Пріоритет 2 — Покращення:**
- CTO-Playbook: додати missing секції
- Architect-First: посилити Hard Stop Rules
- Агенти: додати version detection + заборони де бракує
- Awwwards: додати mobile performance + accessibility секції

**Пріоритет 3 — Нові можливості:**
- Pipeline: додати ULTRA-TRIVIAL клас (1 рядок зміни → 0 overhead)
- Frontend агент: додати decision tree для Server vs Client Components

Формат для кожного патча:
```
FILE: ~/.claude/skills/[name]/SKILL.md
SECTION: [назва секції]
CHANGE: [що і чому]
---
[новий або змінений текст]
```

---

### ЗАДАЧА 8: СТВОРИТИ НОВИЙ СКІЛ — Red Team Security

Це головна задача. Створи повноцінний скіл `/red-team` що дозволяє проводити **automated security reconnaissance** проектів цього розробника.

**Контекст проектів:**
- Python FastAPI / Flask бекенди
- Next.js 15/16 фронтенди (TypeScript)
- PostgreSQL + Supabase databases
- Telegram боти (Python, aiogram)
- Розміщено на VPS (Linux) + Vercel
- Деякі мають MikroTik мережеву інфраструктуру

**Скіл має включати:**

#### 1. Автоматизовані сканери (через Bash tool)

```markdown
## Static Analysis (без запуску коду)
- Bandit (Python): `bandit -r src/ -f json`
- Semgrep: `semgrep --config auto src/`
- npm audit: `npm audit --json`
- pip-audit: `pip-audit --format json`
- truffleHog: `trufflehog filesystem . --json` (секрети в коді)
- detect-secrets: `detect-secrets scan --all-files`

## Dependency Scanning
- Safety (Python): `safety check --json`
- Snyk: `snyk test --json` (якщо встановлено)
- OWASP dependency-check: `dependency-check.sh --project . --scan .`

## Secret Detection
- gitleaks: `gitleaks detect --source . --report-format json`
- git-secrets: `git secrets --scan`

## Infrastructure
- Docker Scout: `docker scout cves image:tag`
- Trivy: `trivy fs . --format json`
```

#### 2. OWASP Top 10 Checklist (адаптований для стеку)

```markdown
## A01 Broken Access Control
□ All endpoints check authentication?
□ Row-level security in PostgreSQL/Supabase?
□ File upload restrictions (extension, size, content-type)?
□ IDOR vulnerabilities (user can access other users' data)?

## A02 Cryptographic Failures
□ Passwords hashed with bcrypt/argon2 (NOT md5/sha1)?
□ Sensitive data encrypted at rest?
□ HTTPS enforced (HSTS header)?
□ JWT secrets rotation policy?

## A03 Injection
□ All SQL queries parameterized (no string concatenation)?
□ NoSQL queries sanitized?
□ OS command injection? (subprocess with shell=True?)
□ Template injection? (Jinja2 autoescape?)

## A05 Security Misconfiguration
□ Debug mode disabled in production?
□ Default credentials changed?
□ Error messages don't leak stack traces?
□ CORS properly configured (not *)?
□ Security headers: CSP, X-Frame-Options, X-Content-Type-Options?

## A07 Authentication Failures
□ Brute force protection (rate limiting)?
□ Secure session management?
□ Password reset flow secure (no token leakage)?
□ 2FA available for admin accounts?

## A09 Security Logging
□ Auth failures logged?
□ Admin actions audited?
□ PII NOT logged?
□ Logs centralized and monitored?
```

#### 3. Workflow скілу

```markdown
## /red-team usage

/red-team [target]
  target = path to project OR auto-detect from CWD

PHASE 1: RECON (read-only, 5 min)
- Detect stack (package.json, requirements.txt, Dockerfile)
- Map entry points (routes, API endpoints, auth flows)
- Identify sensitive files (.env, config, secrets)
- Check git history for accidentally committed secrets

PHASE 2: STATIC SCAN (automated, 10 min)
- Run all applicable scanners from list above
- Parse JSON output, extract HIGH/CRITICAL only
- Deduplicate findings

PHASE 3: MANUAL CHECKS (Claude analysis, 15 min)
- OWASP Top 10 checklist against detected stack
- Business logic vulnerabilities (that scanners miss)
- API design flaws (mass assignment, over-fetching)
- Frontend: XSS vectors, CSP bypass potential

PHASE 4: REPORT
Format:
---
RED TEAM REPORT: [project name]
Scan date: [date]
Stack: [detected]

CRITICAL (fix immediately):
- [finding] | File: X:Y | CVSS: N | Fix: [specific action]

HIGH (fix this sprint):
- ...

MEDIUM (fix next sprint):
- ...

LOW (track in backlog):
- ...

PASSED CHECKS:
- [what's good]

RECOMMENDATIONS:
- [top 3 architectural improvements]
---
```

#### 4. Інтеграція з pipeline

```markdown
## Auto-activation
Trigger /red-team automatically when:
- domain-agent-gate detects security.md context
- File edited: auth/, middleware/, handlers/, api/
- Stop hook: if uncommitted changes include auth files

## CI/CD Integration
Add to ship skill:
1. Before PR: run bandit + npm audit
2. Block PR if CRITICAL findings
3. MEDIUM findings → create GitHub issue
```

**Додатково до скілу:**
- Посилання на топові OSS інструменти з GitHub
- Як встановити кожен (pip install / npm install / winget)
- Які з них працюють на Windows без WSL
- Telegram bot-specific checks (token exposure, webhook security)
- MikroTik-specific checks (якщо project має mikrotik config)

---

### ЗАДАЧА 9: Фінальний звіт

Структуруй як:

```
AUDIT COMPLETE
==============

HOOKS: X/27 мають проблеми
  CRITICAL: [список]
  WARNING: [список]
  OK: [кількість]

SKILLS: X/20 мають проблеми
  pipeline: [OK/NEEDS UPDATE]
  cto-playbook: [OK/NEEDS UPDATE — що саме]
  architect-first: [OK/NEEDS UPDATE]
  awwwards-web-design: [OK/NEEDS UPDATE]
  ...

AGENTS: X/7 мають проблеми
  frontend.md: [OK/NEEDS UPDATE — що саме]
  ...

GITHUB FINDINGS:
  Top 3 repos to watch: [список]
  Top 3 ideas to steal: [список]

PATCHES READY: X файлів
  [список файлів для оновлення]

NEW SKILL CREATED:
  /red-team: [summary]
  Install: copy to ~/.claude/skills/red-team/SKILL.md

PRIORITY ACTIONS (by importance):
  1. [дія] — [чому критично]
  2. ...
  3. ...
```

---

## ДОДАТКОВІ ПРАВИЛА ДЛЯ OPUS

1. **НЕ пропускай жодного хука** — прочитай кожен файл
2. **Конкретність > загальність** — "додай version detection в рядку 5" > "покращи агент"
3. **Показуй diff** для кожного запропонованого покращення
4. **Пріоритизуй за impact** — що реально заважає роботі vs nice-to-have
5. **Windows context** — розробник на Windows 10, bash через Git Bash, деякі інструменти через `cmd /c`
6. **Перевіряй актуальність** — якщо API/версія змінилась після твоїх training data, WebSearch щоб перевірити
7. **Red team скіл** — це фінальний deliverable, він має бути production-ready, не чернетка

---END---
