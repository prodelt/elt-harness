param(
    [Parameter(Mandatory)]
    [string]$Name,

    [string]$StagingRoot = $PSScriptRoot,

    [string[]]$ProductionRoots = @(
        "$HOME\.claude\skills",
        "$HOME\.codex\skills",
        "$HOME\.gemini\skills"
    ),

    [string]$AuditLog = (Join-Path $PSScriptRoot "promote.log")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# 1. Validate staging skill
$stagingSkill = Join-Path $StagingRoot $Name
if (-not (Test-Path -LiteralPath $stagingSkill -PathType Container)) {
    Write-Error "Staging skill not found: $stagingSkill"
    exit 1
}
$skillMd = Join-Path $stagingSkill "SKILL.md"
if (-not (Test-Path -LiteralPath $skillMd)) {
    Write-Error "SKILL.md missing in staging: $skillMd"
    exit 1
}
# Verify semver fields present in staging
$stagingContent = Get-Content -LiteralPath $skillMd -Raw -Encoding UTF8
foreach ($field in @('version:', 'requires:', 'changelog:')) {
    if ($stagingContent -notmatch "(?m)^$field") {
        Write-Error "Staging SKILL.md missing required field '$field'"
        exit 1
    }
}

$timestamp = Get-Date -Format "yyyy-MM-ddTHH-mm-ss"
$results = [System.Collections.Generic.List[psobject]]::new()

foreach ($prodRoot in $ProductionRoots) {
    if (-not (Test-Path -LiteralPath $prodRoot)) {
        $results.Add([PSCustomObject]@{
            root    = $prodRoot
            action  = "skipped"
            reason  = "root not found"
            backup  = ""
            verified = $false
        })
        continue
    }

    $prodSkill  = Join-Path $prodRoot $Name
    $backupRoot = Join-Path $prodRoot ".backups"
    $backupPath = Join-Path $backupRoot "${Name}_${timestamp}"

    # 2. Backup current production skill
    if (Test-Path -LiteralPath $prodSkill) {
        New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
        Copy-Item -LiteralPath $prodSkill -Destination $backupPath -Recurse -Force
    }

    # 3. Copy staging -> production (replace entirely)
    if (Test-Path -LiteralPath $prodSkill) {
        Remove-Item -LiteralPath $prodSkill -Recurse -Force
    }
    Copy-Item -Path $stagingSkill -Destination $prodSkill -Recurse -Force

    # 4. Verify
    $promoted = Join-Path $prodSkill "SKILL.md"
    $ok = Test-Path -LiteralPath $promoted
    if ($ok) {
        $c = Get-Content -LiteralPath $promoted -Raw -Encoding UTF8
        $ok = ($c -match '(?m)^version:') -and ($c -match '(?m)^requires:') -and ($c -match '(?m)^changelog:')
    }

    $results.Add([PSCustomObject]@{
        root     = $prodRoot
        action   = "promoted"
        reason   = ""
        backup   = if ($backupPath -and (Test-Path -LiteralPath $backupPath)) { $backupPath } else { "" }
        verified = $ok
    })
}

# 5. Audit log (JSONL append)
$entry = [PSCustomObject]@{
    ts      = $timestamp
    skill   = $Name
    action  = "promote"
    results = $results
} | ConvertTo-Json -Compress -Depth 5
Add-Content -LiteralPath $AuditLog -Value $entry -Encoding UTF8

$results | Format-Table root, action, reason, verified -AutoSize

$failures = $results | Where-Object { $_.action -eq "promoted" -and -not $_.verified }
if ($failures) {
    Write-Error "Verification failed for: $($failures.root -join ', ')"
    exit 1
}

Write-Output "Promote complete: $Name @ $timestamp"
