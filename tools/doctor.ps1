$Script = Join-Path $PSScriptRoot 'doctor.js'
if (-not (Test-Path -LiteralPath $Script)) {
  $Script = 'C:\Claude playground\Pipiline setupper\tools\doctor.js'
}
node $Script @args
