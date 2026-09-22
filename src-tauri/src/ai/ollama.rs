use super::*;
use serde_json::json;
pub struct Ollama;
#[async_trait::async_trait]
impl Provider for Ollama {
    async fn generate(&self, c: &Config, p: &str, i: Option<&Image>) -> Result<String, String> {
        let mut msg = json!({"role":"user","content":p});
        if let Some(i) = i {
            msg["images"] = json!([i.data]);
        }
        let v = response(
            client()
                .post("http://127.0.0.1:11434/api/chat")
                .json(&json!({"model":c.model,"stream":false,"messages":[msg]})),
        )
        .await?;
        text(v["message"]["content"].as_str())
    }
}
