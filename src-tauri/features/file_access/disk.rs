use std::{
    io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, RwLock,
    },
};

use super::{check, check_link, real_path, refused, secrets, Access, Reach, POLICY};

pub mod checked;
pub mod place;
mod sys;
pub mod walk;

pub use crate::paths::normalize_asked;
pub use checked::{CheckedDir, CheckedFile, DirItem, ItemKind};
pub use walk::{CopyOutcome, WalkFlow, WalkFor, WalkStep};

static GRANTED: AtomicBool = AtomicBool::new(false);

pub fn allow_disk() {
    GRANTED.store(true, Ordering::SeqCst);
}

pub fn revoke_disk() {
    GRANTED.store(false, Ordering::SeqCst);
}

pub fn disk_allowed() -> bool {
    GRANTED.load(Ordering::SeqCst)
}

fn always_closed(real: &Path, access: Access) -> Option<&'static str> {
    closed_places().why(real, access)
}

fn folded(path: &Path) -> PathBuf {
    PathBuf::from(path.to_string_lossy().to_lowercase())
}

fn under(path: &Path, folder: &Path) -> bool {
    path.starts_with(folder)
        || (cfg!(target_os = "macos") && folded(path).starts_with(folded(folder)))
}

pub(crate) fn same_place(a: &Path, b: &Path) -> bool {
    a == b || (cfg!(target_os = "macos") && folded(a) == folded(b))
}

type PlacesKey = (Option<PathBuf>, Option<PathBuf>, PathBuf);

static CLOSED: RwLock<Option<Arc<ClosedPlaces>>> = RwLock::new(None);

fn closed_places() -> Arc<ClosedPlaces> {
    let key: PlacesKey = (
        super::paths::misty_root_dir(),
        dirs::home_dir(),
        std::env::temp_dir(),
    );
    if let Some(places) = CLOSED
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .as_ref()
        .filter(|places| places.key == key)
    {
        return places.clone();
    }
    let fresh = Arc::new(ClosedPlaces::resolve(key));
    *CLOSED
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(fresh.clone());
    fresh
}

struct ClosedPlaces {
    key: PlacesKey,
    misty_root: Option<PathBuf>,
    keychains: Vec<PathBuf>,
    temp: PathBuf,
}

impl ClosedPlaces {
    fn resolve(key: PlacesKey) -> Self {
        let misty_root = key
            .0
            .as_ref()
            .and_then(|root| real_path::resolve(root).ok());
        let temp = real_path::resolve(&key.2).unwrap_or_else(|_| key.2.clone());
        Self {
            misty_root,
            keychains: keychain_folders()
                .into_iter()
                .map(|folder| real_path::resolve(&folder).unwrap_or(folder))
                .collect(),
            temp,
            key,
        }
    }

    fn why(&self, real: &Path, access: Access) -> Option<&'static str> {
        if self.is_misty_data(real) {
            return Some("That folder holds Misty's own data.");
        }
        if self.keychains.iter().any(|folder| under(real, folder)) {
            return Some("Keychains can't be opened here.");
        }
        if access == Access::Write && is_system_folder(real, &self.temp) {
            return Some("System folders can't be changed.");
        }
        None
    }

    fn inside(&self, real: &Path) -> Option<&'static str> {
        let policy = POLICY
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let misty = self
            .misty_root
            .iter()
            .cloned()
            .chain(
                [Reach::MistyHome, Reach::AppFolders, Reach::WebsiteData]
                    .into_iter()
                    .flat_map(|reach| policy.roots_of(reach)),
            )
            .any(|folder| under(&folder, real));
        if misty {
            return Some("That folder holds Misty's own data.");
        }
        if self.keychains.iter().any(|folder| under(folder, real)) {
            return Some("That folder holds the computer's keychains.");
        }
        None
    }

    fn is_misty_data(&self, real: &Path) -> bool {
        if self.is_drive_mount(real) {
            return false;
        }
        let policy = POLICY
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if policy.reach_covers(Reach::SpaceDrive, real) {
            return false;
        }
        [Reach::MistyHome, Reach::AppFolders, Reach::WebsiteData]
            .into_iter()
            .any(|reach| policy.reach_covers(reach, real))
            || self
                .misty_root
                .as_ref()
                .is_some_and(|root| under(real, root))
    }

    fn is_drive_mount(&self, real: &Path) -> bool {
        let Some(root) = &self.misty_root else {
            return false;
        };
        real.strip_prefix(root)
            .ok()
            .and_then(|inside| inside.components().next())
            .is_some_and(|first| first.as_os_str().to_string_lossy().starts_with("mnt"))
    }
}

#[cfg(test)]
fn is_misty_data(real: &Path) -> bool {
    closed_places().is_misty_data(real)
}

fn keychain_folders() -> Vec<PathBuf> {
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
}

fn is_system_folder(real: &Path, temp: &Path) -> bool {
    if under(real, temp) {
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
        if system.iter().any(|folder| under(real, Path::new(folder))) {
            return true;
        }
    }
    #[cfg(windows)]
    {
        let lower = real.to_string_lossy().to_lowercase();
        let lower = lower.trim_start_matches(r"\\?\");
        let system = [
            "SystemRoot",
            "ProgramFiles",
            "ProgramFiles(x86)",
            "ProgramW6432",
            "ProgramData",
        ]
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

pub fn check_disk(path: &Path, access: Access) -> io::Result<()> {
    let real = real_path::resolve(path)?;
    gate(path, &real, access, false)
}

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
    let normal = if link {
        check_link(path, access)
    } else {
        check(path, access)
    };
    normal.map_err(|_| refused(path, access))
}

pub struct DiskFolder {
    real: PathBuf,
    closed: Arc<ClosedPlaces>,
}

impl DiskFolder {
    pub fn open(dir: &Path) -> io::Result<Self> {
        Ok(Self {
            real: real_path::resolve(dir)?,
            closed: closed_places(),
        })
    }

    pub fn allows(&self, name: &str, access: Access) -> bool {
        let real = self.real.join(name);
        if self.closed.why(&real, access).is_some() {
            return false;
        }
        disk_allowed() || checked::policy_allows(&real, access)
    }
}

pub fn check_agent(path: &Path, access: Access) -> io::Result<()> {
    if !disk_allowed() {
        return Err(closed(
            path,
            "Files hasn't been given access to this computer.",
        ));
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
            return Err(closed(
                real,
                "That item belongs to another user of this computer.",
            ));
        }
        let folder = real.parent().unwrap_or(real);
        if mine(folder) != Some(true) {
            return Err(closed(
                real,
                "That folder belongs to another user of this computer.",
            ));
        }
    }
    #[cfg(not(unix))]
    let _ = real;
    Ok(())
}

pub fn owned_by_you(path: &Path) -> bool {
    real_path::resolve_parent(path).is_ok_and(|real| owned_by_person(&real).is_ok())
}

pub fn agent_trash_folder() -> Option<PathBuf> {
    super::paths::misty_root_dir().map(|root| root.join("agent-trash"))
}

fn directly_in_agent_trash(held: &Path) -> io::Result<()> {
    let folder = agent_trash_folder()
        .and_then(|folder| real_path::resolve(&folder).ok())
        .ok_or_else(|| closed(held, "Misty couldn't find its data folder."))?;
    let real = real_path::resolve_parent(held)?;
    (real.parent() == Some(folder.as_path()) && real.file_name().is_some())
        .then_some(())
        .ok_or_else(|| closed(held, "That item isn't in Agent trash."))
}

pub fn rename_into_agent_trash(from: &Path, held: &Path) -> io::Result<()> {
    check_agent(from, Access::Write)?;
    directly_in_agent_trash(held)?;
    let (from_dir, from_name) = CheckedDir::open_parent(from, Access::Write, checked::Gate::Agent)?;
    let (held_dir, held_name) = CheckedDir::open_parent(held, Access::Write, checked::Gate::App)?;
    place::rename_new(&from_dir, &from_name, &held_dir, &held_name)
}

pub fn rename_out_of_agent_trash(held: &Path, to: &Path) -> io::Result<()> {
    directly_in_agent_trash(held)?;
    check_disk_link(to, Access::Write)?;
    let (held_dir, held_name) = CheckedDir::open_parent(held, Access::Write, checked::Gate::App)?;
    let (to_dir, to_name) = CheckedDir::open_parent(to, Access::Write, checked::Gate::Person)?;
    place::rename_new(&held_dir, &held_name, &to_dir, &to_name)
}

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

    pub fn create_new(path: impl AsRef<Path>) -> io::Result<File> {
        check_disk_link(path.as_ref(), Access::Write)?;
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map(File::from_std)
    }

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

    fn absolute(path: &Path) -> io::Result<PathBuf> {
        if path.is_absolute() {
            Ok(path.to_path_buf())
        } else {
            Ok(std::env::current_dir()?.join(path))
        }
    }

    pub fn remove_dir_all(path: impl AsRef<Path>) -> io::Result<()> {
        super::walk::remove_tree_checked(
            &absolute(path.as_ref())?,
            super::walk::WalkFor::Person,
            &mut |_| true,
        )
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

    pub fn copy_tree(from: impl AsRef<Path>, to: impl AsRef<Path>) -> io::Result<()> {
        let (from, to) = (absolute(from.as_ref())?, absolute(to.as_ref())?);
        let (Some(folder), Some(name)) = (to.parent(), to.file_name()) else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "A whole drive can't be used here.",
            ));
        };
        super::walk::copy_tree_checked(
            &from,
            folder,
            name,
            super::walk::WalkFor::Person,
            &mut |_, _| true,
        )
        .map(drop)
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
static GRANT: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
pub(crate) fn grant_lock() -> std::sync::MutexGuard<'static, ()> {
    GRANT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod gate_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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
            assert_eq!(
                always_closed(Path::new("/usr/bin/true"), Access::Read),
                None
            );
            assert!(always_closed(Path::new("/"), Access::Write).is_some());
        }
        let temp = real_path::resolve(&std::env::temp_dir()).unwrap();
        assert_eq!(always_closed(&temp.join("misty-x"), Access::Write), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn keychains_are_closed_even_for_reading() {
        let keychain = home()
            .join("Library")
            .join("Keychains")
            .join("login.keychain-db");
        assert!(always_closed(&keychain, Access::Read).is_some());
        assert!(always_closed(
            Path::new("/Library/Keychains/System.keychain"),
            Access::Read
        )
        .is_some());
    }

    #[test]
    fn without_the_grant_the_disk_stays_closed_and_agents_get_nothing() {
        let _turn = grant_lock();
        revoke_disk();
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
        assert!(owned_by_person(Path::new("/new-file")).is_err());
        let _ = fs::remove_dir_all(&mine);
        revoke_disk();
    }
}
