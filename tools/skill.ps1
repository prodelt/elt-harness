$Script = Join-Path $PSScriptRoot 'skill-search.js'
if (-not (Test-Path -LiteralPath $Script)) {
  $Script = 'C:\Claude playground\Pipiline setupper\tools\skill-search.js'
}
node $Script @args
