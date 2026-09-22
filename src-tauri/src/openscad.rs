use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::process::Command;
pub fn command(path: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut c = Command::new(path);
    c.kill_on_drop(true);
    #[cfg(windows)]
    c.creation_flags(0x08000000);
    c
}
pub fn detect(explicit: &str) -> Result<PathBuf, String> {
    if !explicit.trim().is_empty() {
        let p = PathBuf::from(explicit);
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
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(dir) = current_exe.parent() {
            let local1 = dir.join("openscad.exe");
            if local1.is_file() {
                return Ok(local1);
            }
            let local2 = dir.join("openscad").join("openscad.exe");
            if local2.is_file() {
                return Ok(local2);
            }
        }
    }
    for p in [
        r"C:\Program Files\OpenSCAD\openscad.exe",
        r"C:\Program Files (x86)\OpenSCAD\openscad.exe",
    ] {
        if Path::new(p).is_file() {
            return Ok(p.into());
        }
    }
    which::which("openscad")
        .map_err(|_| "OpenSCAD CLI was not found; select its path in Settings".into())
}
pub async fn compile(exe: &Path, source: &Path, out: &Path) -> Result<(), String> {
    let mut c = command(exe);
    c.arg("-o").arg(out);
    if out.extension().is_some_and(|e| e == "png") {
        c.args(["--autocenter", "--viewall", "--imgsize=1600,1200"]);
    }
    c.arg(source);
    let result=tokio::time::timeout(Duration::from_secs(35),c.output()).await.map_err(|_|"OpenSCAD timed out after 35 seconds (the model may be too complex or $fn may be too high)".to_string())?.map_err(|e|e.to_string())?;
    let errors = String::from_utf8_lossy(&result.stderr);
    if !result.status.success() || errors.contains("ERROR:") || !out.is_file() {
        return Err(errors.chars().take(6000).collect());
    }
    if std::fs::metadata(out).map_err(|e| e.to_string())?.len() == 0 {
        return Err("The geometry is empty".into());
    }
    Ok(())
}
