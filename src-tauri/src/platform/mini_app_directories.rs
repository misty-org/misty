//! Directory capabilities for file/project apps. Never accept an ambient filesystem path.
use super::directory_mutations::Mutation;
use super::{file_jobs::FolderGrant, FileGrant, PermissionSet};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use cap_std::fs::{Dir, OpenOptions};
use serde_json::{json, Value};
use std::{
    ffi::{OsStr, OsString},
    path::{Component, Path},
    sync::Arc,
};

pub struct Request {
    released: Arc<std::sync::atomic::AtomicBool>,
    directory: Arc<Dir>,
    handle: String,
    epoch: u64,
    required: String,
    cancellation: tokio::sync::watch::Receiver<u64>,
    operation: Operation,
}
enum Operation {
    Watch,
    Mutate(Mutation),
    List { offset: usize, limit: usize },
    Open { name: OsString, write: bool },
}
pub enum Output {
    Watch(super::file_observation::DirectoryWatch),
    Listing(Value),
    File(std::fs::File, String, bool, u64),
    Folder(Dir, String, bool),
}
impl Request {
    pub fn run(&self) -> Result<Output, String> {
        if self.released.load(std::sync::atomic::Ordering::Acquire)
            || self.cancellation.has_changed().unwrap_or(true)
        {
            return Err("Folder access was revoked or the App closed.".into());
        }
        match &self.operation {
            Operation::Watch => super::file_observation::DirectoryWatch::start(self.directory.clone(), self.released.clone()).map(Output::Watch),
            Operation::Mutate(mutation) => mutation.run(&self.directory).map(Output::Listing),
            Operation::List { offset, limit } => {
                let mut entries = Vec::new();
                let mut next = None;
                let iterator = self
                    .directory
                    .entries()
                    .map_err(|_| "The folder could not be read.")?;
                for (index, item) in iterator.enumerate() {
                    if self.released.load(std::sync::atomic::Ordering::Acquire)
                        || self.cancellation.has_changed().unwrap_or(true)
                    {
                        return Err("Folder access was revoked or the App closed.".into());
                    }
                    if index < *offset {
                        continue;
                    }
                    if entries.len() == *limit {
                        if index > 1_000_000 {
                            return Err("This folder exceeds the listing limit.".into());
                        }
                        next = Some(index);
                        break;
                    }
                    let item = item.map_err(|_| "A folder entry could not be read.")?;
                    let name = item.file_name();
                    let kind = item
                        .file_type()
                        .map_err(|_| "A folder entry could not be read.")?;
                    let label = if kind.is_symlink() {
                        "symlink"
                    } else if kind.is_dir() {
                        "directory"
                    } else if kind.is_file() {
                        "file"
                    } else {
                        "other"
                    };
                    let mut entry = json!({"entry": encode_name(&name), "name": name.to_string_lossy(), "kind": label});
                    if kind.is_file() {
                        // symlink_metadata prevents metadata reads from following a raced symlink.
                        if let Ok(metadata) = self.directory.symlink_metadata(&name) {
                            if metadata.is_file() {
                                entry["bytes"] = json!(metadata.len());
                            }
                        }
                    }
                    entries.push(entry);
                }
                Ok(Output::Listing(
                    json!({"entries":entries,"nextOffset":next}),
                ))
            }
            Operation::Open { name, write } => {
                let metadata = self
                    .directory
                    .symlink_metadata(name)
                    .map_err(|_| "The entry is unavailable.")?;
                let display = name.to_string_lossy().into_owned();
                if metadata.is_dir() {
                    let directory = self
                        .directory
                        .open_dir(name)
                        .map_err(|_| "The folder could not be opened within its grant.")?;
                    Ok(Output::Folder(directory, display, *write))
                } else if metadata.is_file() {
                    let mut options = OpenOptions::new();
                    options.read(true).write(*write);
                    #[cfg(unix)]
                    {
                        use cap_std::fs::OpenOptionsExt;
                        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
                    }
                    let file = self
                        .directory
                        .open_with(name, &options)
                        .map_err(|_| "The file could not be opened within its grant.")?;
                    let actual = file.metadata().map_err(|_| "The file is unavailable.")?;
                    if !actual.is_file() {
                        return Err("Only regular files can be opened.".into());
                    }
                    Ok(Output::File(file.into_std(), display, *write, actual.len()))
                } else {
                    Err("Links and special files cannot be opened as App capabilities.".into())
                }
            }
        }
    }
    pub fn commit(&self, permissions: &mut PermissionSet, output: Output) -> Result<Value, String> {
        permissions.authorize(&self.required)?;
        if permissions.epoch != self.epoch
            || !permissions
                .folders
                .get(&self.handle)
                .is_some_and(|folder| Arc::ptr_eq(&folder.directory, &self.directory))
        {
            return Err("Folder permission changed while reading the entry.".into());
        }
        match output {
            Output::Watch(watcher) => {
                if permissions.directory_watches.len() >= 8 {
                    return Err("Close an old folder watch before starting another.".into());
                }
                let handle = uuid::Uuid::new_v4().to_string();
                permissions.directory_watches.insert(handle.clone(), watcher);
                Ok(json!({"watcher":handle}))
            }
            Output::Listing(value) => Ok(value),
            Output::File(file, name, writable, bytes) => {
                if permissions.files.len() >= 64 {
                    return Err("Release an open file before opening another.".into());
                }
                let handle = uuid::Uuid::new_v4().to_string();
                permissions
                    .files
                    .insert(handle.clone(), FileGrant { file, writable });
                Ok(json!({"handle":handle,"name":name,"kind":"file","bytes":bytes}))
            }
            Output::Folder(directory, name, writable) => {
                if permissions.folders.len() >= 32 {
                    return Err("Release an open folder before opening another.".into());
                }
                let handle = uuid::Uuid::new_v4().to_string();
                permissions.folders.insert(
                    handle.clone(),
                    FolderGrant {
                        released: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
                        directory: Arc::new(directory),
                        name: name.clone(),
                        writable,
                    },
                );
                Ok(json!({"handle":handle,"name":name,"kind":"directory"}))
            }
        }
    }
}
pub fn prepare(
    permissions: &PermissionSet,
    method: &str,
    params: &Value,
) -> Result<Request, String> {
    let required = super::capability(method, params)?;
    permissions.authorize(&required)?;
    let handle = params
        .get("directory")
        .and_then(Value::as_str)
        .ok_or("Choose a folder first.")?;
    let folder = permissions
        .folders
        .get(handle)
        .ok_or("This folder is not granted to this App.")?;
    let operation = if method == "files.watchDirectory" {
        if permissions.directory_watches.len() >= 8 {
            return Err("Close an old folder watch before starting another.".into());
        }
        Operation::Watch
    } else if method == "files.listDirectory" {
        let integer = |key: &str, default: u64, min: u64, max: u64| -> Result<usize, String> {
            params
                .get(key)
                .map_or(Some(default), Value::as_u64)
                .filter(|value| *value >= min && *value <= max)
                .map(|value| value as usize)
                .ok_or_else(|| "Invalid folder listing range.".into())
        };
        Operation::List {
            offset: integer("offset", 0, 0, 1_000_000)?,
            limit: integer("limit", 200, 1, 200)?,
        }
    } else if method == "files.openEntry" {
        let write = match params.get("write") {
            None => false,
            Some(Value::Bool(value)) => *value,
            _ => return Err("Invalid file access mode.".into()),
        };
        if write && !folder.writable {
            return Err("Choose this folder for writing first.".into());
        }
        let name = decode_name(
            params
                .get("entry")
                .and_then(Value::as_str)
                .ok_or("Choose a folder entry first.")?,
        )?;
        Operation::Open { name, write }
    } else if matches!(
        method,
        "files.createEntry" | "files.renameEntry" | "files.removeEntry"
    ) {
        if !folder.writable {
            return Err("Choose this folder for writing first.".into());
        }
        Operation::Mutate(Mutation::parse(method, params)?)
    } else {
        return Err("Unknown directory operation.".into());
    };
    Ok(Request {
        released: folder.released.clone(),
        directory: folder.directory.clone(),
        handle: handle.to_owned(),
        epoch: permissions.epoch,
        required,
        cancellation: permissions.cancellation.subscribe(),
        operation,
    })
}
#[cfg(unix)]
pub(super) fn encode_name(name: &OsStr) -> String {
    use std::os::unix::ffi::OsStrExt;
    format!("u:{}", URL_SAFE_NO_PAD.encode(name.as_bytes()))
}
#[cfg(windows)]
pub(super) fn encode_name(name: &OsStr) -> String {
    use std::os::windows::ffi::OsStrExt;
    format!(
        "w:{}",
        URL_SAFE_NO_PAD.encode(
            name.encode_wide()
                .flat_map(u16::to_le_bytes)
                .collect::<Vec<_>>()
        )
    )
}
pub(super) fn decode_name(token: &str) -> Result<OsString, String> {
    if token.len() > 4098 {
        return Err("Invalid folder entry.".into());
    }
    #[cfg(unix)]
    let name = {
        use std::os::unix::ffi::OsStringExt;
        let bytes = URL_SAFE_NO_PAD
            .decode(token.strip_prefix("u:").ok_or("Invalid folder entry.")?)
            .map_err(|_| "Invalid folder entry.")?;
        if bytes.contains(&0) {
            return Err("Invalid folder entry.".into());
        }
        OsString::from_vec(bytes)
    };
    #[cfg(windows)]
    let name = {
        use std::os::windows::ffi::OsStringExt;
        let bytes = URL_SAFE_NO_PAD
            .decode(token.strip_prefix("w:").ok_or("Invalid folder entry.")?)
            .map_err(|_| "Invalid folder entry.")?;
        if bytes.len() % 2 != 0 {
            return Err("Invalid folder entry.".into());
        }
        let wide: Vec<_> = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        if wide.contains(&0) {
            return Err("Invalid folder entry.".into());
        }
        OsString::from_wide(&wide)
    };
    let mut parts = Path::new(&name).components();
    if !matches!(parts.next(), Some(Component::Normal(part)) if part == name.as_os_str())
        || parts.next().is_some()
    {
        return Err("Folder entries must be immediate children.".into());
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn permissions(root: &Path, writable: bool) -> PermissionSet {
        let mut p = PermissionSet::from_document(
            "files",
            &json!({"runtime_capabilities":["files.read","files.write"]}),
            None,
        )
        .unwrap();
        p.decide("files.read", true).unwrap();
        p.decide("files.write", true).unwrap();
        p.folders.insert(
            "root".into(),
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
    fn run(p: &mut PermissionSet, method: &str, params: Value) -> Result<Value, String> {
        let request = prepare(p, method, &params)?;
        request.commit(p, request.run()?)
    }
    fn token(name: &str) -> String {
        encode_name(OsStr::new(name))
    }
    #[test]
    fn pages_and_opens_owned_files_and_subfolders_without_paths() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("hello.txt"), "Hello").unwrap();
        std::fs::create_dir(temp.path().join("Nested")).unwrap();
        let mut p = permissions(temp.path(), true);
        let first = run(
            &mut p,
            "files.listDirectory",
            json!({"directory":"root","limit":1}),
        )
        .unwrap();
        assert_eq!(first["entries"].as_array().unwrap().len(), 1);
        let second = run(
            &mut p,
            "files.listDirectory",
            json!({"directory":"root","offset":first["nextOffset"],"limit":1}),
        )
        .unwrap();
        assert!(second["nextOffset"].is_null());
        assert_ne!(first["entries"][0]["entry"], second["entries"][0]["entry"]);
        assert!(!first.to_string().contains(temp.path().to_str().unwrap()));
        let file = run(
            &mut p,
            "files.openEntry",
            json!({"directory":"root","entry":token("hello.txt")}),
        )
        .unwrap();
        assert_eq!(file["bytes"], 5);
        let mut opened = &p.files[file["handle"].as_str().unwrap()].file;
        let mut text = String::new();
        std::io::Read::read_to_string(&mut opened, &mut text).unwrap();
        assert_eq!(text, "Hello");
        let folder = run(
            &mut p,
            "files.openEntry",
            json!({"directory":"root","entry":token("Nested")}),
        )
        .unwrap();
        assert_eq!(folder["kind"], "directory");
        assert!(run(
            &mut p,
            "files.listDirectory",
            json!({"directory":folder["handle"]})
        )
        .unwrap()["entries"]
            .as_array()
            .unwrap()
            .is_empty());
    }
    #[test]
    fn rejects_paths_foreign_handles_links_and_write_escalation() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("safe"), "Original").unwrap();
        let mut p = permissions(temp.path(), false);
        for name in ["..", "../outside", "/etc/passwd", "safe/../safe", ""] {
            assert!(run(
                &mut p,
                "files.openEntry",
                json!({"directory":"root","entry":token(name)})
            )
            .is_err());
        }
        assert!(run(
            &mut p,
            "files.openEntry",
            json!({"directory":"foreign","entry":token("safe")})
        )
        .is_err());
        assert!(run(
            &mut p,
            "files.openEntry",
            json!({"directory":"root","entry":token("safe"),"write":true})
        )
        .is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc/passwd", temp.path().join("outside")).unwrap();
            assert!(run(
                &mut p,
                "files.openEntry",
                json!({"directory":"root","entry":token("outside")})
            )
            .is_err());
        }
        assert_eq!(
            std::fs::read_to_string(temp.path().join("safe")).unwrap(),
            "Original"
        );
        assert!(p.files.is_empty());
    }
    #[test]
    fn discards_finished_open_when_grant_is_revoked_or_folder_released() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("file"), "text").unwrap();
        for revoke in [true, false] {
            let mut p = permissions(temp.path(), true);
            let request = prepare(
                &p,
                "files.openEntry",
                &json!({"directory":"root","entry":token("file")}),
            )
            .unwrap();
            let output = request.run().unwrap();
            if revoke {
                p.decide("files.read", false).unwrap();
            } else {
                p.folders.remove("root");
            }
            assert!(request.commit(&mut p, output).is_err());
            assert!(p.files.is_empty());
        }
    }
    #[test]
    #[cfg(unix)]
    fn preserves_filename_tokens_and_bounds_each_page() {
        use std::os::unix::ffi::OsStringExt;
        let temp = tempfile::tempdir().unwrap();
        let raw_name = OsString::from_vec(vec![0xff, b'a']);
        assert_eq!(decode_name(&encode_name(&raw_name)).unwrap(), raw_name);
        // APFS rejects invalid UTF-8 names; exercise the filesystem with valid Unicode.
        let name = OsString::from("東京 code.txt");
        std::fs::write(temp.path().join(&name), "bytes").unwrap();
        let mut p = permissions(temp.path(), false);
        let listing = run(&mut p, "files.listDirectory", json!({"directory":"root"})).unwrap();
        let item = &listing["entries"][0];
        assert_eq!(decode_name(item["entry"].as_str().unwrap()).unwrap(), name);
        assert_eq!(
            run(
                &mut p,
                "files.openEntry",
                json!({"directory":"root","entry":item["entry"]})
            )
            .unwrap()["bytes"],
            5
        );
        for params in [
            json!({"directory":"root","limit":201}),
            json!({"directory":"root","offset":1000001}),
        ] {
            assert!(run(&mut p, "files.listDirectory", params).is_err());
        }
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn writable_folder_creates_renames_and_removes_entries_without_overwrite() {
        let temp = tempfile::tempdir().unwrap();
        let mut p = permissions(temp.path(), true);
        let made = run(
            &mut p,
            "files.createEntry",
            json!({"directory":"root","name":"日本語 #?.rs","kind":"file"}),
        )
        .unwrap();
        std::fs::write(temp.path().join("日本語 #?.rs"), "source").unwrap();
        assert!(run(
            &mut p,
            "files.createEntry",
            json!({"directory":"root","name":"日本語 #?.rs","kind":"file"})
        )
        .is_err());
        std::fs::write(temp.path().join("occupied.rs"), "keep").unwrap();
        assert!(run(
            &mut p,
            "files.renameEntry",
            json!({"directory":"root","entry":made["entry"],"name":"occupied.rs"})
        )
        .is_err());
        assert_eq!(
            std::fs::read_to_string(temp.path().join("occupied.rs")).unwrap(),
            "keep"
        );
        assert_eq!(
            std::fs::read_to_string(temp.path().join("日本語 #?.rs")).unwrap(),
            "source"
        );
        let renamed = run(
            &mut p,
            "files.renameEntry",
            json!({"directory":"root","entry":made["entry"],"name":"renamed.rs"}),
        )
        .unwrap();
        assert_eq!(renamed["entry"], token("renamed.rs"));
        assert!(!temp.path().join("日本語 #?.rs").exists());
        assert_eq!(
            std::fs::read_to_string(temp.path().join("renamed.rs")).unwrap(),
            "source"
        );
        run(
            &mut p,
            "files.removeEntry",
            json!({"directory":"root","entry":renamed["entry"]}),
        )
        .unwrap();
        assert!(!temp.path().join("renamed.rs").exists());
    }
    #[cfg(unix)]
    #[test]
    fn directory_removal_is_explicit_and_never_follows_outside_symlinks() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("keep"), "outside").unwrap();
        let mut p = permissions(temp.path(), true);
        run(
            &mut p,
            "files.createEntry",
            json!({"directory":"root","name":"nested","kind":"directory"}),
        )
        .unwrap();
        std::fs::write(temp.path().join("nested/file"), "inside").unwrap();
        symlink(outside.path(), temp.path().join("nested/link")).unwrap();
        assert!(run(
            &mut p,
            "files.removeEntry",
            json!({"directory":"root","entry":token("nested")})
        )
        .is_err());
        assert!(temp.path().join("nested/file").exists());
        run(
            &mut p,
            "files.removeEntry",
            json!({"directory":"root","entry":token("nested"),"recursive":true}),
        )
        .unwrap();
        assert!(!temp.path().join("nested").exists());
        assert_eq!(
            std::fs::read_to_string(outside.path().join("keep")).unwrap(),
            "outside"
        );
        symlink(outside.path(), temp.path().join("link")).unwrap();
        run(
            &mut p,
            "files.removeEntry",
            json!({"directory":"root","entry":token("link"),"recursive":true}),
        )
        .unwrap();
        assert!(outside.path().join("keep").exists());
    }
    #[test]
    fn mutations_reject_readonly_foreign_traversal_and_revoked_grants_before_work() {
        let temp = tempfile::tempdir().unwrap();
        let mut readonly = permissions(temp.path(), false);
        assert!(run(
            &mut readonly,
            "files.createEntry",
            json!({"directory":"root","name":"no","kind":"file"})
        )
        .is_err());
        let mut p = permissions(temp.path(), true);
        for name in ["../escape", "/absolute", ".", "..", "a/b", ""] {
            assert!(run(
                &mut p,
                "files.createEntry",
                json!({"directory":"root","name":name,"kind":"file"})
            )
            .is_err());
        }
        assert!(run(
            &mut p,
            "files.createEntry",
            json!({"directory":"foreign","name":"no","kind":"file"})
        )
        .is_err());
        assert!(run(
            &mut p,
            "files.removeEntry",
            json!({"directory":"root","entry":token("../escape"),"recursive":true})
        )
        .is_err());
        let pending = prepare(
            &p,
            "files.createEntry",
            &json!({"directory":"root","name":"late","kind":"file"}),
        )
        .unwrap();
        p.decide("files.write", false).unwrap();
        assert!(pending.run().is_err());
        assert!(run(
            &mut p,
            "files.createEntry",
            json!({"directory":"root","name":"denied","kind":"file"})
        )
        .is_err());
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 0);
    }
    #[test]
    fn a_queued_mutation_cannot_start_after_its_folder_is_released() {
        let temp = tempfile::tempdir().unwrap();
        let mut p = permissions(temp.path(), true);
        let pending = prepare(
            &p,
            "files.createEntry",
            &json!({"directory":"root","name":"late","kind":"file"}),
        )
        .unwrap();
        super::super::binary_files::release(&mut p, "root");
        assert!(pending.run().is_err());
        assert!(!temp.path().join("late").exists());
    }
}
