use std::{
    io,
    path::{Path, PathBuf},
};

use file_access::disk::fs_disk;

pub(super) const VOLUME_HOLDING: &str = ".misty-agent-trash";
const NAME_BYTES: usize = 200;

pub(crate) fn misty_holding() -> Option<PathBuf> {
    file_access::disk::agent_trash_folder()
}

pub(super) fn in_misty_holding(path: &Path) -> bool {
    misty_holding().is_some_and(|folder| path.parent() == Some(folder.as_path()))
}

fn in_volume_holding(path: &Path) -> bool {
    path.parent()
        .and_then(Path::file_name)
        .is_some_and(|name| name == VOLUME_HOLDING)
}

fn holding_name(name: &str) -> String {
    let mut short = String::new();
    for character in name.chars() {
        if short.len() + character.len_utf8() > NAME_BYTES {
            break;
        }
        short.push(character);
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    format!("{}-{short}", &id[..12])
}

#[cfg(unix)]
fn device(folder: &Path, misty: bool) -> io::Result<u64> {
    use std::os::unix::fs::MetadataExt;
    let meta = if misty {
        file_access::fs::metadata(folder)?
    } else {
        fs_disk::metadata(folder)?
    };
    Ok(meta.dev())
}

#[cfg(windows)]
fn device(folder: &Path, _misty: bool) -> io::Result<u64> {
    use std::hash::{Hash, Hasher};
    let prefix = match folder.components().next() {
        Some(std::path::Component::Prefix(prefix)) => {
            prefix.as_os_str().to_string_lossy().to_lowercase()
        }
        _ => return Err(io::Error::other("That path names no drive.")),
    };
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    prefix.hash(&mut hasher);
    Ok(hasher.finish())
}

#[cfg(unix)]
fn volume_root(folder: &Path) -> io::Result<PathBuf> {
    let own = device(folder, false)?;
    let mut root = folder.to_path_buf();
    while let Some(up) = root.parent() {
        if device(up, false)? != own {
            break;
        }
        root = up.to_path_buf();
    }
    Ok(root)
}

#[cfg(windows)]
fn volume_root(folder: &Path) -> io::Result<PathBuf> {
    folder
        .ancestors()
        .last()
        .map(Path::to_path_buf)
        .ok_or_else(|| io::Error::other("That path names no drive."))
}

pub(super) fn into_holding(source: &Path) -> Result<PathBuf, String> {
    let failed = |error: io::Error| super::super::failed(source, error);
    let name = super::super::display_name(source);
    let parent = source
        .parent()
        .ok_or_else(|| format!("{name} can't go to Agent trash."))?;
    let misty = misty_holding().ok_or("Misty couldn't find its data folder.")?;
    let misty_root = misty
        .parent()
        .ok_or("Misty couldn't find its data folder.")?;
    if device(parent, false).map_err(failed)? != device(misty_root, true).map_err(failed)? {
        let folder = volume_root(parent).map_err(failed)?.join(VOLUME_HOLDING);
        fs_disk::create_dir_all(&folder).map_err(|error| {
            format!("Misty can't keep an Agent trash on the drive {name} is on: {error}")
        })?;
        let target = folder.join(holding_name(&name));
        fs_disk::rename(source, &target).map_err(failed)?;
        return Ok(target);
    }
    file_access::fs::create_dir_all(&misty).map_err(failed)?;
    let target = misty.join(holding_name(&name));
    file_access::disk::rename_into_agent_trash(source, &target).map_err(failed)?;
    Ok(target)
}

pub(super) fn out_of_holding(holding: &Path, target: &Path) -> Result<(), String> {
    let failed = |error: io::Error| super::super::failed(target, error);
    if let Some(parent) = target.parent() {
        if !fs_disk::exists(parent) {
            fs_disk::create_dir_all(parent).map_err(failed)?;
        }
    }
    if in_volume_holding(holding) {
        return fs_disk::rename(holding, target).map_err(failed);
    }
    if !in_misty_holding(holding) {
        return Err("That item isn't in Agent trash.".into());
    }
    file_access::disk::rename_out_of_agent_trash(holding, target).map_err(failed)
}

pub(super) fn remove_held(holding: &Path) -> io::Result<()> {
    let refused = || {
        io::Error::new(
            io::ErrorKind::PermissionDenied,
            "That item isn't in Agent trash.",
        )
    };
    let missing = |result: io::Result<()>| match result {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        other => other,
    };
    if in_misty_holding(holding) {
        let meta = match file_access::fs::symlink_metadata(holding) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            other => other?,
        };
        return missing(if meta.is_dir() {
            file_access::fs::remove_dir_all(holding)
        } else {
            file_access::fs::remove_file(holding)
        });
    }
    if !in_volume_holding(holding) {
        return Err(refused());
    }
    let meta = match fs_disk::symlink_metadata(holding) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        other => other?,
    };
    missing(if meta.is_dir() {
        fs_disk::remove_dir_all(holding)
    } else {
        fs_disk::remove_file(holding)
    })
}

pub(super) fn held_size(holding: &Path) -> (super::super::entry::FileKind, u64) {
    use super::super::entry::{is_package_name, FileKind};
    const MOST: usize = 50_000;
    let misty = in_misty_holding(holding);
    let metadata = |path: &Path| {
        if misty {
            file_access::fs::symlink_metadata(path)
        } else {
            fs_disk::symlink_metadata(path)
        }
    };
    let read_dir = |path: &Path| {
        if misty {
            file_access::fs::read_dir(path)
        } else {
            fs_disk::read_dir(path)
        }
    };
    let Ok(meta) = metadata(holding) else {
        return (FileKind::File, 0);
    };
    if meta.file_type().is_symlink() {
        return (FileKind::Link, 0);
    }
    if !meta.is_dir() {
        return (FileKind::File, meta.len());
    }
    let name = holding
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let kind = if is_package_name(&name) {
        FileKind::Package
    } else {
        FileKind::Folder
    };
    let (mut bytes, mut seen, mut folders) = (0u64, 0usize, vec![holding.to_path_buf()]);
    while let Some(folder) = folders.pop() {
        let Ok(entries) = read_dir(&folder) else {
            continue;
        };
        for entry in entries.flatten() {
            seen += 1;
            if seen > MOST {
                return (kind, bytes);
            }
            match metadata(&entry.path()) {
                Ok(meta) if meta.is_dir() => folders.push(entry.path()),
                Ok(meta) if meta.is_file() => bytes += meta.len(),
                _ => {}
            }
        }
    }
    (kind, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn holding_names_are_unique_and_short_enough() {
        let long = "é".repeat(200);
        let name = holding_name(&long);
        assert!(name.len() <= NAME_BYTES + 13);
        assert_ne!(holding_name("a.txt"), holding_name("a.txt"));
        assert!(holding_name("a.txt").ends_with("-a.txt"));
    }

    #[test]
    fn only_items_directly_in_a_holding_folder_count() {
        let misty = misty_holding().expect("a data folder");
        assert!(in_misty_holding(&misty.join("abc-file.txt")));
        assert!(!in_misty_holding(&misty.join("x").join("file.txt")));
        assert!(in_volume_holding(Path::new(
            "/Volumes/USB/.misty-agent-trash/abc-a"
        )));
        assert!(!in_volume_holding(Path::new(
            "/Volumes/USB/elsewhere/abc-a"
        )));
        assert!(remove_held(Path::new("/Users/someone/Documents/a.txt")).is_err());
    }
}
