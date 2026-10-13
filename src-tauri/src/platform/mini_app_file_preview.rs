//! Archive previews use retained file grants and the existing archive readers.
use super::{MiniAppState, PermissionSet};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    ffi::OsString,
    fs::File,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
    time::Instant,
};

pub struct ReadGuard {
    pub handle: String,
    cancel: Arc<AtomicBool>,
}
impl ReadGuard {
    pub(super) fn new(handle: String, cancel: Arc<AtomicBool>) -> Self {
        Self { handle, cancel }
    }
    pub(super) fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Acquire)
    }
}
impl Drop for ReadGuard {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Release);
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    handle: String,
    format: String,
}
struct Request {
    input: Input,
    file: File,
    cancel: Arc<AtomicBool>,
    epoch: u64,
    _slot: tokio::sync::OwnedSemaphorePermit,
}
fn prepare(permissions: &mut PermissionSet, params: Value) -> Result<(String, Request), String> {
    permissions.authorize("files.read")?;
    let input: Input = serde_json::from_value(params).map_err(|_| "Invalid archive request.")?;
    if !matches!(input.format.as_str(), "zip" | "tar" | "7z" | "rar") {
        return Err("Unsupported archive format.".into());
    }
    let file = permissions
        .files
        .get(&input.handle)
        .ok_or("Choose the archive before opening it.")?
        .file
        .try_clone()
        .map_err(|_| "The chosen archive is unavailable.")?;
    static SLOTS: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    let slot = SLOTS
        .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(8)))
        .clone()
        .try_acquire_owned()
        .map_err(|_| "Finish an archive preview before opening another.")?;
    let cancel = Arc::new(AtomicBool::new(false));
    let id = uuid::Uuid::new_v4().to_string();
    permissions.archive_reads.insert(
        id.clone(),
        ReadGuard {
            handle: input.handle.clone(),
            cancel: cancel.clone(),
        },
    );
    Ok((
        id,
        Request {
            input,
            file,
            cancel,
            epoch: permissions.epoch,
            _slot: slot,
        },
    ))
}
pub(super) async fn list_archive(
    state: &MiniAppState,
    instance: &str,
    params: Value,
) -> Result<Value, String> {
    let (id, request) = {
        let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
        prepare(
            &mut registry
                .get_mut(instance)
                .ok_or("App is closed.")?
                .permissions,
            params,
        )?
    };
    let epoch = request.epoch;
    let handle = request.input.handle.clone();
    let result = tokio::task::spawn_blocking(move || request.run())
        .await
        .map_err(|_| "The archive reader failed.");
    let mut registry = state.0.lock().map_err(|_| "App registry unavailable.")?;
    let permissions = &mut registry
        .get_mut(instance)
        .ok_or("App is closed.")?
        .permissions;
    permissions.archive_reads.remove(&id);
    permissions.authorize("files.read")?;
    if permissions.epoch != epoch || !permissions.files.contains_key(&handle) {
        return Err("Archive access was released.".into());
    }
    result?
}
impl Request {
    fn run(self) -> Result<Value, String> {
        if self.cancel.load(Ordering::Acquire) {
            return Err("Archive preview cancelled.".into());
        }
        let before = self
            .file
            .metadata()
            .map_err(|_| "The archive is unavailable.")?;
        let mut reader = ArchiveReader {
            file: &self.file,
            offset: 0,
            length: before.len(),
            cancel: &self.cancel,
        };
        let entries = if self.input.format == "zip" {
            archive_zip_entries(reader, 500).map_err(|error| error.to_string())?
        } else {
            list_with_tool(&self.input.format, &mut reader, &self.cancel)?
        };
        let after = self
            .file
            .metadata()
            .map_err(|_| "The archive is unavailable.")?;
        if self.cancel.load(Ordering::Acquire) {
            return Err("Archive preview cancelled.".into());
        }
        if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
            return Err("The archive changed while it was being read. Try again.".into());
        }
        Ok(json!({ "format": self.input.format, "entries": entries }))
    }
}

/// Lists a tar, 7z or rar archive with the reader installed on this
/// computer. The reader inspects a private snapshot in the native sandbox: it
/// cannot reopen the original, follow adjacent volumes or read outside its
/// own folder.
fn list_with_tool(
    format: &str,
    reader: &mut ArchiveReader,
    cancel: &AtomicBool,
) -> Result<Vec<ArchiveEntry>, String> {
    use super::tool_sandbox::{Sandbox, Stopped};
    use std::io::{Read, Write};
    let (executable, arguments) = archive_tool(format)?;
    let sandbox = Sandbox::new().map_err(|_| "The native archive sandbox is unavailable.")?;
    let input = sandbox.path().join(format!("input.{format}"));
    let mut output = File::create(&input).map_err(|_| "Could not prepare the archive preview.")?;
    std::io::copy(reader, &mut output).map_err(|error| error.to_string())?;
    output
        .flush()
        .map_err(|_| "Could not prepare the archive preview.")?;
    drop(output);
    let listing_path = sandbox.path().join("listing.txt");
    let listing =
        File::create(&listing_path).map_err(|_| "Could not prepare the archive listing.")?;
    let mut arguments: Vec<OsString> = arguments.iter().map(OsString::from).collect();
    arguments.push(input.into_os_string());
    let read = sandbox
        .run(
            &executable,
            &arguments,
            Some(&listing),
            cancel,
            Instant::now(),
        )
        .map_err(|stopped| match stopped {
            Stopped::Cancelled => "Archive preview cancelled.".to_owned(),
            Stopped::TimedOut => "The archive preview exceeded five minutes.".to_owned(),
            Stopped::Failed(message) => message,
        })?;
    if !read {
        return Err(
            "The archive tool could not read this file. Check its format and installed reader."
                .into(),
        );
    }
    drop(listing);
    let mut bytes = Vec::new();
    File::open(&listing_path)
        .map_err(|_| "The archive listing is unavailable.")?
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read the archive listing.")?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("This archive listing exceeds the preview limit.".into());
    }
    Ok(String::from_utf8_lossy(&bytes)
        .lines()
        .filter(|line| !line.trim().is_empty())
        .take(500)
        .map(|line| ArchiveEntry {
            path: line.trim().to_owned(),
            is_dir: line.trim_end().ends_with('/'),
            compressed_size: 0,
            uncompressed_size: 0,
        })
        .collect())
}

/// The installed reader for `format`, from fixed locations only, and the
/// arguments that make it list an archive.
fn archive_tool(format: &str) -> Result<(PathBuf, &'static [&'static str]), String> {
    archive_tools(format)
        .into_iter()
        .find(|(path, _)| path.is_file())
        .ok_or_else(|| {
            let reader = if cfg!(windows) && format != "tar" {
                "7-Zip"
            } else {
                format
            };
            format!("Install {reader} to preview this archive.")
        })
}

#[cfg(target_os = "macos")]
fn archive_tools(format: &str) -> Vec<(PathBuf, &'static [&'static str])> {
    let (paths, arguments): (&[&str], &'static [&'static str]) = match format {
        "tar" => (&["/usr/bin/tar"], &["-tf"]),
        "7z" => (
            &[
                "/opt/homebrew/bin/7z",
                "/usr/local/bin/7z",
                "/opt/homebrew/bin/7zz",
                "/usr/local/bin/7zz",
            ],
            &["l", "-ba"],
        ),
        "rar" => (
            &["/opt/homebrew/bin/unrar", "/usr/local/bin/unrar"],
            &["lb"],
        ),
        _ => return Vec::new(),
    };
    paths
        .iter()
        .map(|path| (PathBuf::from(path), arguments))
        .collect()
}

/// The tar Windows ships, WinRAR's UnRAR for rar, and 7-Zip, which reads
/// rar too, from Program Files or Scoop.
#[cfg(windows)]
fn archive_tools(format: &str) -> Vec<(PathBuf, &'static [&'static str])> {
    let variable = |name: &str| std::env::var_os(name).map(PathBuf::from);
    if format == "tar" {
        return variable("SystemRoot")
            .map(|root| (root.join(r"System32\tar.exe"), &["-tf"][..]))
            .into_iter()
            .collect();
    }
    let program_files = [variable("ProgramFiles"), variable("ProgramFiles(x86)")];
    let mut tools = Vec::new();
    if format == "rar" {
        tools.extend(
            program_files
                .iter()
                .flatten()
                .map(|folder| (folder.join(r"WinRAR\UnRAR.exe"), &["lb"][..])),
        );
    }
    if matches!(format, "7z" | "rar") {
        tools.extend(
            program_files
                .iter()
                .flatten()
                .map(|folder| folder.join(r"7-Zip\7z.exe"))
                .chain(variable("USERPROFILE").map(|home| home.join(r"scoop\shims\7z.exe")))
                .map(|path| (path, &["l", "-ba"][..])),
        );
    }
    tools
}

#[cfg(not(any(target_os = "macos", windows)))]
fn archive_tools(_format: &str) -> Vec<(PathBuf, &'static [&'static str])> {
    Vec::new()
}

struct ArchiveReader<'a> {
    file: &'a File,
    offset: u64,
    length: u64,
    cancel: &'a AtomicBool,
}
impl std::io::Read for ArchiveReader<'_> {
    fn read(&mut self, bytes: &mut [u8]) -> std::io::Result<usize> {
        if self.cancel.load(Ordering::Acquire) {
            return Err(std::io::Error::other("Archive preview cancelled."));
        }
        let length = bytes
            .len()
            .min(self.length.saturating_sub(self.offset) as usize);
        let read = super::tool_sandbox::read_at(self.file, &mut bytes[..length], self.offset)?;
        self.offset += read as u64;
        Ok(read)
    }
}
impl std::io::Seek for ArchiveReader<'_> {
    fn seek(&mut self, position: std::io::SeekFrom) -> std::io::Result<u64> {
        if self.cancel.load(Ordering::Acquire) {
            return Err(std::io::Error::other("Archive preview cancelled."));
        }
        let offset = match position {
            std::io::SeekFrom::Start(offset) => i128::from(offset),
            std::io::SeekFrom::Current(offset) => i128::from(self.offset) + i128::from(offset),
            std::io::SeekFrom::End(offset) => i128::from(self.length) + i128::from(offset),
        };
        self.offset = u64::try_from(offset)
            .map_err(|_| std::io::Error::other("Invalid archive position."))?;
        Ok(self.offset)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn fixture(file: File) -> PermissionSet {
        let mut p = PermissionSet::from_document(
            "files",
            &json!({"runtime_capabilities":["files.read"]}),
            None,
        )
        .unwrap();
        p.decide("files.read", true).unwrap();
        p.files.insert(
            "owned".into(),
            super::super::FileGrant {
                file,
                writable: false,
            },
        );
        p
    }
    #[test]
    fn zip_preview_reuses_the_reader_through_a_retained_grant_and_cancels_on_release() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("chosen.zip");
        let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
        zip.start_file("日本語.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"owned contents").unwrap();
        zip.finish().unwrap();
        let mut p = fixture(File::open(&path).unwrap());
        // Windows can't rename a file that is open.
        if cfg!(unix) {
            std::fs::rename(&path, root.path().join("moved.zip")).unwrap();
            std::fs::write(&path, b"not the granted archive").unwrap();
        }
        let (id, request) = prepare(&mut p, json!({"handle":"owned","format":"zip"})).unwrap();
        let result = request.run().unwrap();
        assert_eq!(result["entries"][0]["path"], "日本語.txt");
        assert_eq!(result["entries"][0]["uncompressedSize"], 14);
        assert!(result.get("archivePath").is_none());
        p.archive_reads.remove(&id);
        let (_, request) = prepare(&mut p, json!({"handle":"owned","format":"zip"})).unwrap();
        super::super::binary_files::release(&mut p, "owned");
        assert!(request.run().unwrap_err().contains("cancelled"));
        assert!(p.archive_reads.is_empty());
        assert!(prepare(&mut p, json!({"handle":"/etc/passwd","format":"zip"})).is_err());
    }
    #[test]
    fn tar_preview_runs_the_existing_tool_in_the_private_native_sandbox() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("notes.txt"), b"archive contents").unwrap();
        let path = root.path().join("chosen.tar.gz");
        let tar = if cfg!(windows) {
            std::path::Path::new(&std::env::var_os("SystemRoot").unwrap())
                .join("System32")
                .join("tar.exe")
        } else {
            "/usr/bin/tar".into()
        };
        assert!(std::process::Command::new(tar)
            .args(["-czf"])
            .arg(&path)
            .arg("-C")
            .arg(root.path())
            .arg("notes.txt")
            .status()
            .unwrap()
            .success());
        let mut p = fixture(File::open(&path).unwrap());
        let (id, request) = prepare(&mut p, json!({"handle":"owned","format":"tar"})).unwrap();
        let result = request.run().unwrap();
        assert_eq!(result["format"], "tar");
        assert!(result["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["path"] == "notes.txt"));
        p.archive_reads.remove(&id);
        assert!(p.archive_reads.is_empty());
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveEntry {
    pub path: String,
    pub is_dir: bool,
    pub compressed_size: u64,
    pub uncompressed_size: u64,
}

/// ZIP metadata for an archive preview, read without extracting anything.
fn archive_zip_entries<R: std::io::Read + std::io::Seek>(
    file: R,
    limit: usize,
) -> Result<Vec<ArchiveEntry>, String> {
    let mut archive =
        zip::ZipArchive::new(file).map_err(|err| format!("Could not read ZIP archive: {err}"))?;
    let mut entries = Vec::new();
    for index in 0..archive.len().min(limit) {
        let entry = archive
            .by_index(index)
            .map_err(|err| format!("Could not read ZIP entry: {err}"))?;
        entries.push(ArchiveEntry {
            path: entry.name().to_owned(),
            is_dir: entry.is_dir(),
            compressed_size: entry.compressed_size(),
            uncompressed_size: entry.size(),
        });
    }
    Ok(entries)
}
