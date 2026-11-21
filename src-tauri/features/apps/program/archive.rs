//! Taking the one program file out of a maker's archive.

use super::*;

/// The one file named `name` anywhere in a zip.
pub(super) fn from_zip(archive: &[u8], name: &str) -> Result<Vec<u8>, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(archive)).map_err(|_| "The app's tools aren't a zip file.".to_owned())?;
    let mut found: Option<usize> = None;
    for index in 0..zip.len() {
        let entry = zip.by_index(index).map_err(|_| "The app's tools are damaged.".to_owned())?;
        let last = entry.name().trim_end_matches('/').rsplit('/').next().unwrap_or("");
        if last != name || entry.is_dir() {
            continue;
        }
        if entry.is_symlink() {
            return Err("The app's program is a link, which Misty doesn't run.".into());
        }
        if found.replace(index).is_some() {
            return Err(format!("The app's release holds more than one {name}."));
        }
    }
    let index = found.ok_or_else(|| format!("The app's release has no {name}."))?;
    let entry = zip.by_index(index).map_err(|_| "The app's tools are damaged.".to_owned())?;
    read_capped(entry)
}

/// The one regular file named `name` anywhere in a gzipped tar.
pub(super) fn from_tar_gz(archive: &[u8], name: &str) -> Result<Vec<u8>, String> {
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(Cursor::new(archive)));
    let mut found: Option<Vec<u8>> = None;
    let entries = tar.entries().map_err(|_| "The app's tools are damaged.".to_owned())?;
    for entry in entries {
        let entry = entry.map_err(|_| "The app's tools are damaged.".to_owned())?;
        let path = entry.path().map_err(|_| "The app's tools are damaged.".to_owned())?.into_owned();
        if path.file_name().and_then(|file| file.to_str()) != Some(name) {
            continue;
        }
        let kind = entry.header().entry_type();
        if kind.is_symlink() || kind.is_hard_link() {
            return Err("The app's program is a link, which Misty doesn't run.".into());
        }
        if !kind.is_file() {
            continue;
        }
        if found.is_some() {
            return Err(format!("The app's release holds more than one {name}."));
        }
        found = Some(read_capped(entry)?);
    }
    found.ok_or_else(|| format!("The app's release has no {name}."))
}

pub(super) fn read_capped(reader: impl Read) -> Result<Vec<u8>, String> {
    let mut data = Vec::new();
    reader
        .take(MAX_PROGRAM_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|_| "The app's tools are damaged.".to_owned())?;
    if data.len() as u64 > MAX_PROGRAM_BYTES {
        return Err("The app's program is larger than Misty runs.".into());
    }
    Ok(data)
}
