param(
    [string]$Source = (Join-Path $PSScriptRoot "coverage-gate.js"),
    [string]$HooksDir = "$HOME\.claude\hooks",
    [string]$ClaudeSettings = "$HOME\.claude\settings.json",
    [string]$CodexHooks = "$HOME\.codex\hooks.json",
    [string]$Command = "node C:/Users/espad/.claude/hooks/coverage-gate.js"
)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Read-JsonFile {
    param([string]$Path)
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Write-JsonFile {
    param([string]$Path, [object]$Value)
    $json = $Value | ConvertTo-Json -Depth 100
    [System.IO.File]::WriteAllText($Path, ($json -replace "`r?`n", "`r`n"), $utf8NoBom)
}

function Ensure-Hook {
    param(
        [object]$Config,
        [string]$Matcher,
        [string]$Command,
        [string]$StatusMessage = ""
    )

    if (-not $Config.hooks) {
        $Config | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{})
    }
    if (-not $Config.hooks.PreToolUse) {
        $Config.hooks | Add-Member -NotePropertyName PreToolUse -NotePropertyValue @()
    }

    $blocks = @($Config.hooks.PreToolUse)
    $block = $blocks | Where-Object { $_.matcher -eq $Matcher } | Select-Object -First 1
    $updated = $false

    if (-not $block) {
        $block = [pscustomobject]@{ matcher = $Matcher; hooks = @() }
        $Config.hooks.PreToolUse = @($Config.hooks.PreToolUse) + $block
        $updated = $true
    }

    $existing = @($block.hooks) | Where-Object { $_.command -eq $Command } | Select-Object -First 1
    if ($existing) {
        return [pscustomobject]@{ updated = $updated; registered = $true }
    }

    $hook = [pscustomobject]@{ type = "command"; command = $Command }
    if ($StatusMessage) {
        $hook | Add-Member -NotePropertyName statusMessage -NotePropertyValue $StatusMessage
    }
    $block.hooks = @($block.hooks) + $hook
    return [pscustomobject]@{ updated = $true; registered = $true }
}

if (-not (Test-Path -LiteralPath $Source)) {
    throw "Source coverage gate not found: $Source"
}
if (-not (Test-Path -LiteralPath $HooksDir)) {
    New-Item -ItemType Directory -Path $HooksDir -Force | Out-Null
}

$target = Join-Path $HooksDir "coverage-gate.js"
$sourceContent = Get-Content -LiteralPath $Source -Raw -Encoding UTF8
$before = if (Test-Path -LiteralPath $target) { Get-Content -LiteralPath $target -Raw -Encoding UTF8 } else { "" }
$hookUpdated = (($before -replace "`r`n", "`n") -ne ($sourceContent -replace "`r`n", "`n"))
if ($hookUpdated) {
    [System.IO.File]::WriteAllText($target, ($sourceContent -replace "`r?`n", "`r`n"), $utf8NoBom)
}

$claudeUpdated = $false
$codexUpdated = $false

if (Test-Path -LiteralPath $ClaudeSettings) {
    $claude = Read-JsonFile $ClaudeSettings
    $claudeCommand = 'node "C:/Users/espad/.claude/hooks/coverage-gate.js"'
    $claudeResult = Ensure-Hook -Config $claude -Matcher "Bash" -Command $claudeCommand -StatusMessage "Checking coverage threshold..."
    if ($claudeResult.updated) {
        Write-JsonFile -Path $ClaudeSettings -Value $claude
    }
    $claudeUpdated = $claudeResult.updated
}

if (Test-Path -LiteralPath $CodexHooks) {
    $codex = Read-JsonFile $CodexHooks
    $codexResult = Ensure-Hook -Config $codex -Matcher "Bash" -Command $Command
    if ($codexResult.updated) {
        Write-JsonFile -Path $CodexHooks -Value $codex
    }
    $codexUpdated = $codexResult.updated
}

[PSCustomObject]@{
    hookPath = $target
    hookUpdated = $hookUpdated
    claudePreToolUseUpdated = $claudeUpdated
    codexPreToolUseUpdated = $codexUpdated
} | Format-List
