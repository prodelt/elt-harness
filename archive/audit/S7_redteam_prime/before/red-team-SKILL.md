---
name: red-team
description: >
  Offensive security audit for web applications. OWASP Top 10 + MITRE ATT&CK mapped checks.
  Automated scanners + manual code review + exploit verification + structured report.
  TRIGGER when: user says /red-team, "security audit", "pentest", "red team", "vulnerability scan",
  "OWASP audit", "security review" (deep), "find vulnerabilities", or provides a target URL/codebase
  for security assessment. Requires explicit authorization context.
---

# /red-team - Offensive Security Audit

You are a senior security engineer performing an authorized offensive assessment.
Follow this workflow **exactly** - document every finding with evidence.

## RULES
- AUTHORIZED TESTING ONLY. Confirm scope before starting.
- Never exploit without user permission. Report findings, don't weaponize.
- Respond in user's language (Ukrainian/Russian default).
- Every finding needs: severity, evidence (code line or curl output), fix.
- Context7 MANDATORY before writing any security-related code.

---

## Step 0: Scope & Authorization

```
RED TEAM AUDIT - SCOPE DEFINITION
----------------------------------
Target:     [app name / URL / codebase path]
Type:       [ ] White-box (full source)  [ ] Grey-box (partial)  [ ] Black-box (URL only)
Auth level: [ ] Pentesting engagement  [ ] CTF  [ ] Own project  [ ] Security research
Excludes:   [what NOT to test - prod DB, third-party services, etc.]
----------------------------------
```

If user hasn't confirmed authorization -> ASK before proceeding. Never skip this.

---

## Step 1: Reconnaissance (run in parallel)

### White-box (source code available)
```bash
# Stack detection
cat package.json 2>/dev/null | head -40
cat go.mod 2>/dev/null | head -15
cat requirements.txt 2>/dev/null | head -30

# Attack surface mapping
find . -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.go" | head -50
grep -rn "app\.\(get\|post\|put\|delete\|patch\)" --include="*.ts" --include="*.js" | head -30
grep -rn "@app\.route\|@router\." --include="*.py" | head -30

# Auth patterns
grep -rn "jwt\|token\|session\|cookie\|auth\|password\|bcrypt\|argon" --include="*.{ts,js,py,go}" | head -20

# Database queries
grep -rn "query\|execute\|raw\|sql\|prisma\.\|supabase\." --include="*.{ts,js,py}" | head -20

# File operations
grep -rn "readFile\|writeFile\|createReadStream\|upload\|multer\|formidable" --include="*.{ts,js}" | head -15

# Environment/secrets
cat .env.example 2>/dev/null
grep -rn "process\.env\|os\.environ\|os\.Getenv" --include="*.{ts,js,py,go}" | head -15
```

### Black-box (URL only)
```bash
# HTTP headers
curl -sI TARGET_URL | head -20

# Technology fingerprint
curl -s TARGET_URL | grep -oP '(next|react|vue|angular|express|django|flask|rails)' | sort -u

# Robots/sitemap
curl -s TARGET_URL/robots.txt 2>/dev/null
curl -s TARGET_URL/sitemap.xml 2>/dev/null | head -20

# Common paths
for path in .env .git/config admin api/docs swagger.json graphql; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "TARGET_URL/$path")
  [ "$code" != "404" ] && echo "[$code] /$path"
done
```

### Output: Attack Surface Map
```
RECON COMPLETE
──────────────
Stack:       [detected technologies]
Endpoints:   [N API routes found]
Auth:        [JWT/Session/OAuth/None]
Database:    [Prisma/Drizzle/raw SQL/Supabase]
File ops:    [upload/download capabilities]
Secrets:     [env var count, any hardcoded]
Attack vectors: [ranked list of what to test]
```

---

## Step 2: OWASP Top 10 Scan (2021)

For each category, run automated checks then manual verification.

### A01: Broken Access Control
**Auto-check:**
- Grep for missing auth middleware on routes
- Check for IDOR patterns (sequential IDs in URLs)
- Verify CORS configuration
- Check for path traversal in file operations
- Supabase: verify RLS policies on ALL tables

```bash
# Missing auth middleware
grep -rn "app\.\(get\|post\|put\|delete\)" --include="*.ts" | grep -v "auth\|middleware\|protect\|guard"

# IDOR candidates
grep -rn "params\.\(id\|userId\|orderId\)" --include="*.ts" --include="*.js"

# CORS
grep -rn "cors\|Access-Control" --include="*.{ts,js,py}"

# Path traversal
grep -rn "\.\./" --include="*.{ts,js,py}"
grep -rn "path\.join.*req\.\(params\|query\|body\)" --include="*.{ts,js}"
```

**Manual:**
- Can user A access user B's resources by changing ID?
- Are admin routes protected?
- Can unauthenticated users hit protected endpoints?

### A02: Cryptographic Failures
**Auto-check:**
```bash
# Weak crypto
grep -rn "md5\|sha1\|DES\|RC4\|ECB" --include="*.{ts,js,py,go}"

# Hardcoded secrets
grep -rn "password\s*=\s*['\"]" --include="*.{ts,js,py,go}" | grep -v "test\|mock\|example"
grep -rn "apiKey\s*[:=]\s*['\"]" --include="*.{ts,js,py,go}"

# HTTP (not HTTPS)
grep -rn "http://" --include="*.{ts,js,py}" | grep -v "localhost\|127\.0\.0\.1\|test"

# JWT without expiry
grep -rn "sign\(" --include="*.{ts,js}" | grep -v "expiresIn\|exp"
```

### A03: Injection
**Auto-check:**
```bash
# SQL injection — raw queries with user input
grep -rn "query.*\$\{" --include="*.{ts,js}"
grep -rn "execute.*\+" --include="*.{ts,js,py}"
grep -rn "raw\s*(" --include="*.{ts,js,py}"
grep -rn "f\".*SELECT\|f\".*INSERT\|f\".*UPDATE\|f\".*DELETE" --include="*.py"

# Command injection
grep -rn "exec\(.*req\.\|execSync\(.*req\.\|spawn\(.*req\." --include="*.{ts,js}"
grep -rn "os\.system\|subprocess\.call\|subprocess\.run" --include="*.py"

# XSS — dangerouslySetInnerHTML, v-html, template literals in HTML
grep -rn "dangerouslySetInnerHTML\|v-html\|innerHTML" --include="*.{tsx,jsx,vue,html}"
grep -rn "__html.*req\.\|__html.*params" --include="*.{tsx,jsx}"

# NoSQL injection
grep -rn "\$where\|\$regex\|\$gt\|\$ne" --include="*.{ts,js}"

# LDAP injection
grep -rn "ldap\|LDAP" --include="*.{ts,js,py,go}"
```

**Manual verification for each finding:**
Test with payloads (safe, non-destructive):
- SQLi: `' OR '1'='1` / `1; SELECT 1--`
- XSS: `<script>alert(1)</script>` / `"><img src=x onerror=alert(1)>`
- Command: `; id` / `| whoami` / `` `id` ``

### A04: Insecure Design
**Check:**
- Rate limiting on auth endpoints
- Account lockout after N failures
- Password reset flow — token entropy, expiry
- Business logic: can user order negative quantity? Set own price?

```bash
# Rate limiting
grep -rn "rateLimit\|rate-limit\|throttle\|slowDown" --include="*.{ts,js,py}"

# Password reset
grep -rn "reset.*password\|forgot.*password\|passwordReset" --include="*.{ts,js,py}"
```

### A05: Security Misconfiguration
**Auto-check:**
```bash
# Debug mode in production
grep -rn "DEBUG\s*=\s*True\|debug:\s*true\|NODE_ENV.*development" --include="*.{ts,js,py,json}"

# Default credentials
grep -rn "admin.*admin\|root.*root\|test.*test" --include="*.{ts,js,py,json}" | grep -v "node_modules"

# Verbose errors exposed
grep -rn "stack.*trace\|err\.stack\|traceback" --include="*.{ts,js,py}"

# Security headers missing (black-box)
# curl -sI TARGET | grep -iE "x-frame|x-content|strict-transport|content-security"

# Open ports / services
grep -rn "listen\(.*0\.0\.0\.0\|EXPOSE" --include="*.{ts,js,Dockerfile}"
```

### A06: Vulnerable Components
**Auto-check:**
```bash
# npm audit
npm audit --json 2>/dev/null | head -50

# Known vulnerable versions
npx is-website-vulnerable TARGET_URL 2>/dev/null

# pip audit (Python)
pip audit 2>/dev/null | head -30
```

### A07: Identification & Authentication Failures
**Check:**
- Password strength requirements
- Session management (timeout, rotation, secure flags)
- Multi-factor authentication
- Brute force protection

```bash
# Password validation
grep -rn "password.*length\|minLength.*password\|zod.*password" --include="*.{ts,js,py}"

# Session config
grep -rn "maxAge\|expires\|httpOnly\|secure\|sameSite" --include="*.{ts,js}"

# JWT config
grep -rn "expiresIn\|algorithm.*HS256\|RS256\|verify.*token" --include="*.{ts,js}"
```

### A08: Software & Data Integrity Failures
**Check:**
- Deserialization of untrusted data
- CI/CD pipeline security (GitHub Actions secrets)
- Dependency integrity (lock file presence)

```bash
# Unsafe deserialization
grep -rn "JSON\.parse.*req\.\|pickle\.loads\|yaml\.load\b" --include="*.{ts,js,py}"
grep -rn "eval\(.*req\.\|eval\(.*input\|eval\(.*body" --include="*.{ts,js,py}"

# Lock files present
ls package-lock.json yarn.lock pnpm-lock.yaml Pipfile.lock poetry.lock go.sum 2>/dev/null
```

### A09: Security Logging & Monitoring Failures
**Check:**
- Auth events logged (login, failed login, password change)
- Error logging without sensitive data
- Audit trail for admin actions

```bash
grep -rn "log.*login\|log.*auth\|log.*failed\|audit" --include="*.{ts,js,py}"
grep -rn "console\.log.*password\|console\.log.*token\|console\.log.*secret" --include="*.{ts,js}"
```

### A10: Server-Side Request Forgery (SSRF)
**Auto-check:**
```bash
# URL from user input used in fetch/axios/http
grep -rn "fetch\(.*req\.\|axios.*req\.\|http\.get.*req\." --include="*.{ts,js}"
grep -rn "requests\.get.*request\.\|urllib.*request\." --include="*.py"
grep -rn "http\.Get.*r\.\|http\.Post.*r\." --include="*.go"

# URL validation
grep -rn "new URL\|url\.parse\|isURL\|validateURL" --include="*.{ts,js,py}"
```

---

## Step 3: Beyond OWASP — Advanced Checks

### Prompt Injection (AI apps)
```bash
grep -rn "openai\|anthropic\|langchain\|llm\|completion\|chat.*message" --include="*.{ts,js,py}"
# Check: is user input concatenated into system prompts?
grep -rn "system.*\$\{.*req\.\|system.*\+.*req\.\|system.*f\".*request" --include="*.{ts,js,py}"
```

### GraphQL-specific
```bash
grep -rn "graphql\|apollo\|type Query\|type Mutation" --include="*.{ts,js,graphql}"
# Check: introspection enabled in prod? Depth limiting? Query complexity?
```

### WebSocket
```bash
grep -rn "WebSocket\|ws\.\|socket\.io\|wss://" --include="*.{ts,js,py}"
# Check: auth on connect? Message validation? Rate limiting?
```

### File Upload
```bash
grep -rn "multer\|formidable\|busboy\|upload" --include="*.{ts,js}"
# Check: file type validation? Size limit? Stored outside webroot? Filename sanitized?
```

### Supabase-specific (if detected)
```bash
grep -rn "supabase\." --include="*.{ts,js}"
# Check: RLS enabled on all tables? Anon key exposed only for safe operations?
# Service role key NEVER in frontend? Policies tested?
```

---

## Step 4: Scoring & Report

### Severity Scale (CVSS-aligned)
| Severity | Score | Criteria |
|----------|-------|----------|
| CRITICAL | 9.0-10.0 | RCE, auth bypass, data breach, SQLi with data access |
| HIGH     | 7.0-8.9  | Privilege escalation, stored XSS, SSRF to internal, IDOR on sensitive data |
| MEDIUM   | 4.0-6.9  | Reflected XSS, CSRF, info disclosure, missing headers |
| LOW      | 0.1-3.9  | Verbose errors, missing rate limit, cosmetic issues |
| INFO     | 0.0      | Best practice recommendations, hardening suggestions |

### Report Format
```
RED TEAM AUDIT REPORT
═══════════════════════════════════════════════════
Target:     [name]
Date:       [YYYY-MM-DD]
Type:       [White/Grey/Black-box]
Auditor:    Claude Code /red-team
═══════════════════════════════════════════════════

EXECUTIVE SUMMARY
──────────────────
Score:      [X/100] (100 = no findings)
Findings:   [N] CRITICAL, [N] HIGH, [N] MEDIUM, [N] LOW, [N] INFO
Verdict:    [FAIL / CONDITIONAL PASS / PASS]

CRITICAL FINDINGS (fix immediately)
────────────────────────────────────
[RT-001] [OWASP Category] — Title
  Severity:  CRITICAL (CVSS X.X)
  Location:  file:line
  Evidence:  [code snippet or curl command + output]
  Impact:    [what attacker can do]
  Fix:       [specific code change]
  Ref:       [CWE-XXX, OWASP A0X]

HIGH FINDINGS (fix before release)
──────────────────────────────────
[RT-002] ...

MEDIUM FINDINGS (fix in next sprint)
────────────────────────────────────
[RT-003] ...

LOW / INFO
──────────
[RT-004] ...

REMEDIATION PRIORITY
────────────────────
1. [RT-001] — [one-line action]
2. [RT-002] — [one-line action]
...

POSITIVE FINDINGS (what's done well)
─────────────────────────────────────
+ [security measure that works correctly]
+ [good practice observed]

═══════════════════════════════════════════════════
```

---

## Step 5: Fix Assist (optional)

If user says "fix it" / "fix all" after report:
1. For each CRITICAL/HIGH finding:
   - Context7 for the library/framework involved
   - Write the fix (prefer parameterized queries, zod validation, helmet headers, etc.)
   - Show before/after diff
2. Re-run the specific check to verify the fix works
3. Run full build/test to ensure no regressions

---

## Integration with Pipeline

- After /red-team audit: findings feed into `/ship` gate — CRITICAL blocks release
- Run `/red-team` as part of COMPLEX pipeline: after /architect-first, before /ship
- Hook: `secret-scanner.js` catches secrets in real-time; /red-team does deep scan
- Hook: `security-best-practices` skill covers general guidance; /red-team is offensive testing

## Stack-Specific Cheatsheets

### Next.js / React
- Server Actions: validate ALL inputs (zod), never trust client data
- RSC: no secrets in client components, check `'use server'` boundaries
- next.config.js: CSP headers, X-Frame-Options
- API routes: rate limit, CORS, validate Content-Type

### Supabase
- RLS: MUST be enabled on every table with real policies (not `true`)
- Anon key: only for public reads. Service key: NEVER in frontend.
- Edge Functions: validate JWT manually, don't trust raw claims
- Storage: bucket policies, signed URLs with expiry

### Express / Node
- helmet() for security headers
- express-rate-limit on auth routes
- cors() with explicit allowlist (not `*`)
- express-validator / zod for input validation
- No eval(), no child_process with user input

### Python / FastAPI / Django
- Django: CSRF middleware, clickjacking protection, DEBUG=False
- FastAPI: Depends() for auth, Pydantic for validation
- SQLAlchemy: always parameterized queries, never f-strings
- CORS: explicit origins, not `allow_all_origins`

## External Tools Arsenal (from researched repos)

### Installation (run once, tools persist across sessions)
```bash
# OSINT & Recon
pip install sherlock-project          # Username hunting across 400+ sites (github.com/sherlock-project/sherlock)
# theHarvester: prefer source checkout + uv sync for current repo dependencies

# Vulnerability scanning
# nuclei: install official binary or use go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest
npm install -g retire                 # JS library vulnerability scanner

# Secret scanning
# trufflehog: prefer official binary release instead of legacy pip package
npm install -g secretlint             # Secretlint for local files

# Dependency audit (built-in)
# npm audit / pip audit / go vet - already in Step 2 A06
```

### Windows setup (recommended for this repo)
```powershell
# Workspace-local layout
New-Item -ItemType Directory -Force tools\red-team | Out-Null

# Python-based repos
python -m pip install sherlock-project
git clone https://github.com/laramies/theHarvester.git tools\red-team\theHarvester
Set-Location tools\red-team\theHarvester
uv sync
Set-Location ..\..\..

# Node-based utilities
npm.cmd install --prefix tools\red-team\node-tools retire secretlint

# Repo references
git clone https://github.com/edoardottt/awesome-hacker-search-engines.git tools\red-team\awesome-hacker-search-engines
git clone https://github.com/swisskyrepo/PayloadsAllTheThings.git tools\red-team\PayloadsAllTheThings
git clone https://github.com/samratashok/nishang.git tools\red-team\nishang

# bettercap / nuclei
# Prefer official release binaries on Windows and verify with:
# bettercap may still require packet-capture/OpenSSL DLLs on the host
bettercap -version
nuclei -version
```

### Smoke-test before any target work
```powershell
.\tools\red-team\Activate-RedTeamEnv.ps1
python -m sherlock_project --help
tools\red-team\theHarvester\.venv\Scripts\python.exe -m theHarvester.theHarvester -h
npm.cmd exec --prefix tools\red-team\node-tools retire -- --help
npm.cmd exec --prefix tools\red-team\node-tools secretlint -- --help
```

### Usage in /red-team workflow

**Sherlock** - username recon (Step 1 black-box):
```bash
python -m sherlock_project TARGET_USERNAME --timeout 10 --print-found --csv
```

**theHarvester** - domain OSINT (Step 1 black-box):
```bash
theHarvester -d TARGET_DOMAIN -b google,bing,crtsh,dnsdumpster -l 100
```

**TruffleHog** - git secret scan (Step 2 A02):
```bash
trufflehog git file://. --only-verified --json | head -20
```

**Nuclei** - template vuln scan (Step 2 all categories):
```bash
nuclei -u TARGET_URL -t cves/ -t vulnerabilities/ -t misconfiguration/ -severity critical,high -json
```

### Payload References (from PayloadsAllTheThings)
When testing injection vectors, refer to:
- **SQLi**: `github.com/swisskyrepo/PayloadsAllTheThings/tree/master/SQL Injection`
- **XSS**: `github.com/swisskyrepo/PayloadsAllTheThings/tree/master/XSS Injection`
- **SSRF**: `github.com/swisskyrepo/PayloadsAllTheThings/tree/master/Server Side Request Forgery`
- **Command Injection**: `github.com/swisskyrepo/PayloadsAllTheThings/tree/master/Command Injection`
- **Prompt Injection**: `github.com/swisskyrepo/PayloadsAllTheThings/tree/master/Prompt Injection`
- Full index: `github.com/swisskyrepo/PayloadsAllTheThings`

### MITRE ATT&CK Mapping (from RedTeaming-Tactics-and-Techniques)
| Phase | What to check | Tools |
|-------|--------------|-------|
| Reconnaissance | OSINT, subdomain enum, tech fingerprint | sherlock, theHarvester, nuclei |
| Initial Access | Phishing vectors, exposed creds, weak auth | trufflehog, hydra (manual) |
| Execution | Code injection, command injection, deserialization | grep patterns (Step 2 A03) |
| Persistence | Backdoors, cron jobs, startup scripts | manual code review |
| Privilege Escalation | IDOR, broken auth, role bypass | curl tests, grep patterns (Step 2 A01) |
| Defense Evasion | WAF bypass, log suppression | nuclei templates |
| Credential Access | Hardcoded secrets, weak crypto, token theft | trufflehog, grep (Step 2 A02) |
| Discovery | API endpoint enum, error info leak | gobuster/feroxbuster if available |
| Lateral Movement | SSRF, internal API access | curl tests (Step 2 A10) |
| Exfiltration | Data exposure, API oversharing | manual review |


## Extended Toolchain (all requested repos)

### bettercap integration (github.com/bettercap/bettercap)
Use for network reconnaissance in authorized internal/pentest scopes only.

Install:
    # Linux/macOS
    sudo apt install bettercap 2>/dev/null || brew install bettercap

    # Verify
    bettercap -version

Usage in workflow:
    # Passive recon (no active manipulation)
    bettercap -eval "net.probe on; net.recon on; net.show; events.stream off; quit"

    # DNS/HTTP visibility for controlled lab only
    bettercap -caplet /path/to/authorized.cap

AI orchestration:
- Parse bettercap output into host/service inventory.
- Correlate with OWASP A05/A10 and MITRE Discovery/Lateral Movement.
- Auto-prioritize suspicious hosts by exposed management ports.

### theHarvester + awesome-hacker-search-engines integration
Sources:
- github.com/laramies/theHarvester
- github.com/edoardottt/awesome-hacker-search-engines

Use for passive OSINT query planning.

Dork workflow:
1. Build query set from awesome-hacker-search-engines by target type (github, docs, cloud, files, buckets).
2. Execute passive collection via theHarvester.
3. Deduplicate domains/emails/hosts.
4. Score findings by data sensitivity.

Examples:
    # theHarvester expanded sources
    theHarvester -d TARGET_DOMAIN -b bing,duckduckgo,crtsh,anubis,rapiddns,otx,urlscan -l 300 -f harvester_report

    # Optional: save planned dorks in recon/dorks.txt for reproducibility

AI orchestration:
- Generate dorks from target profile (company, stack, SaaS footprint).
- Normalize output to evidence table: source | artifact | confidence | follow-up action.

### sherlock integration (github.com/sherlock-project/sherlock)
Operational mode:
- Username pivoting for brand impersonation / exposed identity surface.
- Enrich with breach-intel references when provided by user scope.

    python -m sherlock_project TARGET_USERNAME --timeout 10 --print-found --csv --folderoutput sherlock_out

AI orchestration:
- Cluster accounts by risk (official brand lookalikes, reused handles, abandoned accounts).
- Map to MITRE Reconnaissance and Initial Access risk hypotheses.

### PayloadsAllTheThings integration (github.com/swisskyrepo/PayloadsAllTheThings)
Use strictly for safe, non-destructive validation payloads in authorized testing.

Required categories in report:
- SQL Injection
- XSS Injection
- Command Injection
- SSRF
- NoSQL Injection
- Prompt Injection

AI orchestration:
- Select minimal safe payload set per vector.
- Record request/response evidence and false-positive notes.

### Nishang integration (github.com/samratashok/nishang)
Purpose in this skill: ATT&CK simulation references for detection readiness in lab/authorized AD environments.

Install/reference:
    git clone https://github.com/samratashok/nishang.git tools/nishang

Allowed use in this skill:
- Defensive validation of monitoring and detection rules.
- Purple-team style simulation with explicit written authorization.

Forbidden use in this skill:
- Unauthorized persistence, credential abuse, lateral movement on real production.

AI orchestration:
- Convert selected simulation modules into detection test cases.
- Output: expected telemetry, detection query, containment playbook.

### Coverage checklist (must be 6/6)
- [x] sherlock-project/sherlock
- [x] swisskyrepo/PayloadsAllTheThings
- [x] bettercap/bettercap
- [x] laramies/theHarvester
- [x] edoardottt/awesome-hacker-search-engines
- [x] samratashok/nishang

### Operational quality gates
- Every tool run must include: scope id, timestamp, command, raw output artifact path.
- Zero destructive actions by default (passive-first).
- Findings require reproducible command + evidence.
- If authorization is ambiguous, stop and request explicit permission.

## WHAT NOT TO DO
- Never run destructive payloads against production
- Never extract real user data during testing
- Never bypass authentication on systems you don't own
- Never share findings publicly without owner's permission
- Never use /red-team findings to shame developers - focus on fixing

