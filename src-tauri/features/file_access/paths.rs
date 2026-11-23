use std::{
    env,
    path::{Path, PathBuf},
    sync::OnceLock,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Profile {
    Release { version: String },
    Dev(String),
}

impl Profile {
    pub fn relative(&self) -> PathBuf {
        match self {
            Self::Release { version } => Path::new(RELEASE_FOLDER).join(version),
            Self::Dev(kind) => Path::new(DEV_FOLDER).join(kind),
        }
    }

    pub fn label(&self) -> String {
        match self {
            Self::Release { version } => format!("{RELEASE_FOLDER} {version}"),
            Self::Dev(kind) => format!("{DEV_FOLDER} {kind}"),
        }
    }
}

pub const DEV_FOLDER: &str = "dev";
pub const RELEASE_FOLDER: &str = "rel";
pub const SHARED_FOLDER: &str = "shared";
pub const SHARED_ENTRIES: &[&str] = &["engines", "projects", "multirun", "drive", "models"];
const UNVERSIONED: &str = "unversioned";

static PROFILE: OnceLock<Profile> = OnceLock::new();
static CONF_PROBLEM: OnceLock<Option<String>> = OnceLock::new();

pub fn choose_profile(app_version: &str) -> &'static Profile {
    PROFILE.get_or_init(|| profile_for(app_version, cfg!(debug_assertions), requested_kind()))
}

pub fn profile() -> &'static Profile {
    PROFILE.get_or_init(|| profile_for("", cfg!(debug_assertions), requested_kind()))
}

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

pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.chars().all(|c| c == '.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

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

pub fn misty_data_root() -> Option<PathBuf> {
    resolve_desktop_home_dir()
}

pub fn misty_mount_dir() -> Option<PathBuf> {
    misty_root_dir().map(|root| {
        root.join(if cfg!(debug_assertions) {
            "mnt-dev"
        } else {
            "mnt"
        })
    })
}

pub fn misty_root_dir() -> Option<PathBuf> {
    misty_data_root().map(|root| root.join(".misty"))
}

pub fn misty_shared_dir(entry: &str) -> Option<PathBuf> {
    misty_root_dir().map(|root| root.join(SHARED_FOLDER).join(entry))
}

pub fn misty_home_dir() -> Option<PathBuf> {
    misty_root_dir().map(|root| root.join(profile().relative()))
}

pub fn misty_home_in(data_root: &Path) -> PathBuf {
    data_root.join(".misty").join(profile().relative())
}

fn resolve_desktop_home_dir() -> Option<PathBuf> {
    env::var_os("MISTY_DATA_ROOT")
        .or_else(|| env::var_os("HOME"))
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

#[allow(clippy::disallowed_methods)]
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
        assert_eq!(
            profile_for("0.1.0", true, Some("../x".into())),
            Profile::Dev("default".into())
        );
    }
}
