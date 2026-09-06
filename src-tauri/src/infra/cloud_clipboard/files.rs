//! Files on the clipboard: reading and zipping copies, unpacking received
//! folders, and naming saved files safely.

use super::*;

/// Reads copied files for upload. Folders are zipped; anything that isn't a
/// regular file or folder is skipped. None when they exceed the clip cap.
pub(super) fn read_files(refs: &[ClipboardFileRef]) -> Result<Option<Vec<ReadFile>>, String> {
    let mut files = Vec::new();
    let mut total = 0u64;
    for file in refs.iter().filter(|file| !file.local_path.is_empty()) {
        let path = Path::new(&file.local_path);
        let Ok(metadata) = std::fs::symlink_metadata(path) else {
            continue;
        };
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| file.display_name.clone());
        if metadata.is_file() {
            total += metadata.len();
            if total > MAX_CLIP_BYTES {
                return Ok(None);
            }
            files.push((
                name,
                false,
                std::fs::read(path).map_err(|error| error.to_string())?,
            ));
        } else if metadata.is_dir() {
            let Some(zipped) = zip_folder(path, MAX_CLIP_BYTES.saturating_sub(total))? else {
                return Ok(None);
            };
            total += zipped.len() as u64;
            files.push((format!("{name}.zip"), true, zipped));
        }
    }
    Ok(Some(files))
}

/// A folder as one ZIP archive, or None when its files exceed `limit` bytes.
pub(super) fn zip_folder(root: &Path, limit: u64) -> Result<Option<Vec<u8>>, String> {
    let mut buffer = std::io::Cursor::new(Vec::new());
    {
        let mut writer = zip::ZipWriter::new(&mut buffer);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let mut read = 0u64;
        for entry in walkdir::WalkDir::new(root).follow_links(false) {
            let entry = entry.map_err(|error| error.to_string())?;
            let relative = entry
                .path()
                .strip_prefix(root)
                .map_err(|error| error.to_string())?;
            let name = relative.to_string_lossy().replace('\\', "/");
            if name.is_empty() {
                continue;
            }
            if entry.file_type().is_dir() {
                writer
                    .add_directory(name, options)
                    .map_err(|error| error.to_string())?;
            } else if entry.file_type().is_file() {
                let bytes = std::fs::read(entry.path()).map_err(|error| error.to_string())?;
                read += bytes.len() as u64;
                if read > limit {
                    return Ok(None);
                }
                writer
                    .start_file(name, options)
                    .map_err(|error| error.to_string())?;
                writer
                    .write_all(&bytes)
                    .map_err(|error| error.to_string())?;
            }
        }
        writer.finish().map_err(|error| error.to_string())?;
    }
    Ok(Some(buffer.into_inner()))
}

pub(super) fn unzip_folder(bytes: &[u8], target: &Path) -> Result<(), String> {
    let mut archive =
        zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|error| error.to_string())?;
    std::fs::create_dir_all(target).map_err(|error| error.to_string())?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        // enclosed_name refuses absolute paths and `..`, so nothing escapes the folder.
        let Some(relative) = entry.enclosed_name() else {
            continue;
        };
        let path = target.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
        } else {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let mut file = std::fs::File::create(&path).map_err(|error| error.to_string())?;
            std::io::copy(&mut entry, &mut file).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

pub(super) fn local_ref(path: &Path, is_dir: bool) -> ClipboardFileRef {
    ClipboardFileRef {
        display_name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        local_path: path.to_string_lossy().into_owned(),
        is_dir,
        ..ClipboardFileRef::default()
    }
}

/// A name from another device, reduced to one safe path component.
pub(super) fn safe_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("").trim();
    let cleaned: String = base
        .chars()
        .filter(|character| !character.is_control() && *character != ':')
        .take(200)
        .collect();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        "Clipboard file".into()
    } else {
        cleaned
    }
}

pub(super) fn unique_path(directory: &Path, name: &str) -> PathBuf {
    let name = safe_file_name(name);
    let candidate = directory.join(&name);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, extension) = match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem.to_owned(), format!(".{extension}")),
        _ => (name.clone(), String::new()),
    };
    (2..)
        .map(|index| directory.join(format!("{stem} {index}{extension}")))
        .find(|path| !path.exists())
        .expect("an unused name")
}

pub(super) fn truncate_utf8(text: &str, limit: usize) -> String {
    if text.len() <= limit {
        return text.to_owned();
    }
    let mut end = limit;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_owned()
}

/// Removes received clips older than a day from the cache.
pub(super) fn prune_cache(directory: &Path) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let expired = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age > RECEIVED_LIFETIME);
        if expired {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn received_names_cannot_escape_their_folder() {
        assert_eq!(safe_file_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_file_name("C:\\Users\\a\\report.pdf"), "report.pdf");
        assert_eq!(safe_file_name(".."), "Clipboard file");
        assert_eq!(safe_file_name(""), "Clipboard file");
    }

    #[test]
    fn saved_files_never_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), b"one").unwrap();
        assert_eq!(unique_path(dir.path(), "a.txt"), dir.path().join("a 2.txt"));
        assert_eq!(unique_path(dir.path(), "b.txt"), dir.path().join("b.txt"));
    }

    #[test]
    fn folders_round_trip_through_a_zip() {
        let source = tempfile::tempdir().unwrap();
        std::fs::create_dir(source.path().join("inner")).unwrap();
        std::fs::write(source.path().join("inner/note.txt"), b"hello").unwrap();
        let zipped = zip_folder(source.path(), MAX_CLIP_BYTES).unwrap().unwrap();
        assert!(zip_folder(source.path(), 2).unwrap().is_none());
        let target = tempfile::tempdir().unwrap();
        unzip_folder(&zipped, &target.path().join("copy")).unwrap();
        assert_eq!(
            std::fs::read(target.path().join("copy/inner/note.txt")).unwrap(),
            b"hello"
        );
    }

    #[test]
    fn long_text_is_cut_on_a_character_boundary() {
        assert_eq!(truncate_utf8("héllo", 2), "h");
        assert_eq!(truncate_utf8("hello", 10), "hello");
    }
}
