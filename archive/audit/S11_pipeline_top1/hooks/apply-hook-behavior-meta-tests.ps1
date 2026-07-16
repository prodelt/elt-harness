param(
    [string]$Target = "$HOME\.claude\hooks\test-hooks-behavior.js"
)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$marker = "// S11 task 21 meta hook behavior tests"
$insertBefore = "console.log('\n' + '='.repeat(70));"

$snippet = @'
// S11 task 21 meta hook behavior tests ---------------------------------------
console.log('\n-- S11 task 21 meta hook behavior tests ------------------------');

function writeSizedFile(bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-size-guard-test-'));
  const filePath = path.join(dir, 'session.jsonl');
  fs.writeFileSync(filePath, Buffer.alloc(bytes, 'x'));
  return { dir, filePath };
}

function testSessionSizeGuard(description, bytes, expectContains) {
  const fixture = writeSizedFile(bytes);
  const r = runHook('session-size-guard.js', {
    prompt: 'continue',
    transcript_path: fixture.filePath,
    cwd: os.tmpdir()
  });
  const msg = getMsg(r);
  const ok = r.exitCode === 0 && msg.includes(expectContains);
  const detail = ok ? '' : ` | exit=${r.exitCode} msg="${msg.slice(0, 100)}"`;
  results.cases.push({ ok, description, detail });
  if (ok) results.pass++; else results.fail++;
  try { fs.rmSync(fixture.dir, { recursive: true, force: true }); } catch (_) {}
}

function createCommittedRepo(branchName) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-guard-test-'));
  spawnSync('git', ['init', '-b', 'main', repo], { encoding: 'utf8' });
  spawnSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.name', 'Hook Test'], { cwd: repo, encoding: 'utf8' });
  fs.writeFileSync(path.join(repo, 'README.md'), 'test\n');
  spawnSync('git', ['add', 'README.md'], { cwd: repo, encoding: 'utf8' });
  spawnSync('git', ['commit', '-m', 'test: init'], { cwd: repo, encoding: 'utf8' });
  if (branchName !== 'main') {
    spawnSync('git', ['switch', '-c', branchName], { cwd: repo, encoding: 'utf8' });
  }
  return repo;
}

function testBranchGuard(description, branchName, expectDenied) {
  const repo = createCommittedRepo(branchName);
  const r = runHook('git-branch-guard.js', {
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "test: guarded"' },
    cwd: repo
  });
  const actualDenied = isDenied(r);
  const ok = actualDenied === expectDenied;
  const detail = ok ? '' : ` | expected ${expectDenied ? 'DENY' : 'ALLOW'}, got ${actualDenied ? 'DENY' : 'ALLOW'} msg="${getMsg(r).slice(0, 100)}"`;
  results.cases.push({ ok, description, detail });
  if (ok) results.pass++; else results.fail++;
  try { fs.rmSync(repo, { recursive: true, force: true }); } catch (_) {}
}

function createCoverageDir(pct) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-gate-test-'));
  const coverageDir = path.join(dir, 'coverage');
  fs.mkdirSync(coverageDir, { recursive: true });
  fs.writeFileSync(
    path.join(coverageDir, 'coverage-summary.json'),
    JSON.stringify({ total: { lines: { pct } } }),
    'utf8'
  );
  return dir;
}

function testCoverageGate(description, pct, expectDenied) {
  const dir = createCoverageDir(pct);
  const r = runHook('coverage-gate.js', {
    tool_name: 'Bash',
    tool_input: { command: 'git commit -m "test: coverage"' },
    cwd: dir
  });
  const actualDenied = isDenied(r);
  const ok = actualDenied === expectDenied;
  const detail = ok ? '' : ` | expected ${expectDenied ? 'DENY' : 'ALLOW'}, got ${actualDenied ? 'DENY' : 'ALLOW'} msg="${getMsg(r).slice(0, 100)}"`;
  results.cases.push({ ok, description, detail });
  if (ok) results.pass++; else results.fail++;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

testSessionSizeGuard('WARN: session-size-guard 501KB transcript', 501 * 1024, '500KB');
testSessionSizeGuard('WARN: session-size-guard 1001KB transcript', 1001 * 1024, '1MB');
testBranchGuard('BLOCK: git-branch-guard main commit', 'main', true);
testBranchGuard('ALLOW: git-branch-guard feature commit', 'feature/hook-behavior-test', false);
testCoverageGate('BLOCK: coverage-gate 50 percent', 50, true);
testCoverageGate('ALLOW: coverage-gate 90 percent', 90, false);

'@

if (-not (Test-Path -LiteralPath $Target)) {
    throw "Behavior suite not found: $Target"
}

$content = Get-Content -LiteralPath $Target -Raw -Encoding UTF8
if ($content.Contains($marker)) {
    [PSCustomObject]@{ path = $Target; updated = $false; reason = "already present" } | Format-List
    exit 0
}

$index = $content.LastIndexOf($insertBefore)
if ($index -lt 0) {
    throw "Could not find insertion point in $Target"
}

$next = $content.Insert($index, ($snippet.TrimEnd() + "`r`n`r`n"))
[System.IO.File]::WriteAllText($Target, ($next -replace "`r?`n", "`r`n"), $utf8NoBom)
[PSCustomObject]@{ path = $Target; updated = $true; reason = "inserted task 21 meta-tests" } | Format-List
