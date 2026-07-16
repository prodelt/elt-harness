param(
    [string]$Source = (Join-Path $PSScriptRoot "token-budget.js"),
    [string]$HooksDir = "$HOME\.claude\hooks"
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path -LiteralPath $Source)) {
    throw "Source token budget hook not found: $Source"
}

if (-not (Test-Path -LiteralPath $HooksDir)) {
    New-Item -ItemType Directory -Path $HooksDir -Force | Out-Null
}

$target = Join-Path $HooksDir "token-budget.js"
$sourceContent = Get-Content -LiteralPath $Source -Raw -Encoding UTF8
$before = if (Test-Path -LiteralPath $target) { Get-Content -LiteralPath $target -Raw -Encoding UTF8 } else { "" }
$updated = (($before -replace "`r`n", "`n") -ne ($sourceContent -replace "`r`n", "`n"))

if ($updated) {
    [System.IO.File]::WriteAllText($target, ($sourceContent -replace "`r?`n", "`r`n"), $utf8NoBom)
}

[PSCustomObject]@{
    hookPath = $target
    updated = $updated
} | Format-List
