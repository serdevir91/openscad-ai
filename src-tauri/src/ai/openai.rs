use super::*;
use serde_json::json;
pub struct OpenAI;
#[async_trait::async_trait]
impl Provider for OpenAI {
    async fn generate(&self, c: &Config, p: &str, i: Option<&Image>) -> Result<String, String> {
        let mut content = vec![json!({"type":"text","text":p})];
        if let Some(i) = i {
            content.push(json!({"type":"image_url","image_url":{"url":format!("data:{};base64,{}",i.mime,i.data)}}))
        }
        let v = response(
            client()
                .post("https://api.openai.com/v1/chat/completions")
                .bearer_auth(key(&c.openai_key, "OPENAI_API_KEY")?)
                .json(&json!({"model":c.model,"messages":[{"role":"user","content":content}]})),
        )
        .await?;
        text(v["choices"][0]["message"]["content"].as_str())
    }
}
