//! Providers reached over HTTP: hosted APIs and local servers.
use super::{scrub, Completion, Status};
use crate::config::Config;
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Gemini,
    Anthropic,
    Ollama,
    OpenAi,
}

struct Spec {
    kind: Kind,
    base: &'static str,
    env: &'static str,
    /// Local servers and custom endpoints work without a key.
    needs_key: bool,
}

fn spec(provider: &str) -> Result<Spec, String> {
    let (kind, base, env, needs_key) = match provider {
        "gemini" => (Kind::Gemini, "https://generativelanguage.googleapis.com/v1beta", "GEMINI_API_KEY", true),
        "anthropic" => (Kind::Anthropic, "https://api.anthropic.com/v1", "ANTHROPIC_API_KEY", true),
        "openai" => (Kind::OpenAi, "https://api.openai.com/v1", "OPENAI_API_KEY", true),
        "openrouter" => (Kind::OpenAi, "https://openrouter.ai/api/v1", "OPENROUTER_API_KEY", true),
        "groq" => (Kind::OpenAi, "https://api.groq.com/openai/v1", "GROQ_API_KEY", true),
        "deepseek" => (Kind::OpenAi, "https://api.deepseek.com/v1", "DEEPSEEK_API_KEY", true),
        "mistral" => (Kind::OpenAi, "https://api.mistral.ai/v1", "MISTRAL_API_KEY", true),
        "xai" => (Kind::OpenAi, "https://api.x.ai/v1", "XAI_API_KEY", true),
        "ollama" => (Kind::Ollama, "http://127.0.0.1:11434", "", false),
        "lmstudio" => (Kind::OpenAi, "http://127.0.0.1:1234/v1", "", false),
        "custom" => (Kind::OpenAi, "", "CUSTOM_API_KEY", false),
        _ => return Err("Unknown provider".into()),
    };
    Ok(Spec { kind, base, env, needs_key })
}

fn base(config: &Config, provider: &str, spec: &Spec) -> Result<String, String> {
    let url = match config.base_url(provider) {
        "" => spec.base,
        url => url,
    }
    .trim_end_matches('/')
    .to_string();
    if url.is_empty() {
        return Err("Enter the endpoint URL for this provider in Connections".into());
    }
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("The endpoint URL must start with http:// or https://".into());
    }
    Ok(url)
}

fn secret(config: &Config, provider: &str, spec: &Spec) -> Result<String, String> {
    let value = match config.key(provider) {
        "" if !spec.env.is_empty() => std::env::var(spec.env).unwrap_or_default(),
        key => key.to_string(),
    };
    if value.is_empty() && spec.needs_key {
        return Err(format!("Add an API key for this provider in Connections, or set {}", spec.env));
    }
    Ok(value)
}

fn client(limit: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(limit)
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())
}

fn provider_message(body: &str) -> Option<String> {
    let value: Value = serde_json::from_str(body).ok()?;
    let error = &value["error"];
    error["message"]
        .as_str()
        .or_else(|| error.as_str())
        .or_else(|| value["message"].as_str())
        .map(|text| text.chars().take(400).collect())
}

async fn send(request: reqwest::RequestBuilder, key: &str) -> Result<Value, String> {
    let reply = request.send().await.map_err(|error| {
        if error.is_timeout() {
            "The provider timed out".to_string()
        } else {
            "The provider could not be reached; check the connection and endpoint".to_string()
        }
    })?;
    let status = reply.status();
    let body = reply.text().await.map_err(|_| "The provider response was cut off".to_string())?;
    if !status.is_success() {
        let reason = provider_message(&body).unwrap_or_else(|| "check the key, model, and quota".into());
        return Err(scrub(&format!("The provider returned HTTP {}: {reason}", status.as_u16()), key));
    }
    serde_json::from_str(&body).map_err(|_| "The provider returned invalid JSON".into())
}

/// Reasoning models spend part of their output budget on thinking, so this stays generous.
const MAX_OUTPUT: u32 = 32_000;

fn anthropic_body(model: &str, request: &Completion, precise: bool) -> Value {
    let mut content = Vec::new();
    for image in &request.images {
        content.push(json!({"type":"image","source":{"type":"base64","media_type":image.mime,"data":image.data}}));
    }
    content.push(json!({"type":"text","text":request.prompt}));
    let mut body = json!({
        "model": model,
        "max_tokens": MAX_OUTPUT,
        "messages": [{"role":"user","content":content}],
    });
    if !request.system.is_empty() {
        body["system"] = json!(request.system);
    }
    // Effort is rejected by older models, and this family defaults to a lower setting.
    if precise && ["claude-opus-5", "claude-sonnet-5", "claude-fable-5", "claude-haiku-5"].iter().any(|p| model.starts_with(p)) {
        body["output_config"] = json!({"effort":"high"});
    }
    body
}

fn anthropic_text(value: &Value) -> Result<String, String> {
    match value["stop_reason"].as_str() {
        Some("refusal") => return Err("Claude declined this request".into()),
        Some("max_tokens") => return Err("The response hit the output limit; ask for a simpler model".into()),
        _ => {}
    }
    let blocks = value["content"].as_array().ok_or("The provider returned no content")?;
    Ok(blocks
        .iter()
        .filter(|block| block["type"] == "text")
        .filter_map(|block| block["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n"))
}

fn gemini_body(request: &Completion) -> Value {
    let mut parts = vec![json!({"text":request.prompt})];
    for image in &request.images {
        parts.push(json!({"inline_data":{"mime_type":image.mime,"data":image.data}}));
    }
    let mut body = json!({"contents":[{"role":"user","parts":parts}]});
    if !request.system.is_empty() {
        body["system_instruction"] = json!({"parts":[{"text":request.system}]});
    }
    if request.json {
        body["generationConfig"] = json!({"responseMimeType":"application/json"});
    }
    body
}

fn gemini_text(value: &Value) -> Result<String, String> {
    if value["candidates"][0]["finishReason"] == "MAX_TOKENS" {
        return Err("The response hit the output limit; ask for a simpler model".into());
    }
    let parts = value["candidates"][0]["content"]["parts"].as_array().ok_or("The provider returned no content")?;
    Ok(parts
        .iter()
        .filter(|part| part["thought"] != true)
        .filter_map(|part| part["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n"))
}

fn openai_body(model: &str, request: &Completion, provider: &str) -> Value {
    let mut messages = Vec::new();
    if !request.system.is_empty() {
        messages.push(json!({"role":"system","content":request.system}));
    }
    let user = if request.images.is_empty() {
        json!(request.prompt)
    } else {
        let mut content = vec![json!({"type":"text","text":request.prompt})];
        for image in &request.images {
            content.push(json!({"type":"image_url","image_url":{"url":format!("data:{};base64,{}",image.mime,image.data)}}));
        }
        json!(content)
    };
    messages.push(json!({"role":"user","content":user}));
    let mut body = json!({"model":model,"messages":messages});
    // A custom endpoint may not implement response_format, and the pipeline parses JSON anyway.
    if request.json && !["custom", "lmstudio"].contains(&provider) {
        body["response_format"] = json!({"type":"json_object"});
    }
    body
}

fn ollama_body(model: &str, request: &Completion) -> Value {
    let mut messages = Vec::new();
    if !request.system.is_empty() {
        messages.push(json!({"role":"system","content":request.system}));
    }
    let mut message = json!({"role":"user","content":request.prompt});
    if !request.images.is_empty() {
        message["images"] = json!(request.images.iter().map(|i| &i.data).collect::<Vec<_>>());
    }
    messages.push(message);
    let mut body = json!({"model":model,"stream":false,"messages":messages,"options":{"temperature":0.2}});
    if request.json {
        body["format"] = json!("json");
    }
    body
}

fn require_model(config: &Config) -> Result<&str, String> {
    let model = config.model.trim();
    if model.is_empty() {
        return Err("Choose a model for this provider".into());
    }
    Ok(model)
}

pub async fn complete(config: &Config, provider: &str, request: &Completion) -> Result<String, String> {
    let spec = spec(provider)?;
    let model = require_model(config)?;
    let url = base(config, provider, &spec)?;
    let key = secret(config, provider, &spec)?;
    let http = client(request.limit())?;
    match spec.kind {
        Kind::Gemini => {
            if !model.chars().all(|x| x.is_ascii_alphanumeric() || "-_.".contains(x)) {
                return Err("Invalid model ID".into());
            }
            let value = send(
                http.post(format!("{url}/models/{model}:generateContent"))
                    .header("x-goog-api-key", &key)
                    .json(&gemini_body(request)),
                &key,
            )
            .await?;
            gemini_text(&value)
        }
        Kind::Anthropic => {
            let value = send(
                http.post(format!("{url}/messages"))
                    .header("x-api-key", &key)
                    .header("anthropic-version", "2023-06-01")
                    .json(&anthropic_body(model, request, config.mode == "precise")),
                &key,
            )
            .await?;
            anthropic_text(&value)
        }
        Kind::Ollama => {
            let value = send(http.post(format!("{url}/api/chat")).json(&ollama_body(model, request)), &key).await?;
            Ok(value["message"]["content"].as_str().unwrap_or_default().to_string())
        }
        Kind::OpenAi => {
            let mut post = http.post(format!("{url}/chat/completions")).json(&openai_body(model, request, provider));
            if !key.is_empty() {
                post = post.bearer_auth(&key);
            }
            let value = send(post, &key).await?;
            if value["choices"][0]["finish_reason"] == "length" {
                return Err("The response hit the output limit; ask for a simpler model".into());
            }
            Ok(value["choices"][0]["message"]["content"].as_str().unwrap_or_default().to_string())
        }
    }
}

fn names(value: &Value, list: &str, field: &str) -> Vec<String> {
    value[list]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item[field].as_str())
        .map(str::to_string)
        .collect()
}

pub async fn models(config: &Config, provider: &str) -> Result<Vec<String>, String> {
    let spec = spec(provider)?;
    let url = base(config, provider, &spec)?;
    let key = secret(config, provider, &spec)?;
    let http = client(Duration::from_secs(20))?;
    let mut found = match spec.kind {
        Kind::Gemini => {
            let value = send(
                http.get(format!("{url}/models")).header("x-goog-api-key", &key).query(&[("pageSize", "1000")]),
                &key,
            )
            .await?;
            value["models"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|m| {
                    m["supportedGenerationMethods"].as_array().is_some_and(|methods| methods.iter().any(|m| m == "generateContent"))
                })
                .filter_map(|m| m["name"].as_str())
                .map(|s| s.trim_start_matches("models/").to_string())
                .collect()
        }
        Kind::Anthropic => {
            let value = send(
                http.get(format!("{url}/models"))
                    .header("x-api-key", &key)
                    .header("anthropic-version", "2023-06-01")
                    .query(&[("limit", "100")]),
                &key,
            )
            .await?;
            return Ok(names(&value, "data", "id"));
        }
        Kind::Ollama => names(&send(http.get(format!("{url}/api/tags")), &key).await?, "models", "name"),
        Kind::OpenAi => {
            let mut get = http.get(format!("{url}/models"));
            if !key.is_empty() {
                get = get.bearer_auth(&key);
            }
            let mut list = names(&send(get, &key).await?, "data", "id");
            if provider == "openai" {
                list.retain(|s| s.starts_with("gpt-") || s.starts_with("o1") || s.starts_with("o3") || s.starts_with("o4"));
            }
            list
        }
    };
    found.sort();
    Ok(found)
}

pub async fn status(config: &Config, provider: &str) -> Status {
    let id = provider.to_string();
    let Ok(spec) = spec(provider) else {
        return Status { id, ready: false, detail: "Unknown provider".into(), path: None };
    };
    if spec.needs_key {
        let from_env = config.key(provider).is_empty() && !spec.env.is_empty() && std::env::var(spec.env).is_ok_and(|v| !v.is_empty());
        let saved = !config.key(provider).is_empty();
        let detail = if saved {
            "API key saved".to_string()
        } else if from_env {
            format!("Using {}", spec.env)
        } else {
            "No API key yet".to_string()
        };
        return Status { id, ready: saved || from_env, detail, path: None };
    }
    let url = match base(config, provider, &spec) {
        Ok(url) => url,
        Err(detail) => return Status { id, ready: false, detail, path: None },
    };
    let probe = if spec.kind == Kind::Ollama { format!("{url}/api/tags") } else { format!("{url}/models") };
    let mut get = reqwest::Client::new().get(probe).timeout(Duration::from_millis(1500));
    if !config.key(provider).is_empty() {
        get = get.bearer_auth(config.key(provider));
    }
    let running = get.send().await.is_ok();
    let detail = if running { "Server is running" } else { "Server is not running" };
    Status { id, ready: running, detail: detail.into(), path: None }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::Image;

    fn request() -> Completion {
        Completion {
            system: "be exact".into(),
            prompt: "a cube".into(),
            images: vec![Image { mime: "image/png".into(), data: "QUJD".into() }],
            json: true,
            timeout: None,
        }
    }

    #[test]
    fn anthropic_request_shape() {
        let body = anthropic_body("claude-opus-5-5", &request(), true);
        assert_eq!(body["system"], "be exact");
        assert_eq!(body["messages"][0]["content"][0]["source"]["media_type"], "image/png");
        assert_eq!(body["messages"][0]["content"][1]["text"], "a cube");
        assert_eq!(body["output_config"]["effort"], "high");
        assert!(body.get("temperature").is_none());
        assert!(anthropic_body("claude-opus-5-5", &request(), false).get("output_config").is_none());
        assert!(anthropic_body("claude-haiku-4-5", &request(), true).get("output_config").is_none());
    }

    #[test]
    fn anthropic_stop_reasons_become_errors() {
        assert!(anthropic_text(&json!({"stop_reason":"refusal","content":[]})).is_err());
        assert!(anthropic_text(&json!({"stop_reason":"max_tokens","content":[]})).is_err());
        let ok = json!({"stop_reason":"end_turn","content":[{"type":"thinking","thinking":""},{"type":"text","text":"cube(1);"}]});
        assert_eq!(anthropic_text(&ok).unwrap(), "cube(1);");
    }

    #[test]
    fn gemini_skips_thought_parts() {
        let value = json!({"candidates":[{"content":{"parts":[{"text":"hmm","thought":true},{"text":"cube(1);"}]}}]});
        assert_eq!(gemini_text(&value).unwrap(), "cube(1);");
        assert_eq!(gemini_body(&request())["generationConfig"]["responseMimeType"], "application/json");
    }

    #[test]
    fn openai_compatible_request_shape() {
        let body = openai_body("gpt-x", &request(), "openai");
        assert_eq!(body["messages"][0]["role"], "system");
        assert!(body["messages"][1]["content"][1]["image_url"]["url"].as_str().unwrap().starts_with("data:image/png;base64,"));
        assert_eq!(body["response_format"]["type"], "json_object");
        assert!(openai_body("m", &request(), "custom").get("response_format").is_none());
    }

    #[test]
    fn ollama_sends_images_on_the_message() {
        let body = ollama_body("llava", &request());
        assert_eq!(body["messages"][1]["images"][0], "QUJD");
        assert_eq!(body["format"], "json");
    }

    #[test]
    fn a_key_is_required_only_where_needed() {
        let mut config = Config::default();
        config.keys.insert("groq".into(), " k ".into());
        assert_eq!(secret(&config, "groq", &spec("groq").unwrap()).unwrap(), "k");
        assert_eq!(secret(&config, "lmstudio", &spec("lmstudio").unwrap()).unwrap(), "");
    }

    #[test]
    fn custom_endpoints_need_a_valid_url() {
        let mut config = Config::default();
        let custom = spec("custom").unwrap();
        assert!(base(&config, "custom", &custom).is_err());
        config.base_urls.insert("custom".into(), "ftp://x".into());
        assert!(base(&config, "custom", &custom).is_err());
        config.base_urls.insert("custom".into(), "http://127.0.0.1:8000/v1/".into());
        assert_eq!(base(&config, "custom", &custom).unwrap(), "http://127.0.0.1:8000/v1");
    }

    #[test]
    fn provider_errors_are_readable() {
        assert_eq!(provider_message(r#"{"error":{"message":"bad model"}}"#).unwrap(), "bad model");
        assert_eq!(provider_message(r#"{"error":"nope"}"#).unwrap(), "nope");
        assert!(provider_message("<html>").is_none());
    }
}
