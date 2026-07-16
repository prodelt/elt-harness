param(
    [string[]]$Roots = @(
        "$HOME\.claude\skills",
        "$HOME\.codex\skills",
        "$HOME\.gemini\skills"
    )
)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Normalize-Newlines {
    param([string]$Text)
    return ($Text -replace "`r`n", "`n" -replace "`r", "`n")
}

function Write-Utf8NoBom {
    param(
        [string]$Path,
        [string]$Content
    )

    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Replace-OrThrow {
    param(
        [string]$Content,
        [string]$Old,
        [string]$New,
        [string]$Label,
        [string]$Path
    )

    if ($Content.Contains($New)) {
        return $Content
    }

    if (-not $Content.Contains($Old)) {
        throw "Anchor not found for $Label in $Path"
    }

    return $Content.Replace($Old, $New)
}

function Ensure-LineReplacement {
    param(
        [string]$Content,
        [string]$Old,
        [string]$New,
        [string]$Label,
        [string]$Path
    )

    if ($Content.Contains($New)) {
        return $Content
    }

    return Replace-OrThrow $Content $Old $New $Label $Path
}

function Prepend-ChangelogEntry {
    param(
        [string]$Content,
        [string]$Entry,
        [string]$Path
    )

    if ($Content.Contains($Entry)) {
        return $Content
    }

    $anchor = "changelog:`n"
    $index = $Content.IndexOf($anchor)
    if ($index -lt 0) {
        throw "Anchor not found for changelog in $Path"
    }

    $insertAt = $index + $anchor.Length
    return $Content.Substring(0, $insertAt) + $Entry + "`n" + $content.Substring($insertAt)
}

function Insert-BeforeAnchor {
    param(
        [string]$Content,
        [string[]]$Anchors,
        [string]$Block,
        [string]$Label,
        [string]$Path
    )

    foreach ($anchor in $Anchors) {
        $index = $Content.IndexOf($anchor)
        if ($index -ge 0) {
            return $Content.Substring(0, $index) + $Block + $Content.Substring($index)
        }
    }

    throw "Anchor not found for $Label in $Path"
}

function Update-PipelineSkill {
    param([string]$Path)

    $content = Normalize-Newlines (Get-Content -Raw -Encoding UTF8 $Path)
    $content = Ensure-LineReplacement $content "version: 1.0.0" "version: 1.1.0" "pipeline version" $Path
    $content = Prepend-ChangelogEntry $content "  - 1.1.0 (2026-04-22): add declarative dependency gate for required sub-skills" $Path
    $content = Replace-OrThrow $content @'
  "checkpoints": [{ "phase": "classified", "ts": "<ISO>" }],
'@ @'
  "checkpoints": [{ "phase": "classified", "skill": "pipeline", "ts": "<ISO>" }],
'@ "pipeline classified checkpoint example" $Path

    $dependencyHeader = "## Step 2.5 - Dependency gate (B15)"
    if (-not $content.Contains($dependencyHeader)) {
        $anchor = "## Step 3"
        $anchorIndex = $content.IndexOf($anchor)
        if ($anchorIndex -lt 0) {
            throw "Anchor not found for pipeline dependency gate in $Path"
        }

        $dependencyGate = @'
## Step 2.5 - Dependency gate (B15)

Before ANY `Skill(skill="...")` call:
1. Read the target skill frontmatter from `~/.claude/skills/<skill>/SKILL.md`.
2. Parse `requires:` from that frontmatter.
3. Resolve prerequisites against `~/.claude/pipeline-state.json`:
   - `architect-first` is satisfied by `phase/checkpoint = architected|implementing|reviewed|shipped`
   - `sprint` is satisfied by `implementing|reviewed|shipped`
   - `inline-review` is satisfied by `reviewed|shipped`
   - explicit `checkpoints[].skill` entries also satisfy the matching requirement
4. If a prerequisite is missing: emit an advisory, do NOT silently invoke the dependent skill, and either run the missing prerequisite first or get explicit user override.

'@
        $content = $content.Substring(0, $anchorIndex) + $dependencyGate + $content.Substring($anchorIndex)
    }

    $content = Replace-OrThrow $content @'
**After each sub-skill returns:** append a checkpoint entry to `~/.claude/pipeline-state.json.checkpoints[]` with `{ phase, ts }` before starting the next phase. This is the only way the orchestrator verifies sub-skills actually ran.
'@ @'
**After each sub-skill returns:** append a checkpoint entry to `~/.claude/pipeline-state.json.checkpoints[]` with `{ phase, skill, ts }` before starting the next phase. This is how the orchestrator verifies sub-skills actually ran AND resolves declarative `requires:` dependencies later in the run.
'@ "pipeline checkpoint payload" $Path
    $content = Replace-OrThrow $content @'
2. Update their own phase + checkpoints when done.
'@ @'
2. Update their own phase + checkpoints when done, including `skill: "<skill-name>"` in appended checkpoints.
'@ "pipeline sub-skill protocol" $Path
    Write-Utf8NoBom $Path ($content -replace "`n", "`r`n")
}

function Update-SprintSkill {
    param([string]$Path)

    $content = Normalize-Newlines (Get-Content -Raw -Encoding UTF8 $Path)
    $content = Ensure-LineReplacement $content "version: 1.0.0" "version: 1.1.0" "sprint version" $Path
    $content = Ensure-LineReplacement $content "requires: []" "requires: [architect-first]" "sprint requires" $Path
    $content = Prepend-ChangelogEntry $content "  - 1.1.0 (2026-04-22): require architect-first before sprint execution" $Path
    $sprintPipelineState = @'
## pipeline-state (B14)
If `~/.claude/pipeline-state.json` exists, its `cwd` matches current project, and `ts` is within 24h -> read `task`, `commands.test`, `commands.lint`, `stack` from it. Use those for verification between tasks instead of re-asking. After the sprint completes, append `{ "phase": "implementing", "skill": "sprint", "ts": "<ISO>" }` to `checkpoints[]`.

'@
    if ($content.Contains('append `{ "phase": "implementing", "ts": "<ISO>" }` to `checkpoints[]`.')) {
        $content = Replace-OrThrow $content 'append `{ "phase": "implementing", "ts": "<ISO>" }` to `checkpoints[]`.' 'append `{ "phase": "implementing", "skill": "sprint", "ts": "<ISO>" }` to `checkpoints[]`.' "sprint checkpoint payload" $Path
    } elseif (-not $content.Contains('append `{ "phase": "implementing", "skill": "sprint", "ts": "<ISO>" }` to `checkpoints[]`.')) {
        $content = Insert-BeforeAnchor $content @("## RULES", "## Core Rule", "## Trigger", "## WORKFLOW") $sprintPipelineState "sprint pipeline-state insert" $Path
    }

    $dependencyHeader = "## Dependency Advisory (B15)"
    if (-not $content.Contains($dependencyHeader)) {
        $dependencySection = @'
## Dependency Advisory (B15)
- Read your own frontmatter `requires:` before starting.
- If `architect-first` is required and `~/.claude/pipeline-state.json` lacks an `architected` phase/checkpoint (or `checkpoints[].skill = "architect-first"`), emit advisory: `Prerequisite missing: architect-first. Run /architect-first or /pipeline first.`
- For COMPLEX work, do NOT silently continue past a missing prerequisite; ask for explicit override.

'@
        $content = Insert-BeforeAnchor $content @("## RULES", "## Core Rule", "## Trigger", "## Per-Task Flow", "## WORKFLOW") $dependencySection "sprint dependency advisory" $Path
    }

    Write-Utf8NoBom $Path ($content -replace "`n", "`r`n")
}

function Update-ArchitectSkill {
    param([string]$Path)

    $content = Normalize-Newlines (Get-Content -Raw -Encoding UTF8 $Path)
    $content = Ensure-LineReplacement $content "version: 1.0.0" "version: 1.0.1" "architect-first version" $Path
    $content = Prepend-ChangelogEntry $content "  - 1.0.1 (2026-04-22): append explicit skill name in pipeline checkpoints" $Path
    $architectPipelineState = @'
## pipeline-state (B14)
If `~/.claude/pipeline-state.json` exists, its `cwd` matches current project, and `ts` is within 24h -> read `task`, `stack`, `commands`, `domain` from it. Do NOT re-parse CLAUDE.md for those. After this skill completes, append `{ "phase": "architected", "skill": "architect-first", "ts": "<ISO>" }` to `checkpoints[]` and set `phase=architected`.

'@
    if ($content.Contains('append `{ "phase": "architected", "ts": "<ISO>" }` to `checkpoints[]` and set `phase=architected`.')) {
        $content = Replace-OrThrow $content 'append `{ "phase": "architected", "ts": "<ISO>" }` to `checkpoints[]` and set `phase=architected`.' 'append `{ "phase": "architected", "skill": "architect-first", "ts": "<ISO>" }` to `checkpoints[]` and set `phase=architected`.' "architect-first checkpoint payload" $Path
    } elseif (-not $content.Contains('append `{ "phase": "architected", "skill": "architect-first", "ts": "<ISO>" }` to `checkpoints[]` and set `phase=architected`.')) {
        $content = Insert-BeforeAnchor $content @("## Quality Gates", "## Trigger", "## Behavior") $architectPipelineState "architect-first pipeline-state insert" $Path
    }
    Write-Utf8NoBom $Path ($content -replace "`n", "`r`n")
}

function Update-InlineReviewSkill {
    param([string]$Path)

    $content = Normalize-Newlines (Get-Content -Raw -Encoding UTF8 $Path)
    $content = Ensure-LineReplacement $content "version: 1.0.0" "version: 1.0.1" "inline-review version" $Path
    $content = Prepend-ChangelogEntry $content "  - 1.0.1 (2026-04-22): append explicit skill name in pipeline checkpoints" $Path
    $inlineReviewPipelineState = @'
## pipeline-state (B14)
If `~/.claude/pipeline-state.json` exists, `cwd` matches, and `ts` < 24h old -> read `task`, `domain`, `stack` from it for scope and focus. Skip re-reading CLAUDE.md for these fields. After review completes, append `{ "phase": "reviewed", "skill": "inline-review", "ts": "<ISO>" }` to `checkpoints[]`.

'@
    if ($content.Contains('append `{ "phase": "reviewed", "ts": "<ISO>" }` to `checkpoints[]`.')) {
        $content = Replace-OrThrow $content 'append `{ "phase": "reviewed", "ts": "<ISO>" }` to `checkpoints[]`.' 'append `{ "phase": "reviewed", "skill": "inline-review", "ts": "<ISO>" }` to `checkpoints[]`.' "inline-review checkpoint payload" $Path
    } elseif (-not $content.Contains('append `{ "phase": "reviewed", "skill": "inline-review", "ts": "<ISO>" }` to `checkpoints[]`.')) {
        $content = Insert-BeforeAnchor $content @("## When to Use", "## Trigger", "## Workflow", "## Behavior") $inlineReviewPipelineState "inline-review pipeline-state insert" $Path
    }
    Write-Utf8NoBom $Path ($content -replace "`n", "`r`n")
}

function Update-StateSchema {
    param([string]$Path)

    $content = Normalize-Newlines (Get-Content -Raw -Encoding UTF8 $Path)
    $content = Replace-OrThrow $content @'
  "checkpoints": [
    { "phase": "classified",  "ts": "2026-04-17T22:00:00Z" },
    { "phase": "architected", "ts": "2026-04-17T22:15:00Z" }
  ],
'@ @'
  "checkpoints": [
    { "phase": "classified",  "skill": "pipeline",         "ts": "2026-04-17T22:00:00Z" },
    { "phase": "architected", "skill": "architect-first", "ts": "2026-04-17T22:15:00Z" }
  ],
'@ "state-schema checkpoints example" $Path
    $content = Replace-OrThrow $content @'
3. **Update (by each sub-skill):** Append to `checkpoints[]` when step completes. Update `phase`.
'@ @'
3. **Update (by each sub-skill):** Append to `checkpoints[]` when step completes, including `skill` when known. Update `phase`.
'@ "state-schema lifecycle" $Path

    $dependencyHeader = "## Dependency resolution (B15)"
    if (-not $content.Contains($dependencyHeader)) {
        $appendix = @'
## Dependency resolution (B15)

- Declarative skill prerequisites live in `SKILL.md` frontmatter as `requires: [...]`.
- `/pipeline` resolves those prerequisites against `phase`, `checkpoints[].phase`, and `checkpoints[].skill`.
- Recommended mapping:
  - `architect-first` <- `architected | implementing | reviewed | shipped`
  - `sprint` <- `implementing | reviewed | shipped`
  - `inline-review` <- `reviewed | shipped`
- If a prerequisite is missing, emit advisory before invoking the dependent skill.
'@
        $content = $content.TrimEnd("`n") + "`n`n" + $appendix
    }

    Write-Utf8NoBom $Path ($content -replace "`n", "`r`n")
}

$summary = foreach ($root in $Roots) {
    if (-not (Test-Path $root)) {
        [PSCustomObject]@{ root = $root; updated = 0; missing = $true }
        continue
    }

    $updated = 0
    $pipelinePath = Join-Path $root "pipeline\SKILL.md"
    $sprintPath = Join-Path $root "sprint\SKILL.md"
    $architectPath = Join-Path $root "architect-first\SKILL.md"
    $inlineReviewPath = Join-Path $root "inline-review\SKILL.md"
    $stateSchemaPath = Join-Path $root "pipeline\state-schema.md"

    if (Test-Path $pipelinePath) {
        Update-PipelineSkill $pipelinePath
        $updated++
    }
    if (Test-Path $sprintPath) {
        Update-SprintSkill $sprintPath
        $updated++
    }
    if (Test-Path $architectPath) {
        Update-ArchitectSkill $architectPath
        $updated++
    }
    if (Test-Path $inlineReviewPath) {
        Update-InlineReviewSkill $inlineReviewPath
        $updated++
    }
    if (Test-Path $stateSchemaPath) {
        Update-StateSchema $stateSchemaPath
        $updated++
    }

    [PSCustomObject]@{ root = $root; updated = $updated; missing = $false }
}

$summary | Format-Table -AutoSize
