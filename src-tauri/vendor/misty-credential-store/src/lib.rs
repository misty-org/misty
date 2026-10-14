//! Misty's credential store. Every secret (account logins, device keys, API keys, the
//! vault secret) is a row in `misty.db`, encrypted with a single master key. Release
//! builds keep that key in the operating system's keychain under the service
//! `com.misty.auth`; debug builds keep it in a private file, so rebuilding never asks
//! the keychain for anything. Nothing else holds a credential on disk.
pub mod account;
mod master_key;
mod secrets;
#[cfg(windows)]
mod windows;

use std::{
    fs, io,
    path::{Path, PathBuf},
};

pub use secrets::{delete, load, store};

/// The keychain service that holds the master key.
pub const KEYCHAIN_SERVICE: &str = master_key::SERVICE;

static OVERRIDE_ROOT: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Selects the directory that holds `misty.db` (mobile shells and tests use their own).
pub fn configure_root(path: PathBuf) -> io::Result<()> {
    data_directory(&path)?;
    OVERRIDE_ROOT
        .set(path)
        .map_err(|_| io::Error::other("Credential root already configured"))
}

/// Windows: gives a folder of private data a DACL that admits only its
/// owner and SYSTEM (the counterpart of mode 0700). A no-op when it has one.
#[cfg(windows)]
pub fn restrict_private_directory(path: &Path) -> io::Result<()> {
    windows::restrict_directory(path)
}

/// Windows: whether a folder already admits only its owner and SYSTEM.
#[cfg(windows)]
pub fn is_private_directory(path: &Path) -> bool {
    windows::is_restricted(path)
}

/// Windows: gives a private file the same owner-and-SYSTEM DACL (the
/// counterpart of mode 0600).
#[cfg(windows)]
pub fn restrict_private_file(path: &Path) -> io::Result<()> {
    windows::restrict_directory(path)
}

/// Windows: whether a file admits only its owner and SYSTEM.
#[cfg(windows)]
pub fn is_private_file(path: &Path) -> bool {
    windows::is_restricted(path)
}

/// `~/.misty/.local/data`, or the configured root.
pub fn data_dir() -> io::Result<PathBuf> {
    if let Some(root) = OVERRIDE_ROOT.get() {
        data_directory(root)?;
        return Ok(root.clone());
    }
    let home = dirs::home_dir().ok_or_else(|| io::Error::other("Home directory unavailable"))?;
    let directory = home.join(".misty");
    private_directory(&directory)?;
    let directory = directory.join(".local");
    private_directory(&directory)?;
    let directory = directory.join("data");
    data_directory(&directory)?;
    Ok(directory)
}

/// The path of Misty's database.
pub fn database_path() -> io::Result<PathBuf> {
    Ok(data_dir()?.join("misty.db"))
}

/// A directory that holds secrets: private, and on Windows locked to its owner.
fn data_directory(path: &Path) -> io::Result<()> {
    private_directory(path)?;
    #[cfg(windows)]
    windows::restrict_directory(path)?;
    Ok(())
}

pub(crate) fn private_directory(path: &Path) -> io::Result<()> {
    #[cfg_attr(not(unix), allow(unused_mut))]
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

/// The profile that scopes a secret: the development profile, else "default".
pub(crate) fn profile() -> String {
    std::env::var("MISTY_PROFILE")
        .or_else(|_| std::env::var("MISTY_DESKTOP_PROFILE"))
        .unwrap_or_else(|_| "default".to_owned())
}

const LAYOUT_TABLE: &str =
    "CREATE TABLE IF NOT EXISTS layout (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)";

fn layout_connection(home: &Path) -> io::Result<rusqlite::Connection> {
    let data = home.join(".local").join("data");
    fs::create_dir_all(&data)?;
    let connection = rusqlite::Connection::open(data.join("misty.db")).map_err(io::Error::other)?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(io::Error::other)?;
    connection.execute_batch(LAYOUT_TABLE).map_err(io::Error::other)?;
    Ok(connection)
}

/// The layout version the Misty home at `home` was last brought to, if it has been.
pub fn layout_version(home: &Path) -> io::Result<Option<u32>> {
    if !home.join(".local").join("data").join("misty.db").is_file() {
        return Ok(None);
    }
    let connection = layout_connection(home)?;
    connection
        .query_row("SELECT version FROM layout WHERE id = 1", [], |row| {
            row.get::<_, u32>(0)
        })
        .map(Some)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(io::Error::other(other)),
        })
}

/// Records the layout version of the Misty home at `home`.
pub fn set_layout_version(home: &Path, version: u32) -> io::Result<()> {
    layout_connection(home)?
        .execute(
            "INSERT INTO layout (id, version) VALUES (1, ?1)
             ON CONFLICT (id) DO UPDATE SET version = excluded.version",
            [version],
        )
        .map(|_| ())
        .map_err(io::Error::other)
}
