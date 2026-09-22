use super::*;
use serde_json::json;
pub struct Gemini;
#[async_trait::async_trait]
impl Provider for Gemini {
    async fn generate(&self, c: &Config, p: &str, i: Option<&Image>) -> Result<String, String> {
        if !c
            .model
            .chars()
            .all(|x| x.is_ascii_alphanumeric() || "-_.".contains(x))
        {
            return Err("Invalid model ID".into());
        }
        let mut parts = vec![json!({"text":p})];
        if let Some(i) = i {
            parts.push(json!({"inline_data":{"mime_type":i.mime,"data":i.data}}));
        }
        let v = response(
            client()
                .post(format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
                    c.model
                ))
                .header("x-goog-api-key", key(&c.gemini_key, "GEMINI_API_KEY")?)
                .json(&json!({"contents":[{"role":"user","parts":parts}]})),
        )
        .await?;
        let t = v["candidates"][0]["content"]["parts"].as_array().map(|a| {
            a.iter()
                .filter(|p| p["thought"] != true)
                .filter_map(|p| p["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n")
        });
        text(t.as_deref())
    }
}
