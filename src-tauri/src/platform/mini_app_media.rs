//! Fixed conversion jobs. The App never supplies an executable, path, or flags.
use super::{binary_files, PermissionSet};
use cap_std::fs::Dir;
use serde_json::{json, Value};
use std::{
    fs::File,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};
#[path = "mini_app_media_process.rs"]
pub(super) mod process;
#[path = "../infra/system_dependencies.rs"]
mod system_dependencies;
const FORMATS: &[&str] = &[
    "png", "jpg", "webp", "avif", "mp3", "wav", "flac", "m4a", "mp4", "mov", "webm", "gif",
];
pub struct MediaJob {
    state: Arc<Mutex<JobState>>,
    cancel: Arc<AtomicBool>,
    input: String,
    folder: String,
    directory: Arc<Dir>,
    name: String,
}
struct JobState {
    status: &'static str,
    message: String,
    output: Option<File>,
}
impl Drop for MediaJob {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Release);
    }
}
impl MediaJob {
    pub(super) fn uses_handle(&self, handle: &str) -> bool {
        self.input == handle || self.folder == handle
    }
}
fn tool() -> Result<PathBuf, String> {
    if !cfg!(target_os = "macos") {
        return Err("Isolated media conversion is not implemented on this platform yet.".into());
    }
    if !std::path::Path::new("/usr/bin/sandbox-exec").is_file() {
        return Err("The native media sandbox is unavailable.".into());
    }
    let path = system_dependencies::resolve_executable("ffmpeg", None)
        .ok_or("Install FFmpeg on this device to use media conversion.")?
        .canonicalize()
        .map_err(|_| "FFmpeg is unavailable.")?;
    if let Some(home) = dirs::home_dir() {
        let root = home.join(".misty/plugins");
        if path.starts_with(&root) || root.canonicalize().is_ok_and(|root| path.starts_with(root)) {
            return Err("Media conversion requires a host-selected FFmpeg installation, not an App-bundled executable.".into());
        }
    }
    Ok(path)
}
pub fn availability() -> Value {
    match tool() {
        Ok(_) => json!({"available":true,"formats":FORMATS}),
        Err(message) => json!({"available":false,"message":message,"formats":[]}),
    }
}
fn text<'a>(params: &'a Value, key: &str) -> Result<&'a str, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| value.len() <= 256)
        .ok_or_else(|| format!("Missing {key}."))
}
pub fn execute(p: &mut PermissionSet, method: &str, params: &Value) -> Result<Value, String> {
    p.authorize("media.convert")?;
    if method == "media.convertStart" {
        p.authorize("files.read")?;
        p.authorize("files.write")?;
        if p.media.len() >= 4 {
            return Err("Close an earlier conversion before starting another.".into());
        }
        let input = text(params, "handle")?;
        let folder = text(params, "directory")?;
        let format = text(params, "format")?;
        let quality = text(params, "quality")?;
        let name = text(params, "name")?;
        if !FORMATS.contains(&format)
            || !["small", "balanced", "high"].contains(&quality)
            || !binary_files::safe_name(name)
            || !name.ends_with(&format!(".{format}"))
        {
            return Err("Unsupported conversion options.".into());
        }
        let file = p
            .files
            .get(input)
            .ok_or("Choose the input file in this App first.")?
            .file
            .try_clone()
            .map_err(|_| "Chosen file unavailable.")?;
        if file
            .metadata()
            .map_err(|_| "Chosen file unavailable.")?
            .len()
            > 1_073_741_824
        {
            return Err("Media inputs are limited to 1 GB.".into());
        }
        let folder_grant = p
            .folders
            .get(folder)
            .filter(|folder| folder.writable)
            .ok_or("Choose an output folder for writing first.")?;
        let directory = folder_grant.directory.clone();
        let executable = tool()?;
        static WORKERS: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
        let slot = WORKERS
            .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2)))
            .clone()
            .try_acquire_owned()
            .map_err(|_| "Two conversions are already running. Try again shortly.")?;
        let id = uuid::Uuid::new_v4().to_string();
        let cancel = Arc::new(AtomicBool::new(false));
        let state = Arc::new(Mutex::new(JobState {
            status: "running",
            message: "Converting media…".into(),
            output: None,
        }));
        p.media.insert(
            id.clone(),
            MediaJob {
                state: state.clone(),
                cancel: cancel.clone(),
                input: input.into(),
                folder: folder.into(),
                directory,
                name: name.into(),
            },
        );
        let (format, quality) = (format.to_owned(), quality.to_owned());
        tokio::task::spawn_blocking(move || {
            let _slot = slot;
            let result = process::convert(&executable, &file, &format, &quality, &cancel);
            if let Ok(mut state) = state.lock() {
                if cancel.load(Ordering::Acquire) {
                    state.status = "cancelled";
                    state.message = "Conversion cancelled.".into();
                    state.output = None;
                } else {
                    match result {
                        Ok(output) => {
                            state.status = "completed";
                            state.message = "Conversion ready to save.".into();
                            state.output = Some(output);
                        }
                        Err(error) => {
                            state.status = "failed";
                            state.message = error;
                            state.output = None;
                        }
                    }
                }
            }
        });
        return Ok(json!({"jobId":id}));
    }
    let id = text(params, "jobId")?;
    let job = p
        .media
        .get(id)
        .ok_or("This conversion does not belong to this App instance.")?;
    match method {
        "media.convertStatus" => {
            let state = job.state.lock().map_err(|_| "Conversion unavailable.")?;
            Ok(json!({"status":state.status,"message":state.message}))
        }
        "media.convertCancel" => {
            job.cancel.store(true, Ordering::Release);
            let mut state = job.state.lock().map_err(|_| "Conversion unavailable.")?;
            state.status = "cancelled";
            state.message = "Conversion cancelled.".into();
            state.output = None;
            Ok(Value::Null)
        }
        "media.convertClose" => {
            p.media.remove(id);
            Ok(Value::Null)
        }
        "media.convertCollect" => {
            p.authorize("files.read")?;
            p.authorize("files.write")?;
            let directory = job.directory.clone();
            let name = job.name.clone();
            let output = job
                .state
                .lock()
                .map_err(|_| "Conversion unavailable.")?
                .output
                .as_ref()
                .ok_or("Conversion has no output to save.")?
                .try_clone()
                .map_err(|_| "Conversion unavailable.")?;
            let result = binary_files::stage_converted(p, output, directory, name)?;
            p.media.remove(id);
            Ok(result)
        }
        _ => Err("Unsupported conversion operation.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ready(root: &Path) -> PermissionSet {
        let mut p = PermissionSet::from_document(
            "convert",
            &json!({"runtime_capabilities":["files.read","files.write","media.convert"]}),
            None,
        )
        .unwrap();
        for grant in ["files.read", "files.write", "media.convert"] {
            p.decide(grant, true).unwrap();
        }
        let file = tempfile::tempfile().unwrap();
        file.set_len(3).unwrap();
        p.media.insert(
            "owned".into(),
            MediaJob {
                state: Arc::new(Mutex::new(JobState {
                    status: "completed",
                    message: "Ready".into(),
                    output: Some(file),
                })),
                cancel: Arc::new(AtomicBool::new(false)),
                input: "input".into(),
                folder: "folder".into(),
                directory: Arc::new(
                    Dir::open_ambient_dir(root, cap_std::ambient_authority()).unwrap(),
                ),
                name: "copy.mp3".into(),
            },
        );
        p
    }
    use std::path::Path;
    #[test]
    fn output_is_instance_owned_and_revocation_prevents_collection_and_saving() {
        let root = tempfile::tempdir().unwrap();
        let mut p = ready(root.path());
        let mut other = ready(root.path());
        other.media.clear();
        assert!(execute(
            &mut other,
            "media.convertCollect",
            &json!({"jobId":"owned"})
        )
        .is_err());
        let saved = execute(&mut p, "media.convertCollect", &json!({"jobId":"owned"})).unwrap();
        assert!(p.media.is_empty());
        assert!(p.outputs.contains_key(saved["handle"].as_str().unwrap()));
        p.decide("media.convert", false).unwrap();
        assert!(p.outputs.is_empty());
        assert!(binary_files::execute(
            &mut p,
            "files.commitCopy",
            &json!({"handle":saved["handle"]})
        )
        .is_err());
        let mut p = ready(root.path());
        let cancel = p.media["owned"].cancel.clone();
        p.decide("files.read", false).unwrap();
        assert!(cancel.load(Ordering::Acquire));
        assert!(execute(&mut p, "media.convertCollect", &json!({"jobId":"owned"})).is_err());
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    }
    #[test]
    fn cancellation_discards_ready_outputs_and_requires_the_media_grant() {
        let root = tempfile::tempdir().unwrap();
        let mut p = ready(root.path());
        execute(&mut p, "media.convertCancel", &json!({"jobId":"owned"})).unwrap();
        assert!(execute(&mut p, "media.convertCollect", &json!({"jobId":"owned"})).is_err());
        p.decide("media.convert", false).unwrap();
        assert!(execute(&mut p, "media.convertStatus", &json!({"jobId":"owned"})).is_err());
    }
}
