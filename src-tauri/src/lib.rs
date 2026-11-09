mod ai;
mod config;
mod docs;
mod files;
mod openscad;

use std::path::PathBuf;
use tauri::{Manager, State};

struct AppState {
    dir: PathBuf,
    busy: tokio::sync::Mutex<()>,
    cancel: std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

async fn cancellable<T>(
    state: &AppState,
    future: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let _guard = state
        .busy
        .try_lock()
        .map_err(|_| "Another operation is already running")?;
    let (send, recv) = tokio::sync::oneshot::channel();
    *state
        .cancel
        .lock()
        .map_err(|_| "The operation lock could not be acquired")? = Some(send);
    let result = tokio::select! {
        result = future => result,
        _ = recv => Err("Operation cancelled".into()),
    };
    state
        .cancel
        .lock()
        .map_err(|_| "The operation lock could not be acquired")?
        .take();
    result
}

#[tauri::command]
fn cancel_operation(s: State<AppState>) -> Result<(), String> {
    if let Some(send) = s
        .cancel
        .lock()
        .map_err(|_| "The operation lock could not be acquired")?
        .take()
    {
        let _ = send.send(());
    }
    Ok(())
}

#[tauri::command]
fn load_config(s: State<AppState>) -> Result<config::Config, String> {
    config::load(&s.dir)
}

#[tauri::command]
fn save_config(s: State<AppState>, config: config::Config) -> Result<(), String> {
    config::save(&s.dir, &config)
}

#[derive(serde::Serialize)]
struct OpenScadStatus {
    path: String,
    version: String,
}

#[tauri::command]
async fn detect_openscad(s: State<'_, AppState>) -> Result<OpenScadStatus, String> {
    let path = openscad::detect(&config::load(&s.dir)?.openscad_path)?;
    let version = openscad::version(&path).await;
    Ok(OpenScadStatus {
        path: path.display().to_string(),
        version,
    })
}

#[tauri::command]
async fn detect_providers(config: config::Config) -> Vec<ai::Status> {
    let mut found = Vec::new();
    for provider in ai::PROVIDERS {
        found.push(ai::status(&config, provider).await);
    }
    found
}

#[tauri::command]
async fn test_provider(config: config::Config) -> Result<String, String> {
    let request = ai::Completion {
        prompt: "Reply with exactly: OK".into(),
        timeout: Some(90),
        ..Default::default()
    };
    ai::complete(&config, &config.provider, &request).await
}

#[tauri::command]
fn open_login(config: config::Config, provider: String) -> Result<(), String> {
    ai::cli::open_login(&config, &provider)
}

#[tauri::command]
async fn choose_output_directory(current: String) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new().set_title("Choose output folder");
    if !current.trim().is_empty() && std::path::Path::new(current.trim()).is_dir() {
        dialog = dialog.set_directory(current.trim());
    }
    Ok(dialog
        .pick_folder()
        .await
        .map(|folder| folder.path().display().to_string()))
}

#[tauri::command]
async fn ai_complete(s: State<'_, AppState>, request: ai::Completion) -> Result<String, String> {
    let config = config::load(&s.dir)?;
    cancellable(&s, ai::complete(&config, &config.provider, &request)).await
}

/// Compiles SCAD source. The reply is binary: a little-endian log length, the log, the file.
#[tauri::command]
async fn compile_scad(
    s: State<'_, AppState>,
    code: String,
    format: String,
) -> Result<tauri::ipc::Response, String> {
    if code.len() > 4_000_000 {
        return Err("The code exceeds the 4 MB limit".into());
    }
    if !openscad::FORMATS.contains(&format.as_str()) {
        return Err("Invalid export format".into());
    }
    let config = config::load(&s.dir)?;
    cancellable(&s, async {
        let exe = openscad::detect(&config.openscad_path)?;
        let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
        let source = tmp.path().join("model.scad");
        let output = tmp.path().join(format!("model.{format}"));
        tokio::fs::write(&source, &code)
            .await
            .map_err(|e| e.to_string())?;
        let log = openscad::compile(&exe, &source, &output, config.render_timeout).await?;
        let bytes = tokio::fs::read(output).await.map_err(|e| e.to_string())?;
        if bytes.len() > 400_000_000 {
            return Err("The output exceeds the 400 MB limit".into());
        }
        let mut reply = Vec::with_capacity(bytes.len() + log.len() + 4);
        reply.extend_from_slice(&(log.len() as u32).to_le_bytes());
        reply.extend_from_slice(log.as_bytes());
        reply.extend_from_slice(&bytes);
        Ok(tauri::ipc::Response::new(reply))
    })
    .await
}

#[tauri::command]
async fn docs_context(s: State<'_, AppState>, prompt: String) -> Result<String, String> {
    if docs::stale(&s.dir) {
        // A failed refresh only means an older cache, or none.
        let _ = docs::sync(&s.dir).await;
    }
    Ok(docs::context(&s.dir, &prompt))
}

#[tauri::command]
async fn sync_docs(s: State<'_, AppState>) -> Result<usize, String> {
    cancellable(&s, docs::sync(&s.dir)).await
}

#[tauri::command]
async fn list_models(config: config::Config, provider: String) -> Result<Vec<String>, String> {
    ai::models(&config, &provider).await
}

/// Keeps the SCAD source and its mesh in the output folder. The body is a little-endian
/// source length, the source, then the STL.
#[tauri::command]
async fn save_output(
    s: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err("Expected the design as binary data".into());
    };
    let (code, stl) = split_design(body)?;
    let outputs = config::outputs(&s.dir)?;
    let name = format!(
        "model-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    tokio::fs::write(outputs.join(format!("{name}.scad")), code)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::write(outputs.join(format!("{name}.stl")), stl)
        .await
        .map_err(|e| e.to_string())?;
    Ok(name)
}

fn split_design(body: &[u8]) -> Result<(&[u8], &[u8]), String> {
    let invalid = || "Invalid design data".to_string();
    let (head, rest) = body.split_at_checked(4).ok_or_else(invalid)?;
    let length = u32::from_le_bytes(head.try_into().map_err(|_| invalid())?) as usize;
    rest.split_at_checked(length).ok_or_else(invalid)
}

/// Opens a web page in the default browser. Only https links are accepted.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Only https links can be opened".into());
    }
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = std::process::Command::new("rundll32");
        c.arg("url.dll,FileProtocolHandler");
        c
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = std::process::Command::new("xdg-open");
    command.arg(url).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Opens a save dialog for a file the web view already built, such as a STEP export.
#[tauri::command]
async fn save_bytes(request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected binary data".into());
    };
    let name = request
        .headers()
        .get("x-name")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("design.bin");
    if name.contains(['/', '\\', ':']) {
        return Err("Invalid file name".into());
    }
    let extension = name.rsplit('.').next().unwrap_or("bin");
    files::save(name, bytes, extension).await
}

#[derive(serde::Serialize)]
struct Release {
    version: String,
    url: String,
}

/// The newest published release, or nothing when the repository has none yet.
#[tauri::command]
async fn latest_release() -> Result<Option<Release>, String> {
    let reply = reqwest::Client::new()
        .get("https://api.github.com/repos/serdevir91/openscad-ai/releases/latest")
        .header("user-agent", "openscad-ai")
        .header("accept", "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|_| "The update server could not be reached".to_string())?;
    if reply.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let value: serde_json::Value = reply
        .json()
        .await
        .map_err(|_| "The update server returned invalid data".to_string())?;
    Ok(value["tag_name"].as_str().map(|tag| Release {
        version: tag.trim_start_matches('v').to_string(),
        url: value["html_url"].as_str().unwrap_or_default().to_string(),
    }))
}

#[tauri::command]
fn list_outputs(s: State<AppState>) -> Result<Vec<files::SavedModel>, String> {
    files::list(&s.dir)
}

#[tauri::command]
fn read_output(s: State<AppState>, name: String) -> Result<String, String> {
    files::read(&s.dir, &name)
}

#[tauri::command]
fn output_directory(s: State<AppState>) -> Result<String, String> {
    Ok(config::outputs(&s.dir)?.display().to_string())
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(AppState {
                dir,
                busy: tokio::sync::Mutex::new(()),
                cancel: std::sync::Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            detect_openscad,
            detect_providers,
            test_provider,
            open_login,
            choose_output_directory,
            ai_complete,
            compile_scad,
            docs_context,
            sync_docs,
            save_output,
            save_bytes,
            open_url,
            latest_release,
            output_directory,
            cancel_operation,
            list_models,
            list_outputs,
            read_output
        ])
        .run(tauri::generate_context!())
        .expect("Tauri could not start");
}

#[cfg(test)]
mod tests {
    use super::split_design;
    #[test]
    fn a_design_body_splits_into_source_and_mesh() {
        let mut body = 3u32.to_le_bytes().to_vec();
        body.extend_from_slice(b"abcSTL");
        assert_eq!(split_design(&body).unwrap(), (&b"abc"[..], &b"STL"[..]));
        assert!(split_design(&[1, 0]).is_err());
        assert!(split_design(&9u32.to_le_bytes()).is_err());
    }
}
