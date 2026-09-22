use super::*;
use base64::Engine;
use std::path::PathBuf;
use tokio::io::AsyncWriteExt;

pub struct Codex;

pub fn detect(explicit: &str) -> Result<PathBuf, String> {
    if !explicit.trim().is_empty() && explicit != "codex" {
        return which::which(explicit.trim())
            .map_err(|_| "The Codex executable path was not found".into());
    }
    if let Ok(path) = which::which("codex") {
        if !cfg!(windows) || path.extension().is_some_and(|s| s == "exe") {
            return Ok(path);
        }
    }
    // npm exposes a .cmd/.ps1 shim on Windows. Invoke the real binary without a shell.
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let root = PathBuf::from(appdata).join("npm/node_modules/@openai/codex");
        for arch in ["x86_64", "aarch64"] {
            let package = if arch == "x86_64" {
                "codex-win32-x64"
            } else {
                "codex-win32-arm64"
            };
            for candidate in [
                root.join(format!(
                    "node_modules/@openai/{package}/vendor/{arch}-pc-windows-msvc/codex/codex.exe"
                )),
                root.join(format!("vendor/{arch}-pc-windows-msvc/codex/codex.exe")),
            ] {
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
    }
    Err("Codex CLI was not found. Install it and sign in, or select the full codex.exe path in Settings.".into())
}

#[async_trait::async_trait]
impl Provider for Codex {
    async fn generate(
        &self,
        config: &Config,
        prompt: &str,
        image: Option<&Image>,
    ) -> Result<String, String> {
        let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
        let output = dir.path().join("answer.txt");
        let mut cmd = crate::openscad::command(detect(&config.codex_path)?);
        cmd.current_dir(dir.path())
            .args([
                "exec",
                "--skip-git-repo-check",
                "--sandbox",
                "read-only",
                "--ephemeral",
                "--model",
            ])
            .arg(&config.model)
            .arg("--output-last-message")
            .arg(&output);
        if let Some(image) = image {
            let file = dir.path().join(match image.mime.as_str() {
                "image/jpeg" => "reference.jpg",
                "image/webp" => "reference.webp",
                _ => "reference.png",
            });
            tokio::fs::write(
                &file,
                base64::engine::general_purpose::STANDARD
                    .decode(&image.data)
                    .map_err(|_| "Invalid image")?,
            )
            .await
            .map_err(|e| e.to_string())?;
            cmd.arg("--image").arg(file);
        }
        cmd.arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        let mut child = cmd
            .spawn()
            .map_err(|_| "Codex could not be started; check the executable path")?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or("Codex stdin could not be opened")?;
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        drop(stdin);
        let status = tokio::time::timeout(std::time::Duration::from_secs(240), child.wait())
            .await
            .map_err(|_| "Codex timed out after 240 seconds")?
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Codex failed; check your CLI login and model access".into());
        }
        text(Some(
            &tokio::fs::read_to_string(output)
                .await
                .map_err(|e| e.to_string())?,
        ))
    }
}
