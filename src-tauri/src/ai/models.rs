use super::*;

pub async fn list(c: &Config) -> Result<Vec<String>, String> {
    let mut names: Vec<String> = match c.provider.as_str() {
        "gemini" => {
            let v = response(
                client()
                    .get("https://generativelanguage.googleapis.com/v1beta/models")
                    .header("x-goog-api-key", key(&c.gemini_key, "GEMINI_API_KEY")?)
                    .query(&[("pageSize", "1000")]),
            )
            .await?;
            v["models"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|m| {
                    m["supportedGenerationMethods"]
                        .as_array()
                        .is_some_and(|methods| methods.iter().any(|m| m == "generateContent"))
                })
                .filter_map(|m| m["name"].as_str())
                .map(|s| s.trim_start_matches("models/").to_string())
                .collect()
        }
        "openai" => {
            let v = response(
                client()
                    .get("https://api.openai.com/v1/models")
                    .bearer_auth(key(&c.openai_key, "OPENAI_API_KEY")?),
            )
            .await?;
            v["data"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|m| m["id"].as_str())
                .filter(|s| {
                    s.starts_with("gpt-")
                        || s.starts_with("o1")
                        || s.starts_with("o3")
                        || s.starts_with("o4")
                })
                .map(str::to_string)
                .collect()
        }
        "ollama" => {
            let v = response(client().get("http://127.0.0.1:11434/api/tags")).await?;
            v["models"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|m| m["name"].as_str())
                .map(str::to_string)
                .collect()
        }
        "codex" => {
            return Err(
                "Enter the Codex model ID manually; availability follows your CLI account".into(),
            )
        }
        _ => return Err("Unknown provider".into()),
    };
    names.sort();
    names.dedup();
    Ok(names)
}
