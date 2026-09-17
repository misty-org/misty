//! Misty's native credential files. No OS credential service is contacted.
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

static OVERRIDE_ROOT: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

// Mobile shells select their private app-data directory before using the store.
pub fn configure_root(path: PathBuf) -> io::Result<()> {
    private_directory(&path)?;
    OVERRIDE_ROOT
        .set(path)
        .map_err(|_| io::Error::other("Credential root already configured"))
}

const MAX_BYTES: u64 = 4 * 1024 * 1024;

pub fn root() -> io::Result<PathBuf> {
    if let Some(root) = OVERRIDE_ROOT.get() {
        private_directory(root)?;
        return Ok(root.clone());
    }
    let home = dirs::home_dir().ok_or_else(|| io::Error::other("Home directory unavailable"))?;
    let directory = home.join(".misty");
    private_directory(&directory)?;
    let directory = directory.join(".auth");
    private_directory(&directory)?;
    Ok(directory)
}

fn private_directory(path: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    match builder.create(path) {
        Ok(()) => (),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => (),
        Err(error) => return Err(error),
    }
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(io::Error::other(
            "Credential directory must be a real directory",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if metadata.uid() != unsafe { libc::geteuid() } {
            return Err(io::Error::other(
                "Credential directory has a different owner",
            ));
        }
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

pub fn file_name(service: &str, account: &str, profile: Option<&str>) -> String {
    let mut digest = Sha256::new();
    for part in [profile.unwrap_or("default"), service, account] {
        // Length prefixes prevent ambiguous service/account boundaries.
        digest.update((part.len() as u64).to_be_bytes());
        digest.update(part.as_bytes());
    }
    format!("{}.secret", hex::encode(digest.finalize()))
}

pub fn path(service: &str, account: &str) -> io::Result<PathBuf> {
    let profile = std::env::var("MISTY_PROFILE")
        .or_else(|_| std::env::var("MISTY_DESKTOP_PROFILE"))
        .ok();
    Ok(root()?.join(file_name(service, account, profile.as_deref())))
}

pub fn load(service: &str, account: &str) -> io::Result<Option<String>> {
    read_private_file(&path(service, account)?)
}

pub fn read_private_file(path: &Path) -> io::Result<Option<String>> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = match options.open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err(io::Error::other("Invalid credential file"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if metadata.uid() != unsafe { libc::geteuid() } || metadata.nlink() != 1 {
            return Err(io::Error::other(
                "Credential file must belong exclusively to this user",
            ));
        }
        file.set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    let mut value = String::new();
    file.take(MAX_BYTES + 1).read_to_string(&mut value)?;
    if value.len() as u64 > MAX_BYTES {
        return Err(io::Error::other("Credential file too large"));
    }
    Ok(Some(value))
}

pub fn store(service: &str, account: &str, value: &str) -> io::Result<()> {
    write_private_file(&path(service, account)?, value)
}

pub fn write_private_file(path: &Path, value: &str) -> io::Result<()> {
    if value.len() as u64 > MAX_BYTES {
        return Err(io::Error::other("Credential file too large"));
    }
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("Missing credential directory"))?;
    private_directory(parent)?;
    let mut file = tempfile::NamedTempFile::new_in(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    file.write_all(value.as_bytes())?;
    file.as_file().sync_all()?;
    file.persist(path).map_err(|error| error.error)?;
    #[cfg(unix)]
    fs::File::open(parent)?.sync_all()?;
    Ok(())
}

pub fn delete(service: &str, account: &str) -> io::Result<()> {
    match fs::remove_file(path(service, account)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_separate_profiles_services_and_accounts() {
        let name = file_name("service", "account", None);
        assert_ne!(name, file_name("service", "account", Some("work")));
        assert_ne!(name, file_name("other", "account", None));
        assert_ne!(name, file_name("service", "other", None));
        assert!(!file_name("../../", "../", None).contains('/'));
    }
    #[test]
    fn atomic_replacement_and_private_permissions() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("credential");
        assert_eq!(read_private_file(&path).unwrap(), None);
        write_private_file(&path, "first").unwrap();
        write_private_file(&path, "second").unwrap();
        assert_eq!(read_private_file(&path).unwrap().as_deref(), Some("second"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(temp.path()).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
    }
    #[cfg(unix)]
    #[test]
    fn refuses_symlink_reads_and_symlink_directories() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("target");
        fs::write(&target, "untouched").unwrap();
        let link = temp.path().join("link");
        symlink(&target, &link).unwrap();
        assert!(read_private_file(&link).is_err());
        // Atomic writes replace a link, never follow it into another file.
        write_private_file(&link, "credential").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "untouched");
        let directory_link = temp.path().join("directory-link");
        symlink(temp.path(), &directory_link).unwrap();
        assert!(write_private_file(&directory_link.join("secret"), "x").is_err());
    }
}
