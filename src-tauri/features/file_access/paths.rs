//! Where Misty keeps its data: layout `v1` of `~/.misty` (`conf::MANIFEST`).
//!
//! - `misty.conf`: which data folder this install opens, and defaults for new settings (`conf`).
//! - `rel/<version>`: a release build's data folder, one per version (`0.1.0-beta.1` is
//!   `rel/0.1.0-beta.1`). It is all people who use Misty ever have.
//! - `dev/<kind>`: a debug build's, only for developing Misty. `<kind>` is `misty.root`'s when it
//!   names a dev folder, `MISTY_PROFILE` for one launch, else `default`.
//! - `shared/`: what every build shares (`SHARED_ENTRIES`).
//!
//! Each data folder holds everything else of its own, its `.env` included.
use std::{
    env,
    path::{Path, PathBuf},
    sync::OnceLock,
};

/// The data folder a build uses in `~/.misty`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Profile {
    /// A release build: `rel/<version>`.
    Release { version: String },
    /// A debug build: `dev/<kind>`.
    Dev(String),
}

impl Profile {
    /// The folder, relative to `~/.misty`.
    pub fn relative(&self) -> PathBuf {
        match self {
            Self::Release { version } => Path::new(RELEASE_FOLDER).join(version),
            Self::Dev(kind) => Path::new(DEV_FOLDER).join(kind),
        }
    }

    /// How it reads in a log: `rel 0.1.0-beta.1`, `dev default`.
    pub fn label(&self) -> String {
        match self {
            Self::Release { version } => format!("{RELEASE_FOLDER} {version}"),
            Self::Dev(kind) => format!("{DEV_FOLDER} {kind}"),
        }
    }
}

/// Debug builds' data folders.
pub const DEV_FOLDER: &str = "dev";
/// Release builds' data folders, one per version.
pub const RELEASE_FOLDER: &str = "rel";
/// What every build shares, beside the data folders.
pub const SHARED_FOLDER: &str = "shared";
/// What `~/.misty/shared` holds:
/// - `engines`: the engine programs Misty installs. Programs, not data, and some (Hermes's Python
///   environment) only run from the folder they were installed in.
/// - `projects`: where an engine works when a chat names no folder. The engines key their own
///   sessions and trust by its path, so it never moves.
/// - `multirun`: git worktrees, which their repositories know by path.
/// - `drive`: each account's Space drive records and content cache (`drive/<account id>/`), which
///   an update must not clone or leave behind.
pub const SHARED_ENTRIES: &[&str] = &["engines", "projects", "multirun", "drive"];
/// The release folder of a process with no version to go by (helper binaries).
const UNVERSIONED: &str = "unversioned";

static PROFILE: OnceLock<Profile> = OnceLock::new();
static CONF_PROBLEM: OnceLock<Option<String>> = OnceLock::new();

/// Settles this process's data folder from the app's version and `misty.conf`. The app calls it
/// first thing, before any path is read; a process that never calls it (tests, helper binaries)
/// gets `dev/default` or `rel/unversioned`.
pub fn choose_profile(app_version: &str) -> &'static Profile {
    PROFILE.get_or_init(|| profile_for(app_version, cfg!(debug_assertions), requested_kind()))
}

/// This process's data folder.
pub fn profile() -> &'static Profile {
    PROFILE.get_or_init(|| profile_for("", cfg!(debug_assertions), requested_kind()))
}

/// What is wrong with `misty.conf`, if anything: a `misty.root` outside `~/.misty/dev` and
/// `~/.misty/rel`, or a layout this build doesn't know. Misty doesn't open any folder then.
pub fn conf_problem() -> Option<&'static str> {
    CONF_PROBLEM.get_or_init(check_conf).as_deref()
}

fn check_conf() -> Option<String> {
    let root = misty_root_dir()?;
    let conf = match crate::conf::read(&root) {
        Ok(Some(conf)) => conf,
        Ok(None) => return None,
        Err(error) => return Some(error),
    };
    match conf.manifest.as_deref() {
        Some(crate::conf::MANIFEST) => {}
        Some(other) => {
            return Some(format!(
                "misty.conf follows layout {other}, which this Misty doesn't know (it reads {}). Update Misty.",
                crate::conf::MANIFEST
            ))
        }
        None => return Some("misty.conf names no misty.manifest".into()),
    }
    match conf.root.as_deref() {
        Some(folder) => crate::conf::folder_of(folder, &root).err(),
        None => Some("misty.conf names no misty.root".into()),
    }
}

/// The data folder a build of `version` uses. `kind` is the dev folder asked for, if any; a
/// release build always uses its own version's folder.
pub fn profile_for(version: &str, debug: bool, kind: Option<String>) -> Profile {
    if debug {
        let kind = kind.filter(|kind| valid_name(kind));
        return Profile::Dev(kind.unwrap_or_else(|| "default".into()));
    }
    let version = if valid_name(version) {
        version
    } else {
        UNVERSIONED
    };
    Profile::Release {
        version: version.into(),
    }
}

/// A folder name: letters, digits, `.`, `_` and `-`, and never only dots.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.chars().all(|c| c == '.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// The dev folder a debug build was asked to use: `MISTY_PROFILE` for this launch, else the one
/// `misty.root` names. Release builds ask for none.
fn requested_kind() -> Option<String> {
    if !cfg!(debug_assertions) {
        return None;
    }
    if let Some(kind) = env::var("MISTY_PROFILE")
        .ok()
        .filter(|kind| !kind.is_empty())
    {
        return Some(kind);
    }
    let root = misty_root_dir()?;
    let named = crate::conf::read(&root).ok()??.root?;
    let folder = crate::conf::folder_of(&named, &root).ok()?;
    let mut parts = folder
        .iter()
        .map(|part| part.to_string_lossy().into_owned());
    match (parts.next(), parts.next()) {
        (Some(kind), Some(name)) if kind == DEV_FOLDER => Some(name),
        _ => None,
    }
}

/// The folder `.misty` sits in: `MISTY_DATA_ROOT`, else the home folder.
pub fn misty_data_root() -> Option<PathBuf> {
    resolve_desktop_home_dir()
}

/// Where Space drives are mounted: `~/.misty/mnt`, or `~/.misty/mnt-dev` for a debug build, so a
/// development build's drives never sit where a release's are.
pub fn misty_mount_dir() -> Option<PathBuf> {
    misty_root_dir().map(|root| root.join(if cfg!(debug_assertions) { "mnt-dev" } else { "mnt" }))
}

/// `~/.misty` itself, which holds `misty.conf`, every data folder and what they share.
pub fn misty_root_dir() -> Option<PathBuf> {
    misty_data_root().map(|root| root.join(".misty"))
}

/// One of the entries every build shares (`SHARED_ENTRIES`), such as `~/.misty/shared/engines`.
pub fn misty_shared_dir(entry: &str) -> Option<PathBuf> {
    misty_root_dir().map(|root| root.join(SHARED_FOLDER).join(entry))
}

/// This build's own data folder in `~/.misty`.
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
    fn a_release_build_uses_its_version_folder() {
        let beta = profile_for("0.1.0-beta.1", false, None);
        assert_eq!(beta.relative(), Path::new("rel/0.1.0-beta.1"));
        let stable = profile_for("0.2.0", false, Some("bench".into()));
        assert_eq!(stable.relative(), Path::new("rel/0.2.0"));
        assert_eq!(
            profile_for("", false, None).relative(),
            Path::new("rel/unversioned")
        );
    }

    #[test]
    fn a_debug_build_uses_the_dev_folder_it_is_asked_for() {
        assert_eq!(
            profile_for("0.1.0", true, None),
            Profile::Dev("default".into())
        );
        assert_eq!(
            profile_for("0.1.0", true, Some("bench".into())),
            Profile::Dev("bench".into())
        );
        // A kind that could leave `~/.misty` is ignored.
        assert_eq!(
            profile_for("0.1.0", true, Some("../x".into())),
            Profile::Dev("default".into())
        );
    }
}
