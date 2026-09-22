mod ai;
mod config;
mod docs;
mod files;
mod openscad;
mod pipeline;

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

#[tauri::command]
fn detect_openscad(s: State<AppState>) -> Result<String, String> {
    openscad::detect(&config::load(&s.dir)?.openscad_path).map(|p| p.display().to_string())
}

#[tauri::command]
fn detect_codex(config: config::Config) -> Result<String, String> {
    ai::codex::detect(&config.codex_path).map(|path| path.display().to_string())
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
async fn generate(
    app: tauri::AppHandle,
    s: State<'_, AppState>,
    request: pipeline::Request,
) -> Result<pipeline::Artifact, String> {
    let config = config::load(&s.dir)?;
    cancellable(&s, pipeline::generate(&app, &s.dir, &config, request)).await
}

#[tauri::command]
async fn render(s: State<'_, AppState>, code: String) -> Result<pipeline::Artifact, String> {
    let config = config::load(&s.dir)?;
    cancellable(&s, pipeline::render(&s.dir, &config, &code)).await
}

#[tauri::command]
async fn sync_docs(s: State<'_, AppState>) -> Result<usize, String> {
    cancellable(&s, docs::sync(&s.dir)).await
}

#[tauri::command]
async fn list_models(config: config::Config) -> Result<Vec<String>, String> {
    ai::models::list(&config).await
}

#[tauri::command]
async fn analyze_image(
    s: State<'_, AppState>,
    config: config::Config,
    image: ai::Image,
) -> Result<String, String> {
    image.validate()?;
    let provider = ai::provider(&config.provider)?;
    cancellable(&s, provider.generate(&config,
        "Describe this object as a precise English CAD design brief for OpenSCAD. Describe shapes, relative dimensions, and suggested parameters. Clearly label dimensions inferred from the image as estimates. Return a design brief, not code.", Some(&image))).await
}

#[tauri::command]
async fn export_file(
    s: State<'_, AppState>,
    code: String,
    format: String,
) -> Result<Option<String>, String> {
    if code.len() > 1_000_000 {
        return Err("SCAD files cannot exceed 1 MB".into());
    }
    if !["scad", "stl", "png"].contains(&format.as_str()) {
        return Err("Invalid export format".into());
    }
    cancellable(&s, async {
        if format == "scad" {
            return files::save("design.scad", code.as_bytes(), "scad").await;
        }
        let config = config::load(&s.dir)?;
        let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
        let source = tmp.path().join("model.scad");
        let output = tmp.path().join(format!("model.{format}"));
        tokio::fs::write(&source, code)
            .await
            .map_err(|e| e.to_string())?;
        openscad::compile(&openscad::detect(&config.openscad_path)?, &source, &output).await?;
        let bytes = tokio::fs::read(output).await.map_err(|e| e.to_string())?;
        files::save(&format!("design.{format}"), &bytes, &format).await
    })
    .await
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
            detect_codex,
            choose_output_directory,
            generate,
            render,
            sync_docs,
            export_file,
            output_directory,
            cancel_operation,
            list_models,
            analyze_image,
            list_outputs,
            read_output
        ])
        .run(tauri::generate_context!())
        .expect("Tauri could not start");
}
