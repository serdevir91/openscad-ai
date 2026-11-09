use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tokio::process::Command;

pub const FORMATS: [&str; 5] = ["stl", "csg", "3mf", "off", "amf"];

pub fn command(path: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut c = Command::new(path);
    c.kill_on_drop(true);
    #[cfg(windows)]
    c.creation_flags(0x08000000);
    c
}

fn bundled() -> Vec<PathBuf> {
    let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    else {
        return Vec::new();
    };
    ["openscad.exe", "openscad", "openscad/openscad.exe"]
        .iter()
        .map(|name| dir.join(name))
        .collect()
}

pub fn detect(explicit: &str) -> Result<PathBuf, String> {
    if !explicit.trim().is_empty() {
        let p = PathBuf::from(explicit.trim());
        return if p.is_file() {
            Ok(p)
        } else {
            Err("The OpenSCAD path was not found".into())
        };
    }
    if let Ok(env_path) = std::env::var("OPENSCAD_PATH") {
        let p = PathBuf::from(env_path);
        if p.is_file() {
            return Ok(p);
        }
    }
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut candidates = bundled();
    candidates.extend(
        [
            r"C:\Program Files\OpenSCAD\openscad.exe",
            r"C:\Program Files (x86)\OpenSCAD\openscad.exe",
            "/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD",
            "/Applications/OpenSCAD-Nightly.app/Contents/MacOS/OpenSCAD",
        ]
        .map(PathBuf::from),
    );
    if let Some(home) = &home {
        candidates.push(home.join("Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD"));
    }
    candidates.extend(["/opt/homebrew/bin/openscad", "/usr/local/bin/openscad"].map(PathBuf::from));
    if let Some(found) = candidates.into_iter().find(|p| p.is_file()) {
        return Ok(found);
    }
    which::which("openscad")
        .map_err(|_| "OpenSCAD CLI was not found; select its path in Settings".into())
}

/// Release year of a binary. Snapshots are named by date, such as `2026.10.11`.
async fn release_year(exe: &Path) -> u32 {
    static SEEN: OnceLock<Mutex<HashMap<PathBuf, u32>>> = OnceLock::new();
    let seen = SEEN.get_or_init(Default::default);
    if let Some(year) = seen.lock().ok().and_then(|map| map.get(exe).copied()) {
        return year;
    }
    let mut c = command(exe);
    c.arg("--version");
    let output = tokio::time::timeout(Duration::from_secs(10), c.output()).await;
    let year = output
        .ok()
        .and_then(Result::ok)
        .map(|o| {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&o.stdout),
                String::from_utf8_lossy(&o.stderr)
            );
            parse_year(&text)
        })
        .unwrap_or(0);
    if let Ok(mut map) = seen.lock() {
        map.insert(exe.to_path_buf(), year);
    }
    year
}

fn parse_year(text: &str) -> u32 {
    text.split(|c: char| !c.is_ascii_digit() && c != '.')
        .find_map(|word| word.split('.').next()?.parse::<u32>().ok().filter(|y| *y > 2000))
        .unwrap_or(0)
}

pub async fn version(exe: &Path) -> String {
    let mut c = command(exe);
    c.arg("--version");
    let output = tokio::time::timeout(Duration::from_secs(10), c.output()).await;
    output
        .ok()
        .and_then(Result::ok)
        .map(|o| {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&o.stdout),
                String::from_utf8_lossy(&o.stderr)
            );
            text.trim().to_string()
        })
        .unwrap_or_default()
}

/// Compiles `source` into `out` and returns the console log, including any warnings.
pub async fn compile(exe: &Path, source: &Path, out: &Path, timeout: u32) -> Result<String, String> {
    let modern = release_year(exe).await >= 2024;
    let extension = out.extension().and_then(|e| e.to_str()).unwrap_or_default();
    let mut c = command(exe);
    c.arg("-o").arg(out);
    if modern && extension != "csg" {
        // Manifold is many times faster than CGAL and produces the same solids.
        c.arg("--backend=manifold");
    }
    if modern && extension == "stl" {
        c.args(["--export-format", "binstl"]);
    }
    c.arg(source);
    let result = tokio::time::timeout(Duration::from_secs(timeout.into()), c.output())
        .await
        .map_err(|_| {
            format!("OpenSCAD timed out after {timeout} seconds (the model may be too complex or $fn may be too high)")
        })?
        .map_err(|e| e.to_string())?;
    let log = String::from_utf8_lossy(&result.stderr);
    if !result.status.success() || log.contains("ERROR:") || !out.is_file() {
        return Err(log.chars().take(6000).collect());
    }
    if std::fs::metadata(out).map_err(|e| e.to_string())?.len() == 0 {
        return Err("The geometry is empty".into());
    }
    Ok(log.chars().take(6000).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_the_release_year() {
        assert_eq!(parse_year("OpenSCAD version 2026.10.11\n"), 2026);
        assert_eq!(parse_year("OpenSCAD version 2021.01"), 2021);
        assert_eq!(parse_year("something else"), 0);
    }
}
