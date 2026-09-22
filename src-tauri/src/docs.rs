use serde::{Deserialize, Serialize};
use std::path::Path;

const SOURCES: &[&str] = &[
    "https://openscad.org/cheatsheet/",
    "https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/3D_Modelling",
    "https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/CSG_Modelling",
    "https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Transformations",
    "https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/3D_to_2D_Projection",
    "https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/2D_to_3D_Extrusion",
];

#[derive(Serialize, Deserialize)]
struct Page {
    url: String,
    text: String,
}
#[derive(Serialize, Deserialize)]
struct Cache {
    at: u64,
    pages: Vec<Page>,
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn extract(html: &str) -> String {
    let doc = scraper::Html::parse_document(html);
    // Avoid scripts, navigation and style source in retrieval context.
    let selector = scraper::Selector::parse("main p, main pre, main li, main td, .mw-parser-output p, .mw-parser-output pre, .mw-parser-output li, .mw-parser-output td, .ref, .refhead, .section").unwrap();
    let mut parts: Vec<String> = doc
        .select(&selector)
        .map(|e| {
            e.text()
                .collect::<Vec<_>>()
                .join(" ")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|s| !s.is_empty())
        .collect();
    parts.dedup();
    parts.join("\n").chars().take(80_000).collect()
}

pub async fn sync(dir: &Path) -> Result<usize, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("OpenSCAD-AI/2.0 (documentation cache)")
        .build()
        .map_err(|e| e.to_string())?;
    let previous = read(dir);
    let mut pages = Vec::new();
    let mut downloaded = 0;
    for &url in SOURCES {
        let response = client.get(url).send().await;
        let text = match response {
            Ok(r) if r.status().is_success() => r
                .text()
                .await
                .ok()
                .map(|html| extract(&html))
                .filter(|s| !s.is_empty()),
            _ => None,
        };
        if let Some(text) = text {
            pages.push(Page {
                url: url.into(),
                text,
            });
            downloaded += 1;
        } else if let Some(old) = previous
            .as_ref()
            .and_then(|c| c.pages.iter().find(|p| p.url == url))
        {
            pages.push(Page {
                url: old.url.clone(),
                text: old.text.clone(),
            });
        }
    }
    if downloaded == 0 {
        return Err(
            "Documentation could not be downloaded; the existing cache was preserved".into(),
        );
    }
    // Persist atomically; a cancelled sync must never destroy the previous cache.
    let mut file = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    use std::io::Write;
    file.write_all(&serde_json::to_vec(&Cache { at: now(), pages }).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.persist(dir.join("docs-cache.json"))
        .map_err(|e| e.to_string())?;
    Ok(downloaded)
}

pub fn stale(dir: &Path) -> bool {
    read(dir)
        .map(|c| now().saturating_sub(c.at) > 604800)
        .unwrap_or(true)
}
fn read(dir: &Path) -> Option<Cache> {
    serde_json::from_slice(&std::fs::read(dir.join("docs-cache.json")).ok()?).ok()
}

pub fn context(dir: &Path, prompt: &str) -> String {
    let Some(cache) = read(dir) else {
        return "Use documented OpenSCAD primitives, CSG operations, explicit transforms and top-level numeric parameters.".into();
    };
    let words: Vec<_> = prompt
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 3)
        .map(str::to_string)
        .collect();
    let mut chunks = vec![];
    for page in cache.pages {
        let chars: Vec<_> = page.text.chars().collect();
        for chunk in chars.chunks(900) {
            let text: String = chunk.iter().collect();
            let lower = text.to_lowercase();
            let score = words.iter().filter(|w| lower.contains(w.as_str())).count();
            chunks.push((score, format!("{}\n{}", page.url, text)));
        }
    }
    chunks.sort_by(|a, b| b.0.cmp(&a.0));
    chunks
        .into_iter()
        .take(4)
        .map(|(_, text)| text)
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn excludes_scripts_from_cache() {
        assert_eq!(
            extract("<main><script>secret()</script><p>cube(5);</p></main>"),
            "cube(5);"
        );
    }
    #[test]
    fn missing_cache_has_fallback() {
        let dir = tempfile::tempdir().unwrap();
        assert!(stale(dir.path()));
        assert!(!context(dir.path(), "cube").is_empty());
    }
}
