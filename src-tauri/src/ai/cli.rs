//! Agent CLIs signed in with the user's own subscription. They run without a shell, inside an
//! empty temporary folder, with their tools off or read-only, under a time limit.
use super::{Completion, Status};
use crate::config::Config;
use serde_json::Value;
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::io::AsyncWriteExt;

struct Cli {
    id: &'static str,
    binary: &'static str,
    /// Executables spawn from the app, so a Windows npm shim is no use. See `real_windows_exe`.
    login: &'static [&'static str],
}

const CLIS: [Cli; 5] = [
    Cli { id: "claude-code", binary: "claude", login: &["auth", "login"] },
    Cli { id: "codex", binary: "codex", login: &["login"] },
    Cli { id: "gemini-cli", binary: "gemini", login: &[] },
    Cli { id: "opencode", binary: "opencode", login: &["auth", "login"] },
    Cli { id: "antigravity", binary: "agy", login: &[] },
];

fn cli(id: &str) -> Result<&'static Cli, String> {
    CLIS.iter().find(|c| c.id == id).ok_or_else(|| "Unknown provider".to_string())
}

pub fn is_cli(id: &str) -> bool {
    CLIS.iter().any(|c| c.id == id)
}

/// Apps opened from Finder or a desktop launcher miss the PATH a shell profile sets.
fn search_path() -> OsString {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from) {
        for sub in [".local/bin", ".opencode/bin", ".claude/local", ".npm-global/bin", ".bun/bin", ".volta/bin", ".cargo/bin"] {
            dirs.push(home.join(sub));
        }
        if let Ok(versions) = std::fs::read_dir(home.join(".nvm/versions/node")) {
            dirs.extend(versions.flatten().map(|v| v.path().join("bin")));
        }
    }
    if !cfg!(windows) {
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
    }
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    std::env::join_paths(dirs).unwrap_or_default()
}

/// npm exposes a .cmd shim on Windows. The real binary runs without a shell.
fn real_windows_exe(binary: &str) -> Option<PathBuf> {
    if binary != "codex" {
        return None;
    }
    let root = PathBuf::from(std::env::var_os("APPDATA")?).join("npm/node_modules/@openai/codex");
    for (arch, package) in [("x86_64", "codex-win32-x64"), ("aarch64", "codex-win32-arm64")] {
        for candidate in [
            root.join(format!("node_modules/@openai/{package}/vendor/{arch}-pc-windows-msvc/codex/codex.exe")),
            root.join(format!("vendor/{arch}-pc-windows-msvc/codex/codex.exe")),
        ] {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

pub fn detect(config: &Config, id: &str) -> Result<PathBuf, String> {
    let spec = cli(id)?;
    let explicit = config.path(id);
    if !explicit.is_empty() {
        let path = PathBuf::from(explicit);
        return if path.is_file() { Ok(path) } else { Err("The path set for this CLI was not found".into()) };
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    let found = which::which_in(spec.binary, Some(search_path()), cwd).ok();
    if let Some(path) = found {
        if !cfg!(windows) || path.extension().is_some_and(|e| e == "exe") {
            return Ok(path);
        }
    }
    if cfg!(windows) {
        if let Some(path) = real_windows_exe(spec.binary) {
            return Ok(path);
        }
    }
    Err(format!("{} was not found. Install it, or set its path in Connections.", spec.binary))
}

pub fn status(config: &Config, id: &str) -> Status {
    match detect(config, id) {
        Ok(path) => Status {
            id: id.into(),
            ready: true,
            detail: "Installed".into(),
            path: Some(path.display().to_string()),
        },
        Err(detail) => Status { id: id.into(), ready: false, detail, path: None },
    }
}

const IMAGE_NOTE: &str = "Reference images are in the current folder. Read them before answering: ";
/// Longest prompt passed as an argument. Windows caps a whole command line at 32 KB.
const MAX_ARGUMENT: usize = 24_000;

fn merged(request: &Completion, images: &[String]) -> String {
    let mut text = String::new();
    if !request.system.is_empty() {
        text.push_str(&request.system);
        text.push_str("\n\n");
    }
    text.push_str(&request.prompt);
    if !images.is_empty() {
        text.push_str("\n\n");
        text.push_str(IMAGE_NOTE);
        text.push_str(&images.join(", "));
    }
    text
}

struct Plan {
    args: Vec<OsString>,
    env: Vec<(&'static str, String)>,
    stdin: Option<String>,
    /// File the CLI writes its answer to, in place of stdout.
    answer_file: Option<PathBuf>,
}

fn plan(id: &str, model: &str, request: &Completion, dir: &Path, images: &[String]) -> Result<Plan, String> {
    let mut args: Vec<OsString> = Vec::new();
    let mut env = Vec::new();
    let mut stdin = Some(merged(request, images));
    let mut answer_file = None;
    let mut push = |values: &[&str]| args.extend(values.iter().map(OsString::from));
    match id {
        "claude-code" => {
            push(&["-p", "--output-format", "json", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "", "--disable-slash-commands"]);
            if images.is_empty() {
                push(&["--tools", ""]);
            } else {
                push(&["--tools", "Read", "--allowedTools", "Read"]);
            }
            if !request.system.is_empty() {
                push(&["--system-prompt", &request.system]);
                let mut prompt = request.prompt.clone();
                if !images.is_empty() {
                    prompt.push_str(&format!("\n\n{IMAGE_NOTE}{}", images.join(", ")));
                }
                stdin = Some(prompt);
            }
            if !model.is_empty() {
                push(&["--model", model]);
            }
        }
        "codex" => {
            let file = dir.join("answer.txt");
            push(&["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral"]);
            if !model.is_empty() {
                push(&["--model", model]);
            }
            args.push("--output-last-message".into());
            args.push(file.clone().into());
            for image in images {
                args.push(format!("--image={}", dir.join(image).display()).into());
            }
            args.push("-".into());
            stdin = Some(merged(request, &[]));
            answer_file = Some(file);
        }
        "gemini-cli" => {
            push(&["-o", "json", "--approval-mode", "default", "-p", "Follow the instructions above."]);
            if !model.is_empty() {
                push(&["-m", model]);
            }
            let tags: Vec<String> = images.iter().map(|name| format!("@{name}")).collect();
            stdin = Some(format!("{}\n{}", merged(request, &[]), tags.join(" ")));
        }
        "opencode" => {
            env.push(("OPENCODE_PERMISSION", r#"{"*":"deny"}"#.to_string()));
            push(&["run", "--format", "json"]);
            if !model.is_empty() {
                push(&["-m", model]);
            }
            for image in images {
                push(&["-f", image]);
            }
            stdin = Some(merged(request, &[]));
        }
        "antigravity" => {
            let text = stdin.take().unwrap_or_default();
            let prompt = if text.len() > MAX_ARGUMENT {
                std::fs::write(dir.join("request.md"), &text).map_err(|e| e.to_string())?;
                "Read request.md in the current folder and answer exactly as it asks. Change no files.".to_string()
            } else {
                text
            };
            push(&["--sandbox", "--mode", "plan", "--output-format", "json", "--disable-slash-commands"]);
            if !model.is_empty() {
                push(&["--model", model]);
            }
            args.push(format!("--print-timeout={}s", request.limit().as_secs()).into());
            args.push("-p".into());
            args.push(prompt.into());
        }
        _ => return Err("Unknown provider".into()),
    }
    Ok(Plan { args, env, stdin, answer_file })
}

fn claude_answer(stdout: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(stdout.trim()).map_err(|_| "Claude Code returned unreadable output".to_string())?;
    let text = value["result"].as_str().unwrap_or_default().to_string();
    if value["is_error"] == true {
        return Err(format!("Claude Code: {}", clip(&text)));
    }
    Ok(text)
}

fn opencode_answer(stdout: &str) -> Result<String, String> {
    let mut text = String::new();
    for line in stdout.lines() {
        let Ok(event) = serde_json::from_str::<Value>(line) else { continue };
        match event["type"].as_str() {
            Some("text") => text.push_str(event["part"]["text"].as_str().unwrap_or_default()),
            Some("error") => {
                let error = &event["error"];
                let message = error["data"]["message"].as_str().or_else(|| error["message"].as_str()).unwrap_or("the run failed");
                return Err(format!("OpenCode: {}", clip(message)));
            }
            _ => {}
        }
    }
    Ok(text)
}

fn gemini_answer(stdout: &str) -> Result<String, String> {
    // Node warnings can come before the JSON, so the object starts at the first brace.
    let start = stdout.find('{').ok_or("Gemini CLI returned unreadable output")?;
    let value: Value = serde_json::from_str(&stdout[start..]).map_err(|_| "Gemini CLI returned unreadable output".to_string())?;
    if let Some(message) = value["error"]["message"].as_str() {
        return Err(format!("Gemini CLI: {}", clip(message)));
    }
    Ok(value["response"].as_str().unwrap_or_default().to_string())
}

fn antigravity_answer(stdout: &str) -> Result<String, String> {
    let start = stdout.find('{').ok_or("Antigravity returned unreadable output")?;
    let value: Value = serde_json::from_str(&stdout[start..]).map_err(|_| "Antigravity returned unreadable output".to_string())?;
    if value["status"] != "SUCCESS" {
        let reason = value["error"].as_str().or_else(|| value["error"]["message"].as_str()).unwrap_or("the run failed");
        return Err(format!("Antigravity: {}", clip(reason)));
    }
    Ok(value["response"].as_str().unwrap_or_default().to_string())
}

fn clip(text: &str) -> String {
    text.trim().chars().take(400).collect()
}

fn command(exe: &Path, dir: &Path) -> tokio::process::Command {
    let mut c = crate::openscad::command(exe);
    c.current_dir(dir).env("PATH", search_path());
    c
}

pub async fn complete(config: &Config, id: &str, request: &Completion) -> Result<String, String> {
    let exe = detect(config, id)?;
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let mut images = Vec::new();
    for (index, image) in request.images.iter().enumerate() {
        let name = image.file_name(index);
        tokio::fs::write(dir.path().join(&name), image.bytes()?).await.map_err(|e| e.to_string())?;
        images.push(name);
    }
    let plan = plan(id, config.model.trim(), request, dir.path(), &images)?;
    let mut c = command(&exe, dir.path());
    c.args(&plan.args)
        .envs(plan.env.iter().map(|(k, v)| (*k, v.as_str())))
        .stdin(if plan.stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = c.spawn().map_err(|_| "The CLI could not be started; check its path in Connections".to_string())?;
    if let (Some(text), Some(mut stdin)) = (&plan.stdin, child.stdin.take()) {
        stdin.write_all(text.as_bytes()).await.map_err(|e| e.to_string())?;
    }
    let output = tokio::time::timeout(request.limit(), child.wait_with_output())
        .await
        .map_err(|_| format!("The CLI timed out after {} seconds", request.limit().as_secs()))?
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    // These report failures as structured output, which beats the exit code for the reason.
    let parsed = match id {
        "claude-code" => claude_answer(&stdout),
        "opencode" => opencode_answer(&stdout),
        "gemini-cli" => gemini_answer(&stdout),
        "antigravity" => antigravity_answer(&stdout),
        _ => Ok(String::new()),
    };
    if !output.status.success() {
        let reason = parsed.err().unwrap_or_else(|| clip(&String::from_utf8_lossy(&output.stderr)));
        return Err(if reason.is_empty() { "The CLI failed; check its sign-in and model access".into() } else { reason });
    }
    match plan.answer_file {
        Some(file) => tokio::fs::read_to_string(file).await.map_err(|e| e.to_string()),
        None => parsed,
    }
}

async fn lines_of(exe: &Path, args: &[&str]) -> Result<String, String> {
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let mut c = command(exe, dir.path());
    c.args(args).stdin(Stdio::null());
    let output = tokio::time::timeout(Duration::from_secs(20), c.output())
        .await
        .map_err(|_| "The CLI did not answer in time".to_string())?
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn model_words(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter_map(|line| line.split_whitespace().next())
        .filter(|word| word.chars().all(|c| c.is_ascii_alphanumeric() || "-_./:".contains(c)) && word.contains(['-', '/']))
        .map(str::to_string)
        .collect()
}

pub async fn models(config: &Config, id: &str) -> Result<Vec<String>, String> {
    let exe = detect(config, id)?;
    match id {
        "opencode" => Ok(model_words(&lines_of(&exe, &["models"]).await?)),
        "antigravity" => Ok(model_words(&lines_of(&exe, &["models"]).await?)),
        "claude-code" => Ok(["opus", "sonnet", "haiku", "claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"].map(str::to_string).to_vec()),
        // Availability follows the signed-in account, and the empty choice uses its default.
        _ => Ok(Vec::new()),
    }
}

fn quoted_for_shell(path: &Path) -> Result<String, String> {
    let text = path.display().to_string();
    if text.contains(['"', '\'', '`', '$', '\\', '\n']) && !cfg!(windows) {
        return Err("The CLI path contains characters that cannot be opened in a terminal".into());
    }
    Ok(format!("'{text}'"))
}

/// Opens a terminal running the CLI's sign-in, the one step that needs the user's browser.
pub fn open_login(config: &Config, id: &str) -> Result<(), String> {
    let spec = cli(id)?;
    let exe = detect(config, id)?;
    #[cfg(target_os = "macos")]
    {
        let mut line = quoted_for_shell(&exe)?;
        for arg in spec.login {
            line.push(' ');
            line.push_str(arg);
        }
        std::process::Command::new("osascript")
            .args(["-e", &format!("tell application \"Terminal\" to do script \"{line}\""), "-e", "tell application \"Terminal\" to activate"])
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", "cmd", "/k"])
            .arg(&exe)
            .args(spec.login)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = quoted_for_shell(&exe)?;
        std::process::Command::new("x-terminal-emulator")
            .arg("-e")
            .arg(&exe)
            .args(spec.login)
            .spawn()
            .map_err(|_| format!("Open a terminal and run: {} {}", spec.binary, spec.login.join(" ")))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> Completion {
        Completion { system: "rules".into(), prompt: "a cube".into(), ..Default::default() }
    }
    fn strings(plan: &Plan) -> Vec<String> {
        plan.args.iter().map(|a| a.to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn claude_code_runs_with_tools_off() {
        let dir = tempfile::tempdir().unwrap();
        let plan = plan("claude-code", "sonnet", &request(), dir.path(), &[]).unwrap();
        let args = strings(&plan);
        let tools = args.iter().position(|a| a == "--tools").unwrap();
        assert_eq!(args[tools + 1], "");
        assert!(args.windows(2).any(|w| w == ["--model", "sonnet"]));
        assert!(args.windows(2).any(|w| w == ["--system-prompt", "rules"]));
        assert_eq!(plan.stdin.as_deref(), Some("a cube"));
    }

    #[test]
    fn claude_code_gets_read_only_for_images() {
        let dir = tempfile::tempdir().unwrap();
        let plan = plan("claude-code", "", &request(), dir.path(), &["reference-1.png".into()]).unwrap();
        let args = strings(&plan);
        assert!(args.windows(2).any(|w| w == ["--tools", "Read"]));
        assert!(!args.iter().any(|a| a == "--model"));
        assert!(plan.stdin.unwrap().contains("reference-1.png"));
    }

    #[test]
    fn codex_stays_sandboxed() {
        let dir = tempfile::tempdir().unwrap();
        let plan = plan("codex", "", &request(), dir.path(), &["reference-1.png".into()]).unwrap();
        let args = strings(&plan);
        assert!(args.windows(2).any(|w| w == ["--sandbox", "read-only"]));
        assert_eq!(args.last().unwrap(), "-");
        assert!(plan.answer_file.is_some());
        assert!(args.iter().any(|a| a.starts_with("--image=")));
    }

    #[test]
    fn opencode_denies_every_permission() {
        let dir = tempfile::tempdir().unwrap();
        let plan = plan("opencode", "opencode/x", &request(), dir.path(), &[]).unwrap();
        assert_eq!(plan.env[0].0, "OPENCODE_PERMISSION");
        assert!(plan.env[0].1.contains("deny"));
        assert!(plan.stdin.unwrap().starts_with("rules"));
    }

    #[test]
    fn long_antigravity_prompts_move_to_a_file() {
        let dir = tempfile::tempdir().unwrap();
        let mut long = request();
        long.prompt = "x".repeat(MAX_ARGUMENT + 1);
        let plan = plan("antigravity", "", &long, dir.path(), &[]).unwrap();
        assert!(strings(&plan).last().unwrap().contains("request.md"));
        assert!(dir.path().join("request.md").is_file());
    }

    #[test]
    fn answers_are_extracted() {
        assert_eq!(claude_answer(r#"{"result":"cube(1);","is_error":false}"#).unwrap(), "cube(1);");
        assert!(claude_answer(r#"{"result":"Not logged in","is_error":true}"#).unwrap_err().contains("Not logged in"));
        let events = "{\"type\":\"step_start\"}\n{\"type\":\"text\",\"part\":{\"text\":\"cube\"}}\n{\"type\":\"text\",\"part\":{\"text\":\"(1);\"}}\n";
        assert_eq!(opencode_answer(events).unwrap(), "cube(1);");
        assert!(opencode_answer("{\"type\":\"error\",\"error\":{\"data\":{\"message\":\"limit\"}}}\n").unwrap_err().contains("limit"));
        assert_eq!(gemini_answer("Loaded cached credentials.\n{\"response\":\"ok\"}").unwrap(), "ok");
        assert_eq!(antigravity_answer(r#"{"status":"SUCCESS","response":"ok\n"}"#).unwrap(), "ok\n");
        assert!(antigravity_answer(r#"{"status":"FAILED","error":"quota"}"#).unwrap_err().contains("quota"));
    }

    #[test]
    fn model_lists_keep_only_ids() {
        let text = "opencode/deepseek-v4.1-flash-free\nAvailable models:\n\nanthropic/claude-opus-5-5 extra\n";
        assert_eq!(model_words(text), vec!["opencode/deepseek-v4.1-flash-free", "anthropic/claude-opus-5-5"]);
    }

    #[test]
    fn a_missing_cli_path_is_reported() {
        let mut config = Config::default();
        config.paths.insert("codex".into(), "/no/such/codex".into());
        assert!(detect(&config, "codex").is_err());
    }

    /// Calls the real CLI: `cargo test -- --ignored live_`. Needs the tool installed and signed in.
    async fn live(id: &str, model: &str) {
        let mut config = Config::default();
        config.models.insert(id.into(), model.into());
        config.model = model.into();
        let request = Completion {
            system: "Answer with OpenSCAD code only.".into(),
            prompt: "Write one statement that makes a 10 mm cube.".into(),
            ..Default::default()
        };
        let answer = complete(&config, id, &request).await.unwrap();
        assert!(answer.contains("cube"), "{answer}");
    }

    #[tokio::test]
    #[ignore]
    async fn live_claude_code() {
        live("claude-code", "haiku").await;
    }

    #[tokio::test]
    #[ignore]
    async fn live_opencode() {
        live("opencode", "opencode/deepseek-v4.1-flash-free").await;
    }

    #[tokio::test]
    #[ignore]
    async fn live_antigravity() {
        live("antigravity", "gemini-3.8-flash-high").await;
    }
}
