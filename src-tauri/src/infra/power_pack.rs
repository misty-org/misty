use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs::{self, File},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    process::Command,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

use crate::domain::explorer::{FileKind, ListDirectoryRequest};
use crate::domain::file_master::{normalize_remote_path, RemoteBrowseTarget};
use crate::error::{ApiError, ApiResult};
use crate::infra::{
    environment::AppEnvironmentService, explorer::ExplorerService,
    operation_queue::OperationQueueService,
};

#[derive(Clone)]
pub struct PowerPackService {
    saved_searches_path: PathBuf,
    mount_root: PathBuf,
    explorer: ExplorerService,
    duplicate_cancellations: Arc<Mutex<HashMap<String, bool>>>,
    duplicate_scans: Arc<Mutex<HashMap<String, DuplicateScanState>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveListRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    pub path: String,
    pub is_dir: bool,
    pub compressed_size: u64,
    pub uncompressed_size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveListResult {
    pub archive_path: String,
    pub format: String,
    pub entries: Vec<ArchiveEntry>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveCreateRequest {
    pub paths: Vec<String>,
    pub destination_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveExtractRequest {
    pub archive_path: String,
    pub destination_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveActionResult {
    pub archive_path: String,
    pub destination_path: String,
    pub affected_paths: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateScanRequest {
    pub roots: Vec<String>,
    #[serde(default)]
    pub hash_all: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCandidate {
    pub path: String,
    pub size_bytes: u64,
    pub modified_ms: u64,
    pub sha256: Option<String>,
    pub remote: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub key: String,
    pub size_bytes: u64,
    pub items: Vec<DuplicateCandidate>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateScanResult {
    pub scan_id: String,
    pub groups: Vec<DuplicateGroup>,
    pub scanned_count: usize,
    pub hashed_count: usize,
    pub remote_candidate_count: usize,
    pub remote_hashing_approved: bool,
    pub canceled: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSearchRule {
    pub field: String,
    pub operator: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSearch {
    pub id: String,
    pub name: String,
    pub query: String,
    #[serde(default)]
    pub rules: Vec<SavedSearchRule>,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSearchesSnapshot {
    pub searches: Vec<SavedSearch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareFilesRequest {
    pub left_path: String,
    pub right_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareFilesResult {
    pub left_path: String,
    pub right_path: String,
    pub left_sha256: String,
    pub right_sha256: String,
    pub same: bool,
    pub kind: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareFoldersRequest {
    pub left_path: String,
    pub right_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareFolderRow {
    pub relative_path: String,
    pub disposition: String,
    pub left_size: Option<u64>,
    pub right_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareFoldersResult {
    pub left_path: String,
    pub right_path: String,
    pub rows: Vec<CompareFolderRow>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileToolsChecksumRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileToolsChecksumResult {
    pub path: String,
    pub sha256: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileToolsReadonlyRequest {
    pub path: String,
    pub readonly: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileToolsChmodRequest {
    pub path: String,
    pub mode: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileToolsSymlinkRequest {
    pub target_path: String,
    pub link_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileToolsSymlinkTargetRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileToolsSymlinkTargetResult {
    pub path: String,
    pub target_path: String,
    pub resolved_target_path: String,
    pub target_exists: bool,
    pub target_is_dir: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileToolsActionResult {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone)]
struct DuplicateScanState {
    sources: Vec<DuplicateCandidateSource>,
    requested_hash_all: bool,
}

#[derive(Debug, Clone)]
struct DuplicateCandidateSource {
    candidate: DuplicateCandidate,
    remote_modified: Option<String>,
    remote: bool,
}

impl PowerPackService {
    pub fn new(
        environment: AppEnvironmentService,
        explorer: ExplorerService,
        _operation_queue: OperationQueueService,
    ) -> Self {
        let config_dir = environment.config_dir();
        Self {
            saved_searches_path: config_dir.join("saved-searches.json"),
            mount_root: environment.mount_root(),
            explorer,
            duplicate_cancellations: Arc::new(Mutex::new(HashMap::new())),
            duplicate_scans: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn archive_list(&self, request: ArchiveListRequest) -> ApiResult<ArchiveListResult> {
        tokio::task::spawn_blocking(move || archive_list_blocking(request))
            .await
            .map_err(|err| ApiError::Message(format!("Archive worker failed: {err}")))?
    }

    pub async fn archive_create(
        &self,
        request: ArchiveCreateRequest,
    ) -> ApiResult<ArchiveActionResult> {
        tokio::task::spawn_blocking(move || archive_create_blocking(request))
            .await
            .map_err(|err| ApiError::Message(format!("Archive worker failed: {err}")))?
    }

    pub async fn archive_extract(
        &self,
        request: ArchiveExtractRequest,
    ) -> ApiResult<ArchiveActionResult> {
        tokio::task::spawn_blocking(move || archive_extract_blocking(request))
            .await
            .map_err(|err| ApiError::Message(format!("Archive worker failed: {err}")))?
    }

    pub async fn duplicates_scan(
        &self,
        request: DuplicateScanRequest,
    ) -> ApiResult<DuplicateScanResult> {
        let scan_id = new_id("dup");
        self.duplicate_cancellations
            .lock()
            .await
            .insert(scan_id.clone(), false);
        let cancellations = self.duplicate_cancellations.clone();
        let worker_scan_id = scan_id.clone();
        let local_roots = request
            .roots
            .iter()
            .filter(|root| !root.trim().starts_with("misty://"))
            .cloned()
            .collect::<Vec<_>>();
        let remote_roots = request
            .roots
            .iter()
            .filter(|root| root.trim().starts_with("misty://"))
            .cloned()
            .collect::<Vec<_>>();
        let local_sources = tokio::task::spawn_blocking(move || {
            duplicate_local_sources_blocking(worker_scan_id, local_roots, cancellations)
        })
        .await
        .map_err(|err| ApiError::Message(format!("Duplicate scan worker failed: {err}")))??;
        let remote_sources = self.duplicate_remote_sources(&remote_roots).await?;
        let mut sources = local_sources;
        sources.extend(remote_sources);
        let remote_candidate_count = sources.iter().filter(|source| source.remote).count();
        let hash_now = request.hash_all && remote_candidate_count == 0;
        let result =
            duplicate_result_from_sources(scan_id.clone(), sources.clone(), hash_now, false)?;
        self.duplicate_scans.lock().await.insert(
            scan_id,
            DuplicateScanState {
                sources,
                requested_hash_all: request.hash_all,
            },
        );
        Ok(result)
    }

    pub async fn duplicates_cancel(&self, scan_id: String) -> ApiResult<bool> {
        let mut cancellations = self.duplicate_cancellations.lock().await;
        let Some(value) = cancellations.get_mut(scan_id.trim()) else {
            return Ok(false);
        };
        *value = true;
        Ok(true)
    }

    pub async fn duplicates_hash_remote_candidates(
        &self,
        scan_id: String,
    ) -> ApiResult<DuplicateScanResult> {
        let scan_id = scan_id.trim().to_owned();
        let Some(state) = self.duplicate_scans.lock().await.get(&scan_id).cloned() else {
            return Err(ApiError::Message(format!(
                "Duplicate scan {scan_id} was not found."
            )));
        };
        let mut sources = Vec::with_capacity(state.sources.len());
        for mut source in state.sources {
            if source.remote {
                let prepared = self
                    .explorer
                    .prepare_open_item(crate::domain::explorer::PrepareOpenItemRequest {
                        path: source.candidate.path.clone(),
                        size_bytes: Some(source.candidate.size_bytes.min(i64::MAX as u64) as i64),
                        remote_modified: source.remote_modified.clone(),
                    })
                    .await?;
                let checksum = checksum_file(&PathBuf::from(prepared.local_path))?.sha256;
                source.candidate.sha256 = Some(checksum);
            }
            sources.push(source);
        }
        let result = duplicate_result_from_sources(scan_id.clone(), sources.clone(), true, true)?;
        self.duplicate_scans.lock().await.insert(
            scan_id,
            DuplicateScanState {
                sources,
                requested_hash_all: state.requested_hash_all,
            },
        );
        Ok(result)
    }

    pub async fn saved_searches_snapshot(&self) -> ApiResult<SavedSearchesSnapshot> {
        read_json_file(&self.saved_searches_path).await
    }

    pub async fn saved_searches_save(
        &self,
        search: SavedSearch,
    ) -> ApiResult<SavedSearchesSnapshot> {
        let mut snapshot: SavedSearchesSnapshot = read_json_file(&self.saved_searches_path).await?;
        let mut next = search;
        if next.id.trim().is_empty() {
            next.id = new_id("search");
        }
        next.updated_at_ms = now_ms();
        if let Some(existing) = snapshot.searches.iter_mut().find(|item| item.id == next.id) {
            *existing = next;
        } else {
            snapshot.searches.push(next);
        }
        snapshot
            .searches
            .sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        write_json_file(&self.saved_searches_path, &snapshot).await?;
        Ok(snapshot)
    }

    pub async fn saved_searches_delete(&self, id: String) -> ApiResult<SavedSearchesSnapshot> {
        let mut snapshot: SavedSearchesSnapshot = read_json_file(&self.saved_searches_path).await?;
        snapshot.searches.retain(|item| item.id != id);
        write_json_file(&self.saved_searches_path, &snapshot).await?;
        Ok(snapshot)
    }

    pub async fn compare_files(
        &self,
        request: CompareFilesRequest,
    ) -> ApiResult<CompareFilesResult> {
        tokio::task::spawn_blocking(move || compare_files_blocking(request))
            .await
            .map_err(|err| ApiError::Message(format!("Compare worker failed: {err}")))?
    }

    pub async fn compare_folders(
        &self,
        request: CompareFoldersRequest,
    ) -> ApiResult<CompareFoldersResult> {
        tokio::task::spawn_blocking(move || compare_folders_blocking(request))
            .await
            .map_err(|err| ApiError::Message(format!("Compare worker failed: {err}")))?
    }

    pub async fn compare_apply_text_merge(
        &self,
        merged_text: String,
        target_path: String,
    ) -> ApiResult<FileToolsActionResult> {
        let path = PathBuf::from(target_path);
        tokio::fs::write(&path, merged_text).await.map_err(|err| {
            ApiError::Message(format!(
                "Could not write merged text to {}: {err}",
                path.display()
            ))
        })?;
        Ok(FileToolsActionResult {
            path: path.display().to_string(),
            message: "Applied merged text.".to_owned(),
        })
    }

    pub async fn file_tools_checksum(
        &self,
        request: FileToolsChecksumRequest,
    ) -> ApiResult<FileToolsChecksumResult> {
        tokio::task::spawn_blocking(move || checksum_file(&PathBuf::from(request.path)))
            .await
            .map_err(|err| ApiError::Message(format!("Checksum worker failed: {err}")))?
    }

    pub async fn file_tools_set_readonly(
        &self,
        request: FileToolsReadonlyRequest,
    ) -> ApiResult<FileToolsActionResult> {
        tokio::task::spawn_blocking(move || set_readonly_blocking(request))
            .await
            .map_err(|err| ApiError::Message(format!("Readonly worker failed: {err}")))?
    }

    pub async fn file_tools_chmod(
        &self,
        request: FileToolsChmodRequest,
    ) -> ApiResult<FileToolsActionResult> {
        tokio::task::spawn_blocking(move || chmod_blocking(request))
            .await
            .map_err(|err| ApiError::Message(format!("chmod worker failed: {err}")))?
    }

    pub async fn file_tools_create_symlink(
        &self,
        request: FileToolsSymlinkRequest,
    ) -> ApiResult<FileToolsActionResult> {
        tokio::task::spawn_blocking(move || create_symlink_blocking(request))
            .await
            .map_err(|err| ApiError::Message(format!("Symlink worker failed: {err}")))?
    }

    pub async fn file_tools_read_symlink(
        &self,
        request: FileToolsSymlinkTargetRequest,
    ) -> ApiResult<FileToolsSymlinkTargetResult> {
        tokio::task::spawn_blocking(move || read_symlink_blocking(request))
            .await
            .map_err(|err| ApiError::Message(format!("Symlink worker failed: {err}")))?
    }

    async fn duplicate_remote_sources(
        &self,
        roots: &[String],
    ) -> ApiResult<Vec<DuplicateCandidateSource>> {
        let mut sources = Vec::new();
        for root in roots {
            let Some(root_path) = remote_root_uri_to_mount_path(root, &self.mount_root)? else {
                continue;
            };
            let mut pending = vec![root_path];
            while let Some(path) = pending.pop() {
                let listing = self
                    .explorer
                    .list_directory(ListDirectoryRequest {
                        path: Some(path),
                        show_hidden: Some(true),
                        force_remote_refresh: Some(true),
                    })
                    .await?;
                for entry in listing.entries {
                    match entry.kind {
                        FileKind::Folder => pending.push(entry.path),
                        FileKind::File => {
                            let size_bytes = entry.size_bytes.unwrap_or(0);
                            sources.push(DuplicateCandidateSource {
                                remote_modified: entry.remote_modified.clone(),
                                remote: true,
                                candidate: DuplicateCandidate {
                                    path: entry.path,
                                    size_bytes,
                                    modified_ms: 0,
                                    sha256: None,
                                    remote: true,
                                },
                            });
                        }
                        FileKind::Symlink | FileKind::Other => {}
                    }
                }
            }
        }
        Ok(sources)
    }
}

/// The host explorer and SDK preview share the same ZIP metadata reader.
pub(crate) fn archive_zip_entries<R: Read + io::Seek>(file: R, limit: usize) -> ApiResult<Vec<ArchiveEntry>> {
    let mut archive = ZipArchive::new(file)
            .map_err(|err| ApiError::Message(format!("Could not read ZIP archive: {err}")))?;
        let mut entries = Vec::new();
        for index in 0..archive.len().min(limit) {
            let entry = archive
                .by_index(index)
                .map_err(|err| ApiError::Message(format!("Could not read ZIP entry: {err}")))?;
            entries.push(ArchiveEntry {
                path: entry.name().to_owned(),
                is_dir: entry.is_dir(),
                compressed_size: entry.compressed_size(),
                uncompressed_size: entry.size(),
            });
        }
    Ok(entries)
}

fn archive_list_blocking(request: ArchiveListRequest) -> ApiResult<ArchiveListResult> {
    let archive_path = PathBuf::from(require_path(&request.path, "Archive path")?);
    let format = archive_format(&archive_path);
    if format == "zip" {
        let file = File::open(&archive_path).map_err(|err| {
            ApiError::Message(format!(
                "Could not open archive {}: {err}",
                archive_path.display()
            ))
        })?;
        let entries = archive_zip_entries(file, usize::MAX)?;
        return Ok(ArchiveListResult {
            archive_path: archive_path.display().to_string(),
            format,
            message: format!("Listed {} ZIP entries.", entries.len()),
            entries,
        });
    }

    let output = archive_tool_output(&archive_path, &["tf", "list"])?;
    let entries = output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| ArchiveEntry {
            path: line.trim().to_owned(),
            is_dir: line.trim_end().ends_with('/'),
            compressed_size: 0,
            uncompressed_size: 0,
        })
        .collect::<Vec<_>>();
    Ok(ArchiveListResult {
        archive_path: archive_path.display().to_string(),
        format,
        message: format!(
            "Listed {} archive entries through a system tool.",
            entries.len()
        ),
        entries,
    })
}

pub(crate) fn archive_create_blocking(
    request: ArchiveCreateRequest,
) -> ApiResult<ArchiveActionResult> {
    if request.paths.is_empty() {
        return Err(ApiError::Message(
            "Choose at least one file or folder to compress.".to_owned(),
        ));
    }
    let destination = PathBuf::from(require_path(&request.destination_path, "Destination path")?);
    if archive_format(&destination) != "zip" {
        return Err(ApiError::Message(
            "Misty can create ZIP archives in v1. Other archive formats can be extracted or listed when system tools are installed.".to_owned(),
        ));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            ApiError::Message(format!("Could not create {}: {err}", parent.display()))
        })?;
    }
    let file = File::create(&destination).map_err(|err| {
        ApiError::Message(format!(
            "Could not create archive {}: {err}",
            destination.display()
        ))
    })?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut affected = Vec::new();
    for source in request.paths {
        let source = PathBuf::from(require_path(&source, "Source path")?);
        let base = source.parent().unwrap_or_else(|| Path::new(""));
        zip_path(&mut writer, &source, base, options, &mut affected)?;
    }
    writer
        .finish()
        .map_err(|err| ApiError::Message(format!("Could not finish ZIP archive: {err}")))?;
    Ok(ArchiveActionResult {
        archive_path: destination.display().to_string(),
        destination_path: destination.display().to_string(),
        message: format!(
            "Created ZIP archive with {} item{}.",
            affected.len(),
            if affected.len() == 1 { "" } else { "s" }
        ),
        affected_paths: affected,
    })
}

fn archive_extract_blocking(request: ArchiveExtractRequest) -> ApiResult<ArchiveActionResult> {
    let archive_path = PathBuf::from(require_path(&request.archive_path, "Archive path")?);
    let destination = PathBuf::from(require_path(
        &request.destination_dir,
        "Destination folder",
    )?);
    fs::create_dir_all(&destination).map_err(|err| {
        ApiError::Message(format!("Could not create {}: {err}", destination.display()))
    })?;
    let format = archive_format(&archive_path);
    if format == "zip" {
        let file = File::open(&archive_path).map_err(|err| {
            ApiError::Message(format!(
                "Could not open archive {}: {err}",
                archive_path.display()
            ))
        })?;
        let mut archive = ZipArchive::new(file)
            .map_err(|err| ApiError::Message(format!("Could not read ZIP archive: {err}")))?;
        let mut affected = Vec::new();
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|err| ApiError::Message(format!("Could not read ZIP entry: {err}")))?;
            let Some(relative) = safe_archive_relative_path(entry.name()) else {
                continue;
            };
            let out_path = destination.join(relative);
            if entry.is_dir() {
                fs::create_dir_all(&out_path).map_err(io_error(&out_path))?;
            } else {
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent).map_err(io_error(parent))?;
                }
                let mut out_file = File::create(&out_path).map_err(io_error(&out_path))?;
                io::copy(&mut entry, &mut out_file).map_err(|err| {
                    ApiError::Message(format!("Could not extract {}: {err}", out_path.display()))
                })?;
            }
            affected.push(out_path.display().to_string());
        }
        return Ok(ArchiveActionResult {
            archive_path: archive_path.display().to_string(),
            destination_path: destination.display().to_string(),
            message: format!(
                "Extracted {} ZIP item{}.",
                affected.len(),
                if affected.len() == 1 { "" } else { "s" }
            ),
            affected_paths: affected,
        });
    }
    let message = archive_tool_extract(&archive_path, &destination)?;
    Ok(ArchiveActionResult {
        archive_path: archive_path.display().to_string(),
        destination_path: destination.display().to_string(),
        affected_paths: Vec::new(),
        message,
    })
}

fn zip_path(
    writer: &mut ZipWriter<File>,
    source: &Path,
    base: &Path,
    options: SimpleFileOptions,
    affected: &mut Vec<String>,
) -> ApiResult<()> {
    if source.is_dir() {
        for entry in WalkDir::new(source).into_iter().filter_map(Result::ok) {
            let path = entry.path();
            let name = path.strip_prefix(base).unwrap_or(path);
            let name = archive_name(name)?;
            if entry.file_type().is_dir() {
                writer.add_directory(name.clone(), options).map_err(|err| {
                    ApiError::Message(format!("Could not add ZIP folder {name}: {err}"))
                })?;
            } else if entry.file_type().is_file() {
                writer.start_file(name.clone(), options).map_err(|err| {
                    ApiError::Message(format!("Could not add ZIP file {name}: {err}"))
                })?;
                let mut file = File::open(path).map_err(io_error(path))?;
                io::copy(&mut file, writer).map_err(|err| {
                    ApiError::Message(format!("Could not write ZIP file {name}: {err}"))
                })?;
            }
            affected.push(path.display().to_string());
        }
    } else {
        let name = source
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| {
                ApiError::Message(format!(
                    "Could not derive file name for {}.",
                    source.display()
                ))
            })?;
        writer
            .start_file(name, options)
            .map_err(|err| ApiError::Message(format!("Could not add ZIP file {name}: {err}")))?;
        let mut file = File::open(source).map_err(io_error(source))?;
        io::copy(&mut file, writer)
            .map_err(|err| ApiError::Message(format!("Could not write ZIP file {name}: {err}")))?;
        affected.push(source.display().to_string());
    }
    Ok(())
}

fn duplicate_local_sources_blocking(
    scan_id: String,
    roots: Vec<String>,
    cancellations: Arc<Mutex<HashMap<String, bool>>>,
) -> ApiResult<Vec<DuplicateCandidateSource>> {
    let mut sources = Vec::new();
    for root in roots {
        let root = PathBuf::from(require_path(&root, "Scan root")?);
        for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
            if is_canceled(&scan_id, &cancellations) {
                return Ok(sources);
            }
            if !entry.file_type().is_file() {
                continue;
            }
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            sources.push(DuplicateCandidateSource {
                remote_modified: None,
                remote: false,
                candidate: DuplicateCandidate {
                    path: entry.path().display().to_string(),
                    size_bytes: metadata.len(),
                    modified_ms: system_time_ms(metadata.modified().ok()),
                    sha256: None,
                    remote: false,
                },
            });
        }
    }
    Ok(sources)
}

fn duplicate_result_from_sources(
    scan_id: String,
    mut sources: Vec<DuplicateCandidateSource>,
    hash_all: bool,
    remote_hashing_approved: bool,
) -> ApiResult<DuplicateScanResult> {
    let scanned_count = sources.len();
    let remote_candidate_count = sources.iter().filter(|source| source.remote).count();
    let mut hashed_count = sources
        .iter()
        .filter(|source| source.candidate.sha256.is_some())
        .count();
    let mut by_size: BTreeMap<u64, Vec<DuplicateCandidateSource>> = BTreeMap::new();
    for source in sources.drain(..) {
        by_size
            .entry(source.candidate.size_bytes)
            .or_default()
            .push(source);
    }
    let mut groups = Vec::new();
    for (size, candidates) in by_size.into_iter().filter(|(_, items)| items.len() > 1) {
        if hash_all {
            let mut by_hash: BTreeMap<String, Vec<DuplicateCandidate>> = BTreeMap::new();
            for mut candidate in candidates {
                let checksum = match candidate.candidate.sha256.clone() {
                    Some(checksum) => checksum,
                    None if !candidate.remote => {
                        let checksum =
                            checksum_file(&PathBuf::from(&candidate.candidate.path))?.sha256;
                        candidate.candidate.sha256 = Some(checksum.clone());
                        hashed_count += 1;
                        checksum
                    }
                    None => continue,
                };
                by_hash
                    .entry(checksum)
                    .or_default()
                    .push(candidate.candidate);
            }
            for (hash, items) in by_hash.into_iter().filter(|(_, items)| items.len() > 1) {
                groups.push(DuplicateGroup {
                    key: hash,
                    size_bytes: size,
                    items,
                });
            }
        } else {
            groups.push(DuplicateGroup {
                key: format!("size:{size}"),
                size_bytes: size,
                items: candidates
                    .into_iter()
                    .map(|source| source.candidate)
                    .collect(),
            });
        }
    }
    let remote_hint = if remote_candidate_count > 0 && !remote_hashing_approved {
        format!(
            " Remote approval can hash {} remote candidate{}.",
            remote_candidate_count,
            if remote_candidate_count == 1 { "" } else { "s" }
        )
    } else {
        String::new()
    };
    Ok(DuplicateScanResult {
        scan_id,
        message: format!(
            "Found {} duplicate candidate group{}.{}",
            groups.len(),
            if groups.len() == 1 { "" } else { "s" },
            remote_hint
        ),
        groups,
        scanned_count,
        hashed_count,
        remote_candidate_count,
        remote_hashing_approved,
        canceled: false,
    })
}

fn compare_files_blocking(request: CompareFilesRequest) -> ApiResult<CompareFilesResult> {
    let left = checksum_file(&PathBuf::from(&request.left_path))?;
    let right = checksum_file(&PathBuf::from(&request.right_path))?;
    let same = left.sha256 == right.sha256 && left.size_bytes == right.size_bytes;
    Ok(CompareFilesResult {
        left_path: left.path,
        right_path: right.path,
        left_sha256: left.sha256,
        right_sha256: right.sha256,
        same,
        kind: "binary".to_owned(),
        message: if same {
            "Files match."
        } else {
            "Files differ."
        }
        .to_owned(),
    })
}

fn compare_folders_blocking(request: CompareFoldersRequest) -> ApiResult<CompareFoldersResult> {
    let left = PathBuf::from(require_path(&request.left_path, "Left folder")?);
    let right = PathBuf::from(require_path(&request.right_path, "Right folder")?);
    if !left.is_dir() || !right.is_dir() {
        return Err(ApiError::Message(
            "Folder compare requires two folders.".to_owned(),
        ));
    }
    let left_map = folder_inventory(&left)?;
    let right_map = folder_inventory(&right)?;
    let mut keys = left_map.keys().cloned().collect::<BTreeSet<_>>();
    for key in right_map.keys() {
        keys.insert(key.clone());
    }
    let mut rows = Vec::new();
    for relative_path in keys {
        let left_size = left_map.get(&relative_path).copied();
        let right_size = right_map.get(&relative_path).copied();
        let disposition = match (left_size, right_size) {
            (Some(left), Some(right)) if left == right => "same",
            (Some(_), Some(_)) => "different",
            (Some(_), None) => "left_only",
            (None, Some(_)) => "right_only",
            _ => "unknown",
        };
        rows.push(CompareFolderRow {
            relative_path,
            disposition: disposition.to_owned(),
            left_size,
            right_size,
        });
    }
    Ok(CompareFoldersResult {
        left_path: left.display().to_string(),
        right_path: right.display().to_string(),
        message: format!(
            "Compared {} folder item{}.",
            rows.len(),
            if rows.len() == 1 { "" } else { "s" }
        ),
        rows,
    })
}

fn checksum_file(path: &PathBuf) -> ApiResult<FileToolsChecksumResult> {
    let mut file = File::open(path)
        .map_err(|err| ApiError::Message(format!("Could not open {}: {err}", path.display())))?;
    let mut hasher = Sha256::new();
    let mut size_bytes = 0;
    let mut buffer = [0_u8; 1024 * 64];
    loop {
        let read = file.read(&mut buffer).map_err(|err| {
            ApiError::Message(format!("Could not read {}: {err}", path.display()))
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        size_bytes += read as u64;
    }
    Ok(FileToolsChecksumResult {
        path: path.display().to_string(),
        sha256: format!("{:x}", hasher.finalize()),
        size_bytes,
    })
}

fn set_readonly_blocking(request: FileToolsReadonlyRequest) -> ApiResult<FileToolsActionResult> {
    let path = PathBuf::from(require_path(&request.path, "Path")?);
    let mut permissions = fs::metadata(&path).map_err(io_error(&path))?.permissions();
    permissions.set_readonly(request.readonly);
    fs::set_permissions(&path, permissions).map_err(io_error(&path))?;
    Ok(FileToolsActionResult {
        path: path.display().to_string(),
        message: if request.readonly {
            "Marked readonly."
        } else {
            "Cleared readonly."
        }
        .to_owned(),
    })
}

fn chmod_blocking(request: FileToolsChmodRequest) -> ApiResult<FileToolsActionResult> {
    let path = PathBuf::from(require_path(&request.path, "Path")?);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(request.mode))
            .map_err(io_error(&path))?;
        Ok(FileToolsActionResult {
            path: path.display().to_string(),
            message: format!("Set mode to {:o}.", request.mode),
        })
    }
    #[cfg(not(unix))]
    {
        let _ = request;
        Err(ApiError::Message(
            "chmod is only available on Unix-like systems.".to_owned(),
        ))
    }
}

fn create_symlink_blocking(request: FileToolsSymlinkRequest) -> ApiResult<FileToolsActionResult> {
    let target_path = PathBuf::from(require_path(&request.target_path, "Target path")?);
    let link_path = PathBuf::from(require_path(&request.link_path, "Link path")?);
    #[cfg(unix)]
    std::os::unix::fs::symlink(&target_path, &link_path).map_err(io_error(&link_path))?;
    #[cfg(windows)]
    {
        if target_path.is_dir() {
            std::os::windows::fs::symlink_dir(&target_path, &link_path)
                .map_err(io_error(&link_path))?;
        } else {
            std::os::windows::fs::symlink_file(&target_path, &link_path)
                .map_err(io_error(&link_path))?;
        }
    }
    Ok(FileToolsActionResult {
        path: link_path.display().to_string(),
        message: format!("Created symlink to {}.", target_path.display()),
    })
}

fn read_symlink_blocking(
    request: FileToolsSymlinkTargetRequest,
) -> ApiResult<FileToolsSymlinkTargetResult> {
    let path = PathBuf::from(require_path(&request.path, "Symlink path")?);
    let metadata = fs::symlink_metadata(&path).map_err(io_error(&path))?;
    if !metadata.file_type().is_symlink() {
        return Err(ApiError::Message(format!(
            "{} is not a symlink.",
            path.display()
        )));
    }
    let target = fs::read_link(&path).map_err(io_error(&path))?;
    let resolved = if target.is_absolute() {
        target.clone()
    } else {
        path.parent().unwrap_or_else(|| Path::new("")).join(&target)
    };
    let target_metadata = fs::metadata(&resolved).ok();
    Ok(FileToolsSymlinkTargetResult {
        path: path.display().to_string(),
        target_path: target.display().to_string(),
        resolved_target_path: resolved.display().to_string(),
        target_exists: target_metadata.is_some(),
        target_is_dir: target_metadata.is_some_and(|metadata| metadata.is_dir()),
    })
}

fn remote_target_from_misty_uri(value: &str) -> ApiResult<Option<RemoteBrowseTarget>> {
    let Some(rest) = value.trim().strip_prefix("misty://") else {
        return Ok(None);
    };
    let (remote_name, remote_path) = rest.split_once('/').unwrap_or((rest, ""));
    let remote_name = validate_remote_name(remote_name)?;
    let remote_path = if remote_path.trim().is_empty() {
        "/".to_owned()
    } else {
        normalize_remote_path(&format!("/{remote_path}"))?
    };
    Ok(Some(RemoteBrowseTarget {
        provider_type: String::new(),
        remote_name: remote_name.to_owned(),
        remote_path,
    }))
}

fn validate_remote_name(value: &str) -> ApiResult<&str> {
    let value = value.trim();
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains('/')
        || value.contains('\\')
        || value.contains(':')
    {
        return Err(ApiError::Message(format!("Invalid remote name '{value}'.")));
    }
    Ok(value)
}

fn remote_root_uri_to_mount_path(root: &str, mount_root: &Path) -> ApiResult<Option<String>> {
    let root = root.trim();
    if let Some(target) = remote_target_from_misty_uri(root)? {
        return Ok(Some(target.virtual_path(mount_root).display().to_string()));
    }
    Ok(None)
}

async fn read_json_file<T>(path: &Path) -> ApiResult<T>
where
    T: for<'de> Deserialize<'de> + Default,
{
    match tokio::fs::read(path).await {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(ApiError::from),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(T::default()),
        Err(err) => Err(ApiError::Message(format!(
            "Could not read {}: {err}",
            path.display()
        ))),
    }
}

async fn write_json_file<T: Serialize>(path: &Path, value: &T) -> ApiResult<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|err| {
            ApiError::Message(format!("Could not create {}: {err}", parent.display()))
        })?;
    }
    let bytes = serde_json::to_vec_pretty(value)?;
    tokio::fs::write(path, bytes)
        .await
        .map_err(|err| ApiError::Message(format!("Could not write {}: {err}", path.display())))
}

fn folder_inventory(root: &Path) -> ApiResult<BTreeMap<String, u64>> {
    let mut map = BTreeMap::new();
    for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(root)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .to_string();
        let size = entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
        map.insert(relative, size);
    }
    Ok(map)
}

fn archive_format(path: &Path) -> String {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if name.ends_with(".zip") {
        "zip"
    } else if name.ends_with(".tar")
        || name.ends_with(".tar.gz")
        || name.ends_with(".tgz")
        || name.ends_with(".tar.bz2")
        || name.ends_with(".tbz")
        || name.ends_with(".tbz2")
        || name.ends_with(".tar.xz")
        || name.ends_with(".txz")
    {
        "tar"
    } else if name.ends_with(".7z") {
        "7z"
    } else if name.ends_with(".rar") {
        "rar"
    } else {
        "unknown"
    }
    .to_owned()
}

fn archive_tool_output(path: &Path, _args: &[&str]) -> ApiResult<String> {
    match archive_format(path).as_str() {
        "tar" => command_output(Command::new("tar").arg("-tf").arg(path), "tar"),
        "7z" => command_output(Command::new("7z").arg("l").arg("-ba").arg(path), "7z"),
        "rar" => command_output(Command::new("unrar").arg("lb").arg(path), "unrar"),
        _ => Err(unsupported_archive_tool(path)),
    }
}

fn archive_tool_extract(path: &Path, destination: &Path) -> ApiResult<String> {
    match archive_format(path).as_str() {
        "tar" => {
            command_output(
                Command::new("tar")
                    .arg("-xf")
                    .arg(path)
                    .arg("-C")
                    .arg(destination),
                "tar",
            )?;
            Ok("Extracted archive with tar.".to_owned())
        }
        "7z" => {
            command_output(
                Command::new("7z")
                    .arg("x")
                    .arg(path)
                    .arg(format!("-o{}", destination.display())),
                "7z",
            )?;
            Ok("Extracted archive with 7z.".to_owned())
        }
        "rar" => {
            command_output(
                Command::new("unrar").arg("x").arg(path).arg(destination),
                "unrar",
            )?;
            Ok("Extracted archive with unrar.".to_owned())
        }
        _ => Err(unsupported_archive_tool(path)),
    }
}

fn command_output(command: &mut Command, tool_name: &str) -> ApiResult<String> {
    let output = command.output().map_err(|err| {
        ApiError::Message(format!(
            "{tool_name} is required for this archive format but could not be started: {err}"
        ))
    })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ApiError::Message(format!(
            "{tool_name} failed: {}",
            stderr.trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn unsupported_archive_tool(path: &Path) -> ApiError {
    ApiError::Message(format!(
        "Unsupported archive format for {}. ZIP is native; install tar, 7z, or unrar for other formats.",
        path.display()
    ))
}

fn safe_archive_relative_path(entry_name: &str) -> Option<PathBuf> {
    let entry_path = Path::new(entry_name);
    if entry_path.is_absolute() {
        return None;
    }
    let mut relative = PathBuf::new();
    for component in entry_path.components() {
        match component {
            Component::Normal(value) => relative.push(value),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!relative.as_os_str().is_empty()).then_some(relative)
}

fn archive_name(path: &Path) -> ApiResult<String> {
    let Some(relative) = safe_archive_relative_path(&path.to_string_lossy()) else {
        return Err(ApiError::Message(format!(
            "Unsafe archive path: {}",
            path.display()
        )));
    };
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn io_error(path: &Path) -> impl FnOnce(io::Error) -> ApiError + '_ {
    move |err| ApiError::Message(format!("{}: {err}", path.display()))
}

fn require_path(value: &str, label: &str) -> ApiResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(ApiError::Message(format!("{label} is required.")))
    } else {
        Ok(trimmed.to_owned())
    }
}

fn is_canceled(scan_id: &str, cancellations: &Arc<Mutex<HashMap<String, bool>>>) -> bool {
    cancellations
        .try_lock()
        .ok()
        .and_then(|items| items.get(scan_id).copied())
        .unwrap_or(false)
}

fn system_time_ms(value: Option<SystemTime>) -> u64 {
    value
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn now_ms() -> u64 {
    system_time_ms(Some(SystemTime::now()))
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", now_ms())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_root_uri_maps_to_mount_path() {
        let mount_root = Path::new("/Users/misty/.misty/mnt");
        let path = remote_root_uri_to_mount_path("misty://drive-work/Reports", mount_root)
            .unwrap()
            .expect("remote path");

        assert_eq!(path, "/Users/misty/.misty/mnt/drive-work/Reports");
    }

    #[test]
    fn duplicate_result_reports_remote_candidates_before_approval() {
        let sources = vec![
            duplicate_source("/tmp/local.txt", 42, None, false),
            duplicate_source("/mnt/drive/remote.txt", 42, None, true),
        ];

        let result =
            duplicate_result_from_sources("scan".to_owned(), sources, false, false).unwrap();

        assert_eq!(result.groups.len(), 1);
        assert_eq!(result.remote_candidate_count, 1);
        assert!(!result.remote_hashing_approved);
        assert!(result
            .message
            .contains("Remote approval can hash 1 remote candidate"));
    }

    #[test]
    fn duplicate_result_groups_approved_remote_hashes_with_local_hashes() {
        let hash = Some("abc123".to_owned());
        let sources = vec![
            duplicate_source("/tmp/local.txt", 42, hash.clone(), false),
            duplicate_source("/mnt/drive/remote.txt", 42, hash, true),
        ];

        let result = duplicate_result_from_sources("scan".to_owned(), sources, true, true).unwrap();

        assert_eq!(result.groups.len(), 1);
        assert_eq!(result.groups[0].key, "abc123");
        assert_eq!(result.groups[0].items.len(), 2);
        assert_eq!(result.remote_candidate_count, 1);
        assert!(result.remote_hashing_approved);
    }

    fn duplicate_source(
        path: &str,
        size_bytes: u64,
        sha256: Option<String>,
        remote: bool,
    ) -> DuplicateCandidateSource {
        DuplicateCandidateSource {
            remote_modified: remote.then(|| "2026-06-21T00:00:00Z".to_owned()),
            remote,
            candidate: DuplicateCandidate {
                path: path.to_owned(),
                size_bytes,
                modified_ms: 0,
                sha256,
                remote,
            },
        }
    }
}
