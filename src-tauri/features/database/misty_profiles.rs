//! Opens this build's data folder in `~/.misty` (which one a build uses is in
//! `file_access::paths`), before anything reads from it.
//!
//! - A release version's folder starts as a clone of the newest older version's, so an update keeps
//!   everything, and going back to that older version finds its own folder as it was left.
//! - `rel/` keeps every version from the running one up, plus the newest one before it to go back
//!   to. Older ones go to the Trash.
//! - The first build to open a `~/.misty` without `misty.conf` brings it to layout v1: what every
//!   build shares moves into `shared/` (`workspace` becomes `projects`), release channels'
//!   versions into `rel/`, and `.env` into the folder it opens. A `~/.misty` from before data
//!   folders moves into that folder as a whole. Then it writes `misty.conf`.
use std::{
    cmp::Ordering,
    io,
    path::{Path, PathBuf},
};

use file_access::{
    conf, fs,
    paths::{self, Profile, DEV_FOLDER, RELEASE_FOLDER, SHARED_FOLDER},
};

use crate::misty_home::Trash;

/// The folder that marks the layout from before data folders. It moves last: while it is still at
/// the top, the move isn't finished and the next launch carries it on.
const LEGACY_MARKER: &str = "data";
/// Where the entries every build shares used to sit, at the top of `~/.misty`, and their names in
/// `shared/` now.
const SHARED_BEFORE_V1: &[(&str, &str)] = &[
    ("engines", "engines"),
    ("multirun", "multirun"),
    ("workspace", "projects"),
];

#[derive(Debug, Default)]
pub struct ProfileReport {
    /// The older version's folder this one started from.
    pub started_from: Option<PathBuf>,
    /// What moved in from the layout before data folders.
    pub adopted: Vec<String>,
    /// What moved to its place in layout v1 (`engines -> shared/engines`).
    pub reorganized: Vec<String>,
    /// Old versions moved to the Trash.
    pub retired: Vec<String>,
    /// Old versions the Trash refused, left in place.
    pub kept: Vec<String>,
}

/// Opens this build's data folder, unless `misty.conf` is one Misty mustn't follow.
pub fn open_profile() -> io::Result<ProfileReport> {
    if let Some(problem) = paths::conf_problem() {
        return Err(io::Error::other(problem.to_owned()));
    }
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
    let before_v1 = !fs::exists(conf::path(root));
    if before_v1 {
        move_shared_entries(root, &mut report)?;
        move_release_channels(root, &mut report)?;
    }

    if fs::is_file(root.join(LEGACY_MARKER).join("misty.db"))
        && !fs::exists(home.join(LEGACY_MARKER))
    {
        adopt_legacy(root, &home, &mut report)?;
    } else if !fs::is_dir(&home) {
        if let Profile::Release { version } = profile {
            if let Some(source) = newest_before(root, version) {
                start_from(&source, &home)?;
                report.started_from = Some(source);
            }
        }
    }

    if before_v1 {
        move_into(root, ".env", &home, ".env", &mut report)?;
        conf::write_root(root, &profile.relative())?;
    } else if let Profile::Release { .. } = profile {
        // A release names its own folder once it runs; a dev folder named there stays named.
        let named = conf::read(root)
            .ok()
            .flatten()
            .and_then(|conf| conf.root)
            .and_then(|named| conf::folder_of(&named, root).ok());
        if named.as_deref().is_some_and(|folder| {
            folder.starts_with(RELEASE_FOLDER) && folder != profile.relative()
        }) {
            conf::write_root(root, &profile.relative())?;
        }
    }

    if let Profile::Release { version } = profile {
        retire_old_versions(root, version, trash, &mut report);
    }
    Ok(report)
}

/// Moves `~/.misty/<from>` to `<folder>/<to>` when it is there and nothing is in its place yet.
fn move_into(
    root: &Path,
    from: &str,
    folder: &Path,
    to: &str,
    report: &mut ProfileReport,
) -> io::Result<()> {
    let (source, target) = (root.join(from), folder.join(to));
    if fs::symlink_metadata(&source).is_err() || fs::symlink_metadata(&target).is_ok() {
        return Ok(());
    }
    fs::create_dir_all(folder)?;
    fs::rename(&source, &target)?;
    let shown = target.strip_prefix(root).unwrap_or(&target);
    report
        .reorganized
        .push(format!("{from} -> {}", shown.display()));
    Ok(())
}

/// `engines`, `multirun` and `workspace` from the top of `~/.misty` into `shared/`.
fn move_shared_entries(root: &Path, report: &mut ProfileReport) -> io::Result<()> {
    let shared = root.join(SHARED_FOLDER);
    for (before, now) in SHARED_BEFORE_V1 {
        move_into(root, before, &shared, now, report)?;
    }
    Ok(())
}

/// Release versions kept by channel (`stable/0.2.0`, `beta/0.1.0-beta.1`) into `rel/<version>`.
fn move_release_channels(root: &Path, report: &mut ProfileReport) -> io::Result<()> {
    let Ok(entries) = fs::read_dir(root) else {
        return Ok(());
    };
    let channels: Vec<String> = entries
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| !is_v1_entry(name) && is_channel_folder(&root.join(name)))
        .collect();
    let release = root.join(RELEASE_FOLDER);
    for channel in channels {
        let folder = root.join(&channel);
        for version in fs::read_dir(&folder)?.flatten() {
            let version = version.file_name().to_string_lossy().into_owned();
            if Version::parse(&version).is_some() {
                move_into(&folder, &version, &release, &version, report)?;
            }
        }
        // Emptied, it goes; anything left in it stays where it is.
        let _ = fs::remove_dir(&folder);
    }
    Ok(())
}

/// Moves the layout from before data folders into `home`, entry by entry, so a move cut short
/// carries on at the next launch. Everything at the top moves except layout v1's own entries,
/// hidden entries (bar `.local`, which the credential store empties itself) and release channels.
fn adopt_legacy(root: &Path, home: &Path, report: &mut ProfileReport) -> io::Result<()> {
    fs::create_dir_all(home)?;
    let mut entries: Vec<String> = fs::read_dir(root)?
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| !stays_at_top(root, name))
        .collect();
    // The marker last.
    entries.sort_by_key(|name| name == LEGACY_MARKER);
    for entry in entries {
        let (from, to) = (root.join(&entry), home.join(&entry));
        if fs::symlink_metadata(&to).is_ok() {
            continue;
        }
        fs::rename(&from, &to)?;
        report.adopted.push(entry);
    }
    // Once everything has moved, a link that led into any moved entry leads to its new place,
    // including links between entries (`data/runs` into `turn-snapshots`).
    for entry in &report.adopted {
        relink(home, &root.join(entry), &home.join(entry))?;
    }
    Ok(())
}

/// `misty.conf` and the folders of layout v1.
fn is_v1_entry(name: &str) -> bool {
    [conf::FILE_NAME, DEV_FOLDER, RELEASE_FOLDER, SHARED_FOLDER].contains(&name)
}

/// Whether a top-level entry of `~/.misty` stays where it is when the layout from before data
/// folders moves in: layout v1's own, hidden, or a release channel's versions.
fn stays_at_top(root: &Path, name: &str) -> bool {
    if name == ".local" {
        return false;
    }
    name.starts_with('.') || is_v1_entry(name) || is_channel_folder(&root.join(name))
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

/// Every release version in `rel/`.
fn release_versions(root: &Path) -> Vec<(Version, String)> {
    let Ok(entries) = fs::read_dir(root.join(RELEASE_FOLDER)) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter_map(|name| Some((Version::parse(&name)?, name)))
        .collect()
}

/// The newest version's folder older than `version`.
fn newest_before(root: &Path, version: &str) -> Option<PathBuf> {
    let current = Version::parse(version)?;
    release_versions(root)
        .into_iter()
        .filter(|(older, _)| older.cmp(&current) == Ordering::Less)
        .max_by(|(a, _), (b, _)| a.cmp(b))
        .map(|(_, name)| root.join(RELEASE_FOLDER).join(name))
}

/// Keeps the versions from `version` up and the newest one before it; the older ones go to the
/// Trash. A version the Trash refuses stays where it is.
fn retire_old_versions(root: &Path, version: &str, trash: &Trash, report: &mut ProfileReport) {
    let Some(current) = Version::parse(version) else {
        return;
    };
    let mut older: Vec<(Version, String)> = release_versions(root)
        .into_iter()
        .filter(|(parsed, _)| parsed.cmp(&current) == Ordering::Less)
        .collect();
    older.sort_by(|(a, _), (b, _)| b.cmp(a));
    let batch = format!(
        "Misty old versions {}",
        chrono::Local::now().format("%Y-%m-%d %H.%M.%S")
    );
    for (_, name) in older.into_iter().skip(1) {
        let relative = format!("{RELEASE_FOLDER}/{name}");
        match trash.take(&root.join(RELEASE_FOLDER).join(&name), &batch, &relative) {
            Ok(()) => report.retired.push(relative),
            Err(_) => report.kept.push(relative),
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
        assert_eq!(
            version_order("0.1.0-beta.2", "0.1.0-beta.10"),
            Ordering::Less
        );
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
            let data = root.join("rel").join(version).join("data");
            std::fs::create_dir_all(&data).unwrap();
            std::fs::write(data.join("misty.db"), version).unwrap();
        }
        file_access::conf::write_root(&root, Path::new("rel/0.1.0-beta.3")).unwrap();

        let report = open_at(&root, &release("0.1.0"), &trash).unwrap();

        let home = root.join("rel/0.1.0");
        assert_eq!(report.started_from, Some(root.join("rel/0.1.0-beta.3")));
        assert_eq!(
            std::fs::read_to_string(home.join("data/misty.db")).unwrap(),
            "0.1.0-beta.3"
        );
        // The newest older version stays to go back to; the older ones went to the Trash.
        assert!(root.join("rel/0.1.0-beta.3").is_dir());
        assert!(!root.join("rel/0.1.0-beta.1").exists());
        assert!(!root.join("rel/0.1.0-beta.2").exists());
        assert_eq!(report.retired.len(), 2);
        // misty.conf now names the running version.
        let conf = file_access::conf::read(&root).unwrap().unwrap();
        assert_eq!(conf.root.as_deref(), Some("~/.misty/rel/0.1.0"));
    }

    #[test]
    fn a_misty_folder_from_before_v1_takes_the_v1_layout() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join(".misty");
        for version in ["0.1.0-beta.1", "0.1.0-beta.2"] {
            std::fs::create_dir_all(root.join("beta").join(version).join("data")).unwrap();
        }
        std::fs::create_dir_all(root.join("engines/codex")).unwrap();
        std::fs::create_dir_all(root.join("workspace")).unwrap();
        std::fs::create_dir_all(root.join(".env/server")).unwrap();
        let trash = Trash::Folder(base.path().join("Trash"));

        let report = open_at(&root, &release("0.1.0-beta.2"), &trash).unwrap();

        assert!(root.join("rel/0.1.0-beta.1").is_dir());
        assert!(root.join("rel/0.1.0-beta.2/data").is_dir());
        assert!(!root.join("beta").exists());
        assert!(root.join("shared/engines/codex").is_dir());
        assert!(root.join("shared/projects").is_dir());
        assert!(root.join("rel/0.1.0-beta.2/.env/server").is_dir());
        assert!(!root.join(".env").exists());
        assert!(!report.reorganized.is_empty());
        let conf = file_access::conf::read(&root).unwrap().unwrap();
        assert_eq!(conf.manifest.as_deref(), Some("v1"));
        assert_eq!(conf.root.as_deref(), Some("~/.misty/rel/0.1.0-beta.2"));
    }

    #[test]
    fn a_dev_build_leaves_a_dev_folder_named_in_misty_conf_alone() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join(".misty");
        std::fs::create_dir_all(&root).unwrap();
        file_access::conf::write_root(&root, Path::new("dev/bench")).unwrap();
        let trash = Trash::Folder(base.path().join("Trash"));

        open_at(&root, &Profile::Dev("default".into()), &trash).unwrap();

        let conf = file_access::conf::read(&root).unwrap().unwrap();
        assert_eq!(conf.root.as_deref(), Some("~/.misty/dev/bench"));
    }

    #[test]
    fn the_layout_from_before_data_folders_moves_into_the_first_one() {
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
        assert!(home.join(".env/server").is_dir());
        assert!(!root.join("data").exists());
        // What every build shares goes into shared/.
        assert!(root.join("shared/engines/codex").is_dir());
        #[cfg(unix)]
        assert_eq!(
            std::fs::read_link(home.join("data/runs")).unwrap(),
            home.join("turn-snapshots/runs")
        );
    }
}
