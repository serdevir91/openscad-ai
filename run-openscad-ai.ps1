param(
  [Parameter(Position = 0)]
  [string]$Prompt = "",

  [string]$Name = "model",
  [string]$OutputDir = "outputs",
  [ValidateSet("openai", "codex", "ollama", "gemini")]
  [string]$Provider = "gemini",
  [string]$Model = "",
  [string]$GeminiKey = "",
  [string]$CodexKey = "",
  [switch]$SyncDocs,
  [switch]$SyncDocsOnly,
  [switch]$NoDocContext
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = Join-Path $scriptDir "prompt_to_openscad.py"

if (-not (Test-Path $py)) {
  Write-Error "Script not found: $py"
  exit 1
}

if (-not $SyncDocsOnly -and [string]::IsNullOrWhiteSpace($Prompt)) {
  Write-Error "Prompt is required unless -SyncDocsOnly is used."
  exit 1
}

$args = @(
  $py
  "--provider", $Provider
  "--output-dir", $OutputDir
  "--name", $Name
)

if (-not $Model) {
  switch ($Provider) {
    "gemini" { $Model = "gemini-3.1-flash-lite-preview" }
    "codex" { $Model = "gpt-5.3-codex" }
    "openai" { $Model = "gpt-4.1-mini" }
    "ollama" { $Model = "qwen2.5-coder:7b" }
  }
}

$args += @("--model", $Model)

if ($GeminiKey) {
  $args += @("--gemini-key", $GeminiKey)
}

if ($CodexKey) {
  $args += @("--codex-key", $CodexKey)
}

if ($SyncDocs) {
  $args += "--sync-docs"
}

if ($SyncDocsOnly) {
  $args += "--sync-docs-only"
}

if ($NoDocContext) {
  $args += "--no-doc-context"
}

if (-not $SyncDocsOnly) {
  $args += $Prompt
}

python @args
exit $LASTEXITCODE
