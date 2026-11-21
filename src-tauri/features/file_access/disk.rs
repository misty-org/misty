//! The disk grant: Files' one way to the whole disk. The rest of Misty never looks at it, because
//! [`super::check`] knows nothing of it, so a feature that isn't Files stays where its own grants
//! put it. Only `features/files/` may call this module, which a test there holds it to.
//!
//! With the grant on, the person may reach anything their own user can, except three things that
//! stay closed whatever they choose:
//! - Misty's own data (`~/.misty` and its app folders), save the Space drives mounted under
//!   `~/.misty/mnt*`, which are the person's files like any other;
//! - the keychains, read or write;
//! - writing into the system's own folders (`/System`, `/usr`, `C:\Windows`, Program Files…).
//!
//! Agents get less ([`check_agent`]): never a secret (`.env`, keys, `.ssh`…), and a change only to
//! what the person's own user owns, the item and the folder it is in, so nothing an agent does can
//! ever need an administrator's password. Misty never asks for one.
use std::{
    io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

use super::{check, check_link, real_path, refused, secrets, Access, Reach, POLICY};

static GRANTED: AtomicBool = AtomicBool::new(false);

/// Turns the disk grant on. Only `permissions` calls this, after the person's yes in a native
/// prompt or at startup from that saved answer.
pub fn allow_disk() {
    GRANTED.store(true, Ordering::SeqCst);
}

pub fn revoke_disk() {
    GRANTED.store(false, Ordering::SeqCst);
}

pub fn disk_allowed() -> bool {
    GRANTED.load(Ordering::SeqCst)
}

/// Why a path is closed whatever the grant says, or None. `real` is a real path already.
fn always_closed(real: &Path, access: Access) -> Option<&'static str> {
    if is_misty_data(real) {
        return Some("That folder holds Misty's own data.");
    }
    if is_keychain(real) {
        return Some("Keychains can't be opened here.");
    }
    if access == Access::Write && is_system_folder(real) {
        return Some("System folders can't be changed.");
    }
    None
}

/// Inside `~/.misty` or Misty's own app folders, and not inside a Space drive's mount.
fn is_misty_data(real: &Path) -> bool {
    if is_drive_mount(real) {
        return false;
    }
    let policy = POLICY.read().unwrap_or_else(|poisoned| poisoned.into_inner());
    if policy.reach_covers(Reach::SpaceDrive, real) {
        return false;
    }
    [Reach::MistyHome, Reach::AppFolders, Reach::WebsiteData]
        .into_iter()
        .any(|reach| policy.reach_covers(reach, real))
        || super::paths::misty_root_dir()
            .and_then(|root| real_path::resolve(&root).ok())
            .is_some_and(|root| real.starts_with(root))
}

/// `~/.misty/mnt*/…`: where the Space drives are mounted.
fn is_drive_mount(real: &Path) -> bool {
    let Some(root) = super::paths::misty_root_dir().and_then(|root| real_path::resolve(&root).ok())
    else {
        return false;
    };
    real.strip_prefix(&root)
        .ok()
        .and_then(|inside| inside.components().next())
        .is_some_and(|first| first.as_os_str().to_string_lossy().starts_with("mnt"))
}

fn is_keychain(real: &Path) -> bool {
    let mut folders: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        folders.push(PathBuf::from("/Library/Keychains"));
        folders.push(PathBuf::from("/System/Library/Keychains"));
        folders.push(PathBuf::from("/Network/Library/Keychains"));
        if let Some(home) = dirs::home_dir() {
            folders.push(home.join("Library").join("Keychains"));
        }
    }
    #[cfg(windows)]
    for (variable, inside) in [
        ("APPDATA", ["Microsoft", "Credentials"]),
        ("APPDATA", ["Microsoft", "Protect"]),
        ("LOCALAPPDATA", ["Microsoft", "Credentials"]),
        ("LOCALAPPDATA", ["Microsoft", "Vault"]),
    ] {
        if let Some(base) = std::env::var_os(variable) {
            folders.push(PathBuf::from(base).join(inside[0]).join(inside[1]));
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    if let Some(home) = dirs::home_dir() {
        folders.push(home.join(".local").join("share").join("keyrings"));
    }
    folders
        .iter()
        .map(|folder| real_path::resolve(folder).unwrap_or_else(|_| folder.clone()))
        .any(|folder| real.starts_with(folder))
}

/// The system's own folders, which no one changes without an administrator. The temp folder is
/// left out, though on macOS it lives under `/private`.
fn is_system_folder(real: &Path) -> bool {
    let temp = real_path::resolve(&std::env::temp_dir()).unwrap_or_else(|_| std::env::temp_dir());
    if real.starts_with(&temp) {
        return false;
    }
    #[cfg(unix)]
    {
        let system = [
            "/System", "/Library", "/usr", "/bin", "/sbin", "/private", "/etc", "/var", "/dev",
            "/cores", "/boot", "/lib", "/lib64", "/proc", "/sys", "/root", "/snap",
        ];
        if real == Path::new("/") {
            return true;
        }
        if system.iter().any(|folder| real.starts_with(folder)) {
            return true;
        }
    }
    #[cfg(windows)]
    {
        let lower = real.to_string_lossy().to_lowercase();
        let lower = lower.trim_start_matches(r"\\?\");
        let system = ["SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData"]
            .iter()
            .filter_map(|name| std::env::var_os(name))
            .map(|folder| folder.to_string_lossy().to_lowercase());
        for folder in system {
            if lower == folder || lower.starts_with(&format!("{folder}\\")) {
                return true;
            }
        }
        if real.parent().is_none() {
            return true;
        }
    }
    false
}

fn closed(path: &Path, why: &'static str) -> io::Error {
    #[cfg(debug_assertions)]
    eprintln!("[file gate] closed: {} ({why})", path.display());
    #[cfg(not(debug_assertions))]
    let _ = path;
    io::Error::new(io::ErrorKind::PermissionDenied, why)
}

/// Refuses `path` unless the normal policy allows it or the disk grant is on, and never for what
/// is always closed. `..` and links are resolved first, so neither reaches around a rule.
pub fn check_disk(path: &Path, access: Access) -> io::Result<()> {
    let real = real_path::resolve(path)?;
    gate(path, &real, access, false)
}

/// The same for a call that acts on a link rather than through it: only the link's own folder
/// counts, wherever it points.
pub fn check_disk_link(path: &Path, access: Access) -> io::Result<()> {
    let real = real_path::resolve_parent(path)?;
    gate(path, &real, access, true)
}

fn gate(path: &Path, real: &Path, access: Access, link: bool) -> io::Result<()> {
    if let Some(why) = always_closed(real, access) {
        return Err(closed(path, why));
    }
    if disk_allowed() {
        return Ok(());
    }
    // Without the grant, only what the rest of Misty may already reach (a linked folder, a
    // mounted Space drive, Downloads once granted).
    let normal = if link { check_link(path, access) } else { check(path, access) };
    normal.map_err(|_| refused(path, access))
}

/// What an agent may reach on the disk: the disk grant has to be on (agents never reach further
/// than the person allowed), it isn't a secret, and a change touches only what the person's own
/// user owns, the item and the folder it's in.
pub fn check_agent(path: &Path, access: Access) -> io::Result<()> {
    if !disk_allowed() {
        return Err(closed(path, "Files hasn't been given access to this computer."));
    }
    let real = real_path::resolve_parent(path)?;
    if let Some(why) = always_closed(&real, access) {
        return Err(closed(path, why));
    }
    let followed = real_path::resolve(path)?;
    if let Some(why) = always_closed(&followed, access) {
        return Err(closed(path, why));
    }
    if secrets::closed_to_agents(&real) || secrets::closed_to_agents(&followed) {
        return Err(closed(path, "Agents can't open secrets or keys."));
    }
    if access == Access::Write {
        owned_by_person(&real)?;
    }
    Ok(())
}

/// The item (if it exists) and the folder it is in both belong to the person's own user, so the
/// change never needs an administrator. On Windows, where ownership isn't a simple id, the system
/// folders refused above are the whole rule.
fn owned_by_person(real: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        // SAFETY: getuid has no preconditions and can't fail.
        let me = unsafe { libc::getuid() };
        let mine = |path: &Path| match std::fs::symlink_metadata(path) {
            Ok(meta) => Some(meta.uid() == me),
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(_) => Some(false),
        };
        if mine(real) == Some(false) {
            return Err(closed(real, "That item belongs to another user of this computer."));
        }
        let folder = real.parent().unwrap_or(real);
        if mine(folder) != Some(true) {
            return Err(closed(real, "That folder belongs to another user of this computer."));
        }
    }
    #[cfg(not(unix))]
    let _ = real;
    Ok(())
}

/// Whether an agent could change this item, for Get Info's "agents may change it".
pub fn owned_by_you(path: &Path) -> bool {
    real_path::resolve_parent(path).is_ok_and(|real| owned_by_person(&real).is_ok())
}

/// Agent trash's holding folder on the drive Misty's data is on: `~/.misty/agent-trash`. It sits
/// in Misty's data, which the disk gate never opens, so items reach it only through the two
/// renames below.
pub fn agent_trash_folder() -> Option<PathBuf> {
    super::paths::misty_root_dir().map(|root| root.join("agent-trash"))
}

/// Refuses `held` unless it is directly in [`agent_trash_folder`].
fn directly_in_agent_trash(held: &Path) -> io::Result<()> {
    let folder = agent_trash_folder()
        .and_then(|folder| real_path::resolve(&folder).ok())
        .ok_or_else(|| closed(held, "Misty couldn't find its data folder."))?;
    let real = real_path::resolve_parent(held)?;
    (real.parent() == Some(folder.as_path()) && real.file_name().is_some())
        .then_some(())
        .ok_or_else(|| closed(held, "That item isn't in Agent trash."))
}

/// Moves what an agent trashed into Agent trash's holding folder: one rename on one drive, never a
/// copy and a delete. `from` passes [`check_agent`] for writing.
pub fn rename_into_agent_trash(from: &Path, held: &Path) -> io::Result<()> {
    check_agent(from, Access::Write)?;
    directly_in_agent_trash(held)?;
    std::fs::rename(from, held)
}

/// Puts a held item back at `to` for the person, which passes the disk gate for writing.
pub fn rename_out_of_agent_trash(held: &Path, to: &Path) -> io::Result<()> {
    directly_in_agent_trash(held)?;
    check_disk_link(to, Access::Write)?;
    std::fs::rename(held, to)
}

/// `std::fs` under the disk grant. The same signatures as [`super::fs`], so code moves between
/// them by changing the `use`.
pub mod fs_disk {
    use std::{
        fs, io,
        path::{Path, PathBuf},
    };

    use super::{check_disk, check_disk_link};
    use crate::{fs_handles::File, Access};

    pub use std::fs::{Metadata, Permissions, ReadDir};

    pub fn read(path: impl AsRef<Path>) -> io::Result<Vec<u8>> {
        check_disk(path.as_ref(), Access::Read)?;
        fs::read(path)
    }

    pub fn read_to_string(path: impl AsRef<Path>) -> io::Result<String> {
        check_disk(path.as_ref(), Access::Read)?;
        fs::read_to_string(path)
    }

    pub fn write(path: impl AsRef<Path>, contents: impl AsRef<[u8]>) -> io::Result<()> {
        check_disk(path.as_ref(), Access::Write)?;
        fs::write(path, contents)
    }

    pub fn open(path: impl AsRef<Path>) -> io::Result<File> {
        check_disk(path.as_ref(), Access::Read)?;
        fs::File::open(path).map(File::from_std)
    }

    /// Creates a file that mustn't exist yet.
    pub fn create_new(path: impl AsRef<Path>) -> io::Result<File> {
        check_disk_link(path.as_ref(), Access::Write)?;
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map(File::from_std)
    }

    /// Creates or truncates a file.
    pub fn create(path: impl AsRef<Path>) -> io::Result<File> {
        check_disk(path.as_ref(), Access::Write)?;
        fs::File::create(path).map(File::from_std)
    }

    pub fn create_dir(path: impl AsRef<Path>) -> io::Result<()> {
        check_disk_link(path.as_ref(), Access::Write)?;
        fs::create_dir(path)
    }

    pub fn create_dir_all(path: impl AsRef<Path>) -> io::Result<()> {
        check_disk(path.as_ref(), Access::Write)?;
        fs::create_dir_all(path)
    }

    pub fn remove_file(path: impl AsRef<Path>) -> io::Result<()> {
        check_disk_link(path.as_ref(), Access::Write)?;
        fs::remove_file(path)
    }

    pub fn remove_dir(path: impl AsRef<Path>) -> io::Result<()> {
        check_disk_link(path.as_ref(), Access::Write)?;
        fs::remove_dir(path)
    }

    /// Removes a link rather than following it, and doesn't follow links inside the folder either.
    pub fn remove_dir_all(path: impl AsRef<Path>) -> io::Result<()> {
        check_disk_link(path.as_ref(), Access::Write)?;
        fs::remove_dir_all(path)
    }

    pub fn rename(from: impl AsRef<Path>, to: impl AsRef<Path>) -> io::Result<()> {
        check_disk_link(from.as_ref(), Access::Write)?;
        check_disk_link(to.as_ref(), Access::Write)?;
        fs::rename(from, to)
    }

    pub fn copy(from: impl AsRef<Path>, to: impl AsRef<Path>) -> io::Result<u64> {
        check_disk(from.as_ref(), Access::Read)?;
        check_disk_link(to.as_ref(), Access::Write)?;
        fs::copy(from, to)
    }

    pub fn metadata(path: impl AsRef<Path>) -> io::Result<Metadata> {
        check_disk(path.as_ref(), Access::Read)?;
        fs::metadata(path)
    }

    pub fn symlink_metadata(path: impl AsRef<Path>) -> io::Result<Metadata> {
        check_disk_link(path.as_ref(), Access::Read)?;
        fs::symlink_metadata(path)
    }

    pub fn read_link(path: impl AsRef<Path>) -> io::Result<PathBuf> {
        check_disk_link(path.as_ref(), Access::Read)?;
        fs::read_link(path)
    }

    pub fn read_dir(path: impl AsRef<Path>) -> io::Result<ReadDir> {
        check_disk(path.as_ref(), Access::Read)?;
        fs::read_dir(path)
    }

    pub fn canonicalize(path: impl AsRef<Path>) -> io::Result<PathBuf> {
        check_disk(path.as_ref(), Access::Read)?;
        fs::canonicalize(path)
    }

    pub fn set_permissions(path: impl AsRef<Path>, permissions: Permissions) -> io::Result<()> {
        check_disk(path.as_ref(), Access::Write)?;
        fs::set_permissions(path, permissions)
    }

    /// Makes a link at `link` pointing to `target`. Only where the link goes is checked: reading
    /// through it is checked at its target.
    #[cfg(unix)]
    pub fn symlink(target: impl AsRef<Path>, link: impl AsRef<Path>) -> io::Result<()> {
        check_disk_link(link.as_ref(), Access::Write)?;
        std::os::unix::fs::symlink(target, link)
    }

    #[cfg(windows)]
    pub fn symlink(target: impl AsRef<Path>, link: impl AsRef<Path>) -> io::Result<()> {
        check_disk_link(link.as_ref(), Access::Write)?;
        if fs::metadata(target.as_ref()).is_ok_and(|meta| meta.is_dir()) {
            std::os::windows::fs::symlink_dir(target, link)
        } else {
            std::os::windows::fs::symlink_file(target, link)
        }
    }

    /// Copies a whole folder to `to`, which must not exist yet, as [`crate::fs::copy_tree`] does
    /// (links stay links; on APFS a clone).
    pub fn copy_tree(from: impl AsRef<Path>, to: impl AsRef<Path>) -> io::Result<()> {
        let (from, to) = (from.as_ref(), to.as_ref());
        check_disk(from, Access::Read)?;
        check_disk_link(to, Access::Write)?;
        crate::fs::copy_tree_unchecked(from, to)
    }

    pub fn exists(path: impl AsRef<Path>) -> bool {
        symlink_metadata(path).is_ok()
    }

    pub fn is_dir(path: impl AsRef<Path>) -> bool {
        metadata(path).is_ok_and(|meta| meta.is_dir())
    }

    pub fn is_file(path: impl AsRef<Path>) -> bool {
        metadata(path).is_ok_and(|meta| meta.is_file())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, sync::Mutex};

    /// The grant is one switch for the whole process, so tests that flip it take turns.
    static GRANT: Mutex<()> = Mutex::new(());

    fn grant_lock() -> std::sync::MutexGuard<'static, ()> {
        GRANT.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn home() -> PathBuf {
        dirs::home_dir().expect("a home folder")
    }

    #[test]
    fn misty_data_is_closed_but_its_drive_mounts_are_not() {
        let root = super::super::paths::misty_root_dir().expect("misty root");
        let _ = fs::create_dir_all(root.join("mnt").join("Family"));
        let _ = fs::create_dir_all(root.join("rel"));
        let real = |path: &Path| real_path::resolve(path).unwrap();
        assert!(is_misty_data(&real(&root.join("rel"))));
        assert!(is_misty_data(&real(&root.join("misty.conf"))));
        assert!(!is_misty_data(&real(&root.join("mnt").join("Family"))));
        assert!(!is_misty_data(&real(&root.join("mnt-dev"))));
    }

    #[test]
    fn system_folders_are_closed_for_writing_only() {
        #[cfg(unix)]
        {
            assert_eq!(
                always_closed(Path::new("/usr/bin/true"), Access::Write),
                Some("System folders can't be changed.")
            );
            assert_eq!(always_closed(Path::new("/usr/bin/true"), Access::Read), None);
            assert!(always_closed(Path::new("/"), Access::Write).is_some());
        }
        let temp = real_path::resolve(&std::env::temp_dir()).unwrap();
        assert_eq!(always_closed(&temp.join("misty-x"), Access::Write), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn keychains_are_closed_even_for_reading() {
        let keychain = home().join("Library").join("Keychains").join("login.keychain-db");
        assert!(always_closed(&keychain, Access::Read).is_some());
        assert!(always_closed(Path::new("/Library/Keychains/System.keychain"), Access::Read).is_some());
    }

    #[test]
    fn without_the_grant_the_disk_stays_closed_and_agents_get_nothing() {
        let _turn = grant_lock();
        revoke_disk();
        // Not under the home folder: tests set it in the temp folder, which their fixtures may reach.
        #[cfg(unix)]
        let outside = PathBuf::from("/misty-outside-test/photo.jpg");
        #[cfg(windows)]
        let outside = PathBuf::from(r"C:\misty-outside-test\photo.jpg");
        assert!(check_disk(&outside, Access::Read).is_err());
        assert!(check_agent(&outside, Access::Read).is_err());
    }

    #[test]
    fn agents_never_reach_secrets_or_misty_data_even_with_the_grant() {
        let _turn = grant_lock();
        allow_disk();
        let ssh = home().join(".ssh").join("id_ed25519");
        assert!(check_agent(&ssh, Access::Read).is_err());
        let env = home().join("project").join(".env");
        assert!(check_agent(&env, Access::Read).is_err());
        let root = super::super::paths::misty_root_dir().expect("misty root");
        assert!(check_agent(&root.join("misty.conf"), Access::Read).is_err());
        assert!(check_disk(&root.join("misty.conf"), Access::Read).is_err());
        #[cfg(unix)]
        assert!(check_agent(Path::new("/usr/bin/true"), Access::Write).is_err());
        revoke_disk();
    }

    #[cfg(unix)]
    #[test]
    fn agents_change_only_what_the_person_owns() {
        let _turn = grant_lock();
        allow_disk();
        let temp = real_path::resolve(&std::env::temp_dir()).unwrap();
        let mine = temp.join(format!("misty-disk-owned-{}", std::process::id()));
        let _ = fs::create_dir_all(&mine);
        assert!(check_agent(&mine.join("notes.txt"), Access::Write).is_ok());
        // `/` belongs to root, so a new item there is refused before the system-folder rule.
        assert!(owned_by_person(Path::new("/new-file")).is_err());
        let _ = fs::remove_dir_all(&mine);
        revoke_disk();
    }
}
