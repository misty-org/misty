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
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult},
    infra::{
        devices::DeviceService,
        environment::AppEnvironmentService,
        extension_reporting::scan_storage,
        extension_tools::ExtensionToolResolver,
        keychain::{
            backup_repository_password, generate_backup_repository_password,
            store_backup_repository_password,
        },
        storage_runtime::StorageRuntimeService,
    },
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
    pub plugin_id: String,
    pub status: String,
    pub progress: Option<f64>,
    pub message: String,
    pub output_paths: Vec<String>,
    pub error: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub completed_at: Option<u64>,
    pub result: Option<Value>,
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
    tools: ExtensionToolResolver,
    backup_state_path: PathBuf,
    storage_runtime: StorageRuntimeService,
}

impl ExtensionRuntimeService {
    pub fn new(environment: AppEnvironmentService) -> Self {
        let storage_runtime = StorageRuntimeService::start(&environment);
        Self::new_with_storage_runtime(environment, storage_runtime)
    }

    pub fn new_with_storage_runtime(
        environment: AppEnvironmentService,
        storage_runtime: StorageRuntimeService,
    ) -> Self {
        let tools = ExtensionToolResolver::new(&environment);
        let backup_state_path = environment
            .settings_path()
            .parent()
            .unwrap_or(Path::new("."))
            .join("backups.json");
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
            home_dir: environment.home_dir(),
            cache_dir: environment.cache_dir().join("extension-jobs"),
            tools,
            backup_state_path,
            storage_runtime,
        }
    }

    pub async fn execute(&self, request: ExtensionCommandRequest) -> ApiResult<Value> {
        validate_command_scope(&request.plugin_id, &request.command)?;
        match request.command.as_str() {
            "dependencies.check" => {
                dependency_check(&request.plugin_id, &request.payload, &self.tools)
            }
            "quick_convert.start" => self.start_quick_convert(&request.plugin_id, &request.payload),
            "storage_report.start" => {
                self.start_storage_report(&request.plugin_id, &request.payload)
            }
            "image_optimizer.start" => {
                self.start_image_optimizer(&request.plugin_id, &request.payload)
            }
            "backups.repositories" => self.backup_repositories(),
            "backups.repository.init" => self.initialize_backup_repository(&request.payload),
            "backups.snapshots" => self.backup_snapshots(&request.payload),
            "backups.start" => {
                self.start_backup_job(&request.plugin_id, &request.payload, "backup")
            }
            "backups.check" => self.start_backup_job(&request.plugin_id, &request.payload, "check"),
            "backups.restore" => {
                self.start_backup_job(&request.plugin_id, &request.payload, "restore")
            }
            "ytdlp.start" => self.start_ytdlp(&request.plugin_id, &request.payload),
            "ytdlp.inspect" => {
                let payload = request.payload;
                let executable = self.tools.resolve(&request.plugin_id, "yt-dlp")?;
                tokio::task::spawn_blocking(move || inspect_ytdlp(&payload, &executable))
                    .await
                    .map_err(|error| {
                        ApiError::Message(format!("yt-dlp inspector stopped: {error}"))
                    })?
            }
            "jobs.status" => self.job_status(&request.plugin_id, &request.payload),
            "jobs.latest" => self.latest_job(&request.plugin_id),
            "jobs.cancel" => self.cancel_job(&request.plugin_id, &request.payload),
            "host.revealOutput" => self.reveal_output(&request.plugin_id, &request.payload),
            _ => Err(ApiError::Message(
                "Extension command is not allowlisted.".to_owned(),
            )),
        }
    }

    fn job_status(&self, plugin_id: &str, payload: &Value) -> ApiResult<Value> {
        let id = required_string(payload, "jobId", 128)?;
        let jobs = self
            .jobs
            .lock()
            .map_err(|_| ApiError::Message("Extension job state is unavailable.".to_owned()))?;
        let job = jobs
            .get(&id)
            .ok_or_else(|| ApiError::Message("Extension job was not found.".to_owned()))?;
        require_job_owner(job, plugin_id)?;
        serde_json::to_value(&job.snapshot).map_err(|error| ApiError::Message(error.to_string()))
    }

    fn latest_job(&self, plugin_id: &str) -> ApiResult<Value> {
        let jobs = self
            .jobs
            .lock()
            .map_err(|_| ApiError::Message("Extension job state is unavailable.".to_owned()))?;
        let latest = jobs
            .values()
            .filter(|job| job.snapshot.plugin_id == plugin_id)
            .max_by_key(|job| job.snapshot.created_at)
            .map(|job| job.snapshot.clone());
        serde_json::to_value(latest).map_err(|error| ApiError::Message(error.to_string()))
    }

    fn cancel_job(&self, plugin_id: &str, payload: &Value) -> ApiResult<Value> {
        let id = required_string(payload, "jobId", 128)?;
        let mut jobs = self
            .jobs
            .lock()
            .map_err(|_| ApiError::Message("Extension job state is unavailable.".to_owned()))?;
        let job = jobs
            .get_mut(&id)
            .ok_or_else(|| ApiError::Message("Extension job was not found.".to_owned()))?;
        require_job_owner(job, plugin_id)?;
        if matches!(job.snapshot.status.as_str(), "queued" | "running") {
            job.cancel.store(true, Ordering::Relaxed);
            job.snapshot.message = "Cancelling…".to_owned();
        }
        Ok(json!({ "ok": true }))
    }

    fn reveal_output(&self, plugin_id: &str, payload: &Value) -> ApiResult<Value> {
        let id = required_string(payload, "jobId", 128)?;
        let jobs = self
            .jobs
            .lock()
            .map_err(|_| ApiError::Message("Extension job state is unavailable.".to_owned()))?;
        let job = jobs
            .get(&id)
            .ok_or_else(|| ApiError::Message("Extension job was not found.".to_owned()))?;
        require_job_owner(job, plugin_id)?;
        let output = job
            .snapshot
            .output_paths
            .first()
            .ok_or_else(|| ApiError::Message("This job has no output to reveal.".to_owned()))?;
        let path = fs::canonicalize(output)
            .map_err(|_| ApiError::Message("The output no longer exists.".to_owned()))?;
        reveal_path(&path)?;
        Ok(json!({ "ok": true }))
    }

    fn start_quick_convert(&self, plugin_id: &str, payload: &Value) -> ApiResult<Value> {
        let executable = self.tools.resolve(plugin_id, "ffmpeg")?;
        let paths = safe_input_paths(payload)?;
        let format = allowed_string(payload, "format", QUICK_FORMATS)?;
        let quality = allowed_string(payload, "quality", &["small", "balanced", "high"])?;
        let destination = allowed_string(payload, "destination", &["source", "downloads"])?;
        let id = Uuid::new_v4().to_string();
        let cancel = Arc::new(AtomicBool::new(false));
        self.insert_job(
            &id,
            plugin_id,
            cancel.clone(),
            format!("Queued {} file(s)…", paths.len()),
        )?;
        let jobs = self.jobs.clone();
        let home_dir = self.home_dir.clone();
        let job_id = id.clone();
        thread::spawn(move || {
            run_quick_convert_job(
                ExtensionJobExecution {
                    jobs,
                    id: job_id,
                    cancel,
                },
                QuickConvertJob {
                    paths,
                    format,
                    quality,
                    destination,
                    home_dir,
                    executable,
                },
            )
        });
        Ok(json!({ "ok": true, "jobId": id, "message": "Conversion queued." }))
    }

    fn start_ytdlp(&self, plugin_id: &str, payload: &Value) -> ApiResult<Value> {
        let executable = self.tools.resolve(plugin_id, "yt-dlp")?;
        let ffmpeg = self.tools.resolve(plugin_id, "ffmpeg")?;
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
        self.insert_job(
            &id,
            plugin_id,
            cancel.clone(),
            "Download queued…".to_owned(),
        )?;
        let jobs = self.jobs.clone();
        let job_id = id.clone();
        thread::spawn(move || {
            run_ytdlp_job(
                ExtensionJobExecution {
                    jobs,
                    id: job_id,
                    cancel,
                },
                MediaDownloadJob {
                    url,
                    format,
                    playlist,
                    staging_dir,
                    output_dir,
                    output_log,
                    executable,
                    ffmpeg_location: ffmpeg.parent().unwrap_or(ffmpeg.as_path()).to_path_buf(),
                },
            )
        });
        Ok(json!({ "ok": true, "jobId": id, "message": "Download queued." }))
    }

    fn start_storage_report(&self, plugin_id: &str, payload: &Value) -> ApiResult<Value> {
        let raw = required_string(payload, "root", 16_384)?;
        let root = fs::canonicalize(&raw)
            .map_err(|_| ApiError::Message("Selected folder does not exist.".to_owned()))?;
        if !root.is_dir() {
            return Err(ApiError::Message(
                "Storage Report requires one local folder.".to_owned(),
            ));
        }
        let id = Uuid::new_v4().to_string();
        let cancel = Arc::new(AtomicBool::new(false));
        self.insert_job(
            &id,
            plugin_id,
            cancel.clone(),
            "Scanning folder…".to_owned(),
        )?;
        let jobs = self.jobs.clone();
        let job_id = id.clone();
        thread::spawn(move || {
            update_job(&jobs, &job_id, |job| {
                job.status = "running".to_owned();
                job.progress = None;
            });
            match scan_storage(&root, &cancel) {
                Ok(result) => update_job(&jobs, &job_id, |job| {
                    job.status = "completed".to_owned();
                    job.progress = Some(100.0);
                    job.message = "Storage report ready.".to_owned();
                    job.result = Some(result);
                }),
                Err(error) if cancel.load(Ordering::Relaxed) => {
                    finish_cancelled(&jobs, &job_id, Vec::new())
                }
                Err(error) => finish_failed(&jobs, &job_id, error.to_string(), Vec::new()),
            }
        });
        Ok(json!({"ok":true,"jobId":id,"message":"Folder scan started."}))
    }

    fn start_image_optimizer(&self, plugin_id: &str, payload: &Value) -> ApiResult<Value> {
        let executable = self.tools.resolve(plugin_id, "ffmpeg")?;
        let paths = safe_input_paths(payload)?;
        if paths.iter().any(|path| {
            !matches!(
                path.extension()
                    .and_then(|value| value.to_str())
                    .map(str::to_ascii_lowercase)
                    .as_deref(),
                Some("jpg" | "jpeg" | "png" | "webp")
            )
        }) {
            return Err(ApiError::Message(
                "Only JPEG, PNG, and WebP images are supported.".to_owned(),
            ));
        }
        let quality = allowed_string(payload, "quality", &["small", "balanced", "high"])?;
        let destination = allowed_string(payload, "destination", &["beside", "downloads"])?;
        let max_dimension = allowed_string(
            payload,
            "maxDimension",
            &["original", "3840", "2560", "1920", "1280"],
        )?;
        let id = Uuid::new_v4().to_string();
        let cancel = Arc::new(AtomicBool::new(false));
        self.insert_job(
            &id,
            plugin_id,
            cancel.clone(),
            format!("Queued {} image(s)…", paths.len()),
        )?;
        let jobs = self.jobs.clone();
        let home = self.home_dir.clone();
        let job_id = id.clone();
        thread::spawn(move || {
            run_image_optimizer_job(
                ExtensionJobExecution {
                    jobs,
                    id: job_id,
                    cancel,
                },
                ImageOptimizationJob {
                    paths,
                    quality,
                    max_dimension,
                    destination,
                    home_dir: home,
                    executable,
                },
            )
        });
        Ok(json!({"ok":true,"jobId":id,"message":"Image optimization queued."}))
    }

    fn backup_repositories(&self) -> ApiResult<Value> {
        let repositories = read_backup_repositories(&self.backup_state_path)?;
        let devices = DeviceService::new().snapshot().devices;
        let cloud_remotes = connected_cloud_remotes(&self.storage_runtime);
        let rows=repositories.into_iter().map(|repo| { let available=if repo.kind=="cloud" { cloud_repository_identity(&repo).map(|(remote,_)|cloud_remotes.contains(&remote)).unwrap_or(false) } else { resolved_repository_location(&repo).is_ok() }; json!({"id":repo.id,"name":repo.name,"kind":repo.kind,"location":repo.display_location,"available":available,"initialized":true,"lastBackup":repo.last_backup}) }).collect::<Vec<_>>();
        Ok(
            json!({"ok":true,"repositories":rows,"devices":devices,"cloudRemotes":cloud_remotes,"message":if rows.is_empty(){"Set up a repository to create your first backup."}else{"Backup repositories are ready."}}),
        )
    }

    fn initialize_backup_repository(&self, payload: &Value) -> ApiResult<Value> {
        let kind = allowed_string(payload, "kind", &["local", "cloud"])?;
        let name = required_string(payload, "name", 64)?;
        let location = required_string(payload, "location", 16_384)?;
        let id = Uuid::new_v4().to_string();
        let (normalized, display_location, volume_id, relative_path, cloud_remote, cloud_path) =
            if kind == "local" {
                let normalized = validate_local_repository_location(&location)?;
                let (volume_id, relative_path) = local_repository_identity(Path::new(&normalized))?;
                (
                    normalized.clone(),
                    normalized,
                    volume_id,
                    relative_path,
                    String::new(),
                    String::new(),
                )
            } else {
                let (remote, path) = validate_cloud_repository_location(&location)?;
                if !connected_cloud_remotes(&self.storage_runtime).contains(&remote) {
                    return Err(ApiError::Message(
                        "Choose a cloud connection already connected through Misty.".to_owned(),
                    ));
                }
                let cache = cloud_repository_cache(&self.cache_dir, &id);
                fs::create_dir_all(&cache).map_err(|error| {
                    ApiError::Message(format!("Could not prepare the cloud backup cache: {error}"))
                })?;
                (
                    cache.display().to_string(),
                    format!("{remote}:{path}"),
                    String::new(),
                    String::new(),
                    remote,
                    path,
                )
            };
        let password = generate_backup_repository_password();
        let restic = self.tools.resolve("backups", "restic")?;
        let repository = StoredBackupRepository {
            id: id.clone(),
            name,
            kind: kind.clone(),
            location: normalized.clone(),
            display_location,
            last_backup: None,
            volume_id,
            relative_path,
            cloud_remote,
            cloud_path,
        };
        let mut command = restic_command(&restic, &repository, &password);
        command.arg("init");
        run_checked_command(&mut command, "initialize the backup repository")?;
        if kind == "cloud" {
            mirror_cloud_repository_to_provider(&self.storage_runtime, &repository)?;
        }
        store_backup_repository_password(&id, &password)?;
        let mut repositories = read_backup_repositories(&self.backup_state_path)?;
        repositories.push(repository);
        write_backup_repositories(&self.backup_state_path, &repositories)?;
        Ok(
            json!({"ok":true,"repositoryId":id,"message":"Encrypted backup repository initialized."}),
        )
    }

    fn backup_snapshots(&self, payload: &Value) -> ApiResult<Value> {
        let repository =
            required_backup_repository(&self.backup_state_path, &self.cache_dir, payload)?;
        mirror_cloud_repository_to_local(&self.storage_runtime, &repository)?;
        let password = backup_repository_password(&repository.id)?.ok_or_else(|| {
            ApiError::Message("Backup credential is missing from the OS vault.".to_owned())
        })?;
        let restic = self.tools.resolve("backups", "restic")?;
        let mut command = restic_command(&restic, &repository, &password);
        command.args(["snapshots", "--json"]);
        let output = command
            .output()
            .map_err(|error| ApiError::Message(format!("Could not list snapshots: {error}")))?;
        if !output.status.success() {
            return Err(redacted_command_error(
                "Could not list snapshots",
                &output.stderr,
            ));
        }
        let snapshots: Value = serde_json::from_slice(&output.stdout)
            .map_err(|_| ApiError::Message("Restic returned invalid snapshot data.".to_owned()))?;
        Ok(json!({"ok":true,"snapshots":snapshots}))
    }

    fn start_backup_job(
        &self,
        plugin_id: &str,
        payload: &Value,
        operation: &str,
    ) -> ApiResult<Value> {
        let repository =
            required_backup_repository(&self.backup_state_path, &self.cache_dir, payload)?;
        let password = backup_repository_password(&repository.id)?.ok_or_else(|| {
            ApiError::Message("Backup credential is missing from the OS vault.".to_owned())
        })?;
        let restic = self.tools.resolve("backups", "restic")?;
        let sources = if operation == "backup" {
            safe_source_folders(payload)?
        } else {
            Vec::new()
        };
        let snapshot_id = if operation == "restore" {
            Some(required_string(payload, "snapshotId", 128)?)
        } else {
            None
        };
        let restore_parent = payload
            .get("destination")
            .and_then(Value::as_str)
            .map(PathBuf::from)
            .or_else(dirs::download_dir)
            .unwrap_or_else(|| self.home_dir.join("Downloads"));
        let id = Uuid::new_v4().to_string();
        let cancel = Arc::new(AtomicBool::new(false));
        self.insert_job(
            &id,
            plugin_id,
            cancel.clone(),
            format!(
                "{} queued…",
                if operation == "check" {
                    "Verification"
                } else if operation == "restore" {
                    "Restore"
                } else {
                    "Backup"
                }
            ),
        )?;
        let jobs = self.jobs.clone();
        let job_id = id.clone();
        let operation = operation.to_owned();
        let state_path = self.backup_state_path.clone();
        let storage_runtime = self.storage_runtime.clone();
        thread::spawn(move || {
            run_restic_job(
                jobs,
                job_id,
                cancel,
                operation,
                repository,
                password,
                restic,
                sources,
                snapshot_id,
                restore_parent,
                state_path,
                storage_runtime,
            )
        });
        Ok(json!({"ok":true,"jobId":id,"message":"Backup operation queued."}))
    }

    fn insert_job(
        &self,
        id: &str,
        plugin_id: &str,
        cancel: Arc<AtomicBool>,
        message: String,
    ) -> ApiResult<()> {
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
        let now = unix_timestamp_ms();
        jobs.insert(
            id.to_owned(),
            ExtensionJob {
                snapshot: ExtensionJobSnapshot {
                    id: id.to_owned(),
                    plugin_id: plugin_id.to_owned(),
                    status: "queued".to_owned(),
                    progress: Some(0.0),
                    message,
                    output_paths: Vec::new(),
                    error: None,
                    created_at: now,
                    updated_at: now,
                    completed_at: None,
                    result: None,
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
                | "jobs.latest"
                | "jobs.cancel"
                | "host.revealOutput"
        ),
        "ytdlp" => matches!(
            command,
            "dependencies.check"
                | "ytdlp.start"
                | "ytdlp.inspect"
                | "jobs.status"
                | "jobs.latest"
                | "jobs.cancel"
                | "host.revealOutput"
        ),
        "storage_report" => matches!(
            command,
            "storage_report.start" | "jobs.status" | "jobs.latest" | "jobs.cancel"
        ),
        "image_optimizer" => matches!(
            command,
            "image_optimizer.start"
                | "jobs.status"
                | "jobs.latest"
                | "jobs.cancel"
                | "host.revealOutput"
        ),
        "backups" => matches!(
            command,
            "backups.repositories"
                | "backups.repository.init"
                | "backups.start"
                | "backups.snapshots"
                | "backups.check"
                | "backups.restore"
                | "jobs.status"
                | "jobs.latest"
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

fn dependency_check(
    plugin_id: &str,
    payload: &Value,
    tools: &ExtensionToolResolver,
) -> ApiResult<Value> {
    let requested = allowed_string(payload, "name", &["ffmpeg", "ffprobe", "yt-dlp", "restic"])?;
    let executable = match tools.resolve(plugin_id, &requested) {
        Ok(value) => value,
        Err(_) => return Ok(json!({ "ok": true, "available": false, "version": "" })),
    };
    let output = Command::new(&executable)
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

fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn require_job_owner(job: &ExtensionJob, plugin_id: &str) -> ApiResult<()> {
    if job.snapshot.plugin_id == plugin_id {
        Ok(())
    } else {
        Err(ApiError::Message(
            "This extension does not own the requested job.".to_owned(),
        ))
    }
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
            let now = unix_timestamp_ms();
            job.snapshot.updated_at = now;
            if matches!(
                job.snapshot.status.as_str(),
                "completed" | "failed" | "cancelled"
            ) {
                job.snapshot.completed_at.get_or_insert(now);
            }
        }
    }
}

struct ExtensionJobExecution {
    jobs: Arc<Mutex<HashMap<String, ExtensionJob>>>,
    id: String,
    cancel: Arc<AtomicBool>,
}

struct QuickConvertJob {
    paths: Vec<PathBuf>,
    format: String,
    quality: String,
    destination: String,
    home_dir: PathBuf,
    executable: PathBuf,
}

struct ImageOptimizationJob {
    paths: Vec<PathBuf>,
    quality: String,
    max_dimension: String,
    destination: String,
    home_dir: PathBuf,
    executable: PathBuf,
}

struct MediaDownloadJob {
    url: String,
    format: String,
    playlist: bool,
    staging_dir: PathBuf,
    output_dir: PathBuf,
    output_log: PathBuf,
    executable: PathBuf,
    ffmpeg_location: PathBuf,
}

fn run_quick_convert_job(execution: ExtensionJobExecution, request: QuickConvertJob) {
    let ExtensionJobExecution { jobs, id, cancel } = execution;
    let QuickConvertJob {
        paths,
        format,
        quality,
        destination,
        home_dir,
        executable,
    } = request;
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
        let mut command = Command::new(&executable);
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

fn run_image_optimizer_job(execution: ExtensionJobExecution, request: ImageOptimizationJob) {
    let ExtensionJobExecution { jobs, id, cancel } = execution;
    let ImageOptimizationJob {
        paths,
        quality,
        max_dimension,
        destination,
        home_dir,
        executable,
    } = request;
    update_job(&jobs, &id, |job| {
        job.status = "running".to_owned();
        job.message = "Preparing images…".to_owned();
    });
    let mut outputs = Vec::new();
    let mut outcomes = Vec::new();
    let mut original_total = 0_u64;
    let mut output_total = 0_u64;
    for (index, source) in paths.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            for output in &outputs {
                let _ = fs::remove_file(output);
            }
            finish_cancelled(&jobs, &id, Vec::new());
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
        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("jpg");
        let output = collision_safe_optimized_output(source, &directory, extension);
        let original = fs::metadata(source).map(|value| value.len()).unwrap_or(0);
        original_total = original_total.saturating_add(original);
        update_job(&jobs, &id, |job| {
            job.progress = Some(index as f64 / paths.len() as f64 * 100.0);
            job.message = format!("Optimizing {} of {}…", index + 1, paths.len());
        });
        let mut command = Command::new(&executable);
        command
            .args(["-nostdin", "-hide_banner", "-loglevel", "error", "-n", "-i"])
            .arg(source);
        if max_dimension != "original" {
            command.args(["-vf",&format!("scale='min({max_dimension},iw)':'min({max_dimension},ih)':force_original_aspect_ratio=decrease")]);
        }
        match extension.to_ascii_lowercase().as_str() {
            "jpg" | "jpeg" => {
                command.args([
                    "-q:v",
                    if quality == "high" {
                        "2"
                    } else if quality == "small" {
                        "7"
                    } else {
                        "4"
                    },
                ]);
            }
            "png" => {
                command.args([
                    "-compression_level",
                    if quality == "small" { "9" } else { "7" },
                ]);
            }
            "webp" => {
                command.args([
                    "-quality",
                    if quality == "high" {
                        "88"
                    } else if quality == "small" {
                        "68"
                    } else {
                        "78"
                    },
                ]);
            }
            _ => {}
        }
        command
            .arg(&output)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        match command
            .spawn()
            .and_then(|mut child| wait_for_child(&mut child, &cancel))
        {
            Ok(Some(status)) if status.success() => {
                let optimized = fs::metadata(&output).map(|value| value.len()).unwrap_or(0);
                output_total = output_total.saturating_add(optimized);
                outputs.push(output.display().to_string());
                outcomes.push(json!({"source":source.display().to_string(),"output":output.display().to_string(),"originalBytes":original,"outputBytes":optimized,"status":"completed"}));
            }
            Ok(None) => {
                let _ = fs::remove_file(&output);
                for path in &outputs {
                    let _ = fs::remove_file(path);
                }
                finish_cancelled(&jobs, &id, Vec::new());
                return;
            }
            Ok(Some(status)) => {
                let _ = fs::remove_file(&output);
                outcomes.push(json!({"source":source.display().to_string(),"originalBytes":original,"status":"failed","message":format!("FFmpeg exited with {status}.")}));
            }
            Err(error) => {
                let _ = fs::remove_file(&output);
                outcomes.push(json!({"source":source.display().to_string(),"originalBytes":original,"status":"failed","message":format!("Could not run FFmpeg: {error}")}));
            }
        }
    }
    let completed = outputs.len();
    update_job(&jobs, &id, |job| {
        job.status = if completed > 0 { "completed" } else { "failed" }.to_owned();
        job.progress = Some(100.0);
        job.message = format!("Optimized {completed} of {} image(s).", paths.len());
        job.output_paths = outputs;
        job.result = Some(
            json!({"originalBytes":original_total,"outputBytes":output_total,"files":outcomes}),
        );
        if completed == 0 {
            job.error = Some("No images could be optimized.".to_owned());
        }
    });
}

fn collision_safe_optimized_output(source: &Path, directory: &Path, extension: &str) -> PathBuf {
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    for suffix in 1..10_000 {
        let name = if suffix == 1 {
            format!("{stem}_optimized.{extension}")
        } else {
            format!("{stem}_optimized ({suffix}).{extension}")
        };
        let candidate = directory.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{stem}_optimized-{}.{}", Uuid::new_v4(), extension))
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

fn run_ytdlp_job(execution: ExtensionJobExecution, request: MediaDownloadJob) {
    let ExtensionJobExecution { jobs, id, cancel } = execution;
    let MediaDownloadJob {
        url,
        format,
        playlist,
        staging_dir,
        output_dir,
        output_log,
        executable,
        ffmpeg_location,
    } = request;
    update_job(&jobs, &id, |job| {
        job.status = "running".to_owned();
        job.progress = None;
        job.message = "Downloading media…".to_owned();
    });
    let mut command = Command::new(executable);
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
    command.arg("--ffmpeg-location").arg(ffmpeg_location);
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

fn inspect_ytdlp(payload: &Value, executable: &Path) -> ApiResult<Value> {
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
    let mut command = Command::new(executable);
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredBackupRepository {
    id: String,
    name: String,
    kind: String,
    location: String,
    display_location: String,
    last_backup: Option<String>,
    #[serde(default)]
    volume_id: String,
    #[serde(default)]
    relative_path: String,
    #[serde(default)]
    cloud_remote: String,
    #[serde(default)]
    cloud_path: String,
}

fn read_backup_repositories(path: &Path) -> ApiResult<Vec<StoredBackupRepository>> {
    if !path.is_file() {
        return Ok(Vec::new());
    }
    serde_json::from_slice(
        &fs::read(path).map_err(|error| {
            ApiError::Message(format!("Could not read backup settings: {error}"))
        })?,
    )
    .map_err(|_| ApiError::Message("Backup settings are invalid.".to_owned()))
}
fn write_backup_repositories(
    path: &Path,
    repositories: &[StoredBackupRepository],
) -> ApiResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            ApiError::Message(format!("Could not prepare backup settings: {error}"))
        })?;
    }
    let temporary = path.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(repositories)
            .map_err(|error| ApiError::Message(error.to_string()))?,
    )
    .map_err(|error| ApiError::Message(format!("Could not save backup settings: {error}")))?;
    fs::rename(temporary, path)
        .map_err(|error| ApiError::Message(format!("Could not commit backup settings: {error}")))
}
fn required_backup_repository(
    path: &Path,
    cache_dir: &Path,
    payload: &Value,
) -> ApiResult<StoredBackupRepository> {
    let id = required_string(payload, "repositoryId", 128)?;
    let mut repository = read_backup_repositories(path)?
        .into_iter()
        .find(|repo| repo.id == id)
        .ok_or_else(|| ApiError::Message("Backup repository was not found.".to_owned()))?;
    if repository.kind == "cloud" {
        let (remote, cloud_path) = cloud_repository_identity(&repository)?;
        repository.cloud_remote = remote;
        repository.cloud_path = cloud_path;
        let cache = cloud_repository_cache(cache_dir, &repository.id);
        fs::create_dir_all(&cache).map_err(|error| {
            ApiError::Message(format!("Could not prepare the cloud backup cache: {error}"))
        })?;
        repository.location = cache.display().to_string();
    } else {
        repository.location = resolved_repository_location(&repository)?
            .display()
            .to_string();
    }
    Ok(repository)
}

fn local_repository_identity(path: &Path) -> ApiResult<(String, String)> {
    let canonical = fs::canonicalize(path)
        .map_err(|_| ApiError::Message("Could not identify the repository volume.".to_owned()))?;
    let device = DeviceService::new()
        .snapshot()
        .devices
        .into_iter()
        .filter(|device| canonical.starts_with(&device.mount_path))
        .max_by_key(|device| device.mount_path.len())
        .ok_or_else(|| ApiError::Message("Repository volume is unavailable.".to_owned()))?;
    let relative = canonical
        .strip_prefix(&device.mount_path)
        .map_err(|_| ApiError::Message("Repository path is outside its volume.".to_owned()))?
        .display()
        .to_string();
    Ok((device.volume_id, relative))
}

fn resolved_repository_location(repository: &StoredBackupRepository) -> ApiResult<PathBuf> {
    if repository.kind != "local" {
        return Ok(PathBuf::from(&repository.location));
    }
    if repository.volume_id.is_empty() {
        return fs::canonicalize(&repository.location)
            .map_err(|_| ApiError::Message("Repository volume is disconnected.".to_owned()));
    }
    let device = DeviceService::new()
        .snapshot()
        .devices
        .into_iter()
        .find(|device| {
            device.volume_id == repository.volume_id
                && device.writable
                && !device.is_system
                && !device.is_network
        })
        .ok_or_else(|| {
            ApiError::Message("Repository volume is disconnected or no longer writable.".to_owned())
        })?;
    let candidate = PathBuf::from(&device.mount_path).join(&repository.relative_path);
    let canonical = fs::canonicalize(candidate)
        .map_err(|_| ApiError::Message("Repository folder is unavailable.".to_owned()))?;
    if !canonical.starts_with(&device.mount_path) {
        return Err(ApiError::Message(
            "Repository path escaped its volume.".to_owned(),
        ));
    }
    Ok(canonical)
}

fn validate_local_repository_location(raw: &str) -> ApiResult<String> {
    let path = fs::canonicalize(raw).map_err(|_| {
        ApiError::Message("Choose an existing folder on a writable non-system volume.".to_owned())
    })?;
    if !path.is_dir() {
        return Err(ApiError::Message(
            "Backup destination must be a folder.".to_owned(),
        ));
    }
    let device = DeviceService::new()
        .snapshot()
        .devices
        .into_iter()
        .filter(|device| path.starts_with(&device.mount_path))
        .max_by_key(|device| device.mount_path.len())
        .ok_or_else(|| {
            ApiError::Message("Backup destination is not on a recognized volume.".to_owned())
        })?;
    if device.is_system || device.is_network || !device.writable {
        return Err(ApiError::Message("Choose a writable local non-system volume. OS, network, and read-only volumes are not allowed.".to_owned()));
    }
    let target = path.join("Misty Backups");
    fs::create_dir_all(&target).map_err(|error| {
        ApiError::Message(format!("Could not create the repository folder: {error}"))
    })?;
    let canonical = fs::canonicalize(&target)
        .map_err(|_| ApiError::Message("Could not verify the repository folder.".to_owned()))?;
    if !canonical.starts_with(&path) {
        return Err(ApiError::Message(
            "Repository path escaped the selected volume.".to_owned(),
        ));
    }
    Ok(canonical.display().to_string())
}

fn validate_cloud_repository_location(raw: &str) -> ApiResult<(String, String)> {
    let value = raw.trim();
    let (remote, path) = value.split_once(':').ok_or_else(|| {
        ApiError::Message("Choose a configured Misty cloud connection.".to_owned())
    })?;
    let path = path.trim_matches('/');
    if remote.is_empty()
        || path.is_empty()
        || !remote
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        || path.split('/').any(|part| part == ".." || part == ".")
    {
        return Err(ApiError::Message(
            "Cloud repository identity or subpath is invalid.".to_owned(),
        ));
    }
    Ok((remote.to_owned(), path.to_owned()))
}

fn connected_cloud_remotes(storage: &StorageRuntimeService) -> Vec<String> {
    storage
        .call("config/dump", json!({}))
        .ok()
        .and_then(|value| value.as_object().cloned())
        .map(|entries| {
            entries
                .into_iter()
                .filter_map(|(name, config)| {
                    let supported = matches!(
                        config.get("type").and_then(Value::as_str),
                        Some("drive" | "dropbox" | "onedrive")
                    );
                    let authorized = ["access_token", "token"].iter().any(|key| {
                        config
                            .get(*key)
                            .and_then(Value::as_str)
                            .is_some_and(|value| !value.trim().is_empty())
                    });
                    (supported && authorized).then_some(name)
                })
                .take(32)
                .collect()
        })
        .unwrap_or_default()
}

fn cloud_repository_identity(repository: &StoredBackupRepository) -> ApiResult<(String, String)> {
    if !repository.cloud_remote.is_empty() && !repository.cloud_path.is_empty() {
        return Ok((
            repository.cloud_remote.clone(),
            repository.cloud_path.clone(),
        ));
    }
    // Migrate repositories created by the former transport without requiring
    // that transport to remain installed.
    let legacy = repository
        .location
        .strip_prefix("rclone:")
        .unwrap_or(&repository.location);
    validate_cloud_repository_location(legacy)
}

fn cloud_repository_cache(cache_dir: &Path, repository_id: &str) -> PathBuf {
    cache_dir.join("backup-repositories").join(repository_id)
}

fn mirror_cloud_repository_to_local(
    storage: &StorageRuntimeService,
    repository: &StoredBackupRepository,
) -> ApiResult<()> {
    if repository.kind != "cloud" {
        return Ok(());
    }
    let local = PathBuf::from(&repository.location);
    if local.exists() {
        fs::remove_dir_all(&local).map_err(|error| {
            ApiError::Message(format!("Could not refresh the cloud backup cache: {error}"))
        })?;
    }
    fs::create_dir_all(&local).map_err(|error| {
        ApiError::Message(format!("Could not prepare the cloud backup cache: {error}"))
    })?;
    let (remote, path) = cloud_repository_identity(repository)?;
    storage
        .call(
            "sync/copy",
            json!({"srcFs":format!("{remote}:{path}"),"dstFs":local.display().to_string(),"createEmptySrcDirs":true}),
        )
        .map(|_| ())
        .map_err(ApiError::Message)
}

fn mirror_cloud_repository_to_provider(
    storage: &StorageRuntimeService,
    repository: &StoredBackupRepository,
) -> ApiResult<()> {
    if repository.kind != "cloud" {
        return Ok(());
    }
    let (remote, path) = cloud_repository_identity(repository)?;
    storage
        .call(
            "sync/copy",
            json!({"srcFs":{"type":"local","_root":repository.location},"dstFs":format!("{remote}:{path}"),"createEmptySrcDirs":true}),
        )
        .map(|_| ())
        .map_err(ApiError::Message)
}

fn safe_source_folders(payload: &Value) -> ApiResult<Vec<PathBuf>> {
    let values = payload
        .get("sources")
        .and_then(Value::as_array)
        .ok_or_else(|| ApiError::Message("Choose at least one local source folder.".to_owned()))?;
    if values.is_empty() || values.len() > 32 {
        return Err(ApiError::Message(
            "Choose between 1 and 32 source folders.".to_owned(),
        ));
    }
    values
        .iter()
        .map(|value| {
            let raw = value
                .as_str()
                .ok_or_else(|| ApiError::Message("Source paths must be strings.".to_owned()))?;
            let path = fs::canonicalize(raw)
                .map_err(|_| ApiError::Message(format!("Source folder does not exist: {raw}")))?;
            if !path.is_dir() {
                return Err(ApiError::Message(format!(
                    "Backup source is not a folder: {raw}"
                )));
            }
            Ok(path)
        })
        .collect()
}

fn restic_command(
    executable: &Path,
    repository: &StoredBackupRepository,
    password: &str,
) -> Command {
    let mut command = Command::new(executable);
    command
        .env("RESTIC_PASSWORD", password)
        .arg("-r")
        .arg(&repository.location);
    command.stdin(Stdio::null());
    command
}
fn run_checked_command(command: &mut Command, operation: &str) -> ApiResult<()> {
    let output = command
        .output()
        .map_err(|error| ApiError::Message(format!("Could not {operation}: {error}")))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(redacted_command_error(
            &format!("Could not {operation}"),
            &output.stderr,
        ))
    }
}
fn redacted_command_error(prefix: &str, stderr: &[u8]) -> ApiError {
    let detail = String::from_utf8_lossy(stderr)
        .lines()
        .next()
        .unwrap_or("Restic failed.")
        .chars()
        .filter(|character| !character.is_control())
        .take(240)
        .collect::<String>();
    ApiError::Message(format!("{prefix}: {detail}"))
}
fn collision_safe_restore_folder(parent: &Path) -> ApiResult<PathBuf> {
    fs::create_dir_all(parent).map_err(|error| {
        ApiError::Message(format!("Could not prepare restore destination: {error}"))
    })?;
    for suffix in 1..10_000 {
        let name = if suffix == 1 {
            "Misty Restore".to_owned()
        } else {
            format!("Misty Restore {suffix}")
        };
        let path = parent.join(name);
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(ApiError::Message(format!(
                    "Could not create restore destination: {error}"
                )))
            }
        }
    }
    Err(ApiError::Message(
        "Could not create a unique restore folder.".to_owned(),
    ))
}

#[allow(clippy::too_many_arguments)]
fn run_restic_job(
    jobs: Arc<Mutex<HashMap<String, ExtensionJob>>>,
    id: String,
    cancel: Arc<AtomicBool>,
    operation: String,
    repository: StoredBackupRepository,
    password: String,
    restic: PathBuf,
    sources: Vec<PathBuf>,
    snapshot_id: Option<String>,
    restore_parent: PathBuf,
    state_path: PathBuf,
    storage_runtime: StorageRuntimeService,
) {
    update_job(&jobs, &id, |job| {
        job.status = "running".to_owned();
        job.progress = None;
        job.message = match operation.as_str() {
            "check" => "Verifying repository…",
            "restore" => "Restoring snapshot…",
            _ => "Creating encrypted snapshot…",
        }
        .to_owned();
    });
    if let Err(error) = mirror_cloud_repository_to_local(&storage_runtime, &repository) {
        finish_failed(&jobs, &id, error.to_string(), Vec::new());
        return;
    }
    let mut command = restic_command(&restic, &repository, &password);
    let mut restore_output = None;
    match operation.as_str() {
        "check" => {
            command.arg("check");
        }
        "restore" => {
            let destination = match collision_safe_restore_folder(&restore_parent) {
                Ok(value) => value,
                Err(error) => {
                    finish_failed(&jobs, &id, error.to_string(), Vec::new());
                    return;
                }
            };
            command
                .arg("restore")
                .arg(snapshot_id.unwrap_or_else(|| "latest".to_owned()))
                .arg("--target")
                .arg(&destination);
            restore_output = Some(destination);
        }
        _ => {
            command.arg("backup").args(["--json"]);
            for source in &sources {
                command.arg(source);
            }
        }
    }
    command.stdout(Stdio::piped()).stderr(Stdio::null());
    let result = match command.spawn() {
        Ok(mut child) => {
            let reader = child.stdout.take().map(|stdout| {
                let progress_jobs = jobs.clone();
                let progress_id = id.clone();
                thread::spawn(move || {
                    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                        if let Some(progress) = restic_progress(&line) {
                            update_job(&progress_jobs, &progress_id, |job| {
                                job.progress = Some(progress);
                                job.message = format!("Backup in progress… {}%", progress.round());
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
    match result {
        Ok(Some(status)) if status.success() => {
            if operation == "backup" {
                if let Err(error) =
                    mirror_cloud_repository_to_provider(&storage_runtime, &repository)
                {
                    finish_failed(&jobs, &id, error.to_string(), Vec::new());
                    return;
                }
            }
            let outputs = restore_output
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>();
            update_job(&jobs, &id, |job| {
                job.status = "completed".to_owned();
                job.progress = Some(100.0);
                job.message = match operation.as_str() {
                    "check" => "Repository verification completed.",
                    "restore" => "Snapshot restored into a new folder.",
                    _ => "Backup snapshot created.",
                }
                .to_owned();
                job.output_paths = outputs;
            });
            if operation == "backup" {
                if let Ok(mut repositories) = read_backup_repositories(&state_path) {
                    if let Some(item) = repositories
                        .iter_mut()
                        .find(|item| item.id == repository.id)
                    {
                        item.last_backup = Some(format!("{}", unix_timestamp_ms()));
                        let _ = write_backup_repositories(&state_path, &repositories);
                    }
                }
            }
        }
        Ok(None) => {
            if let Some(path) = restore_output {
                let _ = fs::remove_dir_all(path);
            }
            finish_cancelled(&jobs, &id, Vec::new());
        }
        Ok(Some(status)) => {
            if let Some(path) = restore_output {
                let _ = fs::remove_dir_all(path);
            }
            finish_failed(&jobs,&id,format!("Restic exited with {status}. Credentials and repository access were not exposed."),Vec::new());
        }
        Err(error) => {
            if let Some(path) = restore_output {
                let _ = fs::remove_dir_all(path);
            }
            finish_failed(
                &jobs,
                &id,
                format!("Could not run Restic: {error}"),
                Vec::new(),
            );
        }
    }
}
fn restic_progress(line: &str) -> Option<f64> {
    let value: Value = serde_json::from_str(line).ok()?;
    value
        .get("percent_done")
        .and_then(Value::as_f64)
        .map(|progress| (progress * 100.0).clamp(0.0, 100.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::system_dependencies::resolve_executable;
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
        assert!(validate_command_scope("backups", "backups.restore").is_ok());
        assert!(validate_command_scope("vault", "backups.start").is_err());
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
        let Some(executable) = resolve_executable("ffmpeg", None) else {
            return;
        };
        if Command::new(&executable)
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
                    plugin_id: "quick_convert".to_owned(),
                    status: "queued".to_owned(),
                    progress: Some(0.0),
                    message: String::new(),
                    output_paths: Vec::new(),
                    error: None,
                    created_at: 1,
                    updated_at: 1,
                    completed_at: None,
                    result: None,
                },
                cancel: Arc::new(AtomicBool::new(false)),
            },
        );
        run_quick_convert_job(
            ExtensionJobExecution {
                jobs: jobs.clone(),
                id: id.clone(),
                cancel: Arc::new(AtomicBool::new(false)),
            },
            QuickConvertJob {
                paths: vec![source],
                format: "png".to_owned(),
                quality: "balanced".to_owned(),
                destination: "source".to_owned(),
                home_dir: root.clone(),
                executable,
            },
        );
        let snapshot = jobs.lock().unwrap().get(&id).unwrap().snapshot.clone();
        assert_eq!(snapshot.status, "completed");
        assert_eq!(snapshot.output_paths.len(), 1);
        assert!(Path::new(&snapshot.output_paths[0]).is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn job_access_requires_plugin_ownership_and_latest_is_scoped() {
        let root = std::env::temp_dir().join(format!("misty-ext-runtime-{}", Uuid::new_v4()));
        let environment = AppEnvironmentService::for_test_home(root.clone());
        let service = ExtensionRuntimeService::new(environment);
        let cancel = Arc::new(AtomicBool::new(false));
        service
            .insert_job("quick", "quick_convert", cancel.clone(), "Quick".to_owned())
            .unwrap();
        std::thread::sleep(Duration::from_millis(2));
        service
            .insert_job("download", "ytdlp", cancel, "Download".to_owned())
            .unwrap();

        assert!(service
            .job_status("ytdlp", &json!({ "jobId": "quick" }))
            .is_err());
        assert!(service
            .cancel_job("ytdlp", &json!({ "jobId": "quick" }))
            .is_err());
        let latest = service.latest_job("quick_convert").unwrap();
        assert_eq!(latest.get("id").and_then(Value::as_str), Some("quick"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn validates_repository_progress() {
        assert!(validate_local_repository_location("/").is_err());
        assert_eq!(
            validate_cloud_repository_location("drive:Misty Backups/laptop").unwrap(),
            ("drive".to_owned(), "Misty Backups/laptop".to_owned())
        );
        assert!(validate_cloud_repository_location("drive:../escape").is_err());
        assert!(validate_cloud_repository_location("bad remote:path").is_err());
        assert_eq!(
            restic_progress(r#"{"message_type":"status","percent_done":0.425}"#),
            Some(42.5)
        );
    }

    #[test]
    fn restore_folder_is_collision_safe() {
        let root = std::env::temp_dir().join(format!("misty-restore-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("Misty Restore")).unwrap();
        let created = collision_safe_restore_folder(&root).unwrap();
        assert!(created.ends_with("Misty Restore 2"));
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn optimizer_preserves_source_and_records_output() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("misty-optimize-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("photo.jpg");
        fs::write(&source, b"original").unwrap();
        let executable = root.join("fake-ffmpeg");
        fs::write(
            &executable,
            b"#!/bin/sh\nfor last; do :; done\nprintf optimized > \"$last\"\n",
        )
        .unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
        let jobs = Arc::new(Mutex::new(HashMap::new()));
        let id = "optimizer".to_owned();
        jobs.lock().unwrap().insert(
            id.clone(),
            ExtensionJob {
                snapshot: ExtensionJobSnapshot {
                    id: id.clone(),
                    plugin_id: "image_optimizer".to_owned(),
                    status: "queued".to_owned(),
                    progress: Some(0.0),
                    message: String::new(),
                    output_paths: Vec::new(),
                    error: None,
                    created_at: 1,
                    updated_at: 1,
                    completed_at: None,
                    result: None,
                },
                cancel: Arc::new(AtomicBool::new(false)),
            },
        );
        run_image_optimizer_job(
            ExtensionJobExecution {
                jobs: jobs.clone(),
                id: id.clone(),
                cancel: Arc::new(AtomicBool::new(false)),
            },
            ImageOptimizationJob {
                paths: vec![source.clone()],
                quality: "balanced".to_owned(),
                max_dimension: "original".to_owned(),
                destination: "beside".to_owned(),
                home_dir: root.clone(),
                executable,
            },
        );
        let snapshot = jobs.lock().unwrap().get(&id).unwrap().snapshot.clone();
        assert_eq!(fs::read(&source).unwrap(), b"original");
        assert_eq!(snapshot.status, "completed");
        assert_eq!(snapshot.output_paths.len(), 1);
        let _ = fs::remove_dir_all(root);
    }
}
