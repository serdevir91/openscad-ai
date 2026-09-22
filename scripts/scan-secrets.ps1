$ErrorActionPreference = "Stop"

$patterns = [ordered]@{
    "OpenAI-style key" = "\bsk-[A-Za-z0-9_-]{20,}\b"
    "Google API key" = "\bAIza[0-9A-Za-z_-]{35}\b"
    "GitHub token" = "\b(?:gh[ps]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{70,})\b"
    "AWS access key" = "\bAKIA[0-9A-Z]{16}\b"
    "Slack token" = "\bxox[baprs]-[0-9A-Za-z-]{20,}\b"
    "Private key" = "-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----"
    "Credential URL" = "(?:postgres|postgresql|mysql|mongodb|redis|rediss)://[^\s:/]+:[^\s@]+@"
}

$files = @(git diff --cached --name-only --diff-filter=ACMR)
$findings = @()
foreach ($file in $files) {
    if ($file -eq "scripts/scan-secrets.ps1") { continue }
    $content = git show ":$file" 2>$null | Out-String
    foreach ($entry in $patterns.GetEnumerator()) {
        if ($content -match $entry.Value) {
            $findings += "$($entry.Key): $file"
        }
    }
}

if ($findings.Count -gt 0) {
    Write-Error ("Commit blocked. Possible secrets found:`n" + ($findings -join "`n"))
    exit 1
}

Write-Host "Secret scan passed for $($files.Count) staged files."
