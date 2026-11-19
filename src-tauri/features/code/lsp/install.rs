//! Installing and updating the servers in the catalog, the way Zed does: Misty fetches each one
//! itself into its own folder, builds the install in staging, and renames it into place only
//! once it is whole. Updates are looked for at most once a day, in the background.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tokio::sync::Mutex as AsyncMutex;

use super::catalog::{self, Language, Source};
use super::download::{self, Progress, Step};
use super::node;
use super::store::{self, ServerRecord};

/// How long npm or `go install` may take; gopls compiles from source.
const INSTALL_TIMEOUT: Duration = Duration::from_secs(900);
const UPDATE_EVERY_SECS: i64 = 24 * 60 * 60;

/// One install of each language at a time; a second asker waits and then finds it there.
static INSTALLING: [AsyncMutex<()>; 4] = [
    AsyncMutex::const_new(()),
    AsyncMutex::const_new(()),
    AsyncMutex::const_new(()),
    AsyncMutex::const_new(()),
];
/// A background look for updates already running, per language.
static CHECKING: [AtomicBool; 4] = [
    AtomicBool::new(false),
    AtomicBool::new(false),
    AtomicBool::new(false),
    AtomicBool::new(false),
];

/// The newest release of a server.
#[derive(Debug)]
struct Latest {
    version: String,
    packages: BTreeMap<String, String>,
    /// For a downloaded program: where it is and its published SHA-256, when one is published.
    asset: Option<(String, Option<String>)>,
}

/// What it takes to start a server: the program and its arguments, all decided here.
pub(super) struct Launch {
    pub(super) program: PathBuf,
    pub(super) args: Vec<OsString>,
    pub(super) path: OsString,
    /// The install it runs from, kept on disk while it runs.
    pub(super) dir: PathBuf,
}

/// The installed server for `language`, if its files are all there.
pub(super) async fn current(base: &Path, language: Language) -> Option<ServerRecord> {
    let record = store::read(base).servers.get(language.id()).cloned()?;
    let dir = store::resolve(base, &record.dir)?;
    let whole = match language.source() {
        Source::Npm { package, bin, .. } => {
            let found = server_script(&dir, package, bin).is_some();
            // The npm servers also need a Node.js to run on.
            found && node::find(base).await.is_some()
        }
        Source::GithubGz { program, .. } | Source::GoInstall { program, .. } => {
            file_access::fs::is_file(dir.join(catalog::program_file(program)))
        }
    };
    whole.then_some(record)
}

/// Why `language` can't be installed here, if something on the computer is missing.
pub(super) fn missing(language: Language) -> Option<&'static str> {
    match language {
        Language::Go if crate::engines::resolve::find_program("go").is_none() => {
            Some(catalog::GO_MISSING)
        }
        _ => None,
    }
}

/// Installs the newest `language` server unless one is already there.
pub(super) async fn install(
    base: &Path,
    language: Language,
    progress: Option<&Progress>,
) -> Result<ServerRecord, String> {
    let _held = INSTALLING[language.index()].lock().await;
    if let Some(record) = current(base, language).await {
        return Ok(record);
    }
    let latest = latest(language).await?;
    install_version(base, language, &latest, progress).await
}

/// Looks for a newer `language` server in the background, at most once a day, and installs it
/// beside the current one. It never holds up a start: servers that are running keep their files,
/// and the next start uses the new one.
pub(super) fn check_for_update(base: PathBuf, language: Language, in_use: Vec<PathBuf>) {
    let now = chrono::Utc::now().timestamp();
    let last = store::read(&base)
        .checked
        .get(language.id())
        .copied()
        .unwrap_or(0);
    if now - last < UPDATE_EVERY_SECS {
        return;
    }
    if CHECKING[language.index()].swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        // Marked first, so a failed look waits a day too instead of trying at every start.
        let _ = store::update(&base, |installed| {
            installed.checked.insert(language.id().to_string(), now);
        });
        store::prune_staging(&base);
        let _ = update(&base, language).await;
        store::prune_servers(&base, language, &in_use);
        CHECKING[language.index()].store(false, Ordering::SeqCst);
    });
}

async fn update(base: &Path, language: Language) -> Result<(), String> {
    let _held = INSTALLING[language.index()].lock().await;
    let Some(record) = current(base, language).await else {
        return Ok(());
    };
    let latest = latest(language).await?;
    let newer = record.version != latest.version
        || (!latest.packages.is_empty() && record.packages != latest.packages);
    if newer {
        install_version(base, language, &latest, None).await?;
    }
    Ok(())
}

async fn latest(language: Language) -> Result<Latest, String> {
    match language.source() {
        Source::Npm {
            packages, package, ..
        } => {
            let mut versions = BTreeMap::new();
            for name in packages {
                let answer =
                    download::json(&format!("https://registry.npmjs.org/{name}/latest")).await?;
                let version = answer
                    .get("version")
                    .and_then(|version| version.as_str())
                    .filter(|version| plain_version(version))
                    .ok_or_else(|| format!("npm didn't say which {name} is newest."))?;
                versions.insert(name.to_string(), version.to_string());
            }
            Ok(Latest {
                version: versions.get(package).cloned().unwrap_or_default(),
                packages: versions,
                asset: None,
            })
        }
        Source::GithubGz { repo, .. } => {
            let asset_name =
                catalog::rust_analyzer_asset(std::env::consts::OS, std::env::consts::ARCH)
                    .ok_or_else(|| format!("{} isn't built for this system.", language.server()))?;
            let release = download::json(&format!(
                "https://api.github.com/repos/{repo}/releases/latest"
            ))
            .await?;
            let version = release
                .get("tag_name")
                .and_then(|tag| tag.as_str())
                .filter(|tag| plain_version(tag))
                .ok_or("GitHub didn't say which release is newest.")?
                .to_string();
            let asset = release
                .get("assets")
                .and_then(|assets| assets.as_array())
                .and_then(|assets| {
                    assets.iter().find(|asset| {
                        asset.get("name").and_then(|name| name.as_str())
                            == Some(asset_name.as_str())
                    })
                })
                .ok_or_else(|| {
                    format!(
                        "This {} release has no build for this system.",
                        language.server()
                    )
                })?;
            let url = asset
                .get("browser_download_url")
                .and_then(|url| url.as_str())
                .filter(|url| url.starts_with("https://"))
                .ok_or("GitHub didn't say where the download is.")?
                .to_string();
            // GitHub publishes each asset's digest as `sha256:<hex>`.
            let sha256 = asset
                .get("digest")
                .and_then(|digest| digest.as_str())
                .and_then(|digest| digest.strip_prefix("sha256:"))
                .filter(|hex| hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit()))
                .map(str::to_ascii_lowercase);
            Ok(Latest {
                version,
                packages: BTreeMap::new(),
                asset: Some((url, sha256)),
            })
        }
        Source::GoInstall { module, .. } => {
            let answer =
                download::json(&format!("https://proxy.golang.org/{module}/@latest")).await?;
            let version = answer
                .get("Version")
                .and_then(|version| version.as_str())
                .filter(|version| plain_version(version))
                .ok_or("The Go module proxy didn't say which gopls is newest.")?;
            Ok(Latest {
                version: version.to_string(),
                packages: BTreeMap::new(),
                asset: None,
            })
        }
    }
}

/// A version as a release names it, safe to pass on a command line (`5.9.3`, `v0.20.0`,
/// `2025-11-10`).
fn plain_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 64
        && !version.starts_with('-')
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+' | '_'))
}

async fn install_version(
    base: &Path,
    language: Language,
    latest: &Latest,
    progress: Option<&Progress>,
) -> Result<ServerRecord, String> {
    let staging = store::staging(base)?;
    let made = staging.join("out");
    let result = async {
        file_access::fs::create_dir_all(&made).map_err(|error| error.to_string())?;
        build(base, language, latest, &staging, &made, progress).await?;
        let dir = store::server_dir(language, &latest.version);
        store::settle(base, &made, &dir)?;
        let record = ServerRecord {
            version: latest.version.clone(),
            packages: latest.packages.clone(),
            dir,
        };
        store::update(base, |installed| {
            installed
                .servers
                .insert(language.id().to_string(), record.clone());
        })?;
        Ok(record)
    }
    .await;
    let _ = file_access::fs::remove_dir_all(&staging);
    result
}

/// Makes the install in `made`.
async fn build(
    base: &Path,
    language: Language,
    latest: &Latest,
    staging: &Path,
    made: &Path,
    progress: Option<&Progress>,
) -> Result<(), String> {
    match language.source() {
        Source::Npm { package, bin, .. } => {
            let node = node::ensure(base, progress).await?;
            download::report(progress, Step::Install, 0, None);
            let mut command = node.npm();
            command
                .arg("install")
                .arg("--prefix")
                .arg(made)
                .args([
                    "--no-save",
                    "--no-package-lock",
                    "--no-audit",
                    "--no-fund",
                    "--ignore-scripts",
                    "--loglevel=error",
                ])
                .args(
                    latest
                        .packages
                        .iter()
                        .map(|(name, version)| format!("{name}@{version}")),
                )
                .current_dir(made)
                .env("npm_config_update_notifier", "false");
            run(command, "npm").await?;
            server_script(made, package, bin)
                .map(|_| ())
                .ok_or_else(|| format!("npm didn't install {}.", language.server()))
        }
        Source::GithubGz { program, .. } => {
            let (url, sha256) = latest
                .asset
                .as_ref()
                .ok_or("GitHub didn't say where the download is.")?;
            let archive = staging.join("download.gz");
            let got = download::to_file(url, &archive, Step::Download, progress).await?;
            if sha256.as_ref().is_some_and(|expected| *expected != got) {
                return Err(format!(
                    "The {} download didn't match its published checksum, so it was thrown \
                     away. Try again.",
                    language.server()
                ));
            }
            let target = made.join(catalog::program_file(program));
            tokio::task::spawn_blocking(move || download::gunzip(&archive, &target))
                .await
                .map_err(|error| error.to_string())?
                .map_err(|error| format!("Couldn't unpack {}: {error}", language.server()))
        }
        Source::GoInstall { module, program } => {
            let go = crate::engines::resolve::find_program("go").ok_or(catalog::GO_MISSING)?;
            download::report(progress, Step::Install, 0, None);
            let mut command = crate::engines::resolve::command_for(&go);
            command
                .arg("install")
                .arg(format!("{module}@{}", latest.version))
                .current_dir(made)
                .env("PATH", crate::engines::resolve::search_path())
                .env("GOBIN", made)
                // Outside any module, so a go.work or go.mod nearby can't change what is built.
                .env("GOWORK", "off");
            run(command, "go install").await?;
            if file_access::fs::is_file(made.join(catalog::program_file(program))) {
                Ok(())
            } else {
                Err("go install didn't build gopls.".into())
            }
        }
    }
}

/// Runs an installer to the end, with what it printed last as the error when it fails.
async fn run(mut command: tokio::process::Command, what: &str) -> Result<(), String> {
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    crate::engines::hide_console(&mut command);
    let output = tokio::time::timeout(INSTALL_TIMEOUT, command.output())
        .await
        .map_err(|_| format!("{what} took too long, so Misty stopped it."))?
        .map_err(|error| format!("{what} couldn't be started: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let said = String::from_utf8_lossy(&output.stderr);
    let tail: String = said
        .trim()
        .lines()
        .rev()
        .take(3)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(" ");
    if tail.is_empty() {
        Err(format!("{what} failed."))
    } else {
        Err(format!("{what} failed: {tail}"))
    }
}

/// The script an npm package names as `bin` in its manifest, if it's there.
fn server_script(dir: &Path, package: &str, bin: &str) -> Option<PathBuf> {
    let folder = dir.join("node_modules").join(package);
    let manifest: serde_json::Value =
        serde_json::from_str(&download::read_small(&folder.join("package.json")).ok()?).ok()?;
    let relative = match manifest.get("bin")? {
        serde_json::Value::String(only) => only.as_str(),
        serde_json::Value::Object(named) => named.get(bin)?.as_str()?,
        _ => return None,
    };
    let script = store::resolve(&folder, relative.trim_start_matches("./"))?;
    file_access::fs::is_file(&script).then_some(script)
}

/// How to start the installed `language` server.
pub(super) async fn launch(
    base: &Path,
    language: Language,
    record: &ServerRecord,
) -> Result<Launch, String> {
    let dir = store::resolve(base, &record.dir)
        .ok_or_else(|| format!("{} isn't installed.", language.server()))?;
    let args = language.args().iter().map(OsString::from);
    match language.source() {
        Source::Npm { package, bin, .. } => {
            let script = server_script(&dir, package, bin)
                .ok_or_else(|| format!("{} isn't installed.", language.server()))?;
            let node = node::find(base)
                .await
                .ok_or("Node.js is gone from this computer. Install the server again.")?;
            let mut all = vec![script.into_os_string()];
            all.extend(args);
            Ok(Launch {
                path: node.search_path(),
                program: node.node,
                args: all,
                dir,
            })
        }
        Source::GithubGz { program, .. } | Source::GoInstall { program, .. } => Ok(Launch {
            program: dir.join(catalog::program_file(program)),
            args: args.collect(),
            path: crate::engines::resolve::search_path(),
            dir,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_with_shell_or_flag_text_are_refused() {
        assert!(plain_version("5.9.3"));
        assert!(plain_version("v0.20.0"));
        assert!(plain_version("2025-11-10"));
        assert!(!plain_version("--global"));
        assert!(!plain_version("1.0; rm -rf"));
        assert!(!plain_version(""));
    }
}
