//! Which coding tools this device has, and whether each is signed in. Misty
//! never installs or signs in a tool; it reports what it finds so the server
//! can route work, and Settings can say what's missing.
use std::{
    env,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use serde::Serialize;

use super::EngineId;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EngineStatus {
    pub engine: &'static str,
    pub installed: bool,
    pub signed_in: bool,
    pub version: String,
}

/// The executable names each engine installs as.
pub fn executables(engine: EngineId) -> &'static [&'static str] {
    match engine {
        EngineId::Claude => &["claude"],
        EngineId::Codex => &["codex"],
        EngineId::Kimi => &["kimi"],
        EngineId::Minimax => &["minimax", "mmx"],
        EngineId::Grok => &["grok"],
        EngineId::Pi => &["pi"],
        EngineId::Omp => &["omp"],
        EngineId::Dsh => &["dsh"],
        EngineId::Agy => &["agy"],
        EngineId::Opencode => &["opencode"],
        EngineId::Qoder | EngineId::QoderCn => &["qodercli", "qoder"],
    }
}

/// Where tools keep credentials, relative to home. Present means signed in.
/// Tools with no known file (MiniMax, Pi, Oh My Pi, DeepSeek Shell,
/// Antigravity) count as signed in once installed; a run then fails with the
/// tool's own message if it isn't.
fn credential_files(engine: EngineId) -> &'static [&'static str] {
    match engine {
        EngineId::Claude => &[".claude/.credentials.json", ".claude.json"],
        EngineId::Codex => &[".codex/auth.json"],
        EngineId::Kimi => &[".kimi/credentials.json", ".kimi/config.toml"],
        EngineId::Grok => &[".grok/user-settings.json", ".grok/auth.json"],
        EngineId::Opencode => &[".local/share/opencode/auth.json"],
        EngineId::Qoder | EngineId::QoderCn => &[".qoder/auth.json", ".qoder.json"],
        _ => &[],
    }
}

/// Finds an executable on PATH and in the places installers commonly use,
/// since a desktop app often starts with a shorter PATH than a terminal.
pub fn locate(names: &[&str], home: Option<&Path>) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = env::var_os("PATH")
        .map(|path| env::split_paths(&path).collect())
        .unwrap_or_default();
    if let Some(home) = home {
        for extra in [
            ".local/bin",
            ".npm-global/bin",
            ".bun/bin",
            ".cargo/bin",
            ".claude/local",
            "bin",
        ] {
            dirs.push(home.join(extra));
        }
    }
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
    for dir in dirs {
        for name in names {
            for candidate in [
                dir.join(name),
                dir.join(format!("{name}.exe")),
                dir.join(format!("{name}.cmd")),
            ] {
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

/// The first line of `<tool> --version`, stopped after five seconds so a stuck
/// tool can't hang detection.
fn version_of(path: &Path) -> String {
    let Ok(mut child) = Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return String::new();
    };
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return String::new();
            }
        }
    }
    let mut text = String::new();
    if let Some(mut stdout) = child.stdout.take() {
        let _ = stdout.read_to_string(&mut text);
    }
    text.lines()
        .next()
        .map(|line| line.trim().chars().take(80).collect())
        .unwrap_or_default()
}

pub fn detect(engine: EngineId, home: Option<&Path>) -> EngineStatus {
    let path = locate(executables(engine), home);
    let files = credential_files(engine);
    let signed_in = path.is_some()
        && (files.is_empty()
            || home.is_some_and(|home| files.iter().any(|file| home.join(file).is_file())));
    EngineStatus {
        engine: engine.as_str(),
        installed: path.is_some(),
        signed_in,
        version: path.as_deref().map(version_of).unwrap_or_default(),
    }
}

/// Every engine's status on this device.
pub fn detect_all() -> Vec<EngineStatus> {
    let home = dirs::home_dir();
    EngineId::ALL
        .iter()
        .map(|engine| detect(*engine, home.as_deref()))
        .collect()
}
