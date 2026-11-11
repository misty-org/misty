// Finding an engine's command-line program on this computer.
//
// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong),
// src-tauri/src/engine/resolve.rs. See NOTICE.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

/// The folders a desktop app's own PATH usually misses: a person's login shell adds them, but an
/// app opened from the Dock never ran that shell.
fn usual_folders() -> Vec<PathBuf> {
    let mut folders: Vec<PathBuf> = Vec::new();
    #[cfg(not(windows))]
    {
        for fixed in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
            folders.push(PathBuf::from(fixed));
        }
        if let Some(home) = dirs::home_dir() {
            for under_home in [
                ".local/bin",
                ".claude/local",
                ".codex-cli/bin",
                ".opencode/bin",
                ".local/share/mise/shims",
                ".cargo/bin",
                ".bun/bin",
                ".volta/bin",
                ".npm-global/bin",
            ] {
                folders.push(home.join(under_home));
            }
        }
    }
    #[cfg(windows)]
    {
        if let Some(roaming) = std::env::var_os("APPDATA") {
            folders.push(PathBuf::from(roaming).join("npm"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            folders.push(local.join("Programs").join("nodejs"));
            folders.push(local.join("pnpm"));
            folders.push(local.join("Volta").join("bin"));
        }
        if let Some(home) = dirs::home_dir() {
            folders.push(home.join("scoop").join("shims"));
            folders.push(home.join(".bun").join("bin"));
        }
    }
    folders
}

/// The PATH the person's login shell builds, asked once. An app started from the Dock gets a
/// short PATH, and the engines are usually installed where only the shell's PATH reaches.
#[cfg(not(windows))]
fn login_shell_path() -> Option<String> {
    const MARK: &str = "__MISTY_PATH__";
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut child = std::process::Command::new(shell)
        .args(["-l", "-i", "-c", &format!("echo '{MARK}'\"$PATH\"")])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() > Duration::from_secs(3) => {
                let _ = child.kill();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(_) => return None,
        }
    }
    let output = child.wait_with_output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let path = text.rsplit(MARK).next()?.lines().next()?.trim().to_string();
    (!path.is_empty()).then_some(path)
}

#[cfg(windows)]
fn login_shell_path() -> Option<String> {
    None
}

/// Every folder an engine may be installed in, in the order they are searched: the app's own
/// PATH, the login shell's, then the usual folders.
pub fn search_folders() -> &'static [PathBuf] {
    static FOLDERS: OnceLock<Vec<PathBuf>> = OnceLock::new();
    FOLDERS.get_or_init(|| {
        let mut folders: Vec<PathBuf> = Vec::new();
        let mut add = |folder: PathBuf| {
            if !folder.as_os_str().is_empty() && !folders.contains(&folder) {
                folders.push(folder);
            }
        };
        if let Some(own) = std::env::var_os("PATH") {
            std::env::split_paths(&own).for_each(&mut add);
        }
        if let Some(login) = login_shell_path() {
            std::env::split_paths(&login).for_each(&mut add);
        }
        usual_folders().into_iter().for_each(&mut add);
        folders
    })
}

/// The PATH an engine is started with, so the tools it runs itself (node, git) are found too.
pub fn search_path() -> std::ffi::OsString {
    std::env::join_paths(search_folders()).unwrap_or_default()
}

#[cfg(windows)]
const ENDINGS: [&str; 5] = [".exe", ".cmd", ".bat", ".com", ""];
#[cfg(not(windows))]
const ENDINGS: [&str; 1] = [""];

// Looking for a program on the PATH only asks whether a file is there and can be run; it reads
// nothing. The file gate would refuse these folders, which hold no data of the person's.
#[allow(clippy::disallowed_methods)]
fn runnable(path: &Path) -> bool {
    let Ok(found) = std::fs::metadata(path) else {
        return false;
    };
    if !found.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        found.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// Where the named program is, or nothing when it isn't installed.
pub fn find_program(name: &str) -> Option<PathBuf> {
    search_folders().iter().find_map(|folder| {
        ENDINGS
            .iter()
            .map(|ending| folder.join(format!("{name}{ending}")))
            .find(|candidate| runnable(candidate))
    })
}

/// A command for the program at `path`. On Windows a `.cmd` or `.bat` wrapper (how npm installs
/// a program) can't be started directly, so it runs through `cmd /c`.
pub fn command_for(path: &Path) -> tokio::process::Command {
    #[cfg(windows)]
    {
        let wrapper = path
            .extension()
            .and_then(|ending| ending.to_str())
            .is_some_and(|ending| {
                ending.eq_ignore_ascii_case("cmd") || ending.eq_ignore_ascii_case("bat")
            });
        if wrapper {
            let mut command = tokio::process::Command::new("cmd");
            command.arg("/c").arg(path);
            return command;
        }
    }
    tokio::process::Command::new(path)
}

/// The program's own version line, or nothing if it didn't answer in time.
pub async fn version_of(path: &Path) -> Option<String> {
    let mut command = command_for(path);
    command
        .arg("--version")
        .env("PATH", search_path())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(5), command.output())
        .await
        .ok()?
        .ok()?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}
