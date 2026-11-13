//! Opens this build's profile in `~/.misty` (which profile a build uses is in
//! `file_access::paths`), before anything reads from it.
//!
//! - A release version's folder starts as a clone of the newest older version's, so an update keeps
//!   everything, and going back to that older version finds its own folder as it was left. The
//!   first stable release starts from the newest beta the same way.
//! - Each release channel keeps every version from the running one up, plus the newest one before
//!   it to go back to. Older ones go to the Trash.
//! - The first build to open a `~/.misty` from before profiles takes that data as its own profile.
use std::{
    cmp::Ordering,
    io,
    path::{Path, PathBuf},
};

use file_access::{
    fs,
    paths::{self, Profile, CUSTOM_FOLDER, DEV_FOLDER, SHARED_ENTRIES},
};

use crate::misty_home::Trash;

/// The folder that marks the layout from before profiles. It moves last: while it is still at the
/// top, the move isn't finished and the next launch carries it on.
const LEGACY_MARKER: &str = "data";

#[derive(Debug, Default)]
pub struct ProfileReport {
    /// The older version's folder this one started from.
    pub started_from: Option<PathBuf>,
    /// What moved in from the layout before profiles.
    pub adopted: Vec<String>,
    /// Old versions moved to the Trash.
    pub retired: Vec<String>,
    /// Old versions the Trash refused, left in place.
    pub kept: Vec<String>,
}

/// Opens this build's profile.
pub fn open_profile() -> io::Result<ProfileReport> {
    let root = paths::misty_root_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no home directory"))?;
    open_at(&root, paths::profile(), &Trash::for_this_system())
}

pub(crate) fn open_at(root: &Path, profile: &Profile, trash: &Trash) -> io::Result<ProfileReport> {
    let mut report = ProfileReport::default();
    fs::create_dir_all(root)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root, fs::Permissions::from_mode(0o700))?;
    }
    let home = root.join(profile.relative());

    if fs::is_file(root.join(LEGACY_MARKER).join("misty.db"))
        && !fs::exists(home.join(LEGACY_MARKER))
    {
        adopt_legacy(root, &home, &mut report)?;
    } else if !fs::is_dir(&home) {
        if let Profile::Release { version, .. } = profile {
            if let Some(source) = newest_before(root, version) {
                start_from(&source, &home)?;
                report.started_from = Some(source);
            }
        }
    }

    if let Profile::Release { version, .. } = profile {
        retire_old_versions(root, version, trash, &mut report);
    }
    Ok(report)
}

/// Moves the layout from before profiles into `home`, entry by entry, so a move cut short carries on
/// at the next launch. Everything at the top moves except what every build shares, hidden entries
/// (bar `.local`, which the credential store empties itself) and other profiles' folders.
fn adopt_legacy(root: &Path, home: &Path, report: &mut ProfileReport) -> io::Result<()> {
    fs::create_dir_all(home)?;
    let mut entries: Vec<String> = fs::read_dir(root)?
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| !is_profile_or_shared(root, name))
        .collect();
    // The marker last.
    entries.sort_by_key(|name| name == LEGACY_MARKER);
    for entry in entries {
        let (from, to) = (root.join(&entry), home.join(&entry));
        if fs::symlink_metadata(&to).is_ok() {
            continue;
        }
        fs::rename(&from, &to)?;
        relink(&to, &from, &to)?;
        report.adopted.push(entry);
    }
    Ok(())
}

/// Whether a top-level entry of `~/.misty` stays where it is: shared by every build, hidden, or a
/// folder of profiles (`dev`, `rel`, or a release channel holding version folders).
fn is_profile_or_shared(root: &Path, name: &str) -> bool {
    if name == ".local" {
        return false;
    }
    if name.starts_with('.') || SHARED_ENTRIES.contains(&name) {
        return true;
    }
    if name == DEV_FOLDER || name == CUSTOM_FOLDER {
        return true;
    }
    is_channel_folder(&root.join(name))
}

/// A folder of release versions: every entry in it is named for a version, and there is one.
fn is_channel_folder(folder: &Path) -> bool {
    let Ok(entries) = fs::read_dir(folder) else {
        return false;
    };
    let names: Vec<String> = entries
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| !name.starts_with('.'))
        .collect();
    !names.is_empty() && names.iter().all(|name| Version::parse(name).is_some())
}

/// Clones `source` into `home`, through a staging folder so a copy cut short is never taken for a
/// profile; the next launch starts it over.
fn start_from(source: &Path, home: &Path) -> io::Result<()> {
    let name = home
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let staging = home.with_file_name(format!(".{name}.opening"));
    if fs::symlink_metadata(&staging).is_ok() {
        fs::remove_dir_all(&staging)?;
    }
    if let Some(parent) = staging.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy_tree(source, &staging)?;
    // Links into the old version's folder point into this one's (where `staging` is about to be).
    relink(&staging, source, home)?;
    fs::rename(&staging, home)
}

/// Points every link under `folder` that leads into `from` at the same place under `to`.
#[cfg(unix)]
fn relink(folder: &Path, from: &Path, to: &Path) -> io::Result<()> {
    let Ok(meta) = fs::symlink_metadata(folder) else {
        return Ok(());
    };
    if meta.file_type().is_symlink() {
        let target = fs::read_link(folder)?;
        if let Ok(rest) = target.strip_prefix(from) {
            fs::remove_file(folder)?;
            fs::symlink(to.join(rest), folder)?;
        }
        return Ok(());
    }
    if !meta.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(folder)? {
        relink(&entry?.path(), from, to)?;
    }
    Ok(())
}

/// Windows profiles hold no links into Misty's own folder.
#[cfg(not(unix))]
fn relink(_folder: &Path, _from: &Path, _to: &Path) -> io::Result<()> {
    Ok(())
}

/// Every release version's folder: `(channel folder, version)`.
fn release_folders(root: &Path) -> Vec<(PathBuf, String)> {
    let skip = |name: &str| {
        name.starts_with('.')
            || name == DEV_FOLDER
            || name == CUSTOM_FOLDER
            || SHARED_ENTRIES.contains(&name)
    };
    let mut found = Vec::new();
    let Ok(channels) = fs::read_dir(root) else {
        return found;
    };
    for channel in channels.flatten() {
        let name = channel.file_name().to_string_lossy().into_owned();
        if skip(&name) || !channel.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        let Ok(versions) = fs::read_dir(channel.path()) else {
            continue;
        };
        for version in versions.flatten() {
            let version = version.file_name().to_string_lossy().into_owned();
            if Version::parse(&version).is_some() {
                found.push((channel.path(), version));
            }
        }
    }
    found
}

/// The newest version's folder older than `version`, in any channel.
fn newest_before(root: &Path, version: &str) -> Option<PathBuf> {
    let current = Version::parse(version)?;
    release_folders(root)
        .into_iter()
        .filter_map(|(channel, name)| Some((Version::parse(&name)?, channel.join(&name))))
        .filter(|(older, _)| older.cmp(&current) == Ordering::Less)
        .max_by(|(a, _), (b, _)| a.cmp(b))
        .map(|(_, folder)| folder)
}

/// In each channel, keeps the versions from `version` up and the newest one before it; the older
/// ones go to the Trash. A version the Trash refuses stays where it is.
fn retire_old_versions(root: &Path, version: &str, trash: &Trash, report: &mut ProfileReport) {
    let Some(current) = Version::parse(version) else {
        return;
    };
    let mut by_channel: Vec<(PathBuf, Vec<(Version, String)>)> = Vec::new();
    for (channel, name) in release_folders(root) {
        let Some(parsed) = Version::parse(&name) else {
            continue;
        };
        match by_channel.iter_mut().find(|(folder, _)| *folder == channel) {
            Some((_, versions)) => versions.push((parsed, name)),
            None => by_channel.push((channel, vec![(parsed, name)])),
        }
    }
    let batch = format!(
        "Misty old versions {}",
        chrono::Local::now().format("%Y-%m-%d %H.%M.%S")
    );
    for (channel, mut versions) in by_channel {
        versions.retain(|(parsed, _)| parsed.cmp(&current) == Ordering::Less);
        versions.sort_by(|(a, _), (b, _)| b.cmp(a));
        let channel_name = channel
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        for (_, name) in versions.into_iter().skip(1) {
            let relative = format!("{channel_name}/{name}");
            match trash.take(&channel.join(&name), &batch, &relative) {
                Ok(()) => report.retired.push(relative),
                Err(_) => report.kept.push(relative),
            }
        }
    }
}

/// A version number, ordered the semver way: `0.1.0-beta.2 < 0.1.0-rc.1 < 0.1.0 < 0.1.1`.
#[derive(Debug, PartialEq, Eq)]
struct Version {
    core: [u64; 3],
    pre: Vec<String>,
}

impl Version {
    fn parse(text: &str) -> Option<Self> {
        let text = text.split('+').next()?;
        let (core, pre) = match text.split_once('-') {
            Some((core, pre)) => (core, pre.split('.').map(str::to_string).collect()),
            None => (text, Vec::new()),
        };
        let mut parts = core.split('.').map(|part| part.parse::<u64>().ok());
        let core = [parts.next()??, parts.next()??, parts.next()??];
        if parts.next().is_some() {
            return None;
        }
        Some(Self { core, pre })
    }

    fn cmp(&self, other: &Self) -> Ordering {
        self.core.cmp(&other.core).then_with(|| {
            match (self.pre.is_empty(), other.pre.is_empty()) {
                (true, true) => Ordering::Equal,
                // A pre-release comes before its release.
                (true, false) => Ordering::Greater,
                (false, true) => Ordering::Less,
                (false, false) => {
                    for (a, b) in self.pre.iter().zip(&other.pre) {
                        let order = match (a.parse::<u64>(), b.parse::<u64>()) {
                            (Ok(a), Ok(b)) => a.cmp(&b),
                            (Ok(_), Err(_)) => Ordering::Less,
                            (Err(_), Ok(_)) => Ordering::Greater,
                            (Err(_), Err(_)) => a.cmp(b),
                        };
                        if order != Ordering::Equal {
                            return order;
                        }
                    }
                    self.pre.len().cmp(&other.pre.len())
                }
            }
        })
    }
}

#[cfg(test)]
// Tests build their fixtures directly, outside the file gate.
#[allow(clippy::disallowed_methods)]
mod tests {
    use super::*;

    fn release(version: &str) -> Profile {
        file_access::paths::profile_for(version, false, None)
    }

    fn version_order(a: &str, b: &str) -> Ordering {
        Version::parse(a).unwrap().cmp(&Version::parse(b).unwrap())
    }

    #[test]
    fn versions_order_the_semver_way() {
        assert_eq!(version_order("0.1.0-beta.2", "0.1.0-beta.10"), Ordering::Less);
        assert_eq!(version_order("0.1.0-beta.9", "0.1.0-rc.1"), Ordering::Less);
        assert_eq!(version_order("0.1.0-rc.1", "0.1.0"), Ordering::Less);
        assert_eq!(version_order("0.1.0", "0.1.1"), Ordering::Less);
        assert!(Version::parse("default").is_none());
    }

    #[test]
    fn a_new_version_starts_from_the_last_one_and_old_ones_retire() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join(".misty");
        let trash = Trash::Folder(base.path().join("Trash"));
        for version in ["0.1.0-beta.1", "0.1.0-beta.2", "0.1.0-beta.3"] {
            let data = root.join("beta").join(version).join("data");
            std::fs::create_dir_all(&data).unwrap();
            std::fs::write(data.join("misty.db"), version).unwrap();
        }

        let report = open_at(&root, &release("0.1.0"), &trash).unwrap();

        let home = root.join("stable/0.1.0");
        assert_eq!(report.started_from, Some(root.join("beta/0.1.0-beta.3")));
        assert_eq!(
            std::fs::read_to_string(home.join("data/misty.db")).unwrap(),
            "0.1.0-beta.3"
        );
        // The newest beta stays to go back to; the older ones went to the Trash.
        assert!(root.join("beta/0.1.0-beta.3").is_dir());
        assert!(!root.join("beta/0.1.0-beta.1").exists());
        assert!(!root.join("beta/0.1.0-beta.2").exists());
        assert_eq!(report.retired.len(), 2);
    }

    #[test]
    fn the_layout_from_before_profiles_moves_into_the_first_profile() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join(".misty");
        std::fs::create_dir_all(root.join("data")).unwrap();
        std::fs::write(root.join("data/misty.db"), "db").unwrap();
        std::fs::create_dir_all(root.join("turn-snapshots/runs")).unwrap();
        std::fs::create_dir_all(root.join("engines/codex")).unwrap();
        std::fs::create_dir_all(root.join(".env/server")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("turn-snapshots/runs"), root.join("data/runs"))
            .unwrap();
        let trash = Trash::Folder(base.path().join("Trash"));

        open_at(&root, &Profile::Dev("default".into()), &trash).unwrap();

        let home = root.join("dev/default");
        assert!(home.join("data/misty.db").is_file());
        assert!(home.join("turn-snapshots/runs").is_dir());
        assert!(!root.join("data").exists());
        // What every build shares stays at the top.
        assert!(root.join(".env/server").is_dir());
        assert!(root.join("engines/codex").is_dir());
        #[cfg(unix)]
        assert_eq!(
            std::fs::read_link(home.join("data/runs")).unwrap(),
            home.join("turn-snapshots/runs")
        );
    }
}
