pub mod cli;
pub mod http;

use crate::config::Config;
use serde::{Deserialize, Serialize};

/// Every provider id the app accepts. HTTP and CLI adapters each own their part of this list.
pub const PROVIDERS: [&str; 16] = [
    "gemini",
    "openai",
    "anthropic",
    "openrouter",
    "groq",
    "deepseek",
    "mistral",
    "xai",
    "ollama",
    "lmstudio",
    "custom",
    "claude-code",
    "codex",
    "gemini-cli",
    "opencode",
    "antigravity",
];

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
    pub fn bytes(&self) -> Result<Vec<u8>, String> {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(&self.data)
            .map_err(|_| "Invalid image".to_string())
    }
    pub fn file_name(&self, index: usize) -> String {
        let extension = match self.mime.as_str() {
            "image/jpeg" => "jpg",
            "image/webp" => "webp",
            _ => "png",
        };
        format!("reference-{}.{extension}", index + 1)
    }
}

#[derive(Clone, Default, Deserialize)]
#[serde(default)]
pub struct Completion {
    pub system: String,
    pub prompt: String,
    pub images: Vec<Image>,
    /// Asks for a single JSON object where the provider can enforce it.
    pub json: bool,
    /// Overrides the configured time limit, in seconds.
    pub timeout: Option<u64>,
}

impl Completion {
    pub fn validate(&self) -> Result<(), String> {
        if self.prompt.trim().is_empty() {
            return Err("The prompt is empty".into());
        }
        if self.prompt.len() > 2_000_000 || self.images.len() > 8 {
            return Err("The request is too large".into());
        }
        self.images.iter().try_for_each(Image::validate)
    }
    pub fn limit(&self) -> std::time::Duration {
        std::time::Duration::from_secs(self.timeout.unwrap_or(360))
    }
}

pub async fn complete(config: &Config, provider: &str, request: &Completion) -> Result<String, String> {
    request.validate()?;
    let text = if cli::is_cli(provider) {
        cli::complete(config, provider, request).await?
    } else {
        http::complete(config, provider, request).await?
    };
    if text.trim().is_empty() {
        return Err("The provider returned an empty response".into());
    }
    Ok(text)
}

pub async fn models(config: &Config, provider: &str) -> Result<Vec<String>, String> {
    let mut names = if cli::is_cli(provider) {
        cli::models(config, provider).await?
    } else {
        http::models(config, provider).await?
    };
    names.dedup();
    Ok(names)
}

#[derive(Serialize)]
pub struct Status {
    pub id: String,
    /// True when the provider can be called without further setup.
    pub ready: bool,
    pub detail: String,
    pub path: Option<String>,
}

pub async fn status(config: &Config, provider: &str) -> Status {
    if cli::is_cli(provider) {
        cli::status(config, provider)
    } else {
        http::status(config, provider).await
    }
}

/// Removes a key from text that came back from a provider, in case an error echoes it.
pub fn scrub(message: &str, secret: &str) -> String {
    if secret.len() < 6 {
        return message.to_string();
    }
    message.replace(secret, "[key hidden]")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hides_keys_in_messages() {
        assert_eq!(scrub("bad token FAKEVALUE99", "FAKEVALUE99"), "bad token [key hidden]");
        assert_eq!(scrub("no key here", ""), "no key here");
    }
    #[test]
    fn rejects_empty_and_oversized_requests() {
        let mut request = Completion::default();
        assert!(request.validate().is_err());
        request.prompt = "x".repeat(2_000_001);
        assert!(request.validate().is_err());
        request.prompt = "cube".into();
        assert!(request.validate().is_ok());
    }
    #[test]
    fn image_names_follow_the_mime_type() {
        let image = Image { mime: "image/jpeg".into(), data: String::new() };
        assert_eq!(image.file_name(1), "reference-2.jpg");
    }
}
