#[cfg(target_os = "windows")]
pub mod cloud_files;
#[cfg(target_os = "macos")]
pub mod file_provider;
#[cfg(target_os = "linux")]
pub mod fuse;

use crate::{DriveError, Item, ItemId, OsFace, SpaceId, SpaceMount};

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
