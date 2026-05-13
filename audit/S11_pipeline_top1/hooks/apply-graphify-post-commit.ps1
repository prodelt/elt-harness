param(
    [string]$Source = (Join-Path $PSScriptRoot "graphify-post-commit.js"),
    [string]$HooksDir = "$HOME\.claude\hooks",
    [string]$ClaudeSettings = "$HOME\.claude\settings.json",
    [string]$CodexHooks = "$HOME\.codex\hooks.json"
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Copy-TextFile {
    param([string]$SourcePath, [string]$TargetPath)
    if (-not (Test-Path -LiteralPath $SourcePath)) {
        throw "Missing source file: $SourcePath"
    }
    $targetDir = Split-Path -Parent $TargetPath
    if (-not (Test-Path -LiteralPath $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }
    $content = Get-Content -LiteralPath $SourcePath -Raw -Encoding UTF8
    [System.IO.File]::WriteAllText($TargetPath, ($content -replace "`r?`n", "`r`n"), $utf8NoBom)
}

function Ensure-Hook {
    param(
        [object]$Config,
        [string]$EventName,
        [string]$Matcher,
        [string]$Command
    )

    if (-not $Config.hooks.$EventName) {
        $Config.hooks | Add-Member -MemberType NoteProperty -Name $EventName -Value @()
    }

    $eventHooks = @($Config.hooks.$EventName)
    $target = $eventHooks | Where-Object { $_.matcher -eq $Matcher } | Select-Object -First 1
    if (-not $target) {
        $target = [PSCustomObject]@{ matcher = $Matcher; hooks = @() }
        $eventHooks = @($eventHooks + $target)
        $Config.hooks.$EventName = $eventHooks
    }

    $exists = @($target.hooks) | Where-Object { $_.command -eq $Command } | Select-Object -First 1
    if (-not $exists) {
        $target.hooks = @($target.hooks + [PSCustomObject]@{ type = "command"; command = $Command })
        return $true
    }

    return $false
}

function Update-HookJson {
    param(
        [string]$Path,
        [string]$Command
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return [PSCustomObject]@{ path = $Path; updated = $false; missing = $true }
    }

    $config = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    $updated = Ensure-Hook -Config $config -EventName "PostToolUse" -Matcher "Bash" -Command $Command
    if ($updated) {
        $json = $config | ConvertTo-Json -Depth 100
        [System.IO.File]::WriteAllText($Path, ($json -replace "`r?`n", "`r`n"), $utf8NoBom)
    }

    return [PSCustomObject]@{ path = $Path; updated = $updated; missing = $false }
}

Copy-TextFile -SourcePath $Source -TargetPath (Join-Path $HooksDir "graphify-post-commit.js")

$claudeRegistration = Update-HookJson -Path $ClaudeSettings -Command "node `"C:/Users/user/.claude/hooks/graphify-post-commit.js`""
$codexRegistration = Update-HookJson -Path $CodexHooks -Command "node C:/Users/user/.claude/hooks/graphify-post-commit.js"

[PSCustomObject]@{
    hookPath = Join-Path $HooksDir "graphify-post-commit.js"
    claudePostToolUseUpdated = $claudeRegistration.updated
    codexPostToolUseUpdated = $codexRegistration.updated
    updated = $true
} | Format-List
