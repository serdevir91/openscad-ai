$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ui = Join-Path $scriptDir "openscad_ai_ui.py"

if (-not (Test-Path $ui)) {
  Write-Error "UI script not found: $ui"
  exit 1
}

python $ui
exit $LASTEXITCODE

