use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub provider: String,
    pub model: String,
    pub gemini_key: String,
    pub openai_key: String,
    pub openscad_path: String,
    pub codex_path: String,
    pub output_dir: String,
    pub theme: String,
    pub max_repairs: u8,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            provider: "gemini".into(),
            model: "gemini-2.5-flash".into(),
            gemini_key: String::new(),
            openai_key: String::new(),
            openscad_path: String::new(),
            codex_path: String::new(),
            output_dir: String::new(),
            theme: "dark".into(),
            max_repairs: 2,
        }
    }
}

impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if !["gemini", "openai", "ollama", "codex"].contains(&self.provider.as_str()) {
            return Err("Invalid provider".into());
        }
        if !["light", "dark", "amoled"].contains(&self.theme.as_str()) {
            return Err("Invalid theme".into());
        }
        if self.max_repairs > 5 {
            return Err("Auto-repair attempts cannot exceed 5".into());
        }
        if self.model.trim().is_empty() || self.model.len() > 200 {
            return Err("Model ID must contain 1–200 characters".into());
        }
        Ok(())
    }
}

pub fn load(dir: &Path) -> Result<Config, String> {
    let path = dir.join(".openscad_ai_config.json");
    if !path.exists() {
        return Ok(Config::default());
    }
    let config: Config = serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|_| "The settings file could not be read. Rename .openscad_ai_config.json in the application data directory and try again.".to_string())?;
    config.validate()?;
    Ok(config)
}

pub fn save(dir: &Path, config: &Config) -> Result<(), String> {
    config.validate()?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    use std::io::Write;
    tmp.write_all(&serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;
    tmp.persist(dir.join(".openscad_ai_config.json"))
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn outputs(dir: &Path) -> Result<PathBuf, String> {
    let config = load(dir)?;
    let path = if config.output_dir.trim().is_empty() {
        dir.join("outputs")
    } else {
        PathBuf::from(config.output_dir.trim())
    };
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    path.canonicalize().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn settings_round_trip_and_replace() {
        let dir = tempfile::tempdir().unwrap();
        let mut c = Config::default();
        save(dir.path(), &c).unwrap();
        c.theme = "amoled".into();
        save(dir.path(), &c).unwrap();
        assert_eq!(load(dir.path()).unwrap().theme, "amoled");
    }
    #[test]
    fn invalid_settings_rejected() {
        let mut c = Config::default();
        c.max_repairs = 6;
        assert!(c.validate().is_err());
    }
    #[test]
    fn custom_output_directory_is_used() {
        let app = tempfile::tempdir().unwrap();
        let output = tempfile::tempdir().unwrap();
        let mut config = Config::default();
        config.output_dir = output.path().display().to_string();
        save(app.path(), &config).unwrap();
        assert_eq!(
            outputs(app.path()).unwrap(),
            output.path().canonicalize().unwrap()
        );
    }
}
