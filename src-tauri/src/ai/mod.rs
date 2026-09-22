pub mod codex;
pub mod gemini;
pub mod models;
pub mod ollama;
pub mod openai;
use crate::config::Config;
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[derive(Clone, Deserialize, Serialize)]
pub struct Image {
    pub mime: String,
    pub data: String,
}
impl Image {
    pub fn validate(&self) -> Result<(), String> {
        if !["image/png", "image/jpeg", "image/webp"].contains(&self.mime.as_str())
            || self.data.len() > 14_000_000
        {
            return Err("Use a PNG, JPEG, or WebP image up to 10 MB".into());
        }
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(&self.data)
            .map_err(|_| "Invalid image".to_string())?;
        Ok(())
    }
}
#[async_trait::async_trait]
pub trait Provider: Send + Sync {
    async fn generate(
        &self,
        c: &Config,
        prompt: &str,
        image: Option<&Image>,
    ) -> Result<String, String>;
}
pub fn provider(name: &str) -> Result<Box<dyn Provider>, String> {
    match name {
        "gemini" => Ok(Box::new(gemini::Gemini)),
        "openai" => Ok(Box::new(openai::OpenAI)),
        "ollama" => Ok(Box::new(ollama::Ollama)),
        "codex" => Ok(Box::new(codex::Codex)),
        _ => Err("Unknown provider".into()),
    }
}
pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .expect("HTTP client")
}
pub async fn response(r: reqwest::RequestBuilder) -> Result<Value, String> {
    let r = r
        .send()
        .await
        .map_err(|_| "The provider connection failed or timed out".to_string())?;
    if !r.status().is_success() {
        return Err(format!(
            "The provider returned HTTP {}; check the key, model, and quota",
            r.status()
        ));
    }
    r.json()
        .await
        .map_err(|_| "The provider returned invalid JSON".into())
}
pub fn key(value: &str, env: &str) -> Result<String, String> {
    let k = if value.trim().is_empty() {
        std::env::var(env).unwrap_or_default()
    } else {
        value.trim().to_string()
    };
    if k.is_empty() {
        Err(format!("{env} is required"))
    } else {
        Ok(k)
    }
}
pub fn text(v: Option<&str>) -> Result<String, String> {
    v.filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .ok_or("The provider returned an empty response".into())
}
