//! Where Misty keeps its data. `~/.misty` holds one folder per profile, and a build uses exactly one:
//!
//! - `stable/<version>`, `beta/<version>`: a release build, by the channel in its version
//!   (`0.1.0-beta.1` is `beta/0.1.0-beta.1`, `0.2.0` is `stable/0.2.0`).
//! - `dev/<name>`: a debug build. `<name>` is `MISTY_PROFILE`, else `default`.
//! - `rel/<name>`: a release build given a name of its own, at build time or in `MISTY_PROFILE`.
//!
//! The build decides, never a file every build reads: a release build only reads `MISTY_PROFILE`
//! from its own process, and only a debug build also reads it from `~/.misty/.env/client/misty.env`.
//! A few entries stay shared by every build, beside the profiles (`SHARED_ENTRIES`).
use std::{
    env,
    path::{Path, PathBuf},
    sync::OnceLock,
};

/// Which of `~/.misty`'s profiles this build uses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Profile {
    /// A release build: `<channel>/<version>`.
    Release { channel: String, version: String },
    /// A debug build: `dev/<name>`.
    Dev(String),
    /// A release build with a name of its own: `rel/<name>`.
    Custom(String),
}

impl Profile {
    /// The profile's folder, relative to `~/.misty`.
    pub fn relative(&self) -> PathBuf {
        match self {
            Self::Release { channel, version } => Path::new(channel).join(version),
            Self::Dev(name) => Path::new(DEV_FOLDER).join(name),
            Self::Custom(name) => Path::new(CUSTOM_FOLDER).join(name),
        }
    }

    /// How the profile reads in a log or in Settings: `beta 0.1.0-beta.1`, `dev default`.
    pub fn label(&self) -> String {
        match self {
            Self::Release { channel, version } => format!("{channel} {version}"),
            Self::Dev(name) => format!("{DEV_FOLDER} {name}"),
            Self::Custom(name) => format!("{CUSTOM_FOLDER} {name}"),
        }
    }
}

/// Debug builds' profiles.
pub const DEV_FOLDER: &str = "dev";
/// Named release builds' profiles.
pub const CUSTOM_FOLDER: &str = "rel";
/// What `~/.misty` keeps beside the profiles, shared by every build:
/// - `.env`: settings and keys for developing Misty.
/// - `engines`: the engine programs Misty installs. Programs, not data, and some (Hermes's Python
///   environment) only run from the folder they were installed in.
/// - `workspace`: where an engine works when a chat names no folder. The engines key their own
///   sessions and trust by its path, so it never moves.
/// - `multirun`: git worktrees, which their repositories know by path.
pub const SHARED_ENTRIES: &[&str] = &[".env", "engines", "workspace", "multirun"];

static PROFILE: OnceLock<Profile> = OnceLock::new();

/// Settles this process's profile from the app's version. The app calls it first thing, before any
/// path is read; a process that never calls it (tests, helper binaries) gets the debug or unnamed
/// profile.
pub fn choose_profile(app_version: &str) -> &'static Profile {
    PROFILE.get_or_init(|| profile_for(app_version, cfg!(debug_assertions), requested_name()))
}

/// This process's profile.
pub fn profile() -> &'static Profile {
    PROFILE.get_or_init(|| profile_for("", cfg!(debug_assertions), requested_name()))
}

/// The profile a build of `version` uses. `name` is the one asked for, if any.
pub fn profile_for(version: &str, debug: bool, name: Option<String>) -> Profile {
    let name = name.filter(|name| valid_name(name));
    if debug {
        return Profile::Dev(name.unwrap_or_else(|| "default".into()));
    }
    if let Some(name) = name {
        return Profile::Custom(name);
    }
    if version.is_empty() || !valid_name(version) {
        return Profile::Custom("default".into());
    }
    Profile::Release {
        channel: channel_of(version),
        version: version.into(),
    }
}

/// The channel a version belongs to: its pre-release tag without the counter (`0.1.0-beta.1` is
/// `beta`), else `stable`.
pub fn channel_of(version: &str) -> String {
    let core = version.split('+').next().unwrap_or(version);
    let Some((_, pre)) = core.split_once('-') else {
        return "stable".into();
    };
    let tag: String = pre
        .split('.')
        .next()
        .unwrap_or_default()
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect::<String>()
        .to_ascii_lowercase();
    match tag.as_str() {
        "" | "stable" => "stable".into(),
        // A release candidate is a beta about to become stable; it keeps the beta's data.
        "rc" => "beta".into(),
        // Never a channel that names another kind of profile.
        DEV_FOLDER | CUSTOM_FOLDER => "beta".into(),
        _ => tag,
    }
}

/// A profile name: letters, digits, `.`, `_` and `-`, and never only dots.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.chars().all(|c| c == '.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// The name this build was asked to use: at build time, else in this process's environment, else
/// (debug builds only) in `~/.misty/.env/client/misty.env`.
fn requested_name() -> Option<String> {
    if let Some(name) = option_env!("MISTY_PROFILE").filter(|name| !name.is_empty()) {
        return Some(name.into());
    }
    if let Some(name) = env::var("MISTY_PROFILE").ok().filter(|name| !name.is_empty()) {
        return Some(name);
    }
    if !cfg!(debug_assertions) {
        return None;
    }
    let file = misty_root_dir()?.join(".env").join("client").join("misty.env");
    let text = std::fs::read_to_string(file).ok()?;
    text.lines().find_map(|line| {
        let (key, value) = line.trim().split_once('=')?;
        let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
        (key.trim() == "MISTY_PROFILE" && !value.is_empty()).then(|| value.to_string())
    })
}

/// The folder `.misty` sits in: `MISTY_DATA_ROOT`, else the home folder.
pub fn misty_data_root() -> Option<PathBuf> {
    resolve_desktop_home_dir()
}

/// `~/.misty` itself, which holds every profile and the files they share.
pub fn misty_root_dir() -> Option<PathBuf> {
    misty_data_root().map(|root| root.join(".misty"))
}

/// One of the entries every build shares (`SHARED_ENTRIES`), such as `~/.misty/engines`.
pub fn misty_shared_dir(entry: &str) -> Option<PathBuf> {
    misty_root_dir().map(|root| root.join(entry))
}

/// This build's own data folder: its profile in `~/.misty`.
pub fn misty_home_dir() -> Option<PathBuf> {
    misty_root_dir().map(|root| root.join(profile().relative()))
}

/// This build's data folder under another data root, such as one a test made.
pub fn misty_home_in(data_root: &Path) -> PathBuf {
    data_root.join(".misty").join(profile().relative())
}

fn resolve_desktop_home_dir() -> Option<PathBuf> {
    env::var_os("MISTY_DATA_ROOT")
        .or_else(|| env::var_os("HOME"))
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Points every home-folder lookup at a fresh temporary folder, so tests never reach the person's real
/// data, the credential store included. Each test binary calls it once, before anything else runs.
#[allow(clippy::disallowed_methods)] // It runs before anything else, and only in tests.
pub fn isolate_for_tests() {
    let home = env::temp_dir().join(format!("misty-test-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&home);
    let home = std::fs::canonicalize(&home).unwrap_or(home);
    unsafe {
        env::set_var("HOME", &home);
        env::set_var("USERPROFILE", &home);
        env::remove_var("MISTY_DATA_ROOT");
        env::remove_var("MISTY_PROFILE");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_release_build_uses_its_channel_and_version() {
        let beta = profile_for("0.1.0-beta.1", false, None);
        assert_eq!(beta.relative(), Path::new("beta/0.1.0-beta.1"));
        let stable = profile_for("0.2.0", false, None);
        assert_eq!(stable.relative(), Path::new("stable/0.2.0"));
        assert_eq!(channel_of("1.0.0-rc.2"), "beta");
        assert_eq!(channel_of("1.0.0-alpha3"), "alpha");
        assert_eq!(channel_of("1.0.0-dev.1"), "beta");
    }

    #[test]
    fn a_debug_build_uses_dev_and_a_named_release_uses_rel() {
        assert_eq!(profile_for("0.1.0", true, None), Profile::Dev("default".into()));
        assert_eq!(
            profile_for("0.1.0", true, Some("work".into())),
            Profile::Dev("work".into())
        );
        assert_eq!(
            profile_for("0.1.0", false, Some("mine".into())),
            Profile::Custom("mine".into())
        );
        // A name that could leave `~/.misty` is ignored.
        assert_eq!(
            profile_for("0.1.0", true, Some("../x".into())),
            Profile::Dev("default".into())
        );
    }
}
