use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub provider: String,
    /// Model for the active provider. Empty means the provider's own default.
    pub model: String,
    /// The model last chosen for each provider, so switching back restores it.
    pub models: BTreeMap<String, String>,
    pub keys: BTreeMap<String, String>,
    pub base_urls: BTreeMap<String, String>,
    pub paths: BTreeMap<String, String>,
    pub openscad_path: String,
    pub output_dir: String,
    pub theme: String,
    pub max_repairs: u8,
    /// "precise" plans, verifies, and reviews each design. "fast" only repairs compile errors.
    pub mode: String,
    pub render_timeout: u32,
    pub onboarded: bool,
    // Settings written by versions before 0.3. Read once, then moved into the maps above.
    #[serde(skip_serializing)]
    gemini_key: String,
    #[serde(skip_serializing)]
    openai_key: String,
    #[serde(skip_serializing)]
    codex_path: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            provider: "gemini".into(),
            model: "gemini-flash-latest".into(),
            models: BTreeMap::new(),
            keys: BTreeMap::new(),
            base_urls: BTreeMap::new(),
            paths: BTreeMap::new(),
            openscad_path: String::new(),
            output_dir: String::new(),
            theme: "dark".into(),
            max_repairs: 3,
            mode: "precise".into(),
            render_timeout: 120,
            onboarded: false,
            gemini_key: String::new(),
            openai_key: String::new(),
            codex_path: String::new(),
        }
    }
}

impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if !crate::ai::PROVIDERS.contains(&self.provider.as_str()) {
            return Err("Invalid provider".into());
        }
        if !["light", "dark", "amoled"].contains(&self.theme.as_str()) {
            return Err("Invalid theme".into());
        }
        if !["precise", "fast"].contains(&self.mode.as_str()) {
            return Err("Invalid generation mode".into());
        }
        if self.max_repairs > 5 {
            return Err("Auto-repair attempts cannot exceed 5".into());
        }
        if !(10..=1800).contains(&self.render_timeout) {
            return Err("The OpenSCAD time limit must be between 10 and 1800 seconds".into());
        }
        if self.model.len() > 200 {
            return Err("Model ID cannot exceed 200 characters".into());
        }
        Ok(())
    }

    /// Moves settings written by older versions into the per-provider maps.
    fn migrate(mut self) -> Self {
        for (provider, value) in [
            ("gemini", std::mem::take(&mut self.gemini_key)),
            ("openai", std::mem::take(&mut self.openai_key)),
        ] {
            if !value.trim().is_empty() {
                self.keys.entry(provider.into()).or_insert(value);
                self.onboarded = true;
            }
        }
        let codex = std::mem::take(&mut self.codex_path);
        if !codex.trim().is_empty() && codex != "codex" {
            self.paths.entry("codex".into()).or_insert(codex);
        }
        self
    }

    pub fn key(&self, provider: &str) -> &str {
        self.keys.get(provider).map_or("", |value| value.trim())
    }
    pub fn base_url(&self, provider: &str) -> &str {
        self.base_urls.get(provider).map_or("", |value| value.trim())
    }
    pub fn path(&self, provider: &str) -> &str {
        self.paths.get(provider).map_or("", |value| value.trim())
    }
}

pub fn load(dir: &Path) -> Result<Config, String> {
    let path = dir.join(".openscad_ai_config.json");
    if !path.exists() {
        return Ok(Config::default());
    }
    let config: Config = serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|_| "The settings file could not be read. Rename .openscad_ai_config.json in the application data directory and try again.".to_string())?;
    let config = config.migrate();
    config.validate()?;
    Ok(config)
}

pub fn save(dir: &Path, config: &Config) -> Result<(), String> {
    config.validate()?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    // NamedTempFile is created owner-only, which keeps the API keys private after persist.
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
        let mut c = Config::default();
        c.provider = "nonsense".into();
        assert!(c.validate().is_err());
    }
    #[test]
    fn an_empty_model_means_the_provider_default() {
        let mut c = Config::default();
        c.provider = "claude-code".into();
        c.model = String::new();
        assert!(c.validate().is_ok());
    }
    #[test]
    fn old_settings_move_into_the_maps() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join(".openscad_ai_config.json"),
            r#"{"provider":"openai","model":"gpt-4o","gemini_key":"g","openai_key":"o","codex_path":"/x/codex","theme":"dark","max_repairs":2}"#,
        )
        .unwrap();
        let config = load(dir.path()).unwrap();
        assert_eq!(config.key("gemini"), "g");
        assert_eq!(config.key("openai"), "o");
        assert_eq!(config.path("codex"), "/x/codex");
        assert!(config.onboarded);
        save(dir.path(), &config).unwrap();
        let text = std::fs::read_to_string(dir.path().join(".openscad_ai_config.json")).unwrap();
        assert!(!text.contains("gemini_key"));
    }
    #[cfg(unix)]
    #[test]
    fn the_settings_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), &Config::default()).unwrap();
        let mode = std::fs::metadata(dir.path().join(".openscad_ai_config.json"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o077, 0);
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
