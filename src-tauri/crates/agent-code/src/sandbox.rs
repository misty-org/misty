//! The sandbox every agent command runs in.
//!
//! macOS: Seatbelt through `/usr/bin/sandbox-exec`, with profiles copied from
//! OpenAI Codex (see NOTICE). Codex lets commands read the whole disk; Misty
//! doesn't, because a command's output goes back to the model. A command may:
//!
//! - read the system, developer tools and installed toolchains;
//! - read and write the project, its own temp folder and a private home;
//! - never write Git's folder (hooks would run outside the sandbox later),
//!   never read or write `.env`-style secret files, never delete the project;
//! - use no network at all, except Misty's package proxy when the person
//!   allowed package installs for the project.
//!
//! Commands can't listen for connections either: Seatbelt can't tell a
//! loopback listener from one open to the whole network (`localhost:*` also
//! matches `0.0.0.0`), and a listener would be a way around the closed
//! network. Previews are served by Misty itself (see `preview`).
//!
//! Windows: the project's own AppContainer; see [`windows`].
//!
//! Other platforms have no sandbox yet, so commands are refused there.
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use crate::CodeError;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::{
    approval_arguments, container_name, discover_tools, forget, tools_needing_approval,
    ToolFolder, TOOLS_CAPABILITY,
};

#[cfg(target_os = "macos")]
const BASE_POLICY: &str = include_str!("seatbelt/base.sbpl");
#[cfg(target_os = "macos")]
const PLATFORM_DEFAULTS: &str = include_str!("seatbelt/platform_defaults.sbpl");
#[cfg(target_os = "macos")]
const NETWORK_POLICY: &str = include_str!("seatbelt/network.sbpl");

/// Only the system copy; a `sandbox-exec` earlier on PATH could be anything.
pub const SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";

#[cfg(target_os = "macos")]
/// Read-only system and developer locations commands may use.
const SYSTEM_READ: &[&str] = &[
    "/bin",
    "/sbin",
    "/usr",
    "/System",
    "/Library/Apple",
    "/Library/Developer/CommandLineTools",
    "/Library/Frameworks",
    "/Applications/Xcode.app",
    "/opt/homebrew",
    "/usr/local",
    "/private/var/select",
    "/private/etc",
];

#[cfg(target_os = "macos")]
/// Toolchain managers under the person's home. Only these, never the rest of
/// the home folder; `~/.cargo` is limited to `bin` because its credentials
/// file lives beside it.
const HOME_TOOLCHAINS: &[&str] = &[
    ".nvm/versions",
    ".volta",
    ".local/share/fnm",
    ".fnm",
    ".bun/bin",
    ".deno/bin",
    ".pyenv",
    ".rbenv",
    ".asdf",
    ".local/share/mise/installs",
    ".cargo/bin",
    ".rustup/toolchains",
    ".local/bin",
];

/// Everything one command needs to start inside the sandbox.
pub struct Setup {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    pub cwd: PathBuf,
    #[cfg(windows)]
    pub windows: windows::Confinement,
}

/// Where a project's commands live: the project, plus per-run scratch space.
pub struct Policy<'a> {
    pub project: &'a Path,
    pub temp: &'a Path,
    pub home: &'a Path,
    pub user_home: Option<&'a Path>,
    pub proxy_port: Option<u16>,
    /// Windows: where the project's sandbox records what it changed.
    #[cfg(windows)]
    pub state: &'a Path,
    /// Windows: the toolchains commands may use.
    #[cfg(windows)]
    pub tools: &'a [ToolFolder],
}

#[cfg(target_os = "macos")]
fn existing_toolchains(user_home: Option<&Path>) -> Vec<PathBuf> {
    let Some(home) = user_home else {
        return Vec::new();
    };
    HOME_TOOLCHAINS
        .iter()
        .map(|relative| home.join(relative))
        .filter(|path| path.is_dir())
        .filter_map(|path| path.canonicalize().ok())
        .collect()
}

/// PATH for commands: system folders, Homebrew, and the newest Node from nvm
/// or fnm when one is installed. Nothing from the person's shell profile.
pub fn command_path(user_home: Option<&Path>) -> String {
    let mut entries: Vec<String> = Vec::new();
    if let Some(home) = user_home {
        for manager in [".nvm/versions/node", ".local/share/fnm/node-versions", ".fnm/node-versions"] {
            if let Some(bin) = newest_node(&home.join(manager)) {
                entries.push(bin.to_string_lossy().into_owned());
            }
        }
        for relative in [".volta/bin", ".bun/bin", ".deno/bin", ".pyenv/shims", ".cargo/bin", ".local/bin"] {
            let path = home.join(relative);
            if path.is_dir() {
                entries.push(path.to_string_lossy().into_owned());
            }
        }
    }
    // The real developer tools, ahead of /usr/bin's xcrun shims, which try to
    // write a cache outside the sandbox on every call.
    for developer in [
        "/Library/Developer/CommandLineTools/usr/bin",
        "/Applications/Xcode.app/Contents/Developer/usr/bin",
    ] {
        if Path::new(developer).join("git").exists() {
            entries.push(developer.to_owned());
            break;
        }
    }
    entries.extend(
        [
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ]
        .iter()
        .map(|value| value.to_string()),
    );
    entries.join(":")
}

fn newest_node(versions: &Path) -> Option<PathBuf> {
    let mut found: Vec<(Vec<u64>, PathBuf)> = std::fs::read_dir(versions)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let numbers: Vec<u64> = name
                .trim_start_matches('v')
                .split('.')
                .map(|part| part.parse().ok())
                .collect::<Option<_>>()?;
            let bin = [entry.path().join("bin"), entry.path().join("installation/bin")]
                .into_iter()
                .find(|path| path.join("node").exists())?;
            Some((numbers, bin))
        })
        .collect();
    found.sort();
    found.pop().map(|(_, bin)| bin)
}

#[cfg(target_os = "macos")]
/// Seatbelt strings can't hold every character safely; a project path with
/// quotes, backslashes or control characters is refused outright.
fn safe_for_profile(path: &Path) -> Result<String, CodeError> {
    let text = path.to_string_lossy();
    if text.chars().any(|c| c == '"' || c == '\\' || c.is_control()) {
        return Err(CodeError::Unavailable(
            "Commands can't run in a folder whose path contains quotes or backslashes. Rename or move the folder.".into(),
        ));
    }
    Ok(text.into_owned())
}

#[cfg(target_os = "macos")]
fn regex_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if "\\.+*?()|[]{}^$".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// The full profile and its path parameters for one project.
#[cfg(target_os = "macos")]
pub fn profile(policy: &Policy) -> Result<(String, Vec<(String, String)>), CodeError> {
    let project = safe_for_profile(policy.project)?;
    let temp = safe_for_profile(policy.temp)?;
    let home = safe_for_profile(policy.home)?;
    let mut params: Vec<(String, String)> = vec![
        ("PROJECT".into(), project.clone()),
        ("PROJECT_GIT".into(), format!("{project}/.git")),
        ("PROJECT_MISTY".into(), format!("{project}/.misty")),
        ("RUN_TEMP".into(), temp),
        ("RUN_HOME".into(), home),
    ];
    let mut sections = vec![BASE_POLICY.to_owned(), PLATFORM_DEFAULTS.to_owned()];

    let mut readable = String::from("; system, developer tools and toolchains (read only)\n(allow file-read* file-test-existence file-map-executable\n");
    for path in SYSTEM_READ {
        readable.push_str(&format!("  (subpath \"{path}\")\n"));
    }
    for (index, path) in existing_toolchains(policy.user_home).iter().enumerate() {
        let key = format!("TOOLCHAIN_{index}");
        readable.push_str(&format!("  (subpath (param \"{key}\"))\n"));
        params.push((key, safe_for_profile(path)?));
    }
    readable.push_str(")\n");
    sections.push(readable);

    // Folders above the project: stat only, so tools can resolve the cwd.
    let mut ancestors = String::from("(allow file-read-metadata file-test-existence\n");
    for (index, ancestor) in policy.project.ancestors().skip(1).enumerate() {
        if ancestor.as_os_str().is_empty() {
            continue;
        }
        let key = format!("ANCESTOR_{index}");
        ancestors.push_str(&format!("  (literal (param \"{key}\"))\n"));
        params.push((key, safe_for_profile(ancestor)?));
    }
    ancestors.push_str(")\n");
    sections.push(ancestors);

    sections.push(
        "; the project, this run's temp folder and private home
(allow file-read* file-test-existence file-map-executable file-write* file-ioctl
  (subpath (param \"PROJECT\"))
  (subpath (param \"RUN_TEMP\"))
  (subpath (param \"RUN_HOME\")))\n"
            .to_owned(),
    );

    // No listening and no outbound connections, so a command can't reach the
    // internet, the LAN, or other services on this computer.
    let mut network = String::new();
    if let Some(port) = policy.proxy_port {
        network.push_str(&format!(
            "; package installs go through Misty's allowlisting proxy only
(allow network-outbound (remote ip \"localhost:{port}\"))\n"
        ));
        network.push_str(NETWORK_POLICY);
        network.push_str("(allow mach-lookup (global-name \"com.apple.TrustEvaluationAgent\"))\n");
    }
    sections.push(network);

    // Denies come last: in Seatbelt the last matching rule wins.
    let escaped_project = regex_escape(&project);
    sections.push(format!(
        "; never: XPC services, extent-moving fcntls, Git's folder, secrets, the root itself
(deny mach-lookup (xpc-service-name-prefix \"\"))
(deny system-fcntl (fcntl-command 80 110))
(deny file-write* (subpath (param \"PROJECT_GIT\")) (subpath (param \"PROJECT_MISTY\")))
(deny file-write-unlink (literal (param \"PROJECT\")))
(deny file-read* file-write*
  (require-all
    (regex #\"^{escaped_project}/(.*/)?\\.env(\\.[^/]*)?$\")
    (require-not (regex #\"\\.(example|sample|template|dist)$\"))))
(deny file-read* file-write*
  (regex #\"^{escaped_project}/(.*/)?(\\.npmrc|\\.netrc|\\.pypirc|[^/]*\\.pem|[^/]*\\.key)$\"))\n"
    ));
    Ok((sections.join("\n"), params))
}

/// The command line and environment for one shell command in the sandbox.
pub fn setup(policy: &Policy, cwd: &Path, command: &str) -> Result<Setup, CodeError> {
    #[cfg(target_os = "macos")]
    {
        if !Path::new(SANDBOX_EXEC).exists() {
            return Err(CodeError::Unavailable(
                "This Mac has no sandbox-exec, so commands can't run safely.".into(),
            ));
        }
        let (profile, params) = profile(policy)?;
        let mut args = vec!["-p".to_owned(), profile];
        for (key, value) in params {
            args.push(format!("-D{key}={value}"));
        }
        args.push("--".into());
        args.push("/bin/bash".into());
        args.push("-c".into());
        args.push(command.to_owned());
        Ok(Setup {
            program: PathBuf::from(SANDBOX_EXEC),
            args,
            env: environment(policy),
            cwd: cwd.to_path_buf(),
        })
    }
    #[cfg(windows)]
    {
        windows::setup(policy, cwd, command)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (policy, cwd, command);
        Err(CodeError::Unavailable(
            "Agents can run commands only on macOS and Windows for now.".into(),
        ))
    }
}

/// A clean environment: nothing inherited from Misty, so no tokens or keys
/// reach a command. Tools write caches into the run's private home.
pub fn environment(policy: &Policy) -> BTreeMap<String, String> {
    let home = policy.home.to_string_lossy().into_owned();
    let temp = policy.temp.to_string_lossy().into_owned();
    let mut env = BTreeMap::new();
    for (key, value) in [
        ("PATH", command_path(policy.user_home)),
        ("HOME", home.clone()),
        ("TMPDIR", format!("{temp}/")),
        ("LANG", "en_US.UTF-8".into()),
        ("LC_ALL", "en_US.UTF-8".into()),
        ("TERM", "dumb".into()),
        ("NO_COLOR", "1".into()),
        ("FORCE_COLOR", "0".into()),
        ("CI", "1".into()),
        ("PAGER", "cat".into()),
        ("GIT_PAGER", "cat".into()),
        ("GIT_TERMINAL_PROMPT", "0".into()),
        ("GIT_CONFIG_NOSYSTEM", "1".into()),
        ("npm_config_cache", format!("{home}/.npm")),
        ("npm_config_update_notifier", "false".into()),
        ("npm_config_fund", "false".into()),
        ("npm_config_audit", "false".into()),
        ("npm_config_yes", "true".into()),
        ("PIP_DISABLE_PIP_VERSION_CHECK", "1".into()),
        ("PYTHONDONTWRITEBYTECODE", "1".into()),
        ("NEXT_TELEMETRY_DISABLED", "1".into()),
        ("ASTRO_TELEMETRY_DISABLED", "1".into()),
        ("BROWSER", "none".into()),
    ] {
        env.insert(key.to_owned(), value);
    }
    if let Some(port) = policy.proxy_port {
        let proxy = format!("http://127.0.0.1:{port}");
        for key in [
            "HTTPS_PROXY",
            "HTTP_PROXY",
            "https_proxy",
            "http_proxy",
            "npm_config_proxy",
            "npm_config_https_proxy",
        ] {
            env.insert(key.to_owned(), proxy.clone());
        }
        env.insert("NO_PROXY".into(), String::new());
    }
    env
}
