//! Archive previews use retained file grants and the existing archive readers.
use super::{MiniAppState, PermissionSet};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    fs::File,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
};

pub struct ReadGuard {
    pub handle: String,
    cancel: Arc<AtomicBool>,
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
    #[cfg(not(target_os = "macos"))]
    fn run(self) -> Result<Value, String> {
        Err("Owned archive previews are not implemented on this platform yet.".into())
    }
    #[cfg(target_os = "macos")]
    fn run(self) -> Result<Value, String> {
        use std::io::{Read, Write};
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
            crate::infra::power_pack::archive_zip_entries(reader, 500)
                .map_err(|error| error.to_string())?
        } else {
            // System tools inspect a private snapshot. They cannot reopen the
            // original pathname, follow adjacent volumes or read outside this work area.
            let work = tempfile::Builder::new()
                .prefix("misty-archive-")
                .tempdir()
                .map_err(|_| "Could not prepare the archive preview.")?;
            let input = work.path().join(format!("input.{}", self.input.format));
            let mut output =
                File::create(&input).map_err(|_| "Could not prepare the archive preview.")?;
            std::io::copy(&mut reader, &mut output).map_err(|error| error.to_string())?;
            output
                .flush()
                .map_err(|_| "Could not prepare the archive preview.")?;
            drop(output);
            let (tools, args): (&[&str], &[&str]) = match self.input.format.as_str() {
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
                _ => unreachable!(),
            };
            let executable = tools
                .iter()
                .map(std::path::Path::new)
                .find(|path| path.is_file())
                .ok_or_else(|| format!("Install {} to preview this archive.", self.input.format))?;
            let listing = work.path().join("listing.txt");
            let mut command = super::media::process::command(executable, work.path())
                .map_err(|_| "The native archive sandbox is unavailable.")?;
            command.args(args).arg(&input).stdout(
                File::create(&listing).map_err(|_| "Could not prepare the archive listing.")?,
            );
            run_tool(command, &self.cancel)?;
            let mut bytes = Vec::new();
            File::open(&listing)
                .map_err(|_| "The archive listing is unavailable.")?
                .take(8 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "Could not read the archive listing.")?;
            if bytes.len() > 8 * 1024 * 1024 {
                return Err("This archive listing exceeds the preview limit.".into());
            }
            String::from_utf8_lossy(&bytes)
                .lines()
                .filter(|line| !line.trim().is_empty())
                .take(500)
                .map(|line| crate::infra::power_pack::ArchiveEntry {
                    path: line.trim().to_owned(),
                    is_dir: line.trim_end().ends_with('/'),
                    compressed_size: 0,
                    uncompressed_size: 0,
                })
                .collect()
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

#[cfg(target_os = "macos")]
struct ArchiveReader<'a> {
    file: &'a File,
    offset: u64,
    length: u64,
    cancel: &'a AtomicBool,
}
#[cfg(target_os = "macos")]
impl std::io::Read for ArchiveReader<'_> {
    fn read(&mut self, bytes: &mut [u8]) -> std::io::Result<usize> {
        use std::os::unix::fs::FileExt;
        if self.cancel.load(Ordering::Acquire) {
            return Err(std::io::Error::other("Archive preview cancelled."));
        }
        let length = bytes
            .len()
            .min(self.length.saturating_sub(self.offset) as usize);
        let read = self.file.read_at(&mut bytes[..length], self.offset)?;
        self.offset += read as u64;
        Ok(read)
    }
}
#[cfg(target_os = "macos")]
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
#[cfg(target_os = "macos")]
fn run_tool(mut command: std::process::Command, cancel: &AtomicBool) -> Result<(), String> {
    struct Child {
        process: std::process::Child,
        active: bool,
    }
    impl Drop for Child {
        fn drop(&mut self) {
            if self.active {
                unsafe {
                    libc::kill(-(self.process.id() as i32), libc::SIGKILL);
                }
                let _ = self.process.wait();
            }
        }
    }
    let mut child = Child {
        process: command
            .spawn()
            .map_err(|_| "The archive tool could not be started.")?,
        active: true,
    };
    let started = std::time::Instant::now();
    loop {
        if cancel.load(Ordering::Acquire) {
            return Err("Archive preview cancelled.".into());
        }
        if started.elapsed() > std::time::Duration::from_secs(300) {
            return Err("The archive preview exceeded five minutes.".into());
        }
        if let Some(status) = child
            .process
            .try_wait()
            .map_err(|_| "The archive tool stopped unexpectedly.")?
        {
            child.active = false;
            return if status.success() {
                Ok(())
            } else {
                Err("The archive tool could not read this file. Check its format and installed reader.".into())
            };
        }
        std::thread::sleep(std::time::Duration::from_millis(30));
    }
}

#[cfg(all(test, target_os = "macos"))]
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
        std::fs::rename(&path, root.path().join("moved.zip")).unwrap();
        std::fs::write(&path, b"not the granted archive").unwrap();
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
        assert!(std::process::Command::new("/usr/bin/tar")
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
