param(
    [string[]]$Roots = @(
        "$HOME\.claude\skills",
        "$HOME\.codex\skills",
        "$HOME\.gemini\skills"
    ),
    [string]$Version = "1.0.0",
    [string]$ReleaseDate = "2026-04-22"
)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Get-DescriptionFromBody {
    param([string]$Body, [string]$Name)

    foreach ($rawLine in ($Body -split '\r?\n')) {
        $line = $rawLine.Trim()
        if (-not $line) {
            continue
        }
        if ($line.StartsWith('```')) {
            continue
        }
        if ($line.StartsWith('>')) {
            return $line.TrimStart('>').Trim()
        }
        if ($line.StartsWith('#')) {
            continue
        }
        return $line
    }

    return "Skill workflow for $Name."
}

function Update-SkillFile {
    param([string]$Path)

    $content = Get-Content -Raw -Encoding UTF8 $Path
    $match = [regex]::Match($content, '\A---\r?\n(.*?)\r?\n---\r?\n?', 'Singleline')
    if ($match.Success) {
        $frontmatter = $match.Groups[1].Value
        $body = $content.Substring($match.Length)
        $lines = [System.Collections.Generic.List[string]]::new()
        foreach ($line in ($frontmatter -split '\r?\n')) {
            $lines.Add($line)
        }
    } else {
        $body = $content
        $name = Split-Path (Split-Path $Path -Parent) -Leaf
        $description = Get-DescriptionFromBody -Body $body -Name $name
        $lines = [System.Collections.Generic.List[string]]::new()
        if ($Path -match '[\\/]\.gemini[\\/]skills[\\/]') {
            $lines.Add('category: general')
        }
        $lines.Add("name: $name")
        $lines.Add("description: $description")
        $frontmatter = [string]::Join("`n", $lines)
    }

    if ($frontmatter -notmatch '(?m)^version:') {
        $lines.Add("version: $Version")
    }
    if ($frontmatter -notmatch '(?m)^requires:') {
        $lines.Add("requires: []")
    }
    if ($frontmatter -notmatch '(?m)^changelog:') {
        $lines.Add("changelog:")
        $lines.Add("  - $Version ($ReleaseDate): initialize semver metadata")
    }

    $newFrontmatter = [string]::Join("`n", $lines)
    $newContent = "---`n$newFrontmatter`n---`n$body"
    if ($newContent -eq $content) {
        return $false
    }

    [System.IO.File]::WriteAllText($Path, $newContent, $utf8NoBom)
    return $true
}

$summary = foreach ($root in $Roots) {
    $updated = 0
    $scanned = 0

    if (-not (Test-Path $root)) {
        [PSCustomObject]@{ root = $root; scanned = 0; updated = 0; missing = $true }
        continue
    }

    foreach ($dir in Get-ChildItem -Directory $root) {
        $skillPath = Join-Path $dir.FullName "SKILL.md"
        if (-not (Test-Path $skillPath)) {
            continue
        }

        $scanned++
        if (Update-SkillFile -Path $skillPath) {
            $updated++
        }
    }

    [PSCustomObject]@{ root = $root; scanned = $scanned; updated = $updated; missing = $false }
}

$summary | Format-Table -AutoSize
