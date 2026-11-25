use std::{io, path::Path};

use file_access::disk::fs_disk;

const VOLUME_HOLDING: &str = ".misty-agent-trash";

fn in_misty_holding(path: &Path) -> bool {
    file_access::disk::agent_trash_folder().is_some_and(|folder| path.parent() == Some(folder.as_path()))
}

fn in_volume_holding(path: &Path) -> bool {
    path.parent()
        .and_then(Path::file_name)
        .is_some_and(|name| name == VOLUME_HOLDING)
}

pub(super) fn held_exists(holding: &Path) -> bool {
    if in_misty_holding(holding) {
        return file_access::fs::symlink_metadata(holding).is_ok();
    }
    in_volume_holding(holding) && fs_disk::symlink_metadata(holding).is_ok()
}

pub(super) fn out_of_holding(holding: &Path, target: &Path) -> Result<(), String> {
    let failed = |error: io::Error| super::super::failed(target, error);
    if let Some(parent) = target.parent() {
        if !fs_disk::exists(parent) {
            fs_disk::create_dir_all(parent).map_err(failed)?;
        }
    }
    if in_volume_holding(holding) {
        use file_access::{disk::place, Access};
        let (held_dir, held) =
            super::super::gated::parent(holding, Access::Write).map_err(failed)?;
        let (to_dir, to) = super::super::gated::parent(target, Access::Write).map_err(failed)?;
        return place::rename_new(&held_dir, &held, &to_dir, &to).map_err(failed);
    }
    if !in_misty_holding(holding) {
        return Err("That item isn't in Misty's old agent trash.".into());
    }
    file_access::disk::rename_out_of_agent_trash(holding, target).map_err(failed)
}

pub(super) fn remove_empty_holding() {
    if let Some(folder) = file_access::disk::agent_trash_folder() {
        let _ = file_access::fs::remove_dir(&folder);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_items_directly_in_a_holding_folder_count() {
        let misty = file_access::disk::agent_trash_folder().expect("a data folder");
        assert!(in_misty_holding(&misty.join("abc-file.txt")));
        assert!(!in_misty_holding(&misty.join("x").join("file.txt")));
        assert!(in_volume_holding(Path::new(
            "/Volumes/USB/.misty-agent-trash/abc-a"
        )));
        assert!(!in_volume_holding(Path::new("/Volumes/USB/elsewhere/abc-a")));
    }
}
