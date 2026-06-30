use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs::{self, File},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    process::Command,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{
    sync::{watch, Mutex},
    task::JoinHandle,
};
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

use crate::core::explorer::{
    ClipboardOperation, FileEntry, FileKind, ListDirectoryRequest, PasteItem, PasteItemsRequest,
    RenameItemRequest, RenameItemsRequest,
};
use crate::core::file_master::{normalize_remote_path, RemoteBrowseTarget};
use crate::error::{ApiError, ApiResult};
use crate::services::{
    environment::AppEnvironmentService, explorer::ExplorerService,
    operation_queue::OperationQueueService,
};

#[derive(Clone)]
pub struct PowerPackService {
    saved_searches_path: PathBuf,
    automation_rules_path: PathBuf,
    mount_root: PathBuf,
    explorer: ExplorerService,
    operation_queue: OperationQueueService,
    automation_watcher: Arc<Mutex<Option<AutomationWatcherHandle>>>,
    automation_watch_state: Arc<Mutex<AutomationWatchRuntimeState>>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRule {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    #[serde(default)]
    pub roots: Vec<String>,
    #[serde(default)]
    pub conditions: Vec<SavedSearchRule>,
    #[serde(default)]
    pub actions: Vec<String>,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRulesSnapshot {
    #[serde(default)]
    pub rules: Vec<AutomationRule>,
    #[serde(default)]
    pub activity: Vec<AutomationActivityEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunResult {
    pub rule_id: String,
    pub activity_id: String,
    pub dry_run: bool,
    pub matched_paths: Vec<String>,
    pub queued_count: usize,
    pub action_results: Vec<AutomationActionResult>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationActivityEntry {
    pub id: String,
    pub rule_id: String,
    pub rule_name: String,
    pub started_at_ms: u64,
    pub dry_run: bool,
    pub matched_count: usize,
    pub queued_count: usize,
    pub message: String,
    #[serde(default)]
    pub action_results: Vec<AutomationActionResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationActionResult {
    pub action: String,
    pub status: String,
    pub message: String,
    #[serde(default)]
    pub affected_paths: Vec<String>,
    #[serde(default)]
    pub queued_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationWatchSnapshot {
    pub active: bool,
    pub poll_interval_ms: u64,
    pub watched_rule_count: usize,
    pub watched_roots: Vec<String>,
    pub remote_root_count: usize,
    pub last_scan_ms: u64,
    pub last_run_ms: u64,
    pub last_message: String,
}

#[derive(Debug)]
struct AutomationWatcherHandle {
    stop: watch::Sender<bool>,
    task: JoinHandle<()>,
    poll_interval_ms: u64,
}

#[derive(Debug, Clone)]
struct AutomationMatchedPath {
    path: String,
    signature: String,
}

#[derive(Debug, Clone)]
struct AutomationWatchRuntimeState {
    active: bool,
    poll_interval_ms: u64,
    watched_rule_count: usize,
    watched_roots: Vec<String>,
    remote_root_count: usize,
    last_scan_ms: u64,
    last_run_ms: u64,
    last_message: String,
}

impl Default for AutomationWatchRuntimeState {
    fn default() -> Self {
        Self {
            active: false,
            poll_interval_ms: DEFAULT_AUTOMATION_WATCH_INTERVAL_MS,
            watched_rule_count: 0,
            watched_roots: Vec::new(),
            remote_root_count: 0,
            last_scan_ms: 0,
            last_run_ms: 0,
            last_message: "Automation watcher is stopped.".to_owned(),
        }
    }
}

const DEFAULT_AUTOMATION_WATCH_INTERVAL_MS: u64 = 5_000;
const MIN_AUTOMATION_WATCH_INTERVAL_MS: u64 = 1_000;

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
        operation_queue: OperationQueueService,
    ) -> Self {
        let config_dir = environment.config_dir();
        Self {
            saved_searches_path: config_dir.join("saved-searches.json"),
            automation_rules_path: config_dir.join("automation-rules.json"),
            mount_root: environment.mount_root(),
            explorer,
            operation_queue,
            automation_watcher: Arc::new(Mutex::new(None)),
            automation_watch_state: Arc::new(Mutex::new(AutomationWatchRuntimeState::default())),
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
                    .prepare_open_item(crate::core::explorer::PrepareOpenItemRequest {
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

    pub async fn automation_rules_snapshot(&self) -> ApiResult<AutomationRulesSnapshot> {
        read_json_file(&self.automation_rules_path).await
    }

    pub async fn automation_watch_snapshot(&self) -> AutomationWatchSnapshot {
        let state = self.automation_watch_state.lock().await;
        automation_watch_snapshot_from_state(&state)
    }

    pub async fn automation_watch_start(
        &self,
        poll_interval_ms: Option<u64>,
    ) -> ApiResult<AutomationWatchSnapshot> {
        let interval_ms = poll_interval_ms
            .unwrap_or(DEFAULT_AUTOMATION_WATCH_INTERVAL_MS)
            .max(MIN_AUTOMATION_WATCH_INTERVAL_MS);
        let mut watcher = self.automation_watcher.lock().await;
        if let Some(existing) = watcher.as_ref() {
            if existing.poll_interval_ms == interval_ms {
                return Ok(self.automation_watch_snapshot().await);
            }
            let _ = existing.stop.send(true);
        }
        let (stop_tx, stop_rx) = watch::channel(false);
        let service = self.clone();
        let task = tokio::spawn(async move {
            service.automation_watch_loop(interval_ms, stop_rx).await;
        });
        *watcher = Some(AutomationWatcherHandle {
            stop: stop_tx,
            task,
            poll_interval_ms: interval_ms,
        });
        {
            let mut state = self.automation_watch_state.lock().await;
            state.active = true;
            state.poll_interval_ms = interval_ms;
            state.last_message = "Automation watcher started.".to_owned();
        }
        Ok(self.automation_watch_snapshot().await)
    }

    pub async fn automation_watch_stop(&self) -> AutomationWatchSnapshot {
        if let Some(handle) = self.automation_watcher.lock().await.take() {
            let _ = handle.stop.send(true);
            handle.task.abort();
        }
        {
            let mut state = self.automation_watch_state.lock().await;
            state.active = false;
            state.last_message = "Automation watcher stopped.".to_owned();
        }
        self.automation_watch_snapshot().await
    }

    pub async fn automation_rules_save(
        &self,
        rule: AutomationRule,
    ) -> ApiResult<AutomationRulesSnapshot> {
        let mut snapshot: AutomationRulesSnapshot =
            read_json_file(&self.automation_rules_path).await?;
        let mut next = rule;
        if next.id.trim().is_empty() {
            next.id = new_id("rule");
        }
        next.updated_at_ms = now_ms();
        if let Some(existing) = snapshot.rules.iter_mut().find(|item| item.id == next.id) {
            *existing = next;
        } else {
            snapshot.rules.push(next);
        }
        snapshot
            .rules
            .sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        write_json_file(&self.automation_rules_path, &snapshot).await?;
        Ok(snapshot)
    }

    pub async fn automation_rules_delete(&self, id: String) -> ApiResult<AutomationRulesSnapshot> {
        let mut snapshot: AutomationRulesSnapshot =
            read_json_file(&self.automation_rules_path).await?;
        snapshot.rules.retain(|item| item.id != id);
        write_json_file(&self.automation_rules_path, &snapshot).await?;
        Ok(snapshot)
    }

    pub async fn automation_rules_run_now(
        &self,
        id: String,
        dry_run: bool,
    ) -> ApiResult<AutomationRunResult> {
        let mut snapshot: AutomationRulesSnapshot =
            read_json_file(&self.automation_rules_path).await?;
        let rule = snapshot
            .rules
            .iter()
            .cloned()
            .find(|rule| rule.id == id)
            .ok_or_else(|| ApiError::Message(format!("Automation rule {id} was not found.")))?;
        let matched_entries = self.automation_match_entries(&rule).await?;
        let matched_paths = matched_entries
            .iter()
            .map(|entry| entry.path.clone())
            .collect::<Vec<_>>();
        let action_results = if dry_run {
            automation_preview_actions(&rule, &matched_paths)
        } else {
            self.automation_execute_actions(&rule, &matched_paths).await
        };
        let queued_count = action_results
            .iter()
            .map(|result| result.queued_count)
            .sum();
        let activity_id = new_id("auto-run");
        let message = automation_run_message(dry_run, matched_paths.len(), queued_count);
        let activity = AutomationActivityEntry {
            id: activity_id.clone(),
            rule_id: rule.id.clone(),
            rule_name: rule.name.clone(),
            started_at_ms: now_ms(),
            dry_run,
            matched_count: matched_paths.len(),
            queued_count,
            message: message.clone(),
            action_results: action_results.clone(),
        };
        snapshot.activity.insert(0, activity);
        snapshot.activity.truncate(100);
        write_json_file(&self.automation_rules_path, &snapshot).await?;
        Ok(AutomationRunResult {
            rule_id: rule.id,
            activity_id,
            dry_run,
            queued_count,
            action_results,
            message,
            matched_paths,
        })
    }

    async fn automation_execute_actions(
        &self,
        rule: &AutomationRule,
        matched_paths: &[String],
    ) -> Vec<AutomationActionResult> {
        let mut results = Vec::new();
        for action in clean_automation_actions(&rule.actions) {
            results.push(
                match execute_automation_action(
                    &self.operation_queue,
                    &self.mount_root,
                    &action,
                    matched_paths,
                )
                .await
                {
                    Ok(result) => result,
                    Err(error) => AutomationActionResult {
                        action,
                        status: "failed".to_owned(),
                        message: error.to_string(),
                        affected_paths: Vec::new(),
                        queued_count: 0,
                    },
                },
            );
        }
        results
    }

    async fn automation_match_entries(
        &self,
        rule: &AutomationRule,
    ) -> ApiResult<Vec<AutomationMatchedPath>> {
        let mut entries = Vec::new();
        for root in &rule.roots {
            let root = root.trim();
            if root.is_empty() {
                continue;
            }
            if root.starts_with("misty://") {
                entries.extend(self.automation_match_remote_entries(rule, root).await?);
            } else {
                entries.extend(automation_match_local_entries(rule, root)?);
            }
        }
        entries.sort_by(|left, right| left.path.cmp(&right.path));
        entries.dedup_by(|left, right| left.path == right.path);
        Ok(entries)
    }

    async fn automation_match_remote_entries(
        &self,
        rule: &AutomationRule,
        root: &str,
    ) -> ApiResult<Vec<AutomationMatchedPath>> {
        let Some(root_path) = automation_remote_root_to_mount_path(root, &self.mount_root)? else {
            return Ok(Vec::new());
        };
        let mut matched = Vec::new();
        let mut pending = vec![(root_path, 0usize)];
        while let Some((path, depth)) = pending.pop() {
            let listing = self
                .explorer
                .list_directory(ListDirectoryRequest {
                    path: Some(path.clone()),
                    show_hidden: Some(true),
                    force_remote_refresh: Some(true),
                })
                .await?;
            for entry in listing.entries {
                if rule
                    .conditions
                    .iter()
                    .all(|condition| rule_matches_path(condition, &entry.path))
                {
                    matched.push(automation_remote_match_entry(&entry));
                }
                if matches!(entry.kind, FileKind::Folder) && depth < 1 {
                    pending.push((entry.path, depth + 1));
                }
            }
        }
        Ok(matched)
    }

    async fn duplicate_remote_sources(
        &self,
        roots: &[String],
    ) -> ApiResult<Vec<DuplicateCandidateSource>> {
        let mut sources = Vec::new();
        for root in roots {
            let Some(root_path) = automation_remote_root_to_mount_path(root, &self.mount_root)?
            else {
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

    async fn automation_watch_loop(&self, interval_ms: u64, mut stop_rx: watch::Receiver<bool>) {
        let mut signatures: HashMap<String, String> = HashMap::new();
        loop {
            if *stop_rx.borrow() {
                break;
            }
            let scan_message = match self.automation_watch_scan(&mut signatures).await {
                Ok(message) => message,
                Err(error) => format!("Automation watcher scan failed: {error}"),
            };
            {
                let mut state = self.automation_watch_state.lock().await;
                state.active = true;
                state.poll_interval_ms = interval_ms;
                state.last_scan_ms = now_ms();
                state.last_message = scan_message;
            }
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(interval_ms)) => {}
                changed = stop_rx.changed() => {
                    if changed.is_ok() && *stop_rx.borrow() {
                        break;
                    }
                }
            }
        }
        let mut state = self.automation_watch_state.lock().await;
        state.active = false;
        state.last_message = "Automation watcher stopped.".to_owned();
    }

    async fn automation_watch_scan(
        &self,
        signatures: &mut HashMap<String, String>,
    ) -> ApiResult<String> {
        let snapshot: AutomationRulesSnapshot = read_json_file(&self.automation_rules_path).await?;
        let enabled_rules = snapshot
            .rules
            .into_iter()
            .filter(|rule| rule.enabled)
            .collect::<Vec<_>>();
        let watched_roots = automation_watched_roots(&enabled_rules, false);
        let remote_root_count = automation_watched_roots(&enabled_rules, true).len();
        {
            let mut state = self.automation_watch_state.lock().await;
            state.watched_rule_count = enabled_rules.len();
            state.watched_roots = watched_roots;
            state.remote_root_count = remote_root_count;
        }
        let mut triggered = 0usize;
        for rule in enabled_rules {
            if !rule_has_pollable_root(&rule) {
                continue;
            }
            let matched_entries = self.automation_match_entries(&rule).await?;
            let matched_paths = matched_entries
                .iter()
                .map(|entry| entry.path.clone())
                .collect::<Vec<_>>();
            let signature = automation_match_entries_signature(&matched_entries);
            match signatures.insert(rule.id.clone(), signature.clone()) {
                None => {}
                Some(previous) if previous != signature && !matched_paths.is_empty() => {
                    let result = self
                        .automation_rules_run_now(rule.id.clone(), false)
                        .await?;
                    triggered += 1;
                    let mut state = self.automation_watch_state.lock().await;
                    state.last_run_ms = now_ms();
                    state.last_message = format!("Watcher executed {}.", result.message);
                }
                _ => {}
            }
        }
        Ok(if triggered == 0 {
            "Automation watcher scanned without changes.".to_owned()
        } else {
            format!("Automation watcher triggered {triggered} rule(s).")
        })
    }
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
        let mut archive = ZipArchive::new(file)
            .map_err(|err| ApiError::Message(format!("Could not read ZIP archive: {err}")))?;
        let mut entries = Vec::new();
        for index in 0..archive.len() {
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

fn clean_automation_actions(actions: &[String]) -> Vec<String> {
    actions
        .iter()
        .map(|action| action.trim())
        .filter(|action| !action.is_empty())
        .map(str::to_owned)
        .collect()
}

fn automation_watch_snapshot_from_state(
    state: &AutomationWatchRuntimeState,
) -> AutomationWatchSnapshot {
    AutomationWatchSnapshot {
        active: state.active,
        poll_interval_ms: state.poll_interval_ms,
        watched_rule_count: state.watched_rule_count,
        watched_roots: state.watched_roots.clone(),
        remote_root_count: state.remote_root_count,
        last_scan_ms: state.last_scan_ms,
        last_run_ms: state.last_run_ms,
        last_message: state.last_message.clone(),
    }
}

fn automation_watched_roots(rules: &[AutomationRule], remote: bool) -> Vec<String> {
    let mut roots = BTreeSet::new();
    for rule in rules {
        for root in &rule.roots {
            let trimmed = root.trim();
            if trimmed.is_empty() {
                continue;
            }
            let is_remote = trimmed.starts_with("misty://");
            if is_remote == remote {
                roots.insert(trimmed.to_owned());
            }
        }
    }
    roots.into_iter().collect()
}

fn rule_has_pollable_root(rule: &AutomationRule) -> bool {
    rule.roots.iter().any(|root| !root.trim().is_empty())
}

fn automation_match_signature(paths: &[String]) -> String {
    let mut signatures = paths
        .iter()
        .map(|path| automation_local_path_signature(path))
        .collect::<Vec<_>>();
    signatures.sort();
    signatures.join("\n")
}

fn automation_match_entries_signature(entries: &[AutomationMatchedPath]) -> String {
    let mut signatures = entries
        .iter()
        .map(|entry| entry.signature.clone())
        .collect::<Vec<_>>();
    signatures.sort();
    signatures.join("\n")
}

fn automation_preview_actions(
    rule: &AutomationRule,
    matched_paths: &[String],
) -> Vec<AutomationActionResult> {
    clean_automation_actions(&rule.actions)
        .into_iter()
        .map(|action| preview_automation_action(&action, matched_paths))
        .collect()
}

fn preview_automation_action(action: &str, matched_paths: &[String]) -> AutomationActionResult {
    let (kind, value) = split_automation_action(action);
    match kind {
        "rename" => AutomationActionResult {
            action: action.to_owned(),
            status: "would_queue".to_owned(),
            message: format!("Would queue {} rename operation(s).", matched_paths.len()),
            affected_paths: matched_paths
                .iter()
                .filter_map(|path| rename_target_path(path, value).ok())
                .collect(),
            queued_count: matched_paths.len(),
        },
        "move" | "copy" => AutomationActionResult {
            action: action.to_owned(),
            status: "would_queue".to_owned(),
            message: format!(
                "Would queue {} {} operation(s) to {}.",
                matched_paths.len(),
                kind,
                value
            ),
            affected_paths: matched_paths
                .iter()
                .map(|path| destination_path_for_action(path, value))
                .collect(),
            queued_count: matched_paths.len(),
        },
        "compress" => AutomationActionResult {
            action: action.to_owned(),
            status: "would_queue".to_owned(),
            message: format!(
                "Would queue archive {} from {} item(s).",
                value,
                matched_paths.len()
            ),
            affected_paths: vec![value.to_owned()],
            queued_count: usize::from(!matched_paths.is_empty()),
        },
        "upload" => AutomationActionResult {
            action: action.to_owned(),
            status: "would_queue".to_owned(),
            message: format!(
                "Would queue {} upload operation(s) to {}.",
                matched_paths.len(),
                value
            ),
            affected_paths: matched_paths
                .iter()
                .map(|path| destination_path_for_action(path, value))
                .collect(),
            queued_count: matched_paths.len(),
        },
        _ => AutomationActionResult {
            action: action.to_owned(),
            status: "unsupported".to_owned(),
            message: format!("Unknown automation action '{kind}'."),
            affected_paths: Vec::new(),
            queued_count: 0,
        },
    }
}

async fn execute_automation_action(
    operation_queue: &OperationQueueService,
    mount_root: &Path,
    action: &str,
    matched_paths: &[String],
) -> ApiResult<AutomationActionResult> {
    if matched_paths.is_empty() {
        return Ok(AutomationActionResult {
            action: action.to_owned(),
            status: "skipped".to_owned(),
            message: "No matched paths to process.".to_owned(),
            affected_paths: Vec::new(),
            queued_count: 0,
        });
    }
    let (kind, value) = split_automation_action(action);
    match kind {
        "rename" => execute_automation_rename(operation_queue, action, value, matched_paths).await,
        "move" | "copy" => {
            execute_automation_paste(operation_queue, action, kind, value, matched_paths).await
        }
        "compress" => {
            execute_automation_compress(operation_queue, action, value, matched_paths).await
        }
        "upload" => {
            execute_automation_upload(operation_queue, mount_root, action, value, matched_paths)
                .await
        }
        _ => Ok(AutomationActionResult {
            action: action.to_owned(),
            status: "unsupported".to_owned(),
            message: format!("Unknown automation action '{kind}'."),
            affected_paths: Vec::new(),
            queued_count: 0,
        }),
    }
}

async fn execute_automation_rename(
    operation_queue: &OperationQueueService,
    action: &str,
    template: &str,
    matched_paths: &[String],
) -> ApiResult<AutomationActionResult> {
    let mut items = Vec::new();
    let mut affected_paths = Vec::new();
    for path in matched_paths {
        let target_path = rename_target_path(path, template)?;
        let Some(new_name) = Path::new(&target_path)
            .file_name()
            .and_then(|value| value.to_str())
            .map(str::to_owned)
        else {
            continue;
        };
        if Path::new(path).file_name().and_then(|value| value.to_str()) == Some(new_name.as_str()) {
            continue;
        }
        affected_paths.push(target_path);
        items.push(RenameItemRequest {
            path: path.clone(),
            new_name,
            source_is_directory: local_path_is_dir(path),
        });
    }
    let queued_count = items.len();
    operation_queue
        .enqueue_rename_items(RenameItemsRequest { items })
        .await?;
    Ok(AutomationActionResult {
        action: action.to_owned(),
        status: if queued_count == 0 {
            "skipped".to_owned()
        } else {
            "queued".to_owned()
        },
        message: format!("Queued {queued_count} rename operation(s)."),
        affected_paths,
        queued_count,
    })
}

async fn execute_automation_paste(
    operation_queue: &OperationQueueService,
    action: &str,
    kind: &str,
    destination_directory: &str,
    matched_paths: &[String],
) -> ApiResult<AutomationActionResult> {
    if destination_directory.trim().is_empty() {
        return Err(ApiError::Message(format!(
            "{kind} action is missing a destination."
        )));
    }
    let sources = matched_paths
        .iter()
        .map(|path| PasteItem {
            path: path.clone(),
            is_directory: local_path_is_dir(path).unwrap_or(false),
        })
        .collect::<Vec<_>>();
    let queued_count = sources.len();
    let affected_paths = matched_paths
        .iter()
        .map(|path| destination_path_for_action(path, destination_directory))
        .collect::<Vec<_>>();
    let operation = if kind == "move" {
        ClipboardOperation::Move
    } else {
        ClipboardOperation::Copy
    };
    operation_queue
        .enqueue_paste_items(PasteItemsRequest {
            sources,
            destination_directory: destination_directory.to_owned(),
            operation,
            target_name: None,
        })
        .await?;
    Ok(AutomationActionResult {
        action: action.to_owned(),
        status: "queued".to_owned(),
        message: format!("Queued {queued_count} {kind} operation(s)."),
        affected_paths,
        queued_count,
    })
}

async fn execute_automation_upload(
    operation_queue: &OperationQueueService,
    mount_root: &Path,
    action: &str,
    destination_directory: &str,
    matched_paths: &[String],
) -> ApiResult<AutomationActionResult> {
    let destination_directory = automation_upload_destination(destination_directory, mount_root)?;
    execute_automation_paste(
        operation_queue,
        action,
        "upload",
        &destination_directory,
        matched_paths,
    )
    .await
}

async fn execute_automation_compress(
    operation_queue: &OperationQueueService,
    action: &str,
    destination_path: &str,
    matched_paths: &[String],
) -> ApiResult<AutomationActionResult> {
    if destination_path.trim().is_empty() {
        return Err(ApiError::Message(
            "compress action is missing an archive destination.".to_owned(),
        ));
    }
    let request = ArchiveCreateRequest {
        paths: matched_paths.to_vec(),
        destination_path: destination_path.to_owned(),
    };
    operation_queue.enqueue_archive_create(request).await?;
    Ok(AutomationActionResult {
        action: action.to_owned(),
        status: "queued".to_owned(),
        message: "Queued archive creation operation.".to_owned(),
        affected_paths: vec![destination_path.to_owned()],
        queued_count: 1,
    })
}

fn split_automation_action(action: &str) -> (&str, &str) {
    action
        .split_once(':')
        .map(|(kind, value)| (kind.trim(), value.trim()))
        .unwrap_or((action.trim(), ""))
}

fn rename_target_path(path: &str, template: &str) -> ApiResult<String> {
    let new_name = expand_rename_template(path, template);
    if new_name.trim().is_empty() || new_name.contains('/') || new_name.contains('\\') {
        return Err(ApiError::Message(format!(
            "Rename template produced an invalid file name for {path}."
        )));
    }
    let parent = Path::new(path).parent().unwrap_or_else(|| Path::new(""));
    Ok(parent.join(new_name).display().to_string())
}

fn expand_rename_template(path: &str, template: &str) -> String {
    let path = Path::new(path);
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(name);
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    template
        .replace("{name}", name)
        .replace("{stem}", stem)
        .replace("{ext}", ext)
}

fn destination_path_for_action(path: &str, destination_directory: &str) -> String {
    let file_name = Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(path);
    if let Some(remote_path) = virtual_destination_path_for_action(destination_directory, file_name)
    {
        return remote_path;
    }
    Path::new(destination_directory)
        .join(file_name)
        .display()
        .to_string()
}

fn automation_upload_destination(
    destination_directory: &str,
    mount_root: &Path,
) -> ApiResult<String> {
    let destination_directory = destination_directory.trim();
    if destination_directory.is_empty() {
        return Err(ApiError::Message(
            "upload action is missing a remote destination.".to_owned(),
        ));
    }
    if let Some(target) = remote_target_from_misty_uri(destination_directory)? {
        return Ok(target.virtual_path(mount_root).display().to_string());
    }
    if let Some(target) = remote_target_from_shorthand(destination_directory)? {
        return Ok(target.virtual_path(mount_root).display().to_string());
    }
    if RemoteBrowseTarget::from_virtual_path(mount_root, Path::new(destination_directory)).is_some()
    {
        return Ok(destination_directory.to_owned());
    }
    Err(ApiError::Message(
        "upload action destination must be a mounted remote path, misty://remote/path, or remote:/path."
            .to_owned(),
    ))
}

fn virtual_destination_path_for_action(
    destination_directory: &str,
    file_name: &str,
) -> Option<String> {
    let destination_directory = destination_directory.trim();
    if destination_directory.starts_with("misty://") {
        let destination_directory = destination_directory.trim_end_matches('/');
        return Some(format!("{destination_directory}/{file_name}"));
    }
    let (remote_name, remote_path) = split_remote_shorthand(destination_directory)?;
    let remote_path = remote_path.trim_end_matches('/');
    Some(if remote_path == "/" {
        format!("{remote_name}:/{file_name}")
    } else {
        format!("{remote_name}:{remote_path}/{file_name}")
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

fn remote_target_from_shorthand(value: &str) -> ApiResult<Option<RemoteBrowseTarget>> {
    let Some((remote_name, remote_path)) = split_remote_shorthand(value.trim()) else {
        return Ok(None);
    };
    let remote_name = validate_remote_name(remote_name)?;
    Ok(Some(RemoteBrowseTarget {
        provider_type: String::new(),
        remote_name: remote_name.to_owned(),
        remote_path: normalize_remote_path(remote_path)?,
    }))
}

fn split_remote_shorthand(value: &str) -> Option<(&str, &str)> {
    let (remote_name, _remote_path) = value.split_once(":/")?;
    if remote_name.contains('/') || remote_name.contains('\\') || remote_name.contains(':') {
        return None;
    }
    Some((remote_name, &value[remote_name.len() + 1..]))
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

fn local_path_is_dir(path: &str) -> Option<bool> {
    fs::metadata(path).ok().map(|metadata| metadata.is_dir())
}

fn automation_run_message(dry_run: bool, matched_count: usize, queued_count: usize) -> String {
    if dry_run {
        return format!(
            "Dry run matched {} item{}.",
            matched_count,
            if matched_count == 1 { "" } else { "s" }
        );
    }
    format!(
        "Automation matched {} item{} and queued {} operation{}.",
        matched_count,
        if matched_count == 1 { "" } else { "s" },
        queued_count,
        if queued_count == 1 { "" } else { "s" }
    )
}

fn automation_match_local_entries(
    rule: &AutomationRule,
    root: &str,
) -> ApiResult<Vec<AutomationMatchedPath>> {
    let root = PathBuf::from(root);
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut paths = Vec::new();
    for entry in WalkDir::new(root)
        .max_depth(2)
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = entry.path().display().to_string();
        if rule
            .conditions
            .iter()
            .all(|condition| rule_matches_path(condition, &path))
        {
            paths.push(AutomationMatchedPath {
                signature: automation_local_path_signature(&path),
                path,
            });
        }
    }
    Ok(paths)
}

fn automation_local_path_signature(path: &str) -> String {
    let metadata = fs::metadata(path).ok();
    format!(
        "{}:{}:{}",
        path,
        metadata
            .as_ref()
            .map(|metadata| metadata.len())
            .unwrap_or(0),
        metadata
            .map(|metadata| system_time_ms(metadata.modified().ok()))
            .unwrap_or(0)
    )
}

fn automation_remote_match_entry(entry: &FileEntry) -> AutomationMatchedPath {
    let kind = match entry.kind {
        FileKind::Folder => "folder",
        FileKind::File => "file",
        FileKind::Symlink => "symlink",
        FileKind::Other => "other",
    };
    let signature = format!(
        "{}:{}:{}:{}",
        entry.path,
        kind,
        entry.size_bytes.unwrap_or(0),
        entry.remote_modified.as_deref().unwrap_or_default()
    );
    AutomationMatchedPath {
        path: entry.path.clone(),
        signature,
    }
}

fn automation_remote_root_to_mount_path(
    root: &str,
    mount_root: &Path,
) -> ApiResult<Option<String>> {
    let root = root.trim();
    if let Some(target) = remote_target_from_misty_uri(root)? {
        return Ok(Some(target.virtual_path(mount_root).display().to_string()));
    }
    Ok(None)
}

fn rule_matches_path(rule: &SavedSearchRule, path: &str) -> bool {
    match (rule.field.as_str(), rule.operator.as_str()) {
        ("path" | "name", "contains") => path.to_lowercase().contains(&rule.value.to_lowercase()),
        ("path" | "name", "ends_with") => path.to_lowercase().ends_with(&rule.value.to_lowercase()),
        _ => true,
    }
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
    use crate::services::{
        explorer::ExplorerService, explorer_library::ExplorerLibraryService,
        providers::ProviderService, proxy::ProxyService, transfers::TransferService,
    };

    #[tokio::test]
    async fn automation_execute_copy_queues_operation_and_records_activity() {
        let root = unique_test_dir("automation-copy");
        let source_dir = root.join("source");
        let destination_dir = root.join("destination");
        fs::create_dir_all(&source_dir).unwrap();
        fs::create_dir_all(&destination_dir).unwrap();
        fs::write(source_dir.join("source.txt"), b"hello").unwrap();

        let (service, operation_queue) = test_power_pack_service(root.join("home"));
        service
            .automation_rules_save(AutomationRule {
                id: "copy-rule".to_owned(),
                name: "Copy Rule".to_owned(),
                enabled: true,
                roots: vec![source_dir.display().to_string()],
                conditions: vec![SavedSearchRule {
                    field: "name".to_owned(),
                    operator: "ends_with".to_owned(),
                    value: "source.txt".to_owned(),
                }],
                actions: vec![format!("copy:{}", destination_dir.display())],
                updated_at_ms: 0,
            })
            .await
            .unwrap();

        let result = service
            .automation_rules_run_now("copy-rule".to_owned(), false)
            .await
            .unwrap();

        assert!(!result.dry_run);
        assert_eq!(result.matched_paths.len(), 1);
        assert_eq!(result.queued_count, 1);
        assert_eq!(result.action_results[0].status, "queued");

        let queue_snapshot = operation_queue.snapshot().await;
        assert_eq!(queue_snapshot.operations.len(), 1);
        assert_eq!(
            queue_snapshot.operations[0].kind,
            crate::core::operation_queue::OperationKind::Copy
        );

        let snapshot = service.automation_rules_snapshot().await.unwrap();
        assert_eq!(snapshot.activity.len(), 1);
        assert_eq!(snapshot.activity[0].queued_count, 1);
        assert_eq!(snapshot.activity[0].action_results[0].status, "queued");
    }

    #[tokio::test]
    async fn automation_execute_upload_queues_remote_upload_operation() {
        let root = unique_test_dir("automation-upload");
        let source_dir = root.join("source");
        fs::create_dir_all(&source_dir).unwrap();
        fs::write(source_dir.join("upload.txt"), b"hello remote").unwrap();

        let (service, operation_queue) = test_power_pack_service(root.join("home"));
        service
            .automation_rules_save(AutomationRule {
                id: "upload-rule".to_owned(),
                name: "Upload Rule".to_owned(),
                enabled: true,
                roots: vec![source_dir.display().to_string()],
                conditions: vec![SavedSearchRule {
                    field: "name".to_owned(),
                    operator: "ends_with".to_owned(),
                    value: "upload.txt".to_owned(),
                }],
                actions: vec!["upload:misty://drive-work/uploads".to_owned()],
                updated_at_ms: 0,
            })
            .await
            .unwrap();

        let result = service
            .automation_rules_run_now("upload-rule".to_owned(), false)
            .await
            .unwrap();

        assert!(!result.dry_run);
        assert_eq!(result.queued_count, 1);
        assert_eq!(result.action_results[0].status, "queued");

        let queue_snapshot = operation_queue.snapshot().await;
        assert_eq!(queue_snapshot.operations.len(), 1);
        assert_eq!(
            queue_snapshot.operations[0].kind,
            crate::core::operation_queue::OperationKind::Upload
        );
        assert_eq!(
            queue_snapshot.operations[0].target.remote_name,
            "drive-work"
        );
        assert_eq!(
            queue_snapshot.operations[0].target.remote_path,
            "/uploads/upload.txt"
        );
    }

    #[tokio::test]
    async fn automation_execute_compress_queues_archive_operation() {
        let root = unique_test_dir("automation-compress");
        let source_dir = root.join("source");
        fs::create_dir_all(&source_dir).unwrap();
        fs::write(source_dir.join("compress.txt"), b"archive me").unwrap();
        let archive_path = root.join("out").join("automation.zip");

        let (service, operation_queue) = test_power_pack_service(root.join("home"));
        service
            .automation_rules_save(AutomationRule {
                id: "compress-rule".to_owned(),
                name: "Compress Rule".to_owned(),
                enabled: true,
                roots: vec![source_dir.display().to_string()],
                conditions: vec![SavedSearchRule {
                    field: "name".to_owned(),
                    operator: "ends_with".to_owned(),
                    value: "compress.txt".to_owned(),
                }],
                actions: vec![format!("compress:{}", archive_path.display())],
                updated_at_ms: 0,
            })
            .await
            .unwrap();

        let result = service
            .automation_rules_run_now("compress-rule".to_owned(), false)
            .await
            .unwrap();

        assert!(!result.dry_run);
        assert_eq!(result.queued_count, 1);
        assert_eq!(result.action_results[0].status, "queued");

        let queue_snapshot = operation_queue.snapshot().await;
        assert_eq!(queue_snapshot.operations.len(), 1);
        assert_eq!(
            queue_snapshot.operations[0].kind,
            crate::core::operation_queue::OperationKind::Archive
        );
        assert_eq!(
            queue_snapshot.operations[0].target.local_path,
            archive_path.display().to_string()
        );
    }

    #[test]
    fn automation_watched_roots_separates_local_and_remote_roots() {
        let rules = vec![AutomationRule {
            id: "mixed".to_owned(),
            name: "Mixed".to_owned(),
            enabled: true,
            roots: vec![
                "/tmp/watch".to_owned(),
                "misty://remote/work".to_owned(),
                "/tmp/watch".to_owned(),
            ],
            conditions: Vec::new(),
            actions: Vec::new(),
            updated_at_ms: 0,
        }];
        assert_eq!(automation_watched_roots(&rules, false), vec!["/tmp/watch"]);
        assert_eq!(
            automation_watched_roots(&rules, true),
            vec!["misty://remote/work"]
        );
    }

    #[test]
    fn automation_match_signature_changes_when_file_changes() {
        let root = unique_test_dir("automation-signature");
        fs::create_dir_all(&root).unwrap();
        let file = root.join("item.txt");
        fs::write(&file, b"one").unwrap();
        let paths = vec![file.display().to_string()];
        let first = automation_match_signature(&paths);
        std::thread::sleep(Duration::from_millis(2));
        fs::write(&file, b"two").unwrap();
        let second = automation_match_signature(&paths);
        assert_ne!(first, second);
    }

    #[test]
    fn automation_remote_root_uri_maps_to_mount_path() {
        let mount_root = Path::new("/Users/misty/.misty/mnt");
        let path = automation_remote_root_to_mount_path("misty://drive-work/Reports", mount_root)
            .unwrap()
            .expect("remote path");

        assert_eq!(path, "/Users/misty/.misty/mnt/drive-work/Reports");
    }

    #[test]
    fn automation_remote_match_signature_tracks_size_and_modified_time() {
        let mut entry = FileEntry {
            id: "/mnt/drive/report.txt".to_owned(),
            name: "report.txt".to_owned(),
            path: "/mnt/drive/report.txt".to_owned(),
            extension: "txt".to_owned(),
            mime_type: None,
            remote_modified: Some("2026-06-21T00:00:00Z".to_owned()),
            kind: FileKind::File,
            size_bytes: Some(12),
            modified_ms: None,
            created_ms: None,
            readonly: false,
            hidden: false,
            is_deleted: false,
            location: Default::default(),
        };
        let first = automation_remote_match_entry(&entry).signature;
        entry.size_bytes = Some(24);
        entry.remote_modified = Some("2026-06-21T00:01:00Z".to_owned());
        let second = automation_remote_match_entry(&entry).signature;

        assert_ne!(first, second);
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

    fn test_power_pack_service(home: PathBuf) -> (PowerPackService, OperationQueueService) {
        let environment = AppEnvironmentService::for_test_home(home);
        let proxy = ProxyService::new(environment.clone());
        let providers = ProviderService::new(proxy.clone());
        let transfers = TransferService::new(environment.clone());
        let explorer_library = ExplorerLibraryService::new(environment.clone());
        let explorer = ExplorerService::new(
            environment.clone(),
            proxy,
            providers,
            transfers.clone(),
            explorer_library,
        );
        let operation_queue = OperationQueueService::new(explorer.clone(), transfers);
        (
            PowerPackService::new(environment, explorer, operation_queue.clone()),
            operation_queue,
        )
    }

    fn unique_test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "misty-power-pack-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
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
