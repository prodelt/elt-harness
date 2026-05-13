param(
    [string]$Source = (Join-Path $PSScriptRoot "inline-review-gate.js"),
    [string]$Target = "$HOME\.claude\hooks\inline-review-gate.js"
)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Normalize-Newlines {
    param([string]$Text)
    return (($Text -replace "`r`n", "`n") -replace "`r", "`n")
}

if (-not (Test-Path -LiteralPath $Source)) {
    throw "Source inline-review-gate.js not found: $Source"
}

$targetDir = Split-Path -Parent $Target
if (-not (Test-Path -LiteralPath $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

$sourceContent = Get-Content -LiteralPath $Source -Raw -Encoding UTF8
$before = if (Test-Path -LiteralPath $Target) {
    Get-Content -LiteralPath $Target -Raw -Encoding UTF8
} else {
    ""
}

$updated = (Normalize-Newlines $before) -ne (Normalize-Newlines $sourceContent)
if ($updated) {
    [System.IO.File]::WriteAllText($Target, ($sourceContent -replace "`r?`n", "`r`n"), $utf8NoBom)
}

[PSCustomObject]@{
    path = $Target
    updated = $updated
} | Format-List
