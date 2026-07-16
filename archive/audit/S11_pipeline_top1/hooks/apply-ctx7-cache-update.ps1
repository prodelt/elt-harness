param(
    [string]$SourceRoot = $PSScriptRoot,
    [string]$HooksRoot = "$HOME\.claude\hooks",
    [string]$ClaudeSettings = "$HOME\.claude\settings.json",
    [string]$CodexHooks = "$HOME\.codex\hooks.json"
)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Copy-TextFile {
    param([string]$Source, [string]$Target)
    if (-not (Test-Path -LiteralPath $Source)) {
        throw "Missing source file: $Source"
    }
    $targetDir = Split-Path -Parent $Target
    if (-not (Test-Path -LiteralPath $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }
    $content = Get-Content -LiteralPath $Source -Raw -Encoding UTF8
    [System.IO.File]::WriteAllText($Target, ($content -replace "`r?`n", "`r`n"), $utf8NoBom)
}

Copy-TextFile -Source (Join-Path $SourceRoot "context7-tracker.js") -Target (Join-Path $HooksRoot "context7-tracker.js")
Copy-TextFile -Source (Join-Path $SourceRoot "lib\ctx7-cache.js") -Target (Join-Path $HooksRoot "lib\ctx7-cache.js")

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
    $updated = Ensure-Hook -Config $config -EventName "PreToolUse" -Matcher "Bash" -Command $Command
    if ($updated) {
        $json = $config | ConvertTo-Json -Depth 100
        [System.IO.File]::WriteAllText($Path, ($json -replace "`r?`n", "`r`n"), $utf8NoBom)
    }

    return [PSCustomObject]@{ path = $Path; updated = $updated; missing = $false }
}

$claudeRegistration = Update-HookJson -Path $ClaudeSettings -Command "node `"C:/Users/espad/.claude/hooks/context7-tracker.js`""
$codexRegistration = Update-HookJson -Path $CodexHooks -Command "node C:/Users/espad/.claude/hooks/context7-tracker.js"

[PSCustomObject]@{
    hooksRoot = $HooksRoot
    tracker = Join-Path $HooksRoot "context7-tracker.js"
    cacheLib = Join-Path $HooksRoot "lib\ctx7-cache.js"
    claudePreToolUseUpdated = $claudeRegistration.updated
    codexPreToolUseUpdated = $codexRegistration.updated
    updated = $true
} | Format-List
