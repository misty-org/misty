use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult},
    services::environment::AppEnvironmentService,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionCommandRequest {
    pub plugin_id: String,
    pub command: String,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionJobSnapshot {
    pub id: String,
    pub status: String,
    pub progress: Option<f64>,
    pub message: String,
    pub output_paths: Vec<String>,
    pub error: Option<String>,
}

struct ExtensionJob {
    snapshot: ExtensionJobSnapshot,
    cancel: Arc<AtomicBool>,
}

#[derive(Clone)]
pub struct ExtensionRuntimeService {
    jobs: Arc<Mutex<HashMap<String, ExtensionJob>>>,
    home_dir: PathBuf,
    cache_dir: PathBuf,
}

impl ExtensionRuntimeService {
    pub fn new(environment: AppEnvironmentService) -> Self {
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
            home_dir: environment.home_dir(),
            cache_dir: environment.cache_dir().join("extension-jobs"),
        }
    }

    pub async fn execute(&self, request: ExtensionCommandRequest) -> ApiResult<Value> {
        validate_command_scope(&request.plugin_id, &request.command)?;
        match request.command.as_str() {
            "dependencies.check" => dependency_check(&request.payload),
            "quick_convert.start" => self.start_quick_convert(&request.payload),
            "ytdlp.start" => self.start_ytdlp(&request.payload),
            "ytdlp.inspect" => {
                let payload = request.payload;
                tokio::task::spawn_blocking(move || inspect_ytdlp(&payload))
                    .await
                    .map_err(|error| {
                        ApiError::Message(format!("yt-dlp inspector stopped: {error}"))
                    })?
            }
            "jobs.status" => self.job_status(&request.payload),
            "jobs.cancel" => self.cancel_job(&request.payload),
            "host.revealOutput" => self.reveal_output(&request.payload),
            _ => Err(ApiError::Message(
                "Extension command is not allowlisted.".to_owned(),
            )),
        }
    }

    fn job_status(&self, payload: &Value) -> ApiResult<Value> {
        let id = required_string(payload, "jobId", 128)?;
        let jobs = self
            .jobs
            .lock()
            .map_err(|_| ApiError::Message("Extension job state is unavailable.".to_owned()))?;
        let job = jobs
            .get(&id)
            .ok_or_else(|| ApiError::Message("Extension job was not found.".to_owned()))?;
        serde_json::to_value(&job.snapshot).map_err(|error| ApiError::Message(error.to_string()))
    }

    fn cancel_job(&self, payload: &Value) -> ApiResult<Value> {
        let id = required_string(payload, "jobId", 128)?;
        let mut jobs = self
            .jobs
            .lock()
            .map_err(|_| ApiError::Message("Extension job state is unavailable.".to_owned()))?;
        let job = jobs
            .get_mut(&id)
            .ok_or_else(|| ApiError::Message("Extension job was not found.".to_owned()))?;
        if matches!(job.snapshot.status.as_str(), "queued" | "running") {
            job.cancel.store(true, Ordering::Relaxed);
            job.snapshot.message = "Cancelling…".to_owned();
        }
        Ok(json!({ "ok": true }))
    }

    fn reveal_output(&self, payload: &Value) -> ApiResult<Value> {
        let id = required_string(payload, "jobId", 128)?;
        let jobs = self
            .jobs
            .lock()
            .map_err(|_| ApiError::Message("Extension job state is unavailable.".to_owned()))?;
        let output = jobs
            .get(&id)
            .and_then(|job| job.snapshot.output_paths.first())
            .ok_or_else(|| ApiError::Message("This job has no output to reveal.".to_owned()))?;
        let path = fs::canonicalize(output)
            .map_err(|_| ApiError::Message("The output no longer exists.".to_owned()))?;
        reveal_path(&path)?;
        Ok(json!({ "ok": true }))
    }

    fn start_quick_convert(&self, payload: &Value) -> ApiResult<Value> {
        let paths = safe_input_paths(payload)?;
        let format = allowed_string(payload, "format", QUICK_FORMATS)?;
        let quality = allowed_string(payload, "quality", &["small", "balanced", "high"])?;
        let destination = allowed_string(payload, "destination", &["source", "downloads"])?;
        let id = Uuid::new_v4().to_string();
        let cancel = Arc::new(AtomicBool::new(false));
        self.insert_job(
            &id,
            cancel.clone(),
            format!("Queued {} file(s)…", paths.len()),
        )?;
        let jobs = self.jobs.clone();
        let home_dir = self.home_dir.clone();
        let job_id = id.clone();
        thread::spawn(move || {
            run_quick_convert_job(
                jobs,
                job_id,
                cancel,
                paths,
                format,
                quality,
                destination,
                home_dir,
            )
        });
        Ok(json!({ "ok": true, "jobId": id, "message": "Conversion queued." }))
    }

    fn start_ytdlp(&self, payload: &Value) -> ApiResult<Value> {
        let url = required_string(payload, "url", 4096)?;
        validate_http_url(&url)?;
        let format = allowed_string(payload, "format", &["mp3", "m4a", "mp4", "webm"])?;
        let destination = allowed_string(
            payload,
            "destination",
            &["smart", "downloads", "music", "movies"],
        )?;
        let playlist = payload
            .get("playlist")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let output_dir = ytdlp_output_dir(&self.home_dir, &destination, &format);
        fs::create_dir_all(&output_dir).map_err(|error| {
            ApiError::Message(format!(
                "Could not create {}: {error}",
                output_dir.display()
            ))
        })?;
        fs::create_dir_all(&self.cache_dir).map_err(|error| {
            ApiError::Message(format!("Could not prepare download job: {error}"))
        })?;
        let id = Uuid::new_v4().to_string();
        let staging_dir = self.cache_dir.join(format!("{id}.download"));
        fs::create_dir_all(&staging_dir).map_err(|error| {
            ApiError::Message(format!("Could not prepare download staging: {error}"))
        })?;
        let output_log = self.cache_dir.join(format!("{id}.paths"));
        let cancel = Arc::new(AtomicBool::new(false));
        self.insert_job(&id, cancel.clone(), "Download queued…".to_owned())?;
        let jobs = self.jobs.clone();
        let job_id = id.clone();
        thread::spawn(move || {
            run_ytdlp_job(
                jobs,
                job_id,
                cancel,
                url,
                format,
                playlist,
                staging_dir,
                output_dir,
                output_log,
            )
        });
        Ok(json!({ "ok": true, "jobId": id, "message": "Download queued." }))
    }

    fn insert_job(&self, id: &str, cancel: Arc<AtomicBool>, message: String) -> ApiResult<()> {
        let mut jobs = self
            .jobs
            .lock()
            .map_err(|_| ApiError::Message("Extension job state is unavailable.".to_owned()))?;
        if jobs
            .values()
            .filter(|job| matches!(job.snapshot.status.as_str(), "queued" | "running"))
            .count()
            >= 4
        {
            return Err(ApiError::Message(
                "Wait for another extension job to finish before starting a new one.".to_owned(),
            ));
        }
        if jobs.len() > 128 {
            jobs.retain(|_, job| matches!(job.snapshot.status.as_str(), "queued" | "running"));
        }
        jobs.insert(
            id.to_owned(),
            ExtensionJob {
                snapshot: ExtensionJobSnapshot {
                    id: id.to_owned(),
                    status: "queued".to_owned(),
                    progress: Some(0.0),
                    message,
                    output_paths: Vec::new(),
                    error: None,
                },
                cancel,
            },
        );
        Ok(())
    }
}

const QUICK_FORMATS: &[&str] = &[
    "png", "jpg", "webp", "avif", "mp3", "wav", "flac", "m4a", "mp4", "mov", "webm", "gif",
];

fn validate_command_scope(plugin_id: &str, command: &str) -> ApiResult<()> {
    let allowed = match plugin_id {
        "quick_convert" => matches!(
            command,
            "dependencies.check"
                | "quick_convert.start"
                | "jobs.status"
                | "jobs.cancel"
                | "host.revealOutput"
        ),
        "ytdlp" => matches!(
            command,
            "dependencies.check"
                | "ytdlp.start"
                | "ytdlp.inspect"
                | "jobs.status"
                | "jobs.cancel"
                | "host.revealOutput"
        ),
        _ => false,
    };
    if allowed {
        Ok(())
    } else {
        Err(ApiError::Message(
            "This extension is not permitted to run that command.".to_owned(),
        ))
    }
}

fn dependency_check(payload: &Value) -> ApiResult<Value> {
    let requested = allowed_string(payload, "name", &["ffmpeg", "yt-dlp"])?;
    let output = Command::new(&requested)
        .arg("--version")
        .stdin(Stdio::null())
        .output();
    let (available, version) = match output {
        Ok(output) if output.status.success() => (
            true,
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or_default()
                .chars()
                .take(180)
                .collect(),
        ),
        _ => (false, String::new()),
    };
    Ok(json!({ "ok": true, "available": available, "version": version }))
}

fn safe_input_paths(payload: &Value) -> ApiResult<Vec<PathBuf>> {
    let values = payload
        .get("paths")
        .and_then(Value::as_array)
        .ok_or_else(|| ApiError::Message("At least one input file is required.".to_owned()))?;
    if values.is_empty() || values.len() > 64 {
        return Err(ApiError::Message(
            "Choose between 1 and 64 files.".to_owned(),
        ));
    }
    values
        .iter()
        .map(|value| {
            let raw = value
                .as_str()
                .ok_or_else(|| ApiError::Message("Input paths must be strings.".to_owned()))?;
            let path = fs::canonicalize(raw)
                .map_err(|_| ApiError::Message(format!("Input file does not exist: {raw}")))?;
            if !path.is_file() {
                return Err(ApiError::Message(format!(
                    "Input is not a regular file: {raw}"
                )));
            }
            Ok(path)
        })
        .collect()
}

fn required_string(payload: &Value, key: &str, max: usize) -> ApiResult<String> {
    let value = payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::Message(format!("{key} is required.")))?;
    if value.len() > max {
        return Err(ApiError::Message(format!("{key} is too long.")));
    }
    Ok(value.to_owned())
}

fn allowed_string(payload: &Value, key: &str, allowed: &[&str]) -> ApiResult<String> {
    let value = required_string(payload, key, 64)?;
    if allowed.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(ApiError::Message(format!("Unsupported {key}.")))
    }
}

fn update_job(
    jobs: &Arc<Mutex<HashMap<String, ExtensionJob>>>,
    id: &str,
    update: impl FnOnce(&mut ExtensionJobSnapshot),
) {
    if let Ok(mut jobs) = jobs.lock() {
        if let Some(job) = jobs.get_mut(id) {
            update(&mut job.snapshot);
        }
    }
}

fn run_quick_convert_job(
    jobs: Arc<Mutex<HashMap<String, ExtensionJob>>>,
    id: String,
    cancel: Arc<AtomicBool>,
    paths: Vec<PathBuf>,
    format: String,
    quality: String,
    destination: String,
    home_dir: PathBuf,
) {
    update_job(&jobs, &id, |job| {
        job.status = "running".to_owned();
        job.message = "Preparing conversion…".to_owned();
    });
    let mut outputs = Vec::new();
    for (index, source) in paths.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            finish_cancelled(&jobs, &id, outputs);
            return;
        }
        let directory = if destination == "downloads" {
            dirs::download_dir().unwrap_or_else(|| home_dir.join("Downloads"))
        } else {
            source.parent().unwrap_or(Path::new(".")).to_path_buf()
        };
        if let Err(error) = fs::create_dir_all(&directory) {
            finish_failed(
                &jobs,
                &id,
                format!("Could not create {}: {error}", directory.display()),
                outputs,
            );
            return;
        }
        let output = collision_safe_output(source, &directory, &format);
        update_job(&jobs, &id, |job| {
            job.progress = Some((index as f64 / paths.len() as f64) * 100.0);
            job.message = format!("Converting {} of {}…", index + 1, paths.len());
        });
        let mut command = Command::new("ffmpeg");
        command
            .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i"])
            .arg(source);
        apply_ffmpeg_options(&mut command, &format, &quality);
        command
            .arg(&output)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        match command
            .spawn()
            .and_then(|mut child| wait_for_child(&mut child, &cancel))
        {
            Ok(Some(status)) if status.success() => outputs.push(output.display().to_string()),
            Ok(None) => {
                let _ = fs::remove_file(&output);
                finish_cancelled(&jobs, &id, outputs);
                return;
            }
            Ok(Some(status)) => {
                let _ = fs::remove_file(&output);
                finish_failed(&jobs, &id, format!("FFmpeg exited with {status}."), outputs);
                return;
            }
            Err(error) => {
                let _ = fs::remove_file(&output);
                finish_failed(
                    &jobs,
                    &id,
                    format!("Could not run FFmpeg: {error}"),
                    outputs,
                );
                return;
            }
        }
    }
    update_job(&jobs, &id, |job| {
        job.status = "completed".to_owned();
        job.progress = Some(100.0);
        job.message = format!("Converted {} file(s).", outputs.len());
        job.output_paths = outputs;
    });
}

fn apply_ffmpeg_options(command: &mut Command, format: &str, quality: &str) {
    let crf = match quality {
        "small" => "30",
        "high" => "18",
        _ => "23",
    };
    let audio = match quality {
        "small" => "128k",
        "high" => "256k",
        _ => "192k",
    };
    match format {
        "mp3" => {
            command.args(["-vn", "-codec:a", "libmp3lame", "-b:a", audio]);
        }
        "m4a" => {
            command.args(["-vn", "-c:a", "aac", "-b:a", audio]);
        }
        "mp4" | "mov" => {
            command.args([
                "-c:v",
                "libx264",
                "-crf",
                crf,
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
            ]);
        }
        "webm" => {
            command.args([
                "-c:v",
                "libvpx-vp9",
                "-crf",
                crf,
                "-b:v",
                "0",
                "-c:a",
                "libopus",
            ]);
        }
        "gif" => {
            command.args(["-vf", "fps=12,scale='min(960,iw)':-1:flags=lanczos"]);
        }
        "jpg" => {
            command.args([
                "-frames:v",
                "1",
                "-q:v",
                if quality == "high" { "2" } else { "5" },
            ]);
        }
        "png" | "webp" | "avif" => {
            command.args(["-frames:v", "1"]);
        }
        _ => {}
    }
}

fn collision_safe_output(source: &Path, directory: &Path, format: &str) -> PathBuf {
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("converted");
    for suffix in 1..10_000 {
        let name = if suffix == 1 {
            format!("{stem}_converted.{format}")
        } else {
            format!("{stem}_converted ({suffix}).{format}")
        };
        let candidate = directory.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{stem}_converted-{}.{}", Uuid::new_v4(), format))
}

fn run_ytdlp_job(
    jobs: Arc<Mutex<HashMap<String, ExtensionJob>>>,
    id: String,
    cancel: Arc<AtomicBool>,
    url: String,
    format: String,
    playlist: bool,
    staging_dir: PathBuf,
    output_dir: PathBuf,
    output_log: PathBuf,
) {
    update_job(&jobs, &id, |job| {
        job.status = "running".to_owned();
        job.progress = None;
        job.message = "Downloading media…".to_owned();
    });
    let mut command = Command::new("yt-dlp");
    command
        .args([
            "--no-config",
            "--newline",
            "--restrict-filenames",
            "--no-overwrites",
            "--paths",
        ])
        .arg(&staging_dir)
        .args([
            "--output",
            "%(title).180B [%(id)s].%(ext)s",
            "--print-to-file",
            "after_move:filepath",
        ])
        .arg(&output_log);
    if playlist {
        command.args(["--yes-playlist", "--playlist-end", "100"]);
    } else {
        command.arg("--no-playlist");
    }
    match format.as_str() {
        "mp3" => {
            command.args(["-x", "--audio-format", "mp3", "--audio-quality", "0"]);
        }
        "m4a" => {
            command.args(["-x", "--audio-format", "m4a", "--audio-quality", "0"]);
        }
        "mp4" => {
            command.args(["-f", "bv*+ba/b", "--merge-output-format", "mp4"]);
        }
        "webm" => {
            command.args([
                "-f",
                "bv*[ext=webm]+ba[ext=webm]/b[ext=webm]/bv*+ba/b",
                "--merge-output-format",
                "webm",
            ]);
        }
        _ => {}
    }
    command
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let result = match command.spawn() {
        Ok(mut child) => {
            let reader = child.stderr.take().map(|stderr| {
                let progress_jobs = jobs.clone();
                let progress_id = id.clone();
                thread::spawn(move || {
                    for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                        if let Some(progress) = progress_percent(&line) {
                            update_job(&progress_jobs, &progress_id, |job| {
                                job.progress = Some(progress);
                                job.message = format!("Downloading… {}%", progress.round());
                            });
                        }
                    }
                })
            });
            let status = wait_for_child(&mut child, &cancel);
            if let Some(reader) = reader {
                let _ = reader.join();
            }
            status
        }
        Err(error) => Err(error),
    };
    let canonical_staging_dir =
        fs::canonicalize(&staging_dir).unwrap_or_else(|_| staging_dir.clone());
    let staged = fs::read_to_string(&output_log)
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter_map(|line| fs::canonicalize(line).ok())
        .filter(|path| path.starts_with(&canonical_staging_dir) && path.is_file())
        .collect::<Vec<_>>();
    let _ = fs::remove_file(output_log);
    match result {
        Ok(Some(status)) if status.success() => {
            let mut outputs = Vec::new();
            for source in staged {
                let destination = collision_safe_named_output(&source, &output_dir);
                let moved = fs::rename(&source, &destination).or_else(|_| {
                    fs::copy(&source, &destination).and_then(|_| fs::remove_file(&source))
                });
                if let Err(error) = moved {
                    let _ = fs::remove_dir_all(&staging_dir);
                    finish_failed(
                        &jobs,
                        &id,
                        format!("Could not move the completed download: {error}"),
                        outputs,
                    );
                    return;
                }
                outputs.push(destination.display().to_string());
            }
            let _ = fs::remove_dir_all(&staging_dir);
            if outputs.is_empty() {
                finish_failed(
                    &jobs,
                    &id,
                    "yt-dlp completed without producing an output file.".to_owned(),
                    Vec::new(),
                );
            } else {
                update_job(&jobs, &id, |job| {
                    job.status = "completed".to_owned();
                    job.progress = Some(100.0);
                    job.message = format!("Downloaded {} item(s).", outputs.len());
                    job.output_paths = outputs;
                });
            }
        }
        Ok(None) => {
            let _ = fs::remove_dir_all(&staging_dir);
            finish_cancelled(&jobs, &id, Vec::new());
        }
        Ok(Some(status)) => {
            let _ = fs::remove_dir_all(&staging_dir);
            finish_failed(
                &jobs,
                &id,
                format!(
                    "yt-dlp exited with {status}. Check that the URL is supported and try again."
                ),
                Vec::new(),
            );
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&staging_dir);
            finish_failed(
                &jobs,
                &id,
                format!("Could not run yt-dlp: {error}"),
                Vec::new(),
            );
        }
    }
}

fn progress_percent(line: &str) -> Option<f64> {
    line.split_whitespace()
        .find_map(|part| {
            part.strip_suffix('%')
                .and_then(|value| value.trim().parse::<f64>().ok())
        })
        .map(|value| value.clamp(0.0, 100.0))
}

fn collision_safe_named_output(source: &Path, directory: &Path) -> PathBuf {
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    let extension = source.extension().and_then(|value| value.to_str());
    let first = directory.join(file_name);
    if !first.exists() {
        return first;
    }
    for suffix in 2..10_000 {
        let name = extension
            .map(|ext| format!("{stem} ({suffix}).{ext}"))
            .unwrap_or_else(|| format!("{stem} ({suffix})"));
        let candidate = directory.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{stem}-{}", Uuid::new_v4()))
}

fn wait_for_child(
    child: &mut std::process::Child,
    cancel: &AtomicBool,
) -> std::io::Result<Option<std::process::ExitStatus>> {
    loop {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(None);
        }
        if let Some(status) = child.try_wait()? {
            return Ok(Some(status));
        }
        thread::sleep(Duration::from_millis(150));
    }
}

fn finish_cancelled(
    jobs: &Arc<Mutex<HashMap<String, ExtensionJob>>>,
    id: &str,
    outputs: Vec<String>,
) {
    update_job(jobs, id, |job| {
        job.status = "cancelled".to_owned();
        job.progress = None;
        job.message = "Cancelled.".to_owned();
        job.output_paths = outputs;
    });
}
fn finish_failed(
    jobs: &Arc<Mutex<HashMap<String, ExtensionJob>>>,
    id: &str,
    error: String,
    outputs: Vec<String>,
) {
    update_job(jobs, id, |job| {
        job.status = "failed".to_owned();
        job.progress = None;
        job.message = "The job failed.".to_owned();
        job.error = Some(error);
        job.output_paths = outputs;
    });
}

fn validate_http_url(url: &str) -> ApiResult<()> {
    if url.len() > 4096 || url.chars().any(char::is_whitespace) {
        return Err(ApiError::Message(
            "Enter a valid public http or https URL.".to_owned(),
        ));
    }
    let parsed = reqwest::Url::parse(url)
        .map_err(|_| ApiError::Message("Enter a valid public http or https URL.".to_owned()))?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(ApiError::Message(
            "Enter a public http or https URL without embedded credentials.".to_owned(),
        ));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| ApiError::Message("The URL must include a public host.".to_owned()))?
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") {
        return Err(ApiError::Message(
            "Local network URLs are not allowed for downloads.".to_owned(),
        ));
    }
    if let Ok(address) = host.parse::<std::net::IpAddr>() {
        let unsafe_address = match address {
            std::net::IpAddr::V4(ip) => {
                ip.is_private()
                    || ip.is_loopback()
                    || ip.is_link_local()
                    || ip.is_unspecified()
                    || ip.is_broadcast()
            }
            std::net::IpAddr::V6(ip) => {
                ip.is_loopback()
                    || ip.is_unspecified()
                    || (ip.segments()[0] & 0xfe00) == 0xfc00
                    || (ip.segments()[0] & 0xffc0) == 0xfe80
            }
        };
        if unsafe_address {
            return Err(ApiError::Message(
                "Local network URLs are not allowed for downloads.".to_owned(),
            ));
        }
    } else if !host.contains('.') {
        return Err(ApiError::Message(
            "The URL must use a public domain.".to_owned(),
        ));
    }
    Ok(())
}

fn ytdlp_output_dir(home: &Path, destination: &str, format: &str) -> PathBuf {
    match destination {
        "downloads" => dirs::download_dir().unwrap_or_else(|| home.join("Downloads")),
        "music" => dirs::audio_dir().unwrap_or_else(|| home.join("Music")),
        "movies" => dirs::video_dir().unwrap_or_else(|| home.join("Movies")),
        _ if matches!(format, "mp3" | "m4a") => {
            dirs::audio_dir().unwrap_or_else(|| home.join("Music"))
        }
        _ => dirs::video_dir().unwrap_or_else(|| home.join("Movies")),
    }
}

fn reveal_path(path: &Path) -> ApiResult<()> {
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg("-R").arg(path).spawn();
    #[cfg(target_os = "windows")]
    let result = Command::new("explorer")
        .arg(format!("/select,{}", path.display()))
        .spawn();
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let result = Command::new("xdg-open")
        .arg(path.parent().unwrap_or(path))
        .spawn();
    result
        .map(|_| ())
        .map_err(|error| ApiError::Message(format!("Could not reveal output: {error}")))
}

fn inspect_ytdlp(payload: &Value) -> ApiResult<Value> {
    let url = required_string(payload, "url", 4096)?;
    validate_http_url(&url)?;
    let playlist = payload
        .get("playlist")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let output_path =
        std::env::temp_dir().join(format!("misty-ytdlp-inspect-{}.json", Uuid::new_v4()));
    let output_file = fs::File::create(&output_path).map_err(|error| {
        ApiError::Message(format!("Could not prepare media inspection: {error}"))
    })?;
    let mut command = Command::new("yt-dlp");
    command.args(["--no-config", "--dump-single-json", "--no-warnings"]);
    if playlist {
        command.args(["--flat-playlist", "--playlist-end", "100"]);
    } else {
        command.arg("--no-playlist");
    }
    let mut child = command
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::from(output_file))
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| ApiError::Message(format!("Could not run yt-dlp: {error}")))?;
    let deadline = Instant::now() + Duration::from_secs(30);
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| ApiError::Message(format!("Could not inspect media: {error}")))?
        {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_file(&output_path);
            return Err(ApiError::Message(
                "Media inspection timed out after 30 seconds.".to_owned(),
            ));
        }
        thread::sleep(Duration::from_millis(100));
    };
    if !status.success() {
        let _ = fs::remove_file(&output_path);
        return Err(ApiError::Message(
            "yt-dlp could not read that URL.".to_owned(),
        ));
    }
    let metadata = fs::metadata(&output_path)
        .map_err(|error| ApiError::Message(format!("Could not read media information: {error}")))?;
    if metadata.len() > 8 * 1024 * 1024 {
        let _ = fs::remove_file(&output_path);
        return Err(ApiError::Message(
            "The media response was unexpectedly large.".to_owned(),
        ));
    }
    let bytes = fs::read(&output_path)
        .map_err(|error| ApiError::Message(format!("Could not read media information: {error}")))?;
    let _ = fs::remove_file(&output_path);
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| ApiError::Message("yt-dlp returned invalid media information.".to_owned()))?;
    let count = value.get("entries").and_then(Value::as_array).map(Vec::len);
    let duration = value
        .get("duration_string")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    Ok(json!({ "ok": true, "info": {
        "title": value.get("title").and_then(Value::as_str).unwrap_or("Untitled media"),
        "uploader": value.get("uploader").or_else(|| value.get("channel")).and_then(Value::as_str),
        "duration": duration,
        "thumbnail": value.get("thumbnail").and_then(Value::as_str),
        "playlistCount": count
    }}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_non_public_urls() {
        assert!(validate_http_url("file:///etc/passwd").is_err());
        assert!(validate_http_url("http://127.0.0.1/video").is_err());
        assert!(validate_http_url("http://[::1]/video").is_err());
        assert!(validate_http_url("http://router.local/video").is_err());
        assert!(validate_http_url("https://user:secret@example.com/a").is_err());
        assert!(validate_http_url("https://example.com/a").is_ok());
    }
    #[test]
    fn parses_bounded_ytdlp_progress() {
        assert_eq!(progress_percent("[download]  42.5% of 10MiB"), Some(42.5));
        assert_eq!(progress_percent("[download] 120%"), Some(100.0));
    }
    #[test]
    fn scopes_commands_by_plugin() {
        assert!(validate_command_scope("ytdlp", "quick_convert.start").is_err());
        assert!(validate_command_scope("quick_convert", "quick_convert.start").is_ok());
    }
    #[test]
    fn creates_collision_safe_names() {
        let root = std::env::temp_dir().join(format!("misty-ext-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("demo.mov");
        fs::write(&source, b"x").unwrap();
        let first = collision_safe_output(&source, &root, "mp4");
        assert!(first.ends_with("demo_converted.mp4"));
        fs::write(&first, b"x").unwrap();
        assert!(collision_safe_output(&source, &root, "mp4").ends_with("demo_converted (2).mp4"));
        let _ = fs::remove_dir_all(root);
    }
    #[test]
    fn quick_convert_job_converts_a_real_fixture_when_ffmpeg_is_available() {
        if Command::new("ffmpeg")
            .arg("-version")
            .output()
            .map(|output| !output.status.success())
            .unwrap_or(true)
        {
            return;
        }
        let root = std::env::temp_dir().join(format!("misty-ext-convert-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("pixel.ppm");
        fs::write(&source, b"P3\n1 1\n255\n255 0 0\n").unwrap();
        let jobs = Arc::new(Mutex::new(HashMap::new()));
        let id = "fixture".to_owned();
        jobs.lock().unwrap().insert(
            id.clone(),
            ExtensionJob {
                snapshot: ExtensionJobSnapshot {
                    id: id.clone(),
                    status: "queued".to_owned(),
                    progress: Some(0.0),
                    message: String::new(),
                    output_paths: Vec::new(),
                    error: None,
                },
                cancel: Arc::new(AtomicBool::new(false)),
            },
        );
        run_quick_convert_job(
            jobs.clone(),
            id.clone(),
            Arc::new(AtomicBool::new(false)),
            vec![source],
            "png".to_owned(),
            "balanced".to_owned(),
            "source".to_owned(),
            root.clone(),
        );
        let snapshot = jobs.lock().unwrap().get(&id).unwrap().snapshot.clone();
        assert_eq!(snapshot.status, "completed");
        assert_eq!(snapshot.output_paths.len(), 1);
        assert!(Path::new(&snapshot.output_paths[0]).is_file());
        let _ = fs::remove_dir_all(root);
    }
}
