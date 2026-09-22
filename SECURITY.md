# Security Policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not include API keys, access tokens, private model prompts, or sensitive model files in a public issue.

## Secret handling

- Codex CLI uses the user's existing local Codex login and requires no provider API key in this application.
- Ollama connects only to `127.0.0.1:11434` and requires no API key.
- Gemini and OpenAI keys are optional. Environment variables are preferred.
- Local settings are written to the operating system application-data directory, outside the repository.
- `.env`, local settings, credentials, private keys, build artifacts, and executables are excluded by `.gitignore`.
- CI scans every push and pull request with Gitleaks.

If a credential is committed accidentally, revoke it immediately before removing it from Git history.
