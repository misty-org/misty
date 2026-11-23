use std::{
    io::{self, Read, Seek, Write},
    path::{Component, Path},
};

use file_access::{disk::fs_disk, Access};
use serde_json::{json, Value};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

use super::{free_name, optional, path_list, text};
use crate::files::{
    agent_paths::{admit, admit_path},
    display_name, failed,
};

const ENTRIES_MOST: usize = 100_000;
const BYTES_MOST: u64 = 8 << 30;

#[derive(Default)]
struct Tally {
    files: u64,
    bytes: u64,
    entries: usize,
    skipped: u64,
}

impl Tally {
    fn room(&mut self, size: u64) -> Result<(), String> {
        self.entries += 1;
        if self.entries > ENTRIES_MOST || self.bytes.saturating_add(size) > BYTES_MOST {
            return Err("That is more than one archive can hold here. Pick fewer items.".into());
        }
        Ok(())
    }
}

fn add<W: Write + Seek>(
    writer: &mut ZipWriter<W>,
    path: &Path,
    name: &str,
    tally: &mut Tally,
) -> Result<(), String> {
    if file_access::disk::check_agent(path, Access::Read).is_err() {
        tally.skipped += 1;
        return Ok(());
    }
    let meta = fs_disk::symlink_metadata(path).map_err(|error| failed(path, error))?;
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .large_file(meta.len() >= u64::from(u32::MAX));
    if meta.file_type().is_symlink() {
        tally.skipped += 1;
    } else if meta.is_dir() {
        tally.room(0)?;
        writer
            .add_directory(format!("{name}/"), options)
            .map_err(|error| failed(path, error))?;
        let items = fs_disk::read_dir(path).map_err(|error| failed(path, error))?;
        for item in items.flatten() {
            let inner = format!("{name}/{}", item.file_name().to_string_lossy());
            add(writer, &item.path(), &inner, tally)?;
        }
    } else if meta.is_file() {
        tally.room(meta.len())?;
        writer
            .start_file(name, options)
            .map_err(|error| failed(path, error))?;
        let mut file = fs_disk::open(path).map_err(|error| failed(path, error))?;
        tally.bytes += io::copy(&mut file, writer).map_err(|error| failed(path, error))?;
        tally.files += 1;
    }
    Ok(())
}

pub(super) fn zip(input: &Value) -> Result<Value, String> {
    let sources = path_list(input, "paths")?
        .iter()
        .map(|path| admit(path, Access::Read))
        .collect::<Result<Vec<_>, String>>()?;
    let first = &sources[0];
    let target = match optional(input, "to") {
        Some(to) => {
            let target = admit(to, Access::Write)?;
            if !display_name(&target).to_lowercase().ends_with(".zip") {
                return Err("The archive's name ends in .zip.".into());
            }
            if fs_disk::exists(&target) {
                return Err(format!("{} is there already.", display_name(&target)));
            }
            target
        }
        None => {
            let folder = first
                .parent()
                .ok_or("That item has no folder to zip into.")?;
            let name = if sources.len() == 1 {
                format!("{}.zip", display_name(first))
            } else {
                "Archive.zip".to_owned()
            };
            admit_path(&free_name(folder, &name), Access::Write)?
        }
    };
    let file = fs_disk::create_new(&target).map_err(|error| failed(&target, error))?;
    let mut writer = ZipWriter::new(file);
    let mut tally = Tally::default();
    let packed = sources
        .iter()
        .try_for_each(|source| add(&mut writer, source, &display_name(source), &mut tally))
        .and_then(|()| {
            writer
                .finish()
                .map(|_| ())
                .map_err(|error| failed(&target, error))
        });
    if let Err(error) = packed {
        let _ = fs_disk::remove_file(&target);
        return Err(error);
    }
    Ok(json!({
        "archive": target.display().to_string(),
        "files": tally.files,
        "skipped": tally.skipped,
    }))
}

fn make_folders(into: &Path, relative: &Path) -> Result<(), String> {
    let mut current = into.to_path_buf();
    for part in relative.components() {
        let Component::Normal(name) = part else {
            return Err("That entry leaves the folder.".into());
        };
        current.push(name);
        if fs_disk::is_dir(&current) {
            continue;
        }
        admit_path(&current, Access::Write)?;
        fs_disk::create_dir(&current).map_err(|error| failed(&current, error))?;
    }
    Ok(())
}

fn is_link(mode: Option<u32>) -> bool {
    mode.is_some_and(|mode| mode & 0o170000 == 0o120000)
}

pub(super) fn extract(input: &Value) -> Result<Value, String> {
    let archive = admit(text(input, "path")?, Access::Read)?;
    let name = display_name(&archive);
    if !name.to_lowercase().ends_with(".zip") {
        return Err("Only zip archives can be unpacked here.".into());
    }
    let into = match optional(input, "to") {
        Some(to) => admit(to, Access::Write)?,
        None => {
            let folder = archive
                .parent()
                .ok_or("That archive has no folder to unpack into.")?;
            let stem = name
                .get(..name.len() - 4)
                .filter(|stem| !stem.is_empty())
                .unwrap_or("Archive");
            admit_path(&free_name(folder, stem), Access::Write)?
        }
    };
    if fs_disk::exists(&into) && !fs_disk::is_dir(&into) {
        return Err(format!(
            "{} is there already, and it isn't a folder.",
            display_name(&into)
        ));
    }
    if !fs_disk::exists(&into) {
        fs_disk::create_dir(&into).map_err(|error| failed(&into, error))?;
    }
    let file = fs_disk::open(&archive).map_err(|error| failed(&archive, error))?;
    let mut zip = ZipArchive::new(file).map_err(|error| failed(&archive, error))?;
    if zip.len() > ENTRIES_MOST {
        return Err(format!(
            "{name} holds more items than can be unpacked here."
        ));
    }
    let mut tally = Tally::default();
    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|error| failed(&archive, error))?;
        let Some(relative) = entry.enclosed_name() else {
            tally.skipped += 1;
            continue;
        };
        if entry.is_dir() {
            if make_folders(&into, &relative).is_err() {
                tally.skipped += 1;
            }
            continue;
        }
        if is_link(entry.unix_mode()) {
            tally.skipped += 1;
            continue;
        }
        let parent = relative.parent().unwrap_or(Path::new(""));
        let target = into.join(&relative);
        let open = make_folders(&into, parent)
            .and_then(|()| admit_path(&target, Access::Write))
            .and_then(|target| {
                fs_disk::create_new(&target).map_err(|error| failed(&target, error))
            });
        let Ok(mut output) = open else {
            tally.skipped += 1;
            continue;
        };
        tally.room(entry.size())?;
        let left = BYTES_MOST - tally.bytes;
        let written = io::copy(&mut (&mut entry).take(left), &mut output)
            .map_err(|error| failed(&target, error))?;
        tally.bytes += written;
        tally.files += 1;
    }
    Ok(json!({
        "folder": into.display().to_string(),
        "files": tally.files,
        "skipped": tally.skipped,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_in_an_archive_are_told_apart() {
        assert!(is_link(Some(0o120777)));
        assert!(!is_link(Some(0o100644)));
        assert!(!is_link(None));
    }

    #[test]
    fn an_archive_has_a_ceiling() {
        let mut tally = Tally::default();
        assert!(tally.room(10).is_ok());
        tally.bytes = 10;
        assert!(tally.room(BYTES_MOST).is_err());
    }
}
