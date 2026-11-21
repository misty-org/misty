//! How each OS shows a Space: one [`crate::OsFace`] per mounted Space.
//!
//! - Linux: `fuse`, a FUSE file system Misty answers itself (`fuser`).
//! - macOS: `file_provider`, the Misty side of the File Provider extension: the account's one
//!   domain with a folder per Space, the signals and the `~/.misty/mnt` links. The extension itself talks to Misty over `socket`.
//! - Windows: `cloud_files`, a Cloud Files sync root per Space, registered with Explorer, whose
//!   callbacks Misty answers and whose local changes it watches for.
#[cfg(target_os = "windows")]
pub mod cloud_files;
#[cfg(target_os = "macos")]
pub mod file_provider;
#[cfg(target_os = "linux")]
pub mod fuse;

use crate::{DriveError, Item, ItemId, OsFace, SpaceId, SpaceMount};

/// A face that shows nothing anywhere: for tests, and for a Space whose OS face isn't built yet.
/// Misty's own Files still lists the Space from `drive.db`.
#[derive(Default)]
pub struct NoFace;

impl OsFace for NoFace {
    fn mount(&self, _space: &SpaceMount) -> Result<(), DriveError> {
        Ok(())
    }

    fn unmount(&self, _space: &SpaceId) -> Result<(), DriveError> {
        Ok(())
    }

    fn changed(&self, _space: &SpaceId, _items: &[Item]) {}

    fn evict(&self, _space: &SpaceId, _item: &ItemId) -> Result<(), DriveError> {
        Ok(())
    }
}
