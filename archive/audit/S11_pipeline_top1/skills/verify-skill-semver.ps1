param(
    [string[]]$Roots = @(
        "$HOME\.claude\skills",
        "$HOME\.codex\skills",
        "$HOME\.gemini\skills"
    )
)

$failures = [System.Collections.Generic.List[string]]::new()

foreach ($root in $Roots) {
    if (-not (Test-Path $root)) {
        $failures.Add("MISSING ROOT: $root")
        continue
    }

    $checked = 0
    foreach ($dir in Get-ChildItem -Directory $root) {
        $skillPath = Join-Path $dir.FullName "SKILL.md"
        if (-not (Test-Path $skillPath)) {
            continue
        }

        $checked++
        $content = Get-Content -Raw -Encoding UTF8 $skillPath
        if ($content -notmatch '(?m)^version:') {
            $failures.Add("Missing version: $skillPath")
        }
        if ($content -notmatch '(?m)^requires:') {
            $failures.Add("Missing requires: $skillPath")
        }
        if ($content -notmatch '(?m)^changelog:') {
            $failures.Add("Missing changelog: $skillPath")
        }
    }

    Write-Output ("{0} -> {1} skill files checked" -f $root, $checked)
}

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Output "SemVer metadata present in all checked SKILL.md files."
