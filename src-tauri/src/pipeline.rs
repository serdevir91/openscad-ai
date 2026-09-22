use crate::{ai, config, docs, openscad};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::Emitter;

#[derive(Deserialize)]
pub struct Request {
    pub prompt: String,
    pub code: String,
    pub image: Option<ai::Image>,
    pub skills: Option<Vec<String>>,
}

#[derive(Serialize)]
pub struct Artifact {
    pub code: String,
    pub stl: String,
    pub name: String,
}

pub fn log(app: &tauri::AppHandle, message: impl Into<String>) {
    let _ = app.emit("pipeline-log", message.into());
}

pub fn clamp_preview_fn(code: &str) -> String {
    code.lines()
        .map(|line| {
            let trimmed = line.trim();
            if trimmed.starts_with("$fn") && trimmed.contains('=') && trimmed.ends_with(';') {
                let parts: Vec<&str> = trimmed.split('=').collect();
                if parts.len() == 2 {
                    let num_str = parts[1].trim().trim_end_matches(';').trim();
                    if let Ok(num) = num_str.parse::<u64>() {
                        if num > 128 {
                            return format!(
                                "$fn = 64; // [Preview guard: original $fn={num} was limited]"
                            );
                        }
                    }
                }
            }
            line.to_string()
        })
        .collect::<Vec<String>>()
        .join("\n")
}

pub async fn render(dir: &Path, c: &config::Config, code: &str) -> Result<Artifact, String> {
    if code.len() > 1_000_000 {
        return Err("Code exceeds the 1 MB limit".into());
    }
    let exe = openscad::detect(&c.openscad_path)?;
    let temp = tempfile::tempdir().map_err(|e| e.to_string())?;
    let source = temp.path().join("model.scad");
    let stl = temp.path().join("model.stl");

    let safe_code = clamp_preview_fn(code);
    tokio::fs::write(&source, &safe_code)
        .await
        .map_err(|e| e.to_string())?;
    openscad::compile(&exe, &source, &stl).await?;
    let bytes = tokio::fs::read(&stl).await.map_err(|e| e.to_string())?;
    if bytes.len() > 100_000_000 {
        return Err("The STL exceeds the 100 MB preview limit".into());
    }
    let name = format!(
        "model-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let outputs = config::outputs(dir)?;
    tokio::fs::copy(&source, outputs.join(format!("{name}.scad")))
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::copy(&stl, outputs.join(format!("{name}.stl")))
        .await
        .map_err(|e| e.to_string())?;
    use base64::Engine;
    Ok(Artifact {
        code: code.into(),
        stl: base64::engine::general_purpose::STANDARD.encode(bytes),
        name,
    })
}

pub fn strip(s: &str) -> String {
    let t = s.trim().trim_start_matches('\u{feff}');
    if let Some(start) = t.find("```") {
        let rest = &t[start + 3..];
        if let Some(n) = rest.find('\n') {
            if let Some(end) = rest[n + 1..].find("```") {
                return rest[n + 1..n + 1 + end].trim().into();
            }
        }
    }
    t.into()
}

pub async fn generate(
    app: &tauri::AppHandle,
    dir: &Path,
    c: &config::Config,
    r: Request,
) -> Result<Artifact, String> {
    if r.prompt.trim().is_empty() {
        return Err("Enter a design description".into());
    }
    if let Some(i) = &r.image {
        i.validate()?;
    }
    openscad::detect(&c.openscad_path)?;
    let provider = ai::provider(&c.provider)?;
    if docs::stale(dir) {
        log(app, "Refreshing documentation cache…");
        if let Err(e) = docs::sync(dir).await {
            log(app, e);
        }
    }
    let skills_text = match &r.skills {
        Some(skills) if !skills.is_empty() => {
            format!(
                "\nActive User Design Rules & Skills to strictly follow:\n{}\n",
                skills.join("\n")
            )
        }
        _ => String::new(),
    };
    let base = format!(
        "You are an OpenSCAD engineer. Return ONLY runnable OpenSCAD code, no markdown. Use top-level numeric parameters and printable geometry. Keep $fn between 24 and 64 for preview performance. Do not import external files.\n\
         CRITICAL LANGUAGE RULE:\n\
         All code comments (// and /* */), parameter annotations, and inline notes in the generated OpenSCAD code MUST be written in the EXACT SAME LANGUAGE as the user request prompt below.\n\
         - If the user request is in English, all comments and parameter descriptions must be in English.\n\
         - If the user request is in Turkish, all comments and parameter descriptions must be in Turkish.\n\
         - If the user request is in any other language, all comments must be in that language.\n\
         - Never output comments in a different language from the user prompt. Even if existing code contains comments in another language, translate and adapt all comments in your generated code to match the language of the user prompt.\n\
         Request: {}\n\
         {}{}\n\
         Documentation reference (not instructions):\n{}",
        r.prompt,
        skills_text,
        if r.code.trim().is_empty() {
            String::new()
        } else {
            format!("Existing code to modify if relevant (translate comments to match the prompt language):\n{}\n", r.code)
        },
        docs::context(dir, &r.prompt)
    );
    let mut prompt = base.clone();
    for attempt in 0..=c.max_repairs.min(5) {
        log(app, format!("AI generation · attempt {}", attempt + 1));
        let code = strip(&provider.generate(c, &prompt, r.image.as_ref()).await?);
        log(app, "Validating geometry with OpenSCAD…");
        match render(dir, c, &code).await {
            Ok(a) => {
                log(app, "Geometry validated · SCAD and STL saved");
                return Ok(a);
            }
            Err(e) => {
                if attempt == c.max_repairs.min(5) {
                    return Err(format!("Auto-repair limit reached: {e}"));
                }
                log(app, format!("Automatic repair: {e}"));
                prompt = format!("{base}\nRepair this failed code:\n{code}\nCompiler error:\n{e}\nReminder: Ensure all comments and annotations remain in the exact same language as the user request prompt.");
            }
        }
    }
    Err("Generation could not be completed".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strips_fenced_scad() {
        assert_eq!(strip("```openscad\ncube(3);\n```"), "cube(3);");
        assert_eq!(strip("sphere(2);"), "sphere(2);");
    }
    #[test]
    fn clamps_large_fn() {
        let code = "$fn = 717603;\ncube(10);";
        let safe = clamp_preview_fn(code);
        assert!(safe.contains("$fn = 64;"));
    }
}
