# Security Policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not include API keys, access tokens, private model prompts, or sensitive model files in a public issue.

## Secret handling

- API keys live only in the local app-data config file, with owner-only permissions on Unix, or in browser `localStorage` for Web Studio. They are sent directly to the chosen provider.
- Errors scrub keys, and keys are never written to the operation log.
- Sign-in CLI providers (Claude Code, Codex CLI, Gemini CLI, OpenCode, Antigravity) use the existing login owned by each CLI and require no provider API key in this application.
- Ollama and LM Studio are local endpoints and require no API key. A custom OpenAI-compatible endpoint may use a key if the endpoint requires one.
- Environment variables are accepted for optional Gemini and OpenAI keys.
- Browser calls send Gemini keys in the `x-goog-api-key` header, not in the URL.
- Every CLI runs without a shell, in a temporary folder, with tools disabled or read-only where the CLI allows it, and with process timeouts and cancellation.
- Links open through a command that accepts `https` only.
- Output-file reads validate names and remain inside the selected output directory.
- `.env`, local settings, credentials, private keys, build artifacts, and executables are excluded by `.gitignore`.
- CI scans every push and pull request with Gitleaks.

If a credential is committed accidentally, revoke it immediately before removing it from Git history.
