use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct SavedModel {
    pub name: String,
    pub modified: u64,
}

pub fn list(dir: &Path) -> Result<Vec<SavedModel>, String> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(crate::config::outputs(dir)?).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().extension().is_some_and(|e| e == "scad")
            && entry.file_type().map_err(|e| e.to_string())?.is_file()
        {
            let modified = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|t| t.as_secs())
                .unwrap_or(0);
            files.push(SavedModel {
                name: entry.file_name().to_string_lossy().into(),
                modified,
            });
        }
    }
    files.sort_by(|a, b| b.modified.cmp(&a.modified));
    files.truncate(200);
    Ok(files)
}

pub fn read(dir: &Path, name: &str) -> Result<String, String> {
    if !name.ends_with(".scad") || name.contains(['/', '\\', ':']) || name == ".scad" {
        return Err("Invalid file name".into());
    }
    let root = crate::config::outputs(dir)?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let path = root.join(name).canonicalize().map_err(|e| e.to_string())?;
    if !path.starts_with(&root) {
        return Err("The file is outside the output folder".into());
    }
    if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 1_000_000 {
        return Err("SCAD files cannot exceed 1 MB".into());
    }
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

pub async fn save(name: &str, bytes: &[u8], extension: &str) -> Result<Option<String>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_file_name(name)
        .add_filter(extension.to_uppercase(), &[extension])
        .save_file()
        .await
    else {
        return Ok(None);
    };
    file.write(bytes).await.map_err(|e| e.to_string())?;
    Ok(Some(file.path().display().to_string()))
}
