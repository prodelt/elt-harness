param(
    [string]$Source = (Join-Path $PSScriptRoot "USAGE.md"),
    [string[]]$Roots = @(
        "$HOME\.claude\skills\skill-anything",
        "$HOME\.codex\skills\skill-anything",
        "$HOME\.gemini\skills\skill-anything"
    )
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path -LiteralPath $Source)) {
    throw "Usage source not found: $Source"
}

$sourceContent = Get-Content -LiteralPath $Source -Raw -Encoding UTF8
$results = @()

foreach ($root in $Roots) {
    if (-not (Test-Path -LiteralPath $root)) {
        $results += [PSCustomObject]@{ root = $root; updated = $false; skipped = $true }
        continue
    }

    $target = Join-Path $root "USAGE.md"
    $before = if (Test-Path -LiteralPath $target) { Get-Content -LiteralPath $target -Raw -Encoding UTF8 } else { "" }
    $updated = (($before -replace "`r`n", "`n") -ne ($sourceContent -replace "`r`n", "`n"))

    if ($updated) {
        [System.IO.File]::WriteAllText($target, ($sourceContent -replace "`r?`n", "`r`n"), $utf8NoBom)
    }

    $results += [PSCustomObject]@{ root = $root; updated = $updated; skipped = $false }
}

$results | Format-Table -AutoSize
