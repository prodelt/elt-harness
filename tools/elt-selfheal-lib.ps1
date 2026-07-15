# elt-selfheal-lib.ps1 — T011 (004-elt-selfdrive): чистые функции gated self-repair,
# вынесены из elt-selfheal.ps1 отдельно, чтобы merge-механику можно было юнит-тестить
# РЕАЛЬНЫМ git (init + branch + merge) без спавна watchdog/driver/живого claude.
# Только определения функций — без top-level исполнения (безопасно dot-source'ить).

function Get-AutoMergeConfig {
  param([string]$Project)
  $cfgPath = Join-Path $Project ".harness\harness.json"
  if (-not (Test-Path $cfgPath)) { return $false }
  try {
    $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
    return [bool]($cfg.selfHeal -and $cfg.selfHeal.autoMerge)
  } catch { return $false }
}

# Мержит $HealBranch в main. Вызывающий отвечает за гейт (DryRun / AutoMerge) —
# эта функция ничего не решает про "надо ли", только "как", чтобы обе стороны
# (гейт-по-умолчанию-off и реальный merge-когда-on) были тестируемы раздельно.
function Invoke-SelfHealMerge {
  param([string]$Project, [string]$HealBranch)
  if ([string]::IsNullOrWhiteSpace($HealBranch) -or $HealBranch -in @("main", "master")) {
    return @{ merged = $false; reason = "no-branch" }
  }
  Push-Location $Project
  try {
    # Runtime run-log lives in git-dir, so a successful elt commit leaves no tracked tail.
    & git checkout main 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { return @{ merged = $false; reason = "checkout-failed" } }
    & git merge --no-ff $HealBranch -m "self-heal: merge $HealBranch (elt-selfheal --AutoMerge)" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { return @{ merged = $false; reason = "merge-failed" } }
    return @{ merged = $true; reason = "ok" }
  } finally {
    Pop-Location
  }
}
