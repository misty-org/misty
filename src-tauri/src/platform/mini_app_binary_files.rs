//! Chunked file access and staged output copies. App paths are never accepted.
use super::PermissionSet;
use cap_std::fs::{Dir, OpenOptions};
use serde_json::{json, Value};
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    sync::Arc,
};

const CHUNK: u64 = 65_536;
const MAX_COPY: u64 = 268_435_456;
const MAX_DRAFTS: usize = 4;
pub struct OutputDraft {
    file: File,
    directory: Arc<Dir>,
    name: String,
    bytes: u64,
}
pub fn release(permissions: &mut PermissionSet, handle: &str) {
    permissions.archive_reads.retain(|_, read| read.handle != handle);
    permissions.media.retain(|_, job| !job.uses_handle(handle));
    permissions
        .downloads
        .retain(|_, job| !job.uses_handle(handle));
    permissions
        .backup_jobs
        .retain(|_, job| !job.uses_handle(handle));
    permissions
        .backup_repositories
        .retain(|_, repository| !repository.uses_handle(handle));
    permissions.files.remove(handle);
    if let Some(folder) = permissions.folders.remove(handle) {
        permissions.directory_watches.retain(|_, watch| !Arc::ptr_eq(&watch.directory, &folder.directory));
        permissions
            .outputs
            .retain(|_, draft| !Arc::ptr_eq(&draft.directory, &folder.directory));
    }
}
pub(super) fn stage_converted(
    permissions: &mut PermissionSet,
    mut file: File,
    directory: Arc<Dir>,
    name: String,
) -> Result<Value, String> {
    if permissions.outputs.len() >= MAX_DRAFTS {
        return Err("Finish or discard an output before collecting another.".into());
    }
    let bytes = file
        .metadata()
        .map_err(|_| "Converted file unavailable.")?
        .len();
    if bytes > MAX_COPY || !safe_name(&name) {
        return Err("Converted output exceeds its limits.".into());
    }
    file.seek(SeekFrom::End(0))
        .map_err(|_| "Converted output unavailable.")?;
    let handle = uuid::Uuid::new_v4().to_string();
    permissions.outputs.insert(
        handle.clone(),
        OutputDraft {
            file,
            directory,
            name: name.clone(),
            bytes,
        },
    );
    Ok(json!({"handle":handle,"name":name,"bytes":bytes}))
}
pub fn supports(method: &str) -> bool {
    matches!(
        method,
        "files.readBytes"
            | "files.createCopy"
            | "files.appendCopy"
            | "files.commitCopy"
            | "files.replaceCopy"
            | "files.discardCopy"
    )
}
fn key<'a>(params: &'a Value, name: &str) -> Result<&'a str, String> {
    params
        .get(name)
        .and_then(Value::as_str)
        .filter(|v| v.len() <= 256)
        .ok_or_else(|| format!("Missing {name}."))
}
pub(super) fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 160
        && name != "."
        && name != ".."
        && !name.ends_with([' ', '.'])
        && !name
            .chars()
            .any(|c| c.is_control() || "\\/:*?\"<>|".contains(c))
        && !matches!(
            name.split('.')
                .next()
                .unwrap_or("")
                .to_ascii_uppercase()
                .as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        )
}
pub fn execute(
    permissions: &mut PermissionSet,
    method: &str,
    params: &Value,
) -> Result<Value, String> {
    if method == "files.readBytes" {
        let handle = key(params, "handle")?;
        let offset = params
            .get("offset")
            .and_then(Value::as_u64)
            .filter(|v| *v <= 9_007_199_254_740_991)
            .ok_or("Invalid read offset.")?;
        let length = params
            .get("length")
            .and_then(Value::as_u64)
            .filter(|v| *v > 0 && *v <= CHUNK)
            .ok_or("Read at most 64 KB at a time.")?;
        let selected = permissions
            .files
            .get(handle)
            .ok_or("This file is not granted to this App.")?;
        let mut file = selected.file.try_clone().map_err(|_| "File unavailable.")?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|_| "Could not read the chosen file.")?;
        let mut bytes = Vec::new();
        file.take(length)
            .read_to_end(&mut bytes)
            .map_err(|_| "Could not read the chosen file.")?;
        return Ok(json!({"$mistyBytes":bytes}));
    }
    if method == "files.createCopy" {
        if permissions.outputs.len() >= MAX_DRAFTS {
            return Err("Finish or discard an output before creating another.".into());
        }
        let folder = permissions
            .folders
            .get(key(params, "directory")?)
            .ok_or("Choose an output folder first.")?;
        if !folder.writable {
            return Err(
                "This folder was selected for reading. Choose it for writing first.".into(),
            );
        }
        let name = key(params, "name")?;
        if !safe_name(name) {
            return Err("Use a simple output filename without a path.".into());
        }
        let draft = OutputDraft {
            file: tempfile::tempfile().map_err(|_| "Could not prepare the output.")?,
            directory: folder.directory.clone(),
            name: name.into(),
            bytes: 0,
        };
        let handle = uuid::Uuid::new_v4().to_string();
        permissions.outputs.insert(handle.clone(), draft);
        return Ok(json!({"handle":handle}));
    }
    let handle = key(params, "handle")?;
    if !permissions.outputs.contains_key(handle) {
        return Err("This output does not belong to this App instance.".into());
    }
    if method == "files.discardCopy" {
        permissions.outputs.remove(handle);
        return Ok(Value::Null);
    }
    if method == "files.appendCopy" {
        let values = params
            .get("bytes")
            .and_then(|v| v.get("$mistyBytes"))
            .and_then(Value::as_array)
            .filter(|v| v.len() <= CHUNK as usize)
            .ok_or("Write at most 64 KB at a time.")?;
        let bytes = values
            .iter()
            .map(|v| {
                v.as_u64()
                    .filter(|v| *v <= 255)
                    .map(|v| v as u8)
                    .ok_or("Invalid output bytes.")
            })
            .collect::<Result<Vec<_>, _>>()?;
        let draft = permissions.outputs.get_mut(handle).unwrap();
        if draft.bytes + bytes.len() as u64 > MAX_COPY {
            return Err("Output copies are limited to 256 MB.".into());
        }
        if draft.file.write_all(&bytes).is_err() {
            permissions.outputs.remove(handle);
            return Err("Could not prepare the output; the unfinished copy was discarded.".into());
        }
        draft.bytes += bytes.len() as u64;
        return Ok(Value::Null);
    }
    if method == "files.replaceCopy" {
        let target = permissions.files.get(key(params, "target")?)
            .ok_or("Choose the destination file before saving it.")?;
        if !target.writable {
            return Err("This file was selected for reading. Choose it for writing first.".into());
        }
        let draft = permissions.outputs.get_mut(handle).unwrap();
        // Both handles belong to this live App registration. Validation and
        // all staged writes finish before the original descriptor is touched.
        // Like writeText this preserves file identity, rather than replacing a path.
        let mut target = target.file.try_clone().map_err(|_| "The destination is unavailable.")?;
        draft.file.seek(SeekFrom::Start(0)).map_err(|_| "The staged copy is unavailable.")?;
        target.seek(SeekFrom::Start(0)).map_err(|_| "The destination is unavailable.")?;
        let written = std::io::copy(&mut draft.file, &mut target)
            .map_err(|_| "Saving failed; the original may contain partial changes. The staged copy is retained.")?;
        target.set_len(written).and_then(|_| target.sync_data())
            .map_err(|_| "Saving could not finish. The staged copy is retained.")?;
        permissions.outputs.remove(handle);
        return Ok(Value::Null);
    }
    if method == "files.commitCopy" {
        let draft = permissions.outputs.get_mut(handle).unwrap();
        let result = commit(draft)?;
        permissions.outputs.remove(handle);
        return Ok(result);
    }
    Err("Unsupported file operation.".into())
}
fn commit(draft: &mut OutputDraft) -> Result<Value, String> {
    // The authorization lock serializes commit with revocation. No destination
    // exists before commit. Exclusive creation never overwrites originals or links.
    let (stem, extension) = draft
        .name
        .rsplit_once('.')
        .filter(|(stem, _)| !stem.is_empty())
        .map(|(s, e)| (s, format!(".{e}")))
        .unwrap_or((&draft.name, String::new()));
    for index in 0..1000 {
        let name = if index == 0 {
            draft.name.clone()
        } else {
            format!("{stem} {index}{extension}")
        };
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        let mut target = match draft.directory.open_with(&name, &options) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("Could not save in the chosen folder.".into()),
        };
        let saved = draft
            .file
            .seek(SeekFrom::Start(0))
            .and_then(|_| std::io::copy(&mut draft.file, &mut target))
            .and_then(|bytes| {
                target.flush()?;
                Ok(bytes)
            });
        match saved {
            Ok(bytes) => return Ok(json!({"name":name,"bytes":bytes})),
            Err(_) => {
                // Do not unlink by pathname: another process could have replaced
                // it. Surface the partial copy so the user can remove it safely.
                return Err(format!(
                    "Saving {name} failed; a partial copy may remain in the chosen folder."
                ));
            }
        }
    }
    Err("Too many files with that name. Choose a different name.".into())
}

#[cfg(test)]
mod tests {
    use super::super::{file_jobs::FolderGrant, FileGrant};
    use super::*;
    fn permissions(root: &std::path::Path, writable: bool) -> PermissionSet {
        let mut p = PermissionSet::from_document(
            "image",
            &json!({"runtime_capabilities":["files.read","files.write"]}),
            None,
        )
        .unwrap();
        p.decide("files.read", true).unwrap();
        p.decide("files.write", true).unwrap();
        p.folders.insert(
            "chosen".into(),
            FolderGrant {
                released: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
                directory: Arc::new(
                    Dir::open_ambient_dir(root, cap_std::ambient_authority()).unwrap(),
                ),
                name: "Chosen".into(),
                writable,
            },
        );
        p
    }
    #[test]
    fn staged_edits_write_only_the_granted_file_and_reject_readonly_before_changes() {
        let root = tempfile::tempdir().unwrap();
        let original = root.path().join("image.png");
        let moved = root.path().join("moved.png");
        std::fs::write(&original, b"old longer image").unwrap();
        let file = std::fs::OpenOptions::new().read(true).write(true).open(&original).unwrap();
        let mut p = permissions(root.path(), true);
        p.files.insert("target".into(), FileGrant { file, writable: false });
        let draft = execute(&mut p, "files.createCopy", &json!({"directory":"chosen","name":"image.png"})).unwrap();
        let handle = draft["handle"].as_str().unwrap();
        execute(&mut p, "files.appendCopy", &json!({"handle":handle,"bytes":{"$mistyBytes":[0,255,42]}})).unwrap();
        let params = json!({"handle":handle,"target":"target"});
        assert!(execute(&mut p, "files.replaceCopy", &params).is_err());
        assert_eq!(std::fs::read(&original).unwrap(), b"old longer image");
        assert!(p.outputs.contains_key(handle));
        p.files.get_mut("target").unwrap().writable = true;
        std::fs::rename(&original, &moved).unwrap();
        std::fs::write(&original, b"replacement must remain unchanged").unwrap();
        execute(&mut p, "files.replaceCopy", &params).unwrap();
        assert_eq!(std::fs::read(&moved).unwrap(), [0,255,42]);
        assert_eq!(std::fs::read(&original).unwrap(), b"replacement must remain unchanged");
        assert!(!p.outputs.contains_key(handle));
        assert!(execute(&mut p, "files.replaceCopy", &params).is_err());
    }
    #[test]
    fn binary_reads_use_only_retained_handles_and_bounded_offsets() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("image");
        std::fs::write(&path, [0, 255, 42, 7]).unwrap();
        let mut p = permissions(root.path(), false);
        p.files.insert(
            "input".into(),
            FileGrant {
                file: File::open(&path).unwrap(),
                writable: false,
            },
        );
        std::fs::rename(&path, root.path().join("moved")).unwrap();
        std::fs::write(path, b"private replacement").unwrap();
        let read = |p: &mut PermissionSet, handle: &str, offset: u64, length: u64| {
            execute(
                p,
                "files.readBytes",
                &json!({"handle":handle,"offset":offset,"length":length}),
            )
        };
        assert_eq!(
            read(&mut p, "input", 1, 2).unwrap(),
            json!({"$mistyBytes":[255,42]})
        );
        assert!(read(&mut p, "/etc/passwd", 0, 1).is_err());
        assert!(read(&mut p, "input", 0, CHUNK + 1).is_err());
        assert!(read(&mut p, "input", u64::MAX, 1).is_err());
        p.decide("files.read", false).unwrap();
        assert!(read(&mut p, "input", 0, 1).is_err());
    }
    #[test]
    fn output_grants_do_not_upgrade_read_only_folders_or_accept_paths() {
        let root = tempfile::tempdir().unwrap();
        let mut p = permissions(root.path(), false);
        assert!(execute(
            &mut p,
            "files.createCopy",
            &json!({"directory":"chosen","name":"a.jpg"})
        )
        .is_err());
        p.folders.get_mut("chosen").unwrap().writable = true;
        for name in [
            "../secret",
            "/secret",
            "a/b",
            "a\\b",
            "CON",
            "x:",
            "..",
            "trailing.",
            "a\n",
        ] {
            assert!(
                execute(
                    &mut p,
                    "files.createCopy",
                    &json!({"directory":"chosen","name":name})
                )
                .is_err(),
                "{name}"
            );
        }
        assert!(execute(
            &mut p,
            "files.createCopy",
            &json!({"directory":"foreign","name":"copy.jpg"})
        )
        .is_err());
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    }
    #[test]
    fn copies_are_staged_instance_owned_collision_safe_and_revocable() {
        let root = tempfile::tempdir().unwrap();
        let mut p = permissions(root.path(), true);
        std::fs::write(root.path().join("photo.jpg"), b"original").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("photo.jpg", root.path().join("photo 1.jpg")).unwrap();
        let create = |p: &mut PermissionSet| {
            execute(
                p,
                "files.createCopy",
                &json!({"directory":"chosen","name":"photo.jpg"}),
            )
            .unwrap()["handle"]
                .as_str()
                .unwrap()
                .to_owned()
        };
        let handle = create(&mut p);
        execute(
            &mut p,
            "files.appendCopy",
            &json!({"handle":handle,"bytes":{"$mistyBytes":[255,0,42]}}),
        )
        .unwrap();
        let mut other = permissions(root.path(), true);
        assert!(execute(&mut other, "files.commitCopy", &json!({"handle":handle})).is_err());
        let saved = execute(&mut p, "files.commitCopy", &json!({"handle":handle})).unwrap();
        assert_eq!(
            std::fs::read(root.path().join(saved["name"].as_str().unwrap())).unwrap(),
            [255, 0, 42]
        );
        assert_eq!(
            std::fs::read(root.path().join("photo.jpg")).unwrap(),
            b"original"
        );
        assert!(p.outputs.is_empty());
        let count = std::fs::read_dir(root.path()).unwrap().count();
        let handle = create(&mut p);
        execute(&mut p, "files.discardCopy", &json!({"handle":handle})).unwrap();
        let handle = create(&mut p);
        release(&mut p, "chosen");
        assert!(p.outputs.is_empty());
        assert!(execute(&mut p, "files.commitCopy", &json!({"handle":handle})).is_err());
        let mut p = permissions(root.path(), true);
        let handle = create(&mut p);
        p.decide("files.write", false).unwrap();
        assert!(p.outputs.is_empty());
        assert!(execute(&mut p, "files.commitCopy", &json!({"handle":handle})).is_err());
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), count);
    }
    #[cfg(unix)]
    #[test]
    fn output_stays_in_the_chosen_directory_after_its_path_is_replaced() {
        let root = tempfile::tempdir().unwrap();
        let selected = root.path().join("selected");
        let moved = root.path().join("moved");
        std::fs::create_dir(&selected).unwrap();
        let mut p = permissions(&selected, true);
        let handle = execute(
            &mut p,
            "files.createCopy",
            &json!({"directory":"chosen","name":"copy.png"}),
        )
        .unwrap()["handle"]
            .as_str()
            .unwrap()
            .to_owned();
        execute(
            &mut p,
            "files.appendCopy",
            &json!({"handle":handle,"bytes":{"$mistyBytes":[1,2,3]}}),
        )
        .unwrap();
        std::fs::rename(&selected, &moved).unwrap();
        std::fs::create_dir(&selected).unwrap();
        execute(&mut p, "files.commitCopy", &json!({"handle":handle})).unwrap();
        assert_eq!(std::fs::read(moved.join("copy.png")).unwrap(), [1, 2, 3]);
        assert!(!selected.join("copy.png").exists());
    }
}
