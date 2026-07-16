param(
    [string]$Source = (Join-Path $PSScriptRoot "init-project\SKILL.md"),
    [string[]]$Roots = @(
        "$HOME\.claude\skills",
        "$HOME\.codex\skills",
        "$HOME\.gemini\skills"
    )
)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Normalize-Newlines {
    param([string]$Text)
    return (($Text -replace "`r`n", "`n") -replace "`r", "`n")
}

if (-not (Test-Path -LiteralPath $Source)) {
    throw "Source init-project SKILL.md not found: $Source"
}

$sourceContent = Get-Content -LiteralPath $Source -Raw -Encoding UTF8
$summary = foreach ($root in $Roots) {
    if (-not (Test-Path -LiteralPath $root)) {
        [PSCustomObject]@{ root = $root; path = ""; updated = $false; missingRoot = $true }
        continue
    }

    $targetDir = Join-Path $root "init-project"
    $targetPath = Join-Path $targetDir "SKILL.md"

    if (-not (Test-Path -LiteralPath $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }

    $before = if (Test-Path -LiteralPath $targetPath) {
        Get-Content -LiteralPath $targetPath -Raw -Encoding UTF8
    } else {
        ""
    }

    $updated = (Normalize-Newlines $before) -ne (Normalize-Newlines $sourceContent)
    if ($updated) {
        [System.IO.File]::WriteAllText($targetPath, ($sourceContent -replace "`r?`n", "`r`n"), $utf8NoBom)
    }

    [PSCustomObject]@{ root = $root; path = $targetPath; updated = $updated; missingRoot = $false }
}

$summary | Format-Table -AutoSize
