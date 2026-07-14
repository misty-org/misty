use std::{
    collections::HashSet,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::{
    error::{ApiError, ApiResult},
    services::{environment::AppEnvironmentService, system_dependencies::resolve_executable},
};

pub const MAX_MEDIA_DURATION_MS: i64 = 120 * 60 * 1_000;
pub const MEDIA_CHUNK_MS: i64 = 30_000;
const MIN_FINAL_CHUNK_MS: i64 = 5_000;
const MAX_MEDIA_BYTES: u64 = 100 * 1024 * 1024 * 1024;
const PROCESS_TIMEOUT: Duration = Duration::from_secs(90);
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_PROBE_OUTPUT_BYTES: usize = 1024 * 1024;
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mov", "m4v", "webm", "mkv", "avi"];
const AUDIO_EXTENSIONS: &[&str] = &["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus"];

#[derive(Clone)]
pub struct MediaSearchService {
    environment: AppEnvironmentService,
    db_path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSearchSnapshot {
    pub root_path: String,
    pub max_duration_minutes: i64,
    pub assets: Vec<MediaAsset>,
    pub ffmpeg_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAsset {
    pub asset_id: String,
    pub path: String,
    pub name: String,
    pub fingerprint: String,
    pub media_type: String,
    pub mime_type: String,
    pub duration_ms: i64,
    pub size_bytes: u64,
    pub modified_ms: i64,
    pub status: String,
    pub indexed_fingerprint: Option<String>,
    pub failure_code: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareMediaChunkRequest {
    pub asset_id: String,
    pub chunk_index: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedMediaChunk {
    pub asset_id: String,
    pub fingerprint: String,
    pub media_type: String,
    pub mime_type: String,
    pub duration_ms: i64,
    pub chunk_index: u32,
    pub start_ms: i64,
    pub end_ms: i64,
    pub audio_mime_type: Option<String>,
    pub audio_base64: Option<String>,
    pub frames: Vec<PreparedMediaFrame>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedMediaFrame {
    pub timestamp_ms: i64,
    pub mime_type: String,
    pub base64: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteMediaAssetRequest {
    pub asset_id: String,
    pub fingerprint: String,
    #[serde(default)]
    pub failure_code: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveMediaAssetsRequest {
    pub asset_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedMediaAsset {
    pub asset_id: String,
    pub path: String,
    pub name: String,
    pub media_type: String,
    pub duration_ms: i64,
}

#[derive(Debug, Deserialize)]
struct ProbeDocument {
    format: Option<ProbeFormat>,
    streams: Vec<ProbeStream>,
}

#[derive(Debug, Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
    duration: Option<String>,
}

impl MediaSearchService {
    pub fn new(environment: AppEnvironmentService) -> Self {
        let db_path = environment.cache_dir().join("media-search-v1.sqlite3");
        Self {
            environment,
            db_path,
        }
    }

    pub fn scan_movies(&self) -> ApiResult<MediaSearchSnapshot> {
        let root = self.movies_root()?;
        let ffmpeg = self.executable("ffmpeg");
        let ffprobe = self.executable("ffprobe");
        if ffmpeg.is_none() || ffprobe.is_none() {
            return Ok(MediaSearchSnapshot {
                root_path: root.display().to_string(),
                max_duration_minutes: 120,
                assets: Vec::new(),
                ffmpeg_available: false,
            });
        }
        let connection = self.connection()?;
        let mut seen = HashSet::new();
        for entry in WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() || !is_supported(entry.path()) {
                continue;
            }
            let path = match secure_media_path(&root, entry.path()) {
                Ok(path) => path,
                Err(_) => continue,
            };
            let metadata = fs::metadata(&path).map_err(message)?;
            if metadata.len() == 0 || metadata.len() > MAX_MEDIA_BYTES {
                continue;
            }
            let duration_ms = probe_duration_ms(ffprobe.as_ref().unwrap(), &path)?;
            let (status, failure_code) = if duration_ms <= 0 {
                ("unsupported", Some("duration_unavailable".to_owned()))
            } else if duration_ms > MAX_MEDIA_DURATION_MS {
                ("unsupported", Some("duration_limit_exceeded".to_owned()))
            } else {
                ("pending", None)
            };
            let modified_ms = metadata
                .modified()
                .ok()
                .and_then(system_time_ms)
                .unwrap_or(0);
            let fingerprint = fingerprint_file(&path, metadata.len(), modified_ms)?;
            let asset_id = opaque_asset_id(&path);
            let (media_type, mime_type) = media_descriptor(&path);
            connection.execute(
                "INSERT INTO media_assets(asset_id,path,name,fingerprint,media_type,mime_type,duration_ms,size_bytes,modified_ms,status,failure_code,updated_at_ms) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) ON CONFLICT(asset_id) DO UPDATE SET path=excluded.path,name=excluded.name,fingerprint=excluded.fingerprint,media_type=excluded.media_type,mime_type=excluded.mime_type,duration_ms=excluded.duration_ms,size_bytes=excluded.size_bytes,modified_ms=excluded.modified_ms,status=CASE WHEN media_assets.indexed_fingerprint=excluded.fingerprint THEN 'indexed' ELSE excluded.status END,failure_code=CASE WHEN media_assets.indexed_fingerprint=excluded.fingerprint THEN NULL ELSE excluded.failure_code END,updated_at_ms=excluded.updated_at_ms",
                params![asset_id, path.display().to_string(), entry.file_name().to_string_lossy(), fingerprint, media_type, mime_type, duration_ms, metadata.len() as i64, modified_ms, status, failure_code, now_ms()],
            ).map_err(message)?;
            seen.insert(asset_id);
        }
        let stored = {
            let mut statement = connection
                .prepare("SELECT asset_id FROM media_assets")
                .map_err(message)?;
            let values = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(message)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(message)?;
            values
        };
        for asset_id in stored {
            if !seen.contains(&asset_id) {
                connection
                    .execute("DELETE FROM media_assets WHERE asset_id=?1", [asset_id])
                    .map_err(message)?;
            }
        }
        self.snapshot_with(&connection, root, true)
    }

    pub fn snapshot(&self) -> ApiResult<MediaSearchSnapshot> {
        let root = self.movies_root()?;
        let connection = self.connection()?;
        self.snapshot_with(
            &connection,
            root,
            self.executable("ffmpeg").is_some() && self.executable("ffprobe").is_some(),
        )
    }

    pub fn prepare_chunk(
        &self,
        request: PrepareMediaChunkRequest,
    ) -> ApiResult<PreparedMediaChunk> {
        if !valid_media_id(&request.asset_id) {
            return Err(ApiError::Message("invalid media asset id".into()));
        }
        let root = self.movies_root()?;
        let connection = self.connection()?;
        let asset = load_asset(&connection, &request.asset_id)?
            .ok_or_else(|| ApiError::Message("media asset not found".into()))?;
        let path = secure_media_path(&root, Path::new(&asset.path))?;
        if !media_matches_asset(&path, &asset)? {
            return Err(ApiError::Message(
                "media changed after the last scan; scan Movies again before indexing".into(),
            ));
        }
        if asset.duration_ms <= 0
            || asset.duration_ms > MAX_MEDIA_DURATION_MS
            || asset.status == "unsupported"
        {
            return Err(ApiError::Message("media duration is not eligible".into()));
        }
        let chunk_count = media_chunk_count(asset.duration_ms);
        if request.chunk_index >= chunk_count {
            return Err(ApiError::Message("media chunk is out of range".into()));
        }
        let start_ms = request.chunk_index as i64 * MEDIA_CHUNK_MS;
        let end_ms = if request.chunk_index + 1 == chunk_count {
            asset.duration_ms
        } else {
            start_ms + MEDIA_CHUNK_MS
        };
        let tmp = self
            .environment
            .cache_dir()
            .join("media-search-tmp")
            .join(Uuid::new_v4().to_string());
        fs::create_dir_all(&tmp).map_err(message)?;
        let result = self
            .prepare_chunk_in(&asset, &path, &tmp, request.chunk_index, start_ms, end_ms)
            .and_then(|chunk| {
                if media_matches_asset(&path, &asset)? {
                    Ok(chunk)
                } else {
                    Err(ApiError::Message(
                        "media changed during indexing; scan Movies again".into(),
                    ))
                }
            });
        let _ = fs::remove_dir_all(&tmp);
        result
    }

    fn prepare_chunk_in(
        &self,
        asset: &MediaAsset,
        path: &Path,
        tmp: &Path,
        chunk_index: u32,
        start_ms: i64,
        end_ms: i64,
    ) -> ApiResult<PreparedMediaChunk> {
        let ffmpeg = self
            .executable("ffmpeg")
            .ok_or_else(|| ApiError::Unavailable("FFmpeg is required for Media Search".into()))?;
        let seconds = (end_ms - start_ms) as f64 / 1000.0;
        let start = start_ms as f64 / 1000.0;
        let audio_path = tmp.join("audio.mp3");
        let audio_status = run_bounded(
            Command::new(&ffmpeg)
                .args([
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-nostdin",
                    "-ss",
                    &format!("{start:.3}"),
                    "-i",
                ])
                .arg(path)
                .args([
                    "-t",
                    &format!("{seconds:.3}"),
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-b:a",
                    "32k",
                    "-map_metadata",
                    "-1",
                    "-y",
                ])
                .arg(&audio_path),
        )?;
        let (audio_mime_type, audio_base64) = if audio_status
            && audio_path
                .metadata()
                .map(|m| m.len() <= 2 * 1024 * 1024)
                .unwrap_or(false)
        {
            (
                Some("audio/mpeg".to_owned()),
                Some(BASE64.encode(fs::read(&audio_path).map_err(message)?)),
            )
        } else {
            (None, None)
        };

        let mut frames = Vec::new();
        if asset.media_type == "video" {
            let pattern = tmp.join("frame-%03d.jpg");
            let status = run_bounded(Command::new(&ffmpeg).args(["-hide_banner","-loglevel","error","-nostdin","-ss",&format!("{start:.3}"),"-i"]).arg(path).args(["-t",&format!("{seconds:.3}"),"-vf","fps=1/10,scale=512:-2:force_original_aspect_ratio=decrease,format=yuvj420p","-q:v","4","-map_metadata","-1","-an","-y"]).arg(&pattern))?;
            if status {
                let mut files = fs::read_dir(tmp)
                    .map_err(message)?
                    .filter_map(Result::ok)
                    .filter(|e| e.file_name().to_string_lossy().starts_with("frame-"))
                    .collect::<Vec<_>>();
                let fallback_first = files.is_empty();
                if files.is_empty() {
                    let first = tmp.join("frame-001.jpg");
                    let _ = run_bounded(
                        Command::new(&ffmpeg)
                            .args([
                                "-hide_banner",
                                "-loglevel",
                                "error",
                                "-nostdin",
                                "-ss",
                                &format!("{start:.3}"),
                                "-i",
                            ])
                            .arg(path)
                            .args([
                                "-frames:v",
                                "1",
                                "-vf",
                                "scale=512:-2:force_original_aspect_ratio=decrease,format=yuvj420p",
                                "-q:v",
                                "4",
                                "-map_metadata",
                                "-1",
                                "-an",
                                "-y",
                            ])
                            .arg(&first),
                    )?;
                    files = fs::read_dir(tmp)
                        .map_err(message)?
                        .filter_map(Result::ok)
                        .filter(|e| e.file_name().to_string_lossy().starts_with("frame-"))
                        .collect();
                }
                files.sort_by_key(|entry| entry.file_name());
                for (index, entry) in files.into_iter().take(4).enumerate() {
                    let bytes = fs::read(entry.path()).map_err(message)?;
                    if bytes.len() <= 512 * 1024 {
                        let timestamp = if fallback_first {
                            start_ms
                        } else {
                            start_ms + index as i64 * 10_000 + 5_000
                        };
                        frames.push(PreparedMediaFrame {
                            timestamp_ms: timestamp.min(end_ms.saturating_sub(1)),
                            mime_type: "image/jpeg".into(),
                            base64: BASE64.encode(bytes),
                        });
                    }
                }
            }
        }
        if audio_base64.is_none() && frames.is_empty() {
            return Err(ApiError::Message(
                "FFmpeg could not extract searchable media".into(),
            ));
        }
        connection_status(&self.connection()?, &asset.asset_id, "processing", None)?;
        Ok(PreparedMediaChunk {
            asset_id: asset.asset_id.clone(),
            fingerprint: asset.fingerprint.clone(),
            media_type: asset.media_type.clone(),
            mime_type: asset.mime_type.clone(),
            duration_ms: asset.duration_ms,
            chunk_index,
            start_ms,
            end_ms,
            audio_mime_type,
            audio_base64,
            frames,
        })
    }

    pub fn complete(&self, request: CompleteMediaAssetRequest) -> ApiResult<MediaSearchSnapshot> {
        if !valid_media_id(&request.asset_id) || request.fingerprint.len() != 64 {
            return Err(ApiError::Message("invalid media completion".into()));
        }
        let connection = self.connection()?;
        if let Some(code) = request.failure_code.filter(|v| !v.trim().is_empty()) {
            connection_status(&connection, &request.asset_id, "failed", Some(&code))?;
        } else {
            let changed = connection.execute("UPDATE media_assets SET status='indexed',indexed_fingerprint=?1,failure_code=NULL,updated_at_ms=?2 WHERE asset_id=?3 AND fingerprint=?1", params![request.fingerprint, now_ms(), request.asset_id]).map_err(message)?;
            if changed != 1 {
                return Err(ApiError::Message("media changed during indexing".into()));
            }
        }
        self.snapshot_with(&connection, self.movies_root()?, true)
    }

    pub fn resolve_assets(
        &self,
        request: ResolveMediaAssetsRequest,
    ) -> ApiResult<Vec<ResolvedMediaAsset>> {
        if request.asset_ids.len() > 100 || request.asset_ids.iter().any(|id| !valid_media_id(id)) {
            return Err(ApiError::Message("invalid media asset ids".into()));
        }
        let root = self.movies_root()?;
        let connection = self.connection()?;
        let mut result = Vec::new();
        for id in request.asset_ids {
            if let Some(asset) = load_asset(&connection, &id)? {
                let resolved = secure_media_path(&root, Path::new(&asset.path));
                let is_current = resolved
                    .as_deref()
                    .map(|path| media_matches_asset(path, &asset).unwrap_or(false))
                    .unwrap_or(false);
                if asset.status == "indexed"
                    && asset.indexed_fingerprint.as_deref() == Some(asset.fingerprint.as_str())
                    && is_current
                {
                    result.push(ResolvedMediaAsset {
                        asset_id: id,
                        path: asset.path,
                        name: asset.name,
                        media_type: asset.media_type,
                        duration_ms: asset.duration_ms,
                    });
                }
            }
        }
        Ok(result)
    }

    fn movies_root(&self) -> ApiResult<PathBuf> {
        let configured = self.environment.home_dir().join("Movies");
        fs::create_dir_all(&configured).map_err(message)?;
        configured.canonicalize().map_err(message)
    }

    fn executable(&self, name: &str) -> Option<PathBuf> {
        resolve_executable(name, Some(&self.environment.settings_path()))
    }

    fn connection(&self) -> ApiResult<Connection> {
        if let Some(parent) = self.db_path.parent() {
            fs::create_dir_all(parent).map_err(message)?;
        }
        let connection = Connection::open(&self.db_path).map_err(message)?;
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS media_assets(asset_id TEXT PRIMARY KEY,path TEXT NOT NULL UNIQUE,name TEXT NOT NULL,fingerprint TEXT NOT NULL,media_type TEXT NOT NULL,mime_type TEXT NOT NULL,duration_ms INTEGER NOT NULL,size_bytes INTEGER NOT NULL,modified_ms INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',indexed_fingerprint TEXT,failure_code TEXT,updated_at_ms INTEGER NOT NULL);").map_err(message)?;
        Ok(connection)
    }

    fn snapshot_with(
        &self,
        connection: &Connection,
        root: PathBuf,
        ffmpeg_available: bool,
    ) -> ApiResult<MediaSearchSnapshot> {
        let mut statement = connection.prepare("SELECT asset_id,path,name,fingerprint,media_type,mime_type,duration_ms,size_bytes,modified_ms,status,indexed_fingerprint,failure_code FROM media_assets ORDER BY name COLLATE NOCASE").map_err(message)?;
        let assets = statement
            .query_map([], row_asset)
            .map_err(message)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(message)?;
        Ok(MediaSearchSnapshot {
            root_path: root.display().to_string(),
            max_duration_minutes: 120,
            assets,
            ffmpeg_available,
        })
    }
}

fn row_asset(row: &rusqlite::Row<'_>) -> rusqlite::Result<MediaAsset> {
    Ok(MediaAsset {
        asset_id: row.get(0)?,
        path: row.get(1)?,
        name: row.get(2)?,
        fingerprint: row.get(3)?,
        media_type: row.get(4)?,
        mime_type: row.get(5)?,
        duration_ms: row.get(6)?,
        size_bytes: row.get::<_, i64>(7)? as u64,
        modified_ms: row.get(8)?,
        status: row.get(9)?,
        indexed_fingerprint: row.get(10)?,
        failure_code: row.get(11)?,
    })
}
fn load_asset(connection: &Connection, id: &str) -> ApiResult<Option<MediaAsset>> {
    connection.query_row("SELECT asset_id,path,name,fingerprint,media_type,mime_type,duration_ms,size_bytes,modified_ms,status,indexed_fingerprint,failure_code FROM media_assets WHERE asset_id=?1", [id], row_asset).optional().map_err(message)
}
fn connection_status(
    connection: &Connection,
    id: &str,
    status: &str,
    code: Option<&str>,
) -> ApiResult<()> {
    connection
        .execute(
            "UPDATE media_assets SET status=?1,failure_code=?2,updated_at_ms=?3 WHERE asset_id=?4",
            params![status, code, now_ms(), id],
        )
        .map_err(message)?;
    Ok(())
}

fn secure_media_path(root: &Path, path: &Path) -> ApiResult<PathBuf> {
    let canonical = path.canonicalize().map_err(message)?;
    if !canonical.starts_with(root) || !canonical.is_file() {
        return Err(ApiError::Message("media path is outside ~/Movies".into()));
    }
    Ok(canonical)
}
fn is_supported(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    VIDEO_EXTENSIONS.contains(&ext.as_str()) || AUDIO_EXTENSIONS.contains(&ext.as_str())
}
fn media_descriptor(path: &Path) -> (String, String) {
    let ext = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
        (
            "video".into(),
            match ext.as_str() {
                "webm" => "video/webm",
                "mov" => "video/quicktime",
                "mkv" => "video/x-matroska",
                _ => "video/mp4",
            }
            .into(),
        )
    } else {
        (
            "audio".into(),
            match ext.as_str() {
                "wav" => "audio/wav",
                "flac" => "audio/flac",
                "ogg" => "audio/ogg",
                "opus" => "audio/opus",
                _ => "audio/mpeg",
            }
            .into(),
        )
    }
}
fn opaque_asset_id(path: &Path) -> String {
    let digest = Sha256::digest(path.to_string_lossy().as_bytes());
    format!("media_{}", hex::encode(&digest[..16]))
}
fn valid_media_id(value: &str) -> bool {
    value.len() == 38
        && value.starts_with("media_")
        && value[6..]
            .bytes()
            .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value))
}
fn media_chunk_count(duration_ms: i64) -> u32 {
    if duration_ms <= 0 {
        return 0;
    };
    let full = duration_ms / MEDIA_CHUNK_MS;
    let remainder = duration_ms % MEDIA_CHUNK_MS;
    if remainder == 0 {
        full as u32
    } else if remainder < MIN_FINAL_CHUNK_MS && full > 0 {
        full as u32
    } else {
        (full + 1) as u32
    }
}
fn fingerprint_file(path: &Path, size: u64, modified_ms: i64) -> ApiResult<String> {
    let mut file = fs::File::open(path).map_err(message)?;
    let mut hash = Sha256::new();
    hash.update(size.to_le_bytes());
    hash.update(modified_ms.to_le_bytes());
    let mut buf = vec![0u8; 65536];
    let read = file.read(&mut buf).map_err(message)?;
    hash.update(&buf[..read]);
    if size > 65536 {
        file.seek(SeekFrom::End(-65536)).map_err(message)?;
        let read = file.read(&mut buf).map_err(message)?;
        hash.update(&buf[..read]);
    }
    Ok(hex::encode(hash.finalize()))
}
fn media_matches_asset(path: &Path, asset: &MediaAsset) -> ApiResult<bool> {
    let metadata = fs::metadata(path).map_err(message)?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(system_time_ms)
        .unwrap_or(0);
    if metadata.len() != asset.size_bytes || modified_ms != asset.modified_ms {
        return Ok(false);
    };
    Ok(fingerprint_file(path, metadata.len(), modified_ms)? == asset.fingerprint)
}
fn probe_duration_ms(ffprobe: &Path, path: &Path) -> ApiResult<i64> {
    let output = run_bounded_output(
        Command::new(ffprobe)
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=codec_type,duration",
                "-of",
                "json",
            ])
            .arg(path),
        PROBE_TIMEOUT,
        MAX_PROBE_OUTPUT_BYTES,
    )?;
    let Some(output) = output else {
        return Ok(0);
    };
    let doc: ProbeDocument = serde_json::from_slice(&output)?;
    let duration = doc
        .format
        .and_then(|v| v.duration)
        .or_else(|| {
            doc.streams
                .into_iter()
                .filter(|s| matches!(s.codec_type.as_deref(), Some("audio" | "video")))
                .filter_map(|s| s.duration)
                .next()
        })
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(0.0);
    Ok((duration * 1000.0).round() as i64)
}
fn run_bounded_output(
    command: &mut Command,
    timeout: Duration,
    max_output_bytes: usize,
) -> ApiResult<Option<Vec<u8>>> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command.spawn().map_err(message)?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| ApiError::Message("media probe output was unavailable".into()))?;
    // Drain concurrently so even a corrupt file that produces a large stream
    // listing cannot fill the pipe and deadlock the timeout loop. Only retain a
    // small, bounded JSON document.
    let reader = std::thread::spawn(move || {
        let mut retained = Vec::new();
        let mut exceeded = false;
        let mut buffer = [0_u8; 8192];
        loop {
            let read = match stdout.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => read,
                Err(_) => return None,
            };
            let remaining = max_output_bytes.saturating_sub(retained.len());
            retained.extend_from_slice(&buffer[..read.min(remaining)]);
            exceeded |= read > remaining;
        }
        Some((retained, exceeded))
    });
    let started = std::time::Instant::now();
    let success = loop {
        if let Some(status) = child.try_wait().map_err(message)? {
            break status.success();
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            break false;
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    let captured = reader
        .join()
        .map_err(|_| ApiError::Message("media probe reader failed".into()))?
        .ok_or_else(|| ApiError::Message("media probe output could not be read".into()))?;
    if !success || captured.1 {
        return Ok(None);
    }
    Ok(Some(captured.0))
}
fn run_bounded(command: &mut Command) -> ApiResult<bool> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = command.spawn().map_err(message)?;
    let started = std::time::Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(message)? {
            return Ok(status.success());
        }
        if started.elapsed() > PROCESS_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(ApiError::Message("media extraction timed out".into()));
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}
fn system_time_ms(value: SystemTime) -> Option<i64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|v| v.as_millis() as i64)
}
fn now_ms() -> i64 {
    system_time_ms(SystemTime::now()).unwrap_or(0)
}
fn message(error: impl std::fmt::Display) -> ApiError {
    ApiError::Message(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_opaque_ids() {
        assert!(valid_media_id("media_0123456789abcdef0123456789abcdef"));
        assert!(!valid_media_id("media_0123456789ABCDEF0123456789ABCDEF"));
        assert!(!valid_media_id("media_../../Movies/private"));
    }
    #[cfg(unix)]
    #[test]
    fn bounds_probe_runtime_and_output() {
        let retained = run_bounded_output(
            Command::new("/bin/sh").args(["-c", "printf 1234"]),
            Duration::from_secs(1),
            4,
        )
        .unwrap();
        assert_eq!(retained, Some(b"1234".to_vec()));

        let oversized = run_bounded_output(
            Command::new("/bin/sh").args(["-c", "printf 12345"]),
            Duration::from_secs(1),
            4,
        )
        .unwrap();
        assert!(oversized.is_none());

        let started = std::time::Instant::now();
        let timed_out = run_bounded_output(
            Command::new("/bin/sh").args(["-c", "exec sleep 2"]),
            Duration::from_millis(25),
            4,
        )
        .unwrap();
        assert!(timed_out.is_none());
        assert!(started.elapsed() < Duration::from_secs(1));
    }
    #[test]
    fn enforces_duration_cap() {
        assert_eq!(MAX_MEDIA_DURATION_MS, 7_200_000);
    }
    #[test]
    fn folds_tiny_tail_into_final_chunk() {
        assert_eq!(media_chunk_count(120_186), 4);
        assert_eq!(media_chunk_count(35_001), 2);
        assert_eq!(media_chunk_count(30_000), 1);
    }
    #[test]
    fn classifies_supported_media() {
        assert!(is_supported(Path::new("movie.mp4")));
        assert!(is_supported(Path::new("song.flac")));
        assert!(!is_supported(Path::new("notes.txt")));
    }
    #[test]
    fn scans_and_prepares_real_media_without_paths_in_payload() {
        let Some(ffmpeg) = resolve_executable("ffmpeg", None) else {
            return;
        };
        let root = std::env::temp_dir().join(format!("misty-media-test-{}", Uuid::new_v4()));
        let movies = root.join("Movies");
        fs::create_dir_all(&movies).unwrap();
        let movie = movies.join("fixture.mp4");
        let status = Command::new(ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=320x180:rate=10",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=16000",
                "-t",
                "2",
                "-pix_fmt",
                "yuv420p",
                "-c:v",
                "libx264",
                "-c:a",
                "aac",
                "-y",
            ])
            .arg(&movie)
            .status()
            .unwrap();
        assert!(status.success());
        let service = MediaSearchService::new(AppEnvironmentService::for_test_home(root.clone()));
        let snapshot = service.scan_movies().unwrap();
        assert_eq!(snapshot.assets.len(), 1);
        assert!(snapshot.assets[0].duration_ms >= 1_900);
        let chunk = service
            .prepare_chunk(PrepareMediaChunkRequest {
                asset_id: snapshot.assets[0].asset_id.clone(),
                chunk_index: 0,
            })
            .unwrap();
        assert!(chunk.audio_base64.as_ref().is_some_and(|v| v.len() > 100));
        assert!(!chunk.frames.is_empty());
        let encoded = serde_json::to_string(&chunk).unwrap();
        assert!(!encoded.contains(root.to_string_lossy().as_ref()));
        service
            .complete(CompleteMediaAssetRequest {
                asset_id: chunk.asset_id.clone(),
                fingerprint: chunk.fingerprint.clone(),
                failure_code: None,
            })
            .unwrap();
        let resolved = service
            .resolve_assets(ResolveMediaAssetsRequest {
                asset_ids: vec![chunk.asset_id.clone()],
            })
            .unwrap();
        assert_eq!(resolved.len(), 1);
        use std::io::Write;
        fs::OpenOptions::new()
            .append(true)
            .open(&movie)
            .unwrap()
            .write_all(b"changed")
            .unwrap();
        let changed = service.prepare_chunk(PrepareMediaChunkRequest {
            asset_id: snapshot.assets[0].asset_id.clone(),
            chunk_index: 0,
        });
        assert!(changed.is_err());
        let stale = service
            .resolve_assets(ResolveMediaAssetsRequest {
                asset_ids: vec![chunk.asset_id],
            })
            .unwrap();
        assert!(stale.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn ignores_symlinks_that_escape_movies() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().join(format!("misty-media-symlink-{}", Uuid::new_v4()));
        let movies = root.join("Movies");
        fs::create_dir_all(&movies).unwrap();
        let outside = root.join("private.mp4");
        fs::write(&outside, b"not media").unwrap();
        symlink(&outside, movies.join("escape.mp4")).unwrap();
        let service = MediaSearchService::new(AppEnvironmentService::for_test_home(root.clone()));
        let snapshot = service.scan_movies().unwrap();
        assert!(snapshot.assets.is_empty());
        let _ = fs::remove_dir_all(root);
    }
}
