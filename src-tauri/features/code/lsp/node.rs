//! Node.js for the servers that ship on npm. The computer's own `node` and `npm` are used when
//! they're v18 or newer; otherwise Misty fetches the current Node.js LTS from nodejs.org, checks
//! it against the release's `SHASUMS256.txt`, and keeps it in its own folder. It is never put on
//! the person's PATH.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::process::Command;
use tokio::sync::{Mutex as AsyncMutex, OnceCell};

use super::download::{self, Progress, Step};
use super::store;

const MINIMUM_MAJOR: u64 = 18;
const DIST: &str = "https://nodejs.org/dist";

/// A Node.js to run npm and the servers with.
#[derive(Clone, Debug)]
pub(super) struct Node {
    pub(super) node: PathBuf,
    npm: Npm,
}

#[derive(Clone, Debug)]
enum Npm {
    /// The computer's own `npm`, a script or wrapper found on PATH.
    Program(PathBuf),
    /// npm's entry script inside Misty's Node.js, run with its `node`.
    Script(PathBuf),
}

impl Node {
    /// A command that runs npm.
    pub(super) fn npm(&self) -> Command {
        let mut command = match &self.npm {
            Npm::Program(npm) => crate::engines::resolve::command_for(npm),
            Npm::Script(cli) => {
                let mut command = Command::new(&self.node);
                command.arg(cli);
                command
            }
        };
        command.env("PATH", self.search_path());
        command
    }

    /// The search PATH with this Node.js first, so `#!/usr/bin/env node` scripts and anything
    /// the servers start find the same one.
    pub(super) fn search_path(&self) -> OsString {
        let mut dirs: Vec<PathBuf> = self
            .node
            .parent()
            .map(Path::to_path_buf)
            .into_iter()
            .collect();
        dirs.extend(std::env::split_paths(
            &crate::engines::resolve::search_path(),
        ));
        std::env::join_paths(dirs).unwrap_or_else(|_| crate::engines::resolve::search_path())
    }
}

/// The computer's own Node.js, looked up once per launch.
static SYSTEM: OnceCell<Option<Node>> = OnceCell::const_new();
/// One download of Node.js at a time.
static FETCHING: AsyncMutex<()> = AsyncMutex::const_new(());

/// A Node.js that is there now, without fetching one.
pub(super) async fn find(base: &Path) -> Option<Node> {
    if let Some(node) = SYSTEM.get_or_init(system).await {
        return Some(node.clone());
    }
    own(base)
}

/// A Node.js, fetching Misty's own when the computer has none new enough.
pub(super) async fn ensure(base: &Path, progress: Option<&Progress>) -> Result<Node, String> {
    if let Some(node) = find(base).await {
        return Ok(node);
    }
    let _held = FETCHING.lock().await;
    // Another install may have fetched it while this one waited.
    if let Some(node) = own(base) {
        return Ok(node);
    }
    fetch(base, progress).await?;
    own(base).ok_or_else(|| "The Node.js download didn't hold what Misty expected.".to_string())
}

async fn system() -> Option<Node> {
    let node = crate::engines::resolve::find_program("node")?;
    let npm = crate::engines::resolve::find_program("npm")?;
    let mut command = crate::engines::resolve::command_for(&node);
    command
        .arg("--version")
        .env("PATH", crate::engines::resolve::search_path())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    crate::engines::hide_console(&mut command);
    let output = tokio::time::timeout(Duration::from_secs(5), command.output())
        .await
        .ok()?
        .ok()?;
    let version = String::from_utf8_lossy(&output.stdout);
    (major(&version)? >= MINIMUM_MAJOR).then_some(Node {
        node,
        npm: Npm::Program(npm),
    })
}

/// The major version in `node --version`'s answer (`v20.11.1`).
fn major(version: &str) -> Option<u64> {
    version
        .trim()
        .trim_start_matches('v')
        .split('.')
        .next()?
        .parse()
        .ok()
}

/// Misty's own Node.js, if it is unpacked and whole.
fn own(base: &Path) -> Option<Node> {
    let record = store::read(base).node?;
    let root = store::resolve(base, &record.dir)?;
    let (node, cli) = layout(&root);
    (file_access::fs::is_file(&node) && file_access::fs::is_file(&cli)).then_some(Node {
        node,
        npm: Npm::Script(cli),
    })
}

/// `node` and npm's entry script in a Node.js folder as nodejs.org ships it.
fn layout(root: &Path) -> (PathBuf, PathBuf) {
    if cfg!(windows) {
        (
            root.join("node.exe"),
            root.join("node_modules")
                .join("npm")
                .join("bin")
                .join("npm-cli.js"),
        )
    } else {
        (
            root.join("bin").join("node"),
            root.join("lib")
                .join("node_modules")
                .join("npm")
                .join("bin")
                .join("npm-cli.js"),
        )
    }
}

/// nodejs.org's archive name for this system at `version` (`v24.11.1`).
fn archive_name(version: &str, os: &str, arch: &str) -> Option<String> {
    let os = match os {
        "macos" => "darwin",
        "linux" => "linux",
        "windows" => "win",
        _ => return None,
    };
    let arch = match arch {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        _ => return None,
    };
    let ending = if os == "win" { "zip" } else { "tar.gz" };
    Some(format!("node-{version}-{os}-{arch}.{ending}"))
}

/// The newest LTS release in nodejs.org's index (newest first).
fn newest_lts(index: &serde_json::Value) -> Option<String> {
    index.as_array()?.iter().find_map(|release| {
        let lts = release.get("lts")?;
        let is_lts = lts.as_str().is_some_and(|name| !name.is_empty());
        let version = release.get("version")?.as_str()?;
        (is_lts && version.starts_with('v')).then(|| version.to_string())
    })
}

async fn fetch(base: &Path, progress: Option<&Progress>) -> Result<(), String> {
    let index = download::json(&format!("{DIST}/index.json")).await?;
    let version = newest_lts(&index).ok_or("nodejs.org lists no LTS release.")?;
    let file = archive_name(&version, std::env::consts::OS, std::env::consts::ARCH)
        .ok_or("Node.js isn't built for this system, so Misty can't get it.")?;
    let shasums = download::text(&format!("{DIST}/{version}/SHASUMS256.txt")).await?;
    let expected = download::sha256_from_shasums(&shasums, &file)
        .ok_or("nodejs.org's checksum list doesn't name this download.")?;
    let staging = store::staging(base)?;
    let result = async {
        let archive = staging.join(&file);
        let url = format!("{DIST}/{version}/{file}");
        let got = download::to_file(&url, &archive, Step::Node, progress).await?;
        if got != expected {
            return Err(
                "The Node.js download didn't match its published checksum, so it was \
                        thrown away. Try again."
                    .to_string(),
            );
        }
        let unpacked = staging.join("node");
        let (from, into) = (archive.clone(), unpacked.clone());
        tokio::task::spawn_blocking(move || {
            if file_ends_with_zip(&from) {
                download::unzip(&from, &into, 1)
            } else {
                download::untar_gz(&from, &into, 1)
            }
        })
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| format!("Couldn't unpack Node.js: {error}"))?;
        let (node, cli) = layout(&unpacked);
        if !file_access::fs::is_file(&node) || !file_access::fs::is_file(&cli) {
            return Err("The Node.js download didn't hold the program Misty expected.".into());
        }
        let dir = store::node_dir(&version);
        store::settle(base, &unpacked, &dir)?;
        store::update(base, |installed| {
            installed.node = Some(store::NodeRecord {
                version: version.clone(),
                dir,
            });
        })
    }
    .await;
    let _ = file_access::fs::remove_dir_all(&staging);
    result
}

fn file_ends_with_zip(path: &Path) -> bool {
    path.extension().is_some_and(|ending| ending == "zip")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_below_18_are_too_old() {
        assert_eq!(major("v20.11.1\n"), Some(20));
        assert_eq!(major("v16.0.0"), Some(16));
        assert_eq!(major("not node"), None);
    }

    #[test]
    fn the_newest_lts_is_picked() {
        let index = serde_json::json!([
            { "version": "v25.1.0", "lts": false },
            { "version": "v24.11.1", "lts": "Krypton" },
            { "version": "v22.21.0", "lts": "Jod" },
        ]);
        assert_eq!(newest_lts(&index).as_deref(), Some("v24.11.1"));
    }

    #[test]
    fn archives_are_named_like_nodejs_org() {
        assert_eq!(
            archive_name("v24.11.1", "macos", "aarch64").as_deref(),
            Some("node-v24.11.1-darwin-arm64.tar.gz")
        );
        assert_eq!(
            archive_name("v24.11.1", "windows", "x86_64").as_deref(),
            Some("node-v24.11.1-win-x64.zip")
        );
        assert_eq!(archive_name("v24.11.1", "linux", "riscv64"), None);
    }
}
