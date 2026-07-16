param(
    [Parameter(Mandatory)]
    [string]$Name,

    [string[]]$ProductionRoots = @(
        "$HOME\.claude\skills",
        "$HOME\.codex\skills",
        "$HOME\.gemini\skills"
    ),

    [string]$AuditLog = (Join-Path $PSScriptRoot "promote.log")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$timestamp = Get-Date -Format "yyyy-MM-ddTHH-mm-ss"
$results   = [System.Collections.Generic.List[psobject]]::new()

foreach ($prodRoot in $ProductionRoots) {
    if (-not (Test-Path -LiteralPath $prodRoot)) {
        $results.Add([PSCustomObject]@{
            root   = $prodRoot
            action = "skipped"
            reason = "root not found"
            from   = ""
        })
        continue
    }

    $prodSkill  = Join-Path $prodRoot $Name
    $backupRoot = Join-Path $prodRoot ".backups"

    # Find latest backup for this skill (lexicographic desc = newest first)
    # @() ensures array even when Get-ChildItem returns a single object (StrictMode safe)
    $backups = @(Get-ChildItem -Path $backupRoot -Filter "${Name}_*" -Directory -ErrorAction SilentlyContinue |
               Sort-Object Name -Descending)

    if ($backups.Count -eq 0) {
        $results.Add([PSCustomObject]@{
            root   = $prodRoot
            action = "skipped"
            reason = "no backup found"
            from   = ""
        })
        continue
    }

    $latestBackup = $backups[0].FullName

    # Restore: remove current production, copy backup in
    if (Test-Path -LiteralPath $prodSkill) {
        Remove-Item -LiteralPath $prodSkill -Recurse -Force
    }
    Copy-Item -Path $latestBackup -Destination $prodSkill -Recurse -Force

    $results.Add([PSCustomObject]@{
        root   = $prodRoot
        action = "rolled-back"
        reason = ""
        from   = $latestBackup
    })
}

# Audit log (JSONL append)
$entry = [PSCustomObject]@{
    ts      = $timestamp
    skill   = $Name
    action  = "rollback"
    results = $results
} | ConvertTo-Json -Compress -Depth 5
Add-Content -LiteralPath $AuditLog -Value $entry -Encoding UTF8

$results | Format-Table root, action, reason, from -AutoSize

$failed = @($results | Where-Object { $_.action -eq "skipped" -and $_.reason -eq "no backup found" })
if ($failed.Count -eq $ProductionRoots.Count) {
    Write-Error "Rollback failed: no backups found in any root for skill '$Name'"
    exit 1
}

Write-Output "Rollback complete: $Name @ $timestamp"
