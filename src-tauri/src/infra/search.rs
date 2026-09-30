use std::{
    collections::{HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, RwLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
#[cfg(not(target_os = "macos"))]
use tantivy::{
    collector::TopDocs,
    doc,
    query::{AllQuery, BooleanQuery, FuzzyTermQuery, Occur, Query, TermQuery},
    schema::{
        Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, Value, FAST, STORED,
        STRING,
    },
    Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term,
};
use walkdir::WalkDir;

use crate::{
    domain::{
        explorer::{ExplorerLocation, ExplorerLocationKind, FileEntry, FileKind},
        file_master::{
            join_remote_path, normalize_remote_path, RemoteBrowseTarget, RemoteJobStart,
            RemoteJobStatus, RemoteListItem,
        },
        listing_cache::ListingCache,
    },
    error::{ApiError, ApiResult},
    infra::environment::AppEnvironmentService,
};

const SEARCH_SCHEMA_VERSION: u32 = 1;
const INDEX_MEMORY_BUDGET_BYTES: usize = 96 * 1024 * 1024;
const DEFAULT_RESULT_LIMIT: usize = 100;
const DEFAULT_MAX_DEPTH: usize = 18;
const DEFAULT_REMOTE_MAX_DEPTH: usize = 12;
const REMOTE_DIRECTORY_LIMIT: usize = 20_000;
const SEARCH_MANIFEST_FILE: &str = "manifest.sqlite3";
const SCAN_LOCK_FILE: &str = ".scan.lock";
/// A scan that another process finished this recently is not repeated.
const MIN_SCAN_SPACING_MS: u64 = 60_000;
/// Scans run in bursts of this long, then yield for half as long, so a
/// full walk uses at most about two thirds of one core.
const SCAN_BURST: Duration = Duration::from_millis(40);
const SCAN_PAUSE: Duration = Duration::from_millis(20);

#[derive(Clone)]
pub struct SearchService {
    inner: Arc<SearchInner>,
    #[cfg(target_os = "macos")]
    engine: Option<Arc<crate::infra::document_intelligence::ServiceLease>>,
    #[cfg(target_os = "macos")]
    scopes: Arc<Mutex<std::collections::HashMap<String, Arc<SearchInner>>>>,
}

struct SearchInner {
    index_root: PathBuf,
    excluded_index_root: PathBuf,
    live_index_dir: PathBuf,
    mount_root: PathBuf,
    home_dir: PathBuf,
    state: RwLock<SearchState>,
    cancel_flag: Arc<AtomicBool>,
}

struct SearchState {
    status: SearchStatus,
    index: Option<Index>,
    reader: Option<IndexReader>,
    fields: Option<SearchIndexFields>,
    /// Commit stamp of the live index the reader was opened on. Reopening is
    /// skipped while it is unchanged; another process may publish a new one.
    opened: Option<SystemTime>,
}

#[cfg(not(target_os = "macos"))]
#[derive(Debug, Clone, Copy)]
struct SearchIndexFields {
    path: Field,
    name: Field,
    name_lower: Field,
    extension: Field,
    source_kind: Field,
    provider_type: Field,
    remote_name: Field,
    remote_path: Field,
    mime_type: Field,
    is_file: Field,
    is_dir: Field,
    size: Field,
    modified_ms: Field,
    hidden: Field,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SearchSourceKind {
    Local,
    Remote,
}

impl SearchSourceKind {
    fn as_str(self) -> &'static str {
        match self {
            SearchSourceKind::Local => "local",
            SearchSourceKind::Remote => "remote",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SearchScanPhase {
    Idle,
    Scanning,
    Canceling,
    Committing,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SearchScanOutcome {
    Completed,
    Canceled,
    Failed,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchScanRequest {
    #[serde(default)]
    pub roots: Vec<String>,
    #[serde(default = "default_true")]
    pub include_local: bool,
    #[serde(default)]
    pub include_remotes: bool,
    #[serde(default)]
    pub remote_names: Vec<String>,
    #[serde(default)]
    pub max_depth: Option<usize>,
    #[serde(default)]
    pub ignored_paths: Vec<String>,
    #[serde(default = "default_true")]
    pub incremental: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQueryRequest {
    pub query: String,
    #[serde(default)]
    pub current_path: Option<String>,
    #[serde(default)]
    pub scope: SearchQueryScope,
    #[serde(default = "default_true")]
    pub include_files: bool,
    #[serde(default = "default_true")]
    pub include_directories: bool,
    #[serde(default)]
    pub include_hidden: bool,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub rules: Vec<SearchQueryRule>,
    #[serde(default)]
    pub match_mode: SearchRuleMatchMode,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQueryRule {
    pub field: String,
    pub operator: String,
    pub value: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SearchRuleMatchMode {
    Any,
    #[default]
    All,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SearchQueryScope {
    Current,
    Local,
    Remotes,
    #[default]
    Everything,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub entry: FileEntry,
    pub score: f32,
    pub source_kind: SearchSourceKind,
    pub indexed_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchScanError {
    pub source: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchStatus {
    pub scan_in_progress: bool,
    pub scan_phase: SearchScanPhase,
    pub last_scan_time_ms: Option<u64>,
    pub last_scan_outcome: Option<SearchScanOutcome>,
    pub last_scan_error: Option<String>,
    pub indexed_item_count: u64,
    pub indexed_local_item_count: u64,
    pub indexed_remote_item_count: u64,
    pub scan_indexed_item_count: u64,
    pub index_size_bytes: u64,
    pub current_source: Option<String>,
    pub current_path: Option<String>,
    pub scan_errors: Vec<SearchScanError>,
    pub indexed_local_roots: Vec<String>,
    pub indexed_remote_names: Vec<String>,
    pub last_scan_added_item_count: u64,
    pub last_scan_updated_item_count: u64,
    pub last_scan_removed_item_count: u64,
    pub last_scan_unchanged_item_count: u64,
    /// When the last scan (from any Misty process sharing this index) began.
    pub last_scan_started_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchMeta {
    schema_version: u32,
    indexed_item_count: u64,
    #[serde(default)]
    indexed_local_item_count: u64,
    #[serde(default)]
    indexed_remote_item_count: u64,
    last_scan_time_ms: Option<u64>,
    last_scan_outcome: Option<SearchScanOutcome>,
    last_scan_error: Option<String>,
    indexed_local_roots: Vec<String>,
    indexed_remote_names: Vec<String>,
    #[serde(default)]
    last_scan_added_item_count: u64,
    #[serde(default)]
    last_scan_updated_item_count: u64,
    #[serde(default)]
    last_scan_removed_item_count: u64,
    #[serde(default)]
    last_scan_unchanged_item_count: u64,
    #[serde(default)]
    last_scan_started_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct SearchDoc {
    path: String,
    name: String,
    extension: String,
    source_kind: SearchSourceKind,
    provider_type: String,
    remote_name: String,
    remote_path: String,
    mime_type: String,
    is_file: bool,
    is_dir: bool,
    size: u64,
    modified_ms: u64,
    hidden: bool,
}

#[derive(Debug, Clone, Copy, Default)]
struct SearchScanChanges {
    added: u64,
    updated: u64,
    removed: u64,
    unchanged: u64,
}

struct CompletedSearchScan {
    /// The newly published index, or `None` when nothing changed and the
    /// live index was left untouched.
    published: Option<(Index, IndexReader, SearchIndexFields)>,
    count: u64,
    local_count: u64,
    remote_count: u64,
    local_roots: Vec<String>,
    remote_names: Vec<String>,
    changes: SearchScanChanges,
}

pub fn default_true() -> bool {
    true
}

impl SearchService {
    pub fn new(environment: AppEnvironmentService) -> Self {
        let index_root = environment.cache_dir().join("search").join("local-v2");
        let live_index_dir = index_root.join("index");
        let status = SearchStatus {
            scan_in_progress: false,
            scan_phase: SearchScanPhase::Idle,
            last_scan_time_ms: None,
            last_scan_outcome: None,
            last_scan_error: None,
            indexed_item_count: 0,
            indexed_local_item_count: 0,
            indexed_remote_item_count: 0,
            scan_indexed_item_count: 0,
            index_size_bytes: 0,
            current_source: None,
            current_path: None,
            scan_errors: Vec::new(),
            indexed_local_roots: Vec::new(),
            indexed_remote_names: Vec::new(),
            last_scan_added_item_count: 0,
            last_scan_updated_item_count: 0,
            last_scan_removed_item_count: 0,
            last_scan_unchanged_item_count: 0,
            last_scan_started_ms: None,
        };
        Self {
            #[cfg(target_os = "macos")]
            engine: None,
            #[cfg(target_os = "macos")]
            scopes: Default::default(),
            inner: Arc::new(SearchInner {
                excluded_index_root: index_root.clone(),
                index_root,
                live_index_dir,
                mount_root: environment.mount_root(),
                home_dir: environment.home_dir(),
                state: RwLock::new(SearchState {
                    status,
                    index: None,
                    reader: None,
                    fields: None,
                    opened: None,
                }),
                cancel_flag: Arc::new(AtomicBool::new(false)),
            }),
        }
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn authorized(
        &self,
        lease: crate::infra::document_intelligence::ServiceLease,
    ) -> ApiResult<Self> {
        use sha2::{Digest, Sha256};
        let key = format!("{:x}", Sha256::digest(lease.namespace.as_bytes()));
        let mut scopes = self
            .scopes
            .lock()
            .map_err(|e| ApiError::Message(e.to_string()))?;
        let inner = scopes
            .entry(key.clone())
            .or_insert_with(|| {
                let root = self.inner.index_root.join("space-owned-v1").join(key);
                Arc::new(SearchInner {
                    excluded_index_root: self.inner.excluded_index_root.clone(),
                    live_index_dir: root.join("index"),
                    index_root: root,
                    mount_root: self.inner.mount_root.clone(),
                    home_dir: self.inner.home_dir.clone(),
                    state: RwLock::new(SearchState {
                        status: self.inner.state.read().unwrap().status.clone(),
                        index: None,
                        reader: None,
                        fields: None,
                        opened: None,
                    }),
                    cancel_flag: Arc::new(AtomicBool::new(false)),
                })
            })
            .clone();
        Ok(Self {
            inner,
            engine: Some(Arc::new(lease)),
            scopes: self.scopes.clone(),
        })
    }
    fn open_index(&self, path: &Path) -> ApiResult<(Index, IndexReader, SearchIndexFields)> {
        #[cfg(target_os = "macos")]
        {
            remote_engine::open(
                path,
                self.engine
                    .clone()
                    .ok_or_else(|| ApiError::Message("Open Files in a Space to search.".into()))?,
            )
        }
        #[cfg(not(target_os = "macos"))]
        {
            open_or_create_index(path)
        }
    }
    fn fresh_index(&self, path: &Path) -> ApiResult<(Index, SearchIndexFields)> {
        #[cfg(target_os = "macos")]
        {
            let _ = fs::remove_dir_all(path);
            let (index, _, fields) = self.open_index(path)?;
            Ok((index, fields))
        }
        #[cfg(not(target_os = "macos"))]
        {
            create_fresh_index(path)
        }
    }
    fn access_cancelled(&self) -> bool {
        #[cfg(target_os = "macos")]
        {
            self.engine.as_ref().is_none_or(|engine| engine.cancelled())
        }
        #[cfg(not(target_os = "macos"))]
        {
            false
        }
    }
    pub async fn init(&self) -> ApiResult<SearchStatus> {
        tokio::fs::create_dir_all(&self.inner.index_root)
            .await
            .map_err(|error| {
                ApiError::Message(format!(
                    "Failed to create search index directory {}: {error}",
                    self.inner.index_root.display()
                ))
            })?;
        let first = self
            .inner
            .state
            .read()
            .map_err(|e| ApiError::Message(e.to_string()))?
            .index
            .is_none();
        if first {
            // Staging copies belong to whichever process holds the scan lock.
            // Only recover or clean up while no scan can be running.
            if let Some(_lock) = ScanLock::try_acquire(&self.inner.index_root)? {
                recover_interrupted_publish(&self.inner.live_index_dir);
                cleanup_staging_dirs(&self.inner.index_root);
            }
        }
        let stamp = index_stamp(&self.inner.live_index_dir);
        let reopen = {
            let state = self
                .inner
                .state
                .read()
                .map_err(|e| ApiError::Message(e.to_string()))?;
            state.index.is_none() || stamp.is_none() || state.opened != stamp
        };
        if reopen {
            let (index, reader, fields) = self.open_index(&self.inner.live_index_dir)?;
            let indexed_item_count = reader.searcher().num_docs();
            let mut state = self
                .inner
                .state
                .write()
                .map_err(|error| ApiError::Message(error.to_string()))?;
            state.index = Some(index);
            state.reader = Some(reader);
            state.fields = Some(fields);
            state.opened = index_stamp(&self.inner.live_index_dir);
            state.status.indexed_item_count = indexed_item_count;
            state.status.index_size_bytes = dir_size(&self.inner.live_index_dir);
        }
        // Another process sharing this index may have finished a scan.
        let meta = read_meta(&self.inner.index_root);
        let mut state = self
            .inner
            .state
            .write()
            .map_err(|error| ApiError::Message(error.to_string()))?;
        if let Some(meta) = meta.filter(|meta| meta.schema_version == SEARCH_SCHEMA_VERSION) {
            state.status.last_scan_time_ms = meta.last_scan_time_ms;
            state.status.last_scan_outcome = meta.last_scan_outcome;
            state.status.last_scan_error = meta.last_scan_error;
            state.status.indexed_local_item_count = meta.indexed_local_item_count;
            state.status.indexed_remote_item_count = meta.indexed_remote_item_count;
            state.status.indexed_local_roots = meta.indexed_local_roots;
            state.status.indexed_remote_names = meta.indexed_remote_names;
            state.status.last_scan_added_item_count = meta.last_scan_added_item_count;
            state.status.last_scan_updated_item_count = meta.last_scan_updated_item_count;
            state.status.last_scan_removed_item_count = meta.last_scan_removed_item_count;
            state.status.last_scan_unchanged_item_count = meta.last_scan_unchanged_item_count;
            state.status.last_scan_started_ms = meta.last_scan_started_ms;
        }
        Ok(state.status.clone())
    }

    pub async fn status(&self) -> ApiResult<SearchStatus> {
        Ok(self
            .inner
            .state
            .read()
            .map_err(|error| ApiError::Message(error.to_string()))?
            .status
            .clone())
    }

    pub async fn start_scan(&self, request: SearchScanRequest) -> ApiResult<SearchStatus> {
        self.init().await?;
        if self
            .inner
            .state
            .read()
            .map_err(|error| ApiError::Message(error.to_string()))?
            .status
            .scan_in_progress
        {
            return self.status().await;
        }
        // Every Misty process for this account shares the index directory.
        // Only one of them scans; the others pick up its result from disk.
        let Some(lock) = ScanLock::try_acquire(&self.inner.index_root)? else {
            return self.status().await;
        };
        // Another process may have finished a scan since this one checked.
        let meta = read_meta(&self.inner.index_root);
        if request.incremental
            && meta
                .as_ref()
                .and_then(|meta| meta.last_scan_time_ms)
                .is_some_and(|finished| now_ms().saturating_sub(finished) < MIN_SCAN_SPACING_MS)
        {
            drop(lock);
            return self.init().await;
        }
        {
            let mut state = self
                .inner
                .state
                .write()
                .map_err(|error| ApiError::Message(error.to_string()))?;
            if state.status.scan_in_progress {
                return Ok(state.status.clone());
            }
            self.inner.cancel_flag.store(false, Ordering::SeqCst);
            state.status.scan_in_progress = true;
            state.status.scan_phase = SearchScanPhase::Scanning;
            state.status.scan_indexed_item_count = 0;
            state.status.current_source = None;
            state.status.current_path = None;
            state.status.scan_errors.clear();
            state.status.last_scan_error = None;
            state.status.last_scan_started_ms = Some(now_ms());
            let _ = write_meta(&self.inner.index_root, &meta_from_status(&state.status));
        }

        let service = self.clone();
        // Scanning and the confined worker protocol use blocking filesystem I/O.
        // Keep runtime threads available for permission revocation and provider I/O.
        tokio::task::spawn_blocking(move || {
            let _lock = lock;
            let _background = BackgroundPriority::enter();
            tauri::async_runtime::block_on(service.run_scan(request));
        });
        self.status().await
    }

    pub async fn cancel_scan(&self) -> ApiResult<SearchStatus> {
        self.inner.cancel_flag.store(true, Ordering::SeqCst);
        {
            let mut state = self
                .inner
                .state
                .write()
                .map_err(|error| ApiError::Message(error.to_string()))?;
            if state.status.scan_in_progress {
                state.status.scan_phase = SearchScanPhase::Canceling;
            }
        }
        self.status().await
    }

    pub async fn query(&self, request: SearchQueryRequest) -> ApiResult<Vec<SearchResult>> {
        self.init().await?;
        let query_text = normalize_case(&request.query);
        if query_text.is_empty() && request.rules.is_empty() {
            return Ok(Vec::new());
        }
        let limit = request.limit.unwrap_or(DEFAULT_RESULT_LIMIT).clamp(1, 500);
        let current_path = request.current_path.unwrap_or_default();
        let indexed_at_ms = self
            .inner
            .state
            .read()
            .map_err(|error| ApiError::Message(error.to_string()))?
            .status
            .last_scan_time_ms
            .unwrap_or(0);
        let results = {
            let state = self
                .inner
                .state
                .read()
                .map_err(|error| ApiError::Message(error.to_string()))?;
            let reader = state
                .reader
                .as_ref()
                .ok_or_else(|| ApiError::Message("Search index is not initialized.".to_string()))?;
            let fields = *state.fields.as_ref().ok_or_else(|| {
                ApiError::Message("Search index fields are unavailable.".to_string())
            })?;
            let documents = query_documents(reader, fields, &query_text)?;
            let mut results = Vec::new();
            for doc in documents {
                if !request.include_hidden && doc.hidden {
                    continue;
                }
                if !matches_scope(&doc, &request.scope, &current_path) {
                    continue;
                }
                if (doc.is_file && !request.include_files)
                    || (doc.is_dir && !request.include_directories)
                {
                    continue;
                }
                if !matches_query_rules(&doc, &request.rules, &request.match_mode) {
                    continue;
                }
                let score = if query_text.is_empty() {
                    0.72
                } else {
                    score_result(&query_text, &doc, &current_path)
                };
                if !query_text.is_empty() && score < min_score(query_text.len()) {
                    continue;
                }
                results.push(SearchResult {
                    entry: file_entry_from_doc(&doc, &self.inner.mount_root),
                    score,
                    source_kind: doc.source_kind,
                    indexed_at_ms,
                });
            }
            results
        };
        let mut results = results;
        results.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| left.entry.name.cmp(&right.entry.name))
        });
        results.truncate(limit);
        Ok(results)
    }

    async fn run_scan(&self, request: SearchScanRequest) {
        let started = now_ms();
        let staging_dir =
            self.inner
                .index_root
                .join(format!(".staging.{}.{}", started, std::process::id()));
        let result = self.run_scan_inner(&request, &staging_dir).await;
        // The live index is only ever replaced by a completed scan, so a
        // canceled or failed one leaves the last valid index in place.
        let _ = fs::remove_dir_all(&staging_dir);
        let finished = now_ms();
        let mut state = match self.inner.state.write() {
            Ok(state) => state,
            Err(_) => return,
        };
        let canceled = self.inner.cancel_flag.load(Ordering::SeqCst) || self.access_cancelled();
        state.status.scan_in_progress = false;
        state.status.scan_phase = SearchScanPhase::Idle;
        state.status.current_source = None;
        state.status.current_path = None;
        state.status.scan_indexed_item_count = 0;
        state.status.last_scan_outcome = Some(if canceled {
            SearchScanOutcome::Canceled
        } else if result.is_ok() {
            SearchScanOutcome::Completed
        } else {
            SearchScanOutcome::Failed
        });
        state.status.last_scan_error = result.as_ref().err().map(ToString::to_string);
        if let Ok(completed) = result {
            if let Some((index, reader, fields)) = completed.published {
                state.index = Some(index);
                state.reader = Some(reader);
                state.fields = Some(fields);
                state.opened = index_stamp(&self.inner.live_index_dir);
                state.status.index_size_bytes = dir_size(&self.inner.live_index_dir);
            }
            state.status.last_scan_time_ms = Some(finished);
            state.status.indexed_item_count = completed.count;
            state.status.indexed_local_item_count = completed.local_count;
            state.status.indexed_remote_item_count = completed.remote_count;
            state.status.indexed_local_roots = completed.local_roots;
            state.status.indexed_remote_names = completed.remote_names;
            state.status.last_scan_added_item_count = completed.changes.added;
            state.status.last_scan_updated_item_count = completed.changes.updated;
            state.status.last_scan_removed_item_count = completed.changes.removed;
            state.status.last_scan_unchanged_item_count = completed.changes.unchanged;
        }
        let _ = write_meta(&self.inner.index_root, &meta_from_status(&state.status));
    }

    /// Walks the requested roots against the live catalog without writing
    /// anything. Only the first actual change copies the live index to a
    /// staging directory, which is published atomically when the scan
    /// completes; an unchanged tree costs reads only.
    async fn run_scan_inner(
        &self,
        request: &SearchScanRequest,
        staging_dir: &Path,
    ) -> ApiResult<CompletedSearchScan> {
        if let Some(completed) = self.run_scan_pass(request, staging_dir).await? {
            return Ok(completed);
        }
        // Most of the catalog is gone (for example, areas newly excluded from
        // scanning). Building it afresh costs far less than deleting entry by
        // entry, and leaves a compact catalog.
        let _ = fs::remove_dir_all(staging_dir);
        let rebuild = SearchScanRequest {
            incremental: false,
            ..request.clone()
        };
        self.run_scan_pass(&rebuild, staging_dir)
            .await?
            .ok_or_else(|| ApiError::Message("Search catalog rebuild did not complete.".into()))
    }

    /// One walk. `None` asks for a full rebuild instead of this update.
    async fn run_scan_pass(
        &self,
        request: &SearchScanRequest,
        staging_dir: &Path,
    ) -> ApiResult<Option<CompletedSearchScan>> {
        let reuse_existing =
            request.incremental && self.inner.live_index_dir.join("meta.json").exists();
        let manifest_exists = self
            .inner
            .live_index_dir
            .join(SEARCH_MANIFEST_FILE)
            .exists();
        let mut sink = if reuse_existing && manifest_exists {
            ScanSink::probe(self, &self.inner.live_index_dir, staging_dir)?
        } else {
            // Full rebuilds and catalogs that predate the manifest are staged
            // up front, as before.
            let (index, fields, existing_reader) = if reuse_existing {
                copy_index(&self.inner.live_index_dir, staging_dir)?;
                let (index, reader, fields) = self.open_index(staging_dir)?;
                (index, fields, Some(reader))
            } else {
                let (index, fields) = self.fresh_index(staging_dir)?;
                (index, fields, None)
            };
            let manifest = Mutex::new(open_search_manifest(staging_dir)?);
            begin_manifest_update(&manifest)?;
            if let Some(reader) = existing_reader.as_ref() {
                seed_search_manifest(&manifest, reader, fields)?;
            }
            drop(existing_reader);
            ScanSink::staged(self, staging_dir, index, fields, manifest)?
        };
        let ignored = ignored_paths(&request.ignored_paths, &self.inner.excluded_index_root);
        let privacy =
            crate::infra::macos_privacy::BackgroundScanExclusions::new(&self.inner.home_dir);
        let mut count = 0u64;
        let mut local_roots_scanned = Vec::new();
        let indexed_remote_names: Vec<String> = Vec::new();
        let mut pacer = ScanPacer::default();

        if request.include_local {
            let roots = local_roots(request, &self.inner.home_dir);
            for root in roots {
                if self.scan_canceled() {
                    return Err(ApiError::Message("Search scan canceled.".to_string()));
                }
                self.set_scan_progress(Some("Local".to_string()), Some(display_path(&root)));
                let filter = ScanFilter::new(
                    &root,
                    &self.inner.home_dir,
                    &self.inner.mount_root,
                    &ignored,
                    &privacy,
                );
                match self.scan_local_root(&root, request.max_depth, &filter, &mut sink, &mut pacer)
                {
                    Ok(indexed) => {
                        count += indexed;
                        local_roots_scanned.push(display_path(&root));
                        self.set_indexed_count(count);
                    }
                    Err(error) if self.scan_canceled() => return Err(error),
                    Err(error) => self.push_scan_error(display_path(&root), error.to_string()),
                }
            }
        }

        if !sink.remove_missing(request, &local_roots_scanned)? {
            return Ok(None);
        }
        if self.scan_canceled() {
            return Err(ApiError::Message("Search scan canceled.".into()));
        }
        let changes = sink.changes;
        let Some(staged) = sink.finish()? else {
            // Nothing changed: the live index already is the result.
            let state = self
                .inner
                .state
                .read()
                .map_err(|error| ApiError::Message(error.to_string()))?;
            return Ok(Some(CompletedSearchScan {
                published: None,
                count: state.status.indexed_item_count,
                local_count: state.status.indexed_local_item_count,
                remote_count: state.status.indexed_remote_item_count,
                local_roots: local_roots_scanned,
                remote_names: indexed_remote_names,
                changes,
            }));
        };
        {
            let mut state = self
                .inner
                .state
                .write()
                .map_err(|error| ApiError::Message(error.to_string()))?;
            state.status.scan_phase = SearchScanPhase::Committing;
        }
        let StagedIndex {
            index,
            mut writer,
            manifest,
            ..
        } = staged;
        writer
            .commit()
            .map_err(|error| ApiError::Message(error.to_string()))?;
        commit_manifest_update(&manifest)?;
        drop(writer);
        drop(index);
        let (local_count, remote_count) = manifest_source_counts(&manifest)?;
        compact_manifest(&manifest)?;
        drop(manifest);
        if self.scan_canceled() {
            return Err(ApiError::Message("Search scan canceled.".into()));
        }
        replace_index(staging_dir, &self.inner.live_index_dir)?;
        let (index, reader, fields) = self.open_index(&self.inner.live_index_dir)?;
        let count = reader.searcher().num_docs();
        Ok(Some(CompletedSearchScan {
            published: Some((index, reader, fields)),
            count,
            local_count,
            remote_count,
            local_roots: local_roots_scanned,
            remote_names: indexed_remote_names,
            changes,
        }))
    }

    fn scan_canceled(&self) -> bool {
        self.inner.cancel_flag.load(Ordering::SeqCst) || self.access_cancelled()
    }

    fn scan_local_root(
        &self,
        root: &Path,
        max_depth: Option<usize>,
        filter: &ScanFilter,
        sink: &mut ScanSink<'_>,
        pacer: &mut ScanPacer,
    ) -> ApiResult<u64> {
        if !root.exists() || !root.is_dir() {
            return Ok(0);
        }
        let mut count = 0u64;
        for entry in WalkDir::new(root)
            .follow_links(false)
            .max_depth(max_depth.unwrap_or(DEFAULT_MAX_DEPTH).max(1))
            .into_iter()
            .filter_entry(|entry| entry.depth() == 0 || !filter.excludes(entry.path()))
        {
            if self.scan_canceled() {
                return Err(ApiError::Message("Search scan canceled.".to_string()));
            }
            pacer.pace();
            let Ok(entry) = entry else {
                continue;
            };
            if entry.depth() == 0 {
                continue;
            }
            let path = entry.path();
            self.set_current_path_throttled(path, count);
            // Directory entries already carry the file type; only files and
            // directories need their size and modification time.
            if entry.file_type().is_symlink() {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            let doc = SearchDoc {
                path: display_path(path),
                name: name.to_string(),
                extension: path
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_ascii_lowercase(),
                source_kind: SearchSourceKind::Local,
                provider_type: String::new(),
                remote_name: String::new(),
                remote_path: String::new(),
                mime_type: String::new(),
                is_file: metadata.is_file(),
                is_dir: metadata.is_dir(),
                size: if metadata.is_file() {
                    metadata.len()
                } else {
                    0
                },
                modified_ms: metadata_modified_ms(&metadata),
                hidden: name.starts_with('.'),
            };
            sink.accept(doc)?;
            count += 1;
        }
        Ok(count)
    }

    fn set_scan_progress(&self, source: Option<String>, path: Option<String>) {
        if let Ok(mut state) = self.inner.state.write() {
            state.status.current_source = source;
            state.status.current_path = path;
        }
    }

    fn set_current_path_throttled(&self, path: &Path, count: u64) {
        if count % 250 != 0 {
            return;
        }
        if let Ok(mut state) = self.inner.state.write() {
            state.status.current_path = Some(display_path(path));
        }
    }

    fn set_indexed_count(&self, count: u64) {
        if let Ok(mut state) = self.inner.state.write() {
            state.status.scan_indexed_item_count = count;
        }
    }

    fn push_scan_error(&self, source: String, message: String) {
        if let Ok(mut state) = self.inner.state.write() {
            state
                .status
                .scan_errors
                .push(SearchScanError { source, message });
        }
    }
}

/// Cross-process scan ownership. Every Misty process for an account shares the
/// index directory; the OS releases the lock if its holder exits or crashes.
struct ScanLock(fs::File);

impl ScanLock {
    fn try_acquire(index_root: &Path) -> ApiResult<Option<Self>> {
        fs::create_dir_all(index_root).map_err(|error| ApiError::Message(error.to_string()))?;
        let file = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(index_root.join(SCAN_LOCK_FILE))
            .map_err(|error| ApiError::Message(format!("Search scan lock failed: {error}")))?;
        match file.try_lock() {
            Ok(()) => Ok(Some(Self(file))),
            Err(fs::TryLockError::WouldBlock) => Ok(None),
            Err(fs::TryLockError::Error(error)) => Err(ApiError::Message(format!(
                "Search scan lock failed: {error}"
            ))),
        }
    }
}

impl Drop for ScanLock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}

/// Runs the scanning thread at background priority (CPU and disk) for as long
/// as it lives; the pooled thread gets its normal priority back afterwards.
struct BackgroundPriority;

impl BackgroundPriority {
    fn enter() -> Self {
        #[cfg(target_os = "macos")]
        unsafe {
            libc::setpriority(libc::PRIO_DARWIN_THREAD, 0, libc::PRIO_DARWIN_BG);
        }
        Self
    }
}

impl Drop for BackgroundPriority {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        unsafe {
            libc::setpriority(libc::PRIO_DARWIN_THREAD, 0, 0);
        }
    }
}

/// Duty cycle for the filesystem walk.
struct ScanPacer {
    burst_started: std::time::Instant,
    entries: u32,
}

impl Default for ScanPacer {
    fn default() -> Self {
        Self {
            burst_started: std::time::Instant::now(),
            entries: 0,
        }
    }
}

impl ScanPacer {
    fn pace(&mut self) {
        self.entries = self.entries.wrapping_add(1);
        if self.entries % 256 != 0 || self.burst_started.elapsed() < SCAN_BURST {
            return;
        }
        std::thread::sleep(SCAN_PAUSE);
        self.burst_started = std::time::Instant::now();
    }
}

/// What one root's walk skips. Caches, toolchains, build output and app data
/// are regenerated by their owners and never searched for by name; they were
/// most of a home directory's entries. A root the user chose explicitly is
/// always walked, even when it lies inside one of those areas.
struct ScanFilter {
    names: HashSet<std::ffi::OsString>,
    absolute: Vec<PathBuf>,
    home: Option<PathBuf>,
}

/// Directory names skipped wherever they appear: build output, dependency
/// stores and caches.
const GENERATED_DIR_NAMES: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".cache",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".parcel-cache",
    ".gradle",
    ".venv",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    ".tox",
    "DerivedData",
    "Pods",
    "bower_components",
    ".terraform",
];

/// Home-relative areas that hold application data rather than documents.
const GENERATED_HOME_DIRS: &[&str] = &[
    ".Trash",
    ".cache",
    ".npm",
    ".pnpm-store",
    ".yarn",
    ".bun",
    ".deno",
    ".cargo",
    ".rustup",
    ".gradle",
    ".m2",
    ".ivy2",
    ".nvm",
    ".pyenv",
    ".rbenv",
    ".gem",
    ".cocoapods",
    ".android",
    ".docker",
    ".vscode",
    ".cursor",
    ".local",
    ".colima",
    ".orbstack",
    "AppData",
];

/// Inside ~/Library only these hold user documents (iCloud Drive and
/// third-party cloud drives).
const LIBRARY_DOCUMENT_DIRS: &[&str] = &["Mobile Documents", "CloudStorage"];

impl ScanFilter {
    fn new(
        root: &Path,
        home: &Path,
        mount_root: &Path,
        ignored: &[PathBuf],
        privacy: &crate::infra::macos_privacy::BackgroundScanExclusions,
    ) -> Self {
        let mut names: HashSet<std::ffi::OsString> =
            GENERATED_DIR_NAMES.iter().map(Into::into).collect();
        // Misty's own caches and the remote mount (remotes are indexed
        // separately); notes and config under ~/.misty stay searchable.
        let mut absolute = vec![
            mount_root.to_path_buf(),
            home.join(".misty").join(".cache"),
            home.join(".misty").join("tmp"),
        ];
        absolute.extend(privacy.roots().iter().cloned());
        for path in ignored {
            if path.is_absolute() {
                absolute.push(path.clone());
            } else {
                names.insert(path.as_os_str().to_owned());
            }
        }
        // Explicitly requested roots inside an excluded area are still walked.
        absolute.retain(|excluded| !root.starts_with(excluded));
        let home = (!generated_home_area(root, home)).then(|| home.to_path_buf());
        Self {
            names,
            absolute,
            home,
        }
    }

    fn excludes(&self, path: &Path) -> bool {
        if path
            .file_name()
            .is_some_and(|name| self.names.contains(name))
        {
            return true;
        }
        if self.absolute.iter().any(|root| path.starts_with(root)) {
            return true;
        }
        if path.extension().is_some_and(|extension| {
            extension.eq_ignore_ascii_case("photoslibrary")
                || extension.eq_ignore_ascii_case("photolibrary")
        }) {
            return true;
        }
        self.home
            .as_deref()
            .is_some_and(|home| generated_home_area(path, home))
    }
}

fn generated_home_area(path: &Path, home: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(home) else {
        return false;
    };
    let mut components = relative.components().map(|part| part.as_os_str());
    let Some(first) = components.next() else {
        return false;
    };
    if first == "Library" && cfg!(target_os = "macos") {
        return components
            .next()
            .is_some_and(|second| !LIBRARY_DOCUMENT_DIRS.iter().any(|keep| second == *keep));
    }
    GENERATED_HOME_DIRS.iter().any(|name| first == *name)
}

/// The fields a local entry's scan can change; everything else is derived
/// from its path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DocSignature {
    is_file: bool,
    is_dir: bool,
    size: u64,
    modified_ms: u64,
    hidden: bool,
}

impl From<&SearchDoc> for DocSignature {
    fn from(doc: &SearchDoc) -> Self {
        Self {
            is_file: doc.is_file,
            is_dir: doc.is_dir,
            size: doc.size,
            modified_ms: doc.modified_ms,
            hidden: doc.hidden,
        }
    }
}

fn lookup_signature(connection: &Connection, key: &str) -> ApiResult<Option<DocSignature>> {
    let mut statement = connection
        .prepare_cached(
            "SELECT is_file,is_dir,size,modified_ms,hidden FROM search_docs WHERE doc_key=?1",
        )
        .map_err(search_manifest_error)?;
    statement
        .query_row(params![key], |row| {
            Ok(DocSignature {
                is_file: row.get::<_, i64>(0)? != 0,
                is_dir: row.get::<_, i64>(1)? != 0,
                size: row.get(2)?,
                modified_ms: row.get(3)?,
                hidden: row.get::<_, i64>(4)? != 0,
            })
        })
        .optional()
        .map_err(search_manifest_error)
}

fn key_hash(key: &str) -> u64 {
    use std::hash::{BuildHasher, BuildHasherDefault, DefaultHasher};
    BuildHasherDefault::<DefaultHasher>::default().hash_one(key)
}

/// Manifest key range holding every local entry below `root`.
fn local_key_range(root: &str) -> (String, String) {
    let prefix = if root.ends_with('/') || root.ends_with('\\') {
        root.to_owned()
    } else if cfg!(windows) {
        format!("{root}\\")
    } else {
        format!("{root}/")
    };
    let lower = format!("local\u{0}{prefix}");
    let mut upper = lower.clone();
    let last = upper.pop().expect("separator");
    upper.push(char::from_u32(last as u32 + 1).expect("next character"));
    (lower, upper)
}

/// Entries the manifest holds below the scanned roots that the walk did not
/// see. Counting first avoids reading every key when nothing was removed.
/// Both queries read only the `(source_kind, remote_name)` index, which
/// carries the key, never the much larger rows.
fn missing_local_keys(
    connection: &Connection,
    roots: &[String],
    seen: &HashSet<u64>,
    seen_existing: u64,
) -> ApiResult<(u64, Vec<String>)> {
    let mut roots: Vec<&String> = roots.iter().collect();
    roots.sort();
    roots.dedup();
    let mut total = 0u64;
    for root in &roots {
        let (lower, upper) = local_key_range(root);
        total += connection
            .query_row(
                "SELECT COUNT(*) FROM search_docs WHERE source_kind='local' AND remote_name='' AND doc_key>?1 AND doc_key<?2",
                params![lower, upper],
                |row| row.get::<_, u64>(0),
            )
            .map_err(search_manifest_error)?;
    }
    if total == seen_existing {
        return Ok((total, Vec::new()));
    }
    let mut missing = Vec::new();
    let mut statement = connection
        .prepare("SELECT doc_key FROM search_docs WHERE source_kind='local' AND remote_name='' AND doc_key>?1 AND doc_key<?2")
        .map_err(search_manifest_error)?;
    for root in roots {
        let (lower, upper) = local_key_range(root);
        let keys = statement
            .query_map(params![lower, upper], |row| row.get::<_, String>(0))
            .map_err(search_manifest_error)?;
        for key in keys {
            let key = key.map_err(search_manifest_error)?;
            if !seen.contains(&key_hash(&key)) {
                missing.push(key);
            }
        }
    }
    Ok((total, missing))
}

fn lock_manifest(manifest: &Mutex<Connection>) -> ApiResult<std::sync::MutexGuard<'_, Connection>> {
    manifest
        .lock()
        .map_err(|error| ApiError::Message(format!("Search catalog lock failed: {error}")))
}

struct StagedIndex {
    index: Index,
    writer: IndexWriter,
    fields: SearchIndexFields,
    manifest: Mutex<Connection>,
}

/// Receives walked entries. It compares them with the live manifest read-only
/// and stages a copy of the index only when the first change appears.
struct ScanSink<'a> {
    service: &'a SearchService,
    staging_dir: &'a Path,
    live_dir: Option<&'a Path>,
    probe: Option<Connection>,
    staged: Option<StagedIndex>,
    generation: u64,
    seen: HashSet<u64>,
    changes: SearchScanChanges,
}

impl<'a> ScanSink<'a> {
    fn probe(
        service: &'a SearchService,
        live_dir: &'a Path,
        staging_dir: &'a Path,
    ) -> ApiResult<Self> {
        let probe = Connection::open_with_flags(
            live_dir.join(SEARCH_MANIFEST_FILE),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(search_manifest_error)?;
        // One point lookup per walked entry: map the file instead of reading
        // it page by page through SQLite's small default cache.
        probe
            .execute_batch("PRAGMA mmap_size=1073741824; PRAGMA cache_size=-65536;")
            .map_err(search_manifest_error)?;
        Ok(Self {
            service,
            staging_dir,
            live_dir: Some(live_dir),
            probe: Some(probe),
            staged: None,
            generation: now_ms().max(1),
            seen: HashSet::new(),
            changes: SearchScanChanges::default(),
        })
    }

    fn staged(
        service: &'a SearchService,
        staging_dir: &'a Path,
        index: Index,
        fields: SearchIndexFields,
        manifest: Mutex<Connection>,
    ) -> ApiResult<Self> {
        let writer = index
            .writer_with_num_threads(1, INDEX_MEMORY_BUDGET_BYTES)
            .map_err(|error| ApiError::Message(error.to_string()))?;
        Ok(Self {
            service,
            staging_dir,
            live_dir: None,
            probe: None,
            staged: Some(StagedIndex {
                index,
                writer,
                fields,
                manifest,
            }),
            generation: now_ms().max(1),
            seen: HashSet::new(),
            changes: SearchScanChanges::default(),
        })
    }

    fn stage(&mut self) -> ApiResult<&StagedIndex> {
        if self.staged.is_none() {
            self.probe = None;
            let live = self.live_dir.ok_or_else(|| {
                ApiError::Message("Search catalog staging is unavailable.".to_owned())
            })?;
            copy_index(live, self.staging_dir)?;
            let (index, _reader, fields) = self.service.open_index(self.staging_dir)?;
            let manifest = Mutex::new(open_search_manifest(self.staging_dir)?);
            begin_manifest_update(&manifest)?;
            let writer = index
                .writer_with_num_threads(1, INDEX_MEMORY_BUDGET_BYTES)
                .map_err(|error| ApiError::Message(error.to_string()))?;
            self.staged = Some(StagedIndex {
                index,
                writer,
                fields,
                manifest,
            });
        }
        Ok(self.staged.as_ref().expect("staged"))
    }

    fn lookup(&self, key: &str) -> ApiResult<Option<DocSignature>> {
        match (&self.staged, &self.probe) {
            (Some(staged), _) => lookup_signature(&*lock_manifest(&staged.manifest)?, key),
            (None, Some(probe)) => lookup_signature(probe, key),
            (None, None) => Ok(None),
        }
    }

    fn accept(&mut self, doc: SearchDoc) -> ApiResult<()> {
        let key = search_doc_key(&doc);
        self.seen.insert(key_hash(&key));
        let existing = self.lookup(&key)?;
        if existing == Some(DocSignature::from(&doc)) {
            self.changes.unchanged += 1;
            return Ok(());
        }
        let generation = self.generation;
        let staged = self.stage()?;
        if existing.is_some() {
            delete_doc(&staged.writer, &staged.fields, &doc.path)?;
        }
        add_doc(&staged.writer, &staged.fields, &doc)?;
        persist_manifest_doc(&*lock_manifest(&staged.manifest)?, &doc, generation)?;
        if existing.is_some() {
            self.changes.updated += 1;
        } else {
            self.changes.added += 1;
        }
        Ok(())
    }

    /// Removes entries below the fully walked roots that no longer exist.
    /// Returns `false`, without changing anything, when an incremental update
    /// would remove most of the catalog; a rebuild is cheaper then.
    fn remove_missing(&mut self, request: &SearchScanRequest, roots: &[String]) -> ApiResult<bool> {
        if !request.include_local || roots.is_empty() {
            return Ok(true);
        }
        let seen_existing = self.changes.unchanged + self.changes.updated;
        let (total, missing) = match (&self.staged, &self.probe) {
            (Some(staged), _) => missing_local_keys(
                &*lock_manifest(&staged.manifest)?,
                roots,
                &self.seen,
                seen_existing,
            )?,
            (None, Some(probe)) => missing_local_keys(probe, roots, &self.seen, seen_existing)?,
            (None, None) => (0, Vec::new()),
        };
        if missing.is_empty() {
            return Ok(true);
        }
        if request.incremental && missing.len() as u64 * 2 > total {
            return Ok(false);
        }
        let staged = self.stage()?;
        let manifest = lock_manifest(&staged.manifest)?;
        let mut delete = manifest
            .prepare_cached("DELETE FROM search_docs WHERE doc_key=?1")
            .map_err(search_manifest_error)?;
        for key in &missing {
            let Some(path) = key.strip_prefix("local\u{0}") else {
                continue;
            };
            delete_doc(&staged.writer, &staged.fields, path)?;
            delete
                .execute(params![key])
                .map_err(search_manifest_error)?;
        }
        drop(delete);
        drop(manifest);
        self.changes.removed += missing.len() as u64;
        Ok(true)
    }

    fn finish(self) -> ApiResult<Option<StagedIndex>> {
        Ok(self.staged)
    }
}

/// A crash between the two renames of `replace_index` leaves only the
/// backup; put it back so the last valid index is not lost.
fn recover_interrupted_publish(live: &Path) {
    if live.exists() {
        return;
    }
    let (Some(parent), Some(name)) = (live.parent(), live.file_name()) else {
        return;
    };
    let prefix = format!("{}.backup.", name.to_string_lossy());
    let newest = fs::read_dir(parent)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(&prefix))
        .max_by_key(|entry| entry.file_name());
    if let Some(backup) = newest {
        let _ = fs::rename(backup.path(), live);
    }
}

/// Changes whenever a new index is published (by any process).
fn index_stamp(live: &Path) -> Option<SystemTime> {
    fs::metadata(live.join("meta.json"))
        .and_then(|metadata| metadata.modified())
        .ok()
}

fn meta_from_status(status: &SearchStatus) -> SearchMeta {
    SearchMeta {
        schema_version: SEARCH_SCHEMA_VERSION,
        indexed_item_count: status.indexed_item_count,
        indexed_local_item_count: status.indexed_local_item_count,
        indexed_remote_item_count: status.indexed_remote_item_count,
        last_scan_time_ms: status.last_scan_time_ms,
        last_scan_outcome: status.last_scan_outcome.clone(),
        last_scan_error: status.last_scan_error.clone(),
        indexed_local_roots: status.indexed_local_roots.clone(),
        indexed_remote_names: status.indexed_remote_names.clone(),
        last_scan_added_item_count: status.last_scan_added_item_count,
        last_scan_updated_item_count: status.last_scan_updated_item_count,
        last_scan_removed_item_count: status.last_scan_removed_item_count,
        last_scan_unchanged_item_count: status.last_scan_unchanged_item_count,
        last_scan_started_ms: status.last_scan_started_ms,
    }
}

#[cfg(not(target_os = "macos"))]
fn build_schema() -> (Schema, SearchIndexFields) {
    let mut builder = Schema::builder();
    let name_indexing = TextFieldIndexing::default()
        .set_tokenizer("default")
        .set_index_option(IndexRecordOption::WithFreqsAndPositions);
    let name_options = TextOptions::default()
        .set_indexing_options(name_indexing)
        .set_stored();
    let path = builder.add_text_field("path", STRING | STORED);
    let name = builder.add_text_field("name", name_options);
    let name_lower = builder.add_text_field("name_lower", STRING | STORED);
    let extension = builder.add_text_field("extension", STRING | STORED);
    let source_kind = builder.add_text_field("source_kind", STRING | STORED);
    let provider_type = builder.add_text_field("provider_type", STRING | STORED);
    let remote_name = builder.add_text_field("remote_name", STRING | STORED);
    let remote_path = builder.add_text_field("remote_path", STRING | STORED);
    let mime_type = builder.add_text_field("mime_type", STRING | STORED);
    let is_file = builder.add_u64_field("is_file", FAST | STORED);
    let is_dir = builder.add_u64_field("is_dir", FAST | STORED);
    let size = builder.add_u64_field("size", FAST | STORED);
    let modified_ms = builder.add_u64_field("modified_ms", FAST | STORED);
    let hidden = builder.add_u64_field("hidden", FAST | STORED);
    let schema = builder.build();
    (
        schema,
        SearchIndexFields {
            path,
            name,
            name_lower,
            extension,
            source_kind,
            provider_type,
            remote_name,
            remote_path,
            mime_type,
            is_file,
            is_dir,
            size,
            modified_ms,
            hidden,
        },
    )
}

#[cfg(not(target_os = "macos"))]
fn open_or_create_index(path: &Path) -> ApiResult<(Index, IndexReader, SearchIndexFields)> {
    fs::create_dir_all(path).map_err(|error| {
        ApiError::Message(format!(
            "Failed to create search index {}: {error}",
            path.display()
        ))
    })?;
    let (schema, fields) = build_schema();
    let index = match Index::open_in_dir(path) {
        Ok(index) if index.schema() == schema => index,
        _ => {
            let _ = fs::remove_dir_all(path);
            fs::create_dir_all(path).map_err(|error| {
                ApiError::Message(format!(
                    "Failed to reset search index {}: {error}",
                    path.display()
                ))
            })?;
            Index::create_in_dir(path, schema)
                .map_err(|error| ApiError::Message(error.to_string()))?
        }
    };
    let reader = index
        .reader_builder()
        .reload_policy(ReloadPolicy::Manual)
        .try_into()
        .map_err(|error| ApiError::Message(error.to_string()))?;
    Ok((index, reader, fields))
}

#[cfg(not(target_os = "macos"))]
fn create_fresh_index(path: &Path) -> ApiResult<(Index, SearchIndexFields)> {
    let _ = fs::remove_dir_all(path);
    fs::create_dir_all(path).map_err(|error| {
        ApiError::Message(format!(
            "Failed to create staged search index {}: {error}",
            path.display()
        ))
    })?;
    let (schema, fields) = build_schema();
    let index =
        Index::create_in_dir(path, schema).map_err(|error| ApiError::Message(error.to_string()))?;
    Ok((index, fields))
}

fn copy_index(source: &Path, destination: &Path) -> ApiResult<()> {
    let _ = fs::remove_dir_all(destination);
    copy_directory(source, destination).map_err(|error| {
        ApiError::Message(format!(
            "Failed to prepare the previous search catalog for an incremental update: {error}"
        ))
    })
}

fn copy_directory(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_directory(&source_path, &destination_path)?;
        } else {
            fs::copy(source_path, destination_path)?;
        }
    }
    Ok(())
}

/// Opens a staged catalog. It is written only inside a staging copy that is
/// discarded if the scan does not complete, so it keeps no rollback journal.
fn open_search_manifest(index_dir: &Path) -> ApiResult<Connection> {
    let connection =
        Connection::open(index_dir.join(SEARCH_MANIFEST_FILE)).map_err(search_manifest_error)?;
    connection
        .execute_batch(
            "PRAGMA journal_mode=OFF;
             PRAGMA synchronous=NORMAL;
             PRAGMA cache_size=-65536;
             CREATE TABLE IF NOT EXISTS search_docs (
               doc_key TEXT PRIMARY KEY,
               path TEXT NOT NULL,
               name TEXT NOT NULL,
               extension TEXT NOT NULL,
               source_kind TEXT NOT NULL,
               provider_type TEXT NOT NULL,
               remote_name TEXT NOT NULL,
               remote_path TEXT NOT NULL,
               mime_type TEXT NOT NULL,
               is_file INTEGER NOT NULL,
               is_dir INTEGER NOT NULL,
               size INTEGER NOT NULL,
               modified_ms INTEGER NOT NULL,
               hidden INTEGER NOT NULL,
               last_seen_generation INTEGER NOT NULL
             ) WITHOUT ROWID;
             CREATE INDEX IF NOT EXISTS search_docs_source ON search_docs(source_kind, remote_name);",
        )
        .map_err(search_manifest_error)?;
    Ok(connection)
}

fn begin_manifest_update(manifest: &Mutex<Connection>) -> ApiResult<()> {
    manifest
        .lock()
        .map_err(|error| ApiError::Message(format!("Search catalog lock failed: {error}")))?
        .execute_batch("BEGIN IMMEDIATE")
        .map_err(search_manifest_error)
}

fn commit_manifest_update(manifest: &Mutex<Connection>) -> ApiResult<()> {
    manifest
        .lock()
        .map_err(|error| ApiError::Message(format!("Search catalog lock failed: {error}")))?
        .execute_batch("COMMIT")
        .map_err(search_manifest_error)
}

#[cfg(not(target_os = "macos"))]
fn seed_search_manifest(
    manifest: &Mutex<Connection>,
    reader: &IndexReader,
    fields: SearchIndexFields,
) -> ApiResult<()> {
    let manifest = manifest
        .lock()
        .map_err(|error| ApiError::Message(format!("Search catalog lock failed: {error}")))?;
    let searcher = reader.searcher();
    for (segment_ord, segment) in searcher.segment_readers().iter().enumerate() {
        for doc_id in 0..segment.max_doc() {
            if segment.is_deleted(doc_id) {
                continue;
            }
            let document = searcher
                .doc::<TantivyDocument>(tantivy::DocAddress::new(segment_ord as u32, doc_id))
                .map_err(|error| ApiError::Message(error.to_string()))?;
            if let Some(doc) = doc_from_tantivy(fields, &document) {
                persist_manifest_doc(&manifest, &doc, 0)?;
            }
        }
    }
    Ok(())
}

fn search_doc_key(doc: &SearchDoc) -> String {
    match doc.source_kind {
        SearchSourceKind::Local => format!("local\u{0}{}", doc.path),
        SearchSourceKind::Remote => {
            format!("remote\u{0}{}\u{0}{}", doc.remote_name, doc.remote_path)
        }
    }
}

fn persist_manifest_doc(
    connection: &Connection,
    doc: &SearchDoc,
    generation: u64,
) -> ApiResult<()> {
    connection
        .execute(
            "INSERT INTO search_docs(doc_key,path,name,extension,source_kind,provider_type,remote_name,remote_path,mime_type,is_file,is_dir,size,modified_ms,hidden,last_seen_generation)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
             ON CONFLICT(doc_key) DO UPDATE SET path=excluded.path,name=excluded.name,extension=excluded.extension,source_kind=excluded.source_kind,provider_type=excluded.provider_type,remote_name=excluded.remote_name,remote_path=excluded.remote_path,mime_type=excluded.mime_type,is_file=excluded.is_file,is_dir=excluded.is_dir,size=excluded.size,modified_ms=excluded.modified_ms,hidden=excluded.hidden,last_seen_generation=excluded.last_seen_generation",
            params![
                search_doc_key(doc),
                doc.path,
                doc.name,
                doc.extension,
                doc.source_kind.as_str(),
                doc.provider_type,
                doc.remote_name,
                doc.remote_path,
                doc.mime_type,
                i64::from(doc.is_file),
                i64::from(doc.is_dir),
                doc.size,
                doc.modified_ms,
                i64::from(doc.hidden),
                generation,
            ],
        )
        .map_err(search_manifest_error)?;
    Ok(())
}

/// Removals leave free pages behind; SQLite never shrinks the file on its
/// own. Once most of the staged catalog is free space, rewrite it compactly
/// before it is published.
fn compact_manifest(manifest: &Mutex<Connection>) -> ApiResult<()> {
    let manifest = lock_manifest(manifest)?;
    let (pages, free): (u64, u64) = manifest
        .query_row(
            "SELECT (SELECT page_count FROM pragma_page_count()), (SELECT freelist_count FROM pragma_freelist_count())",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(search_manifest_error)?;
    if pages > 0 && free * 2 > pages {
        manifest
            .execute_batch("VACUUM")
            .map_err(search_manifest_error)?;
    }
    Ok(())
}

fn manifest_source_counts(manifest: &Mutex<Connection>) -> ApiResult<(u64, u64)> {
    let manifest = manifest
        .lock()
        .map_err(|error| ApiError::Message(format!("Search catalog lock failed: {error}")))?;
    let local = manifest
        .query_row(
            "SELECT COUNT(*) FROM search_docs WHERE source_kind='local'",
            [],
            |row| row.get(0),
        )
        .map_err(search_manifest_error)?;
    let remote = manifest
        .query_row(
            "SELECT COUNT(*) FROM search_docs WHERE source_kind='remote'",
            [],
            |row| row.get(0),
        )
        .map_err(search_manifest_error)?;
    Ok((local, remote))
}

fn search_manifest_error(error: rusqlite::Error) -> ApiError {
    ApiError::Message(format!("Search catalog database failed: {error}"))
}

fn replace_index(staging: &Path, live: &Path) -> ApiResult<()> {
    let backup = live.with_extension(format!("backup.{}", now_ms()));
    if live.exists() {
        fs::rename(live, &backup).map_err(|error| {
            ApiError::Message(format!(
                "Failed to stage old search index {}: {error}",
                live.display()
            ))
        })?;
    }
    fs::rename(staging, live).map_err(|error| {
        let _ = fs::rename(&backup, live);
        ApiError::Message(format!(
            "Failed to publish search index {}: {error}",
            live.display()
        ))
    })?;
    let _ = fs::remove_dir_all(backup);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn add_doc(
    writer: &IndexWriter,
    fields: &SearchIndexFields,
    search_doc: &SearchDoc,
) -> ApiResult<()> {
    writer
        .add_document(doc!(
            fields.path => search_doc.path.clone(),
            fields.name => search_doc.name.clone(),
            fields.name_lower => normalize_case(&search_doc.name),
            fields.extension => search_doc.extension.clone(),
            fields.source_kind => search_doc.source_kind.as_str(),
            fields.provider_type => search_doc.provider_type.clone(),
            fields.remote_name => search_doc.remote_name.clone(),
            fields.remote_path => search_doc.remote_path.clone(),
            fields.mime_type => search_doc.mime_type.clone(),
            fields.is_file => if search_doc.is_file { 1u64 } else { 0u64 },
            fields.is_dir => if search_doc.is_dir { 1u64 } else { 0u64 },
            fields.size => search_doc.size,
            fields.modified_ms => search_doc.modified_ms,
            fields.hidden => if search_doc.hidden { 1u64 } else { 0u64 },
        ))
        .map_err(|error| ApiError::Message(error.to_string()))?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn build_query(fields: SearchIndexFields, query: &str) -> Box<dyn Query> {
    let tokens = split_tokens(query);
    if tokens.is_empty() {
        return Box::new(AllQuery);
    }
    let mut queries: Vec<(Occur, Box<dyn Query>)> = Vec::new();
    for token in tokens {
        let term = Term::from_field_text(fields.name, &token);
        queries.push((Occur::Should, Box::new(FuzzyTermQuery::new(term, 2, true))));
        let exact = Term::from_field_text(fields.name, &token);
        queries.push((
            Occur::Should,
            Box::new(TermQuery::new(exact, IndexRecordOption::Basic)),
        ));
    }
    Box::new(BooleanQuery::from(queries))
}

#[cfg(not(target_os = "macos"))]
fn doc_from_tantivy(fields: SearchIndexFields, doc: &TantivyDocument) -> Option<SearchDoc> {
    let path = text_field(doc, fields.path)?;
    let name = text_field(doc, fields.name)?;
    let source_kind = match text_field(doc, fields.source_kind)?.as_str() {
        "remote" => SearchSourceKind::Remote,
        _ => SearchSourceKind::Local,
    };
    Some(SearchDoc {
        path,
        name,
        extension: text_field(doc, fields.extension).unwrap_or_default(),
        source_kind,
        provider_type: text_field(doc, fields.provider_type).unwrap_or_default(),
        remote_name: text_field(doc, fields.remote_name).unwrap_or_default(),
        remote_path: text_field(doc, fields.remote_path).unwrap_or_default(),
        mime_type: text_field(doc, fields.mime_type).unwrap_or_default(),
        is_file: u64_field(doc, fields.is_file) == 1,
        is_dir: u64_field(doc, fields.is_dir) == 1,
        size: u64_field(doc, fields.size),
        modified_ms: u64_field(doc, fields.modified_ms),
        hidden: u64_field(doc, fields.hidden) == 1,
    })
}

#[cfg(not(target_os = "macos"))]
fn text_field(doc: &TantivyDocument, field: Field) -> Option<String> {
    doc.get_first(field)
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}

#[cfg(not(target_os = "macos"))]
fn u64_field(doc: &TantivyDocument, field: Field) -> u64 {
    doc.get_first(field)
        .and_then(|value| value.as_u64())
        .unwrap_or(0)
}

fn file_entry_from_doc(doc: &SearchDoc, mount_root: &Path) -> FileEntry {
    let kind = if doc.is_dir {
        FileKind::Folder
    } else if doc.is_file {
        FileKind::File
    } else {
        FileKind::Other
    };
    let path = match doc.source_kind {
        SearchSourceKind::Remote if !doc.remote_name.is_empty() => RemoteBrowseTarget {
            provider_type: doc.provider_type.clone(),
            remote_name: doc.remote_name.clone(),
            remote_path: if doc.remote_path.is_empty() {
                "/".to_string()
            } else {
                doc.remote_path.clone()
            },
        }
        .virtual_path(mount_root)
        .to_string_lossy()
        .to_string(),
        _ => doc.path.clone(),
    };
    FileEntry {
        id: path.clone(),
        name: doc.name.clone(),
        path,
        extension: doc.extension.clone(),
        mime_type: (!doc.mime_type.is_empty()).then_some(doc.mime_type.clone()),
        remote_modified: None,
        kind,
        size_bytes: doc.is_file.then_some(doc.size),
        modified_ms: (doc.modified_ms > 0).then_some(doc.modified_ms as i64),
        created_ms: None,
        readonly: false,
        hidden: doc.hidden,
        is_deleted: false,
        location: match doc.source_kind {
            SearchSourceKind::Local => ExplorerLocation::local(),
            SearchSourceKind::Remote => ExplorerLocation {
                kind: ExplorerLocationKind::Remote,
                provider_type: (!doc.provider_type.is_empty()).then_some(doc.provider_type.clone()),
                remote_name: (!doc.remote_name.is_empty()).then_some(doc.remote_name.clone()),
                remote_path: (!doc.remote_path.is_empty()).then_some(doc.remote_path.clone()),
                ..Default::default()
            },
        },
    }
}

fn score_result(query: &str, doc: &SearchDoc, current_path: &str) -> f32 {
    let name = normalize_case(&doc.name);
    let mut score = if name == query {
        1.0
    } else if name.starts_with(query) {
        0.92
    } else if name.contains(query) {
        0.82
    } else {
        token_score(query, &name)
    };
    if !current_path.is_empty() && doc.path.starts_with(current_path) {
        score += 0.08;
    }
    if doc.is_dir {
        score += 0.02;
    }
    score.min(1.25)
}

fn token_score(query: &str, name: &str) -> f32 {
    let query_tokens = split_tokens(query);
    let name_tokens = split_tokens(name);
    if query_tokens.is_empty() || name_tokens.is_empty() {
        return 0.0;
    }
    let mut total = 0.0;
    let mut matched = 0usize;
    for query_token in &query_tokens {
        let mut best = 0.0f32;
        for name_token in &name_tokens {
            if name_token == query_token {
                best = best.max(1.0);
            } else if name_token.starts_with(query_token) {
                best = best.max(0.86);
            } else if name_token.contains(query_token) {
                best = best.max(0.74);
            } else {
                let distance = levenshtein(query_token, name_token);
                let max_len = query_token.len().max(name_token.len());
                if distance <= 2 && max_len > 0 {
                    best = best.max((1.0 - distance as f32 / max_len as f32) * 0.7);
                }
            }
        }
        if best > 0.5 {
            matched += 1;
        }
        total += best;
    }
    let ratio = matched as f32 / query_tokens.len() as f32;
    if ratio < 0.5 {
        return 0.0;
    }
    0.5 + (total / query_tokens.len() as f32) * 0.35 + ratio * 0.15
}

fn min_score(query_len: usize) -> f32 {
    match query_len {
        1..=3 => 0.9,
        4..=6 => 0.6,
        7..=9 => 0.5,
        _ => 0.45,
    }
}

fn matches_scope(doc: &SearchDoc, scope: &SearchQueryScope, current_path: &str) -> bool {
    match scope {
        SearchQueryScope::Everything => true,
        SearchQueryScope::Local => doc.source_kind == SearchSourceKind::Local,
        SearchQueryScope::Remotes => doc.source_kind == SearchSourceKind::Remote,
        SearchQueryScope::Current => current_path.is_empty() || doc.path.starts_with(current_path),
    }
}

fn matches_query_rules(
    doc: &SearchDoc,
    rules: &[SearchQueryRule],
    mode: &SearchRuleMatchMode,
) -> bool {
    let rules = rules
        .iter()
        .filter(|rule| rule.field != "__match" && !rule.value.trim().is_empty());
    let matches: Vec<bool> = rules.map(|rule| matches_query_rule(doc, rule)).collect();
    if matches.is_empty() {
        return true;
    }
    match mode {
        SearchRuleMatchMode::Any => matches.into_iter().any(|value| value),
        SearchRuleMatchMode::All => matches.into_iter().all(|value| value),
    }
}

fn matches_query_rule(doc: &SearchDoc, rule: &SearchQueryRule) -> bool {
    let value = normalize_case(rule.value.trim());
    match rule.field.as_str() {
        "text" => compare_rule_text(&normalize_case(&doc.name), &value, &rule.operator),
        "path" => compare_rule_text(&normalize_case(&doc.path), &value, &rule.operator),
        "kind" => compare_rule_text(
            if doc.is_dir { "folder" } else { "file" },
            &value,
            &rule.operator,
        ),
        "extension" => compare_rule_text(
            doc.extension.trim_start_matches('.'),
            value.trim_start_matches('.'),
            &rule.operator,
        ),
        "hidden" => doc.hidden == matches!(value.as_str(), "true" | "yes" | "1"),
        "size" => parse_rule_size(&value)
            .is_some_and(|target| compare_rule_number(doc.size, target, &rule.operator)),
        "modified" => parse_rule_date_ms(&value)
            .is_some_and(|target| compare_rule_number(doc.modified_ms, target, &rule.operator)),
        // AI tags are evaluated after server semantic results are merged.
        "tag" => true,
        _ => true,
    }
}

fn compare_rule_text(candidate: &str, value: &str, operator: &str) -> bool {
    match operator {
        "is" => candidate == value,
        "is_not" => candidate != value,
        "starts_with" => candidate.starts_with(value),
        "ends_with" => candidate.ends_with(value),
        _ => candidate.contains(value),
    }
}

fn compare_rule_number(candidate: u64, target: u64, operator: &str) -> bool {
    match operator {
        "gt" | "after" => candidate > target,
        "lt" | "before" => candidate < target,
        "is_not" => candidate != target,
        _ => candidate == target,
    }
}

fn parse_rule_size(value: &str) -> Option<u64> {
    let split = value
        .find(|character: char| !character.is_ascii_digit() && character != '.')
        .unwrap_or(value.len());
    let number = value[..split].parse::<f64>().ok()?;
    let multiplier = match value[split..].trim().to_ascii_lowercase().as_str() {
        "kb" | "kib" => 1024.0,
        "mb" | "mib" => 1024.0 * 1024.0,
        "gb" | "gib" => 1024.0 * 1024.0 * 1024.0,
        _ => 1.0,
    };
    Some((number * multiplier) as u64)
}

fn parse_rule_date_ms(value: &str) -> Option<u64> {
    let date = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()?;
    Some(
        date.and_hms_opt(0, 0, 0)?
            .and_utc()
            .timestamp_millis()
            .max(0) as u64,
    )
}

fn split_tokens(value: &str) -> Vec<String> {
    value
        .split(|character: char| {
            character.is_whitespace() || matches!(character, '.' | '_' | '-' | '/')
        })
        .filter(|segment| !segment.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn normalize_case(value: &str) -> String {
    value.trim().to_lowercase()
}

fn levenshtein(first: &str, second: &str) -> usize {
    let a: Vec<char> = first.chars().collect();
    let b: Vec<char> = second.chars().collect();
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    let mut current = vec![0; b.len() + 1];
    for (i, a_char) in a.iter().enumerate() {
        current[0] = i + 1;
        for (j, b_char) in b.iter().enumerate() {
            let cost = usize::from(a_char != b_char);
            current[j + 1] = (previous[j + 1] + 1)
                .min(current[j] + 1)
                .min(previous[j] + cost);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[b.len()]
}

fn local_roots(request: &SearchScanRequest, home_dir: &Path) -> Vec<PathBuf> {
    if request.roots.is_empty() {
        return vec![home_dir.to_path_buf()];
    }
    request.roots.iter().map(PathBuf::from).collect()
}

fn ignored_paths(extra: &[String], index_root: &Path) -> Vec<PathBuf> {
    let mut paths = vec![
        index_root.to_path_buf(),
        PathBuf::from(".git"),
        PathBuf::from("node_modules"),
        PathBuf::from("target"),
        PathBuf::from("dist"),
        PathBuf::from("build"),
        PathBuf::from(".next"),
        PathBuf::from(".cache"),
    ];
    paths.extend(extra.iter().map(PathBuf::from));
    paths
}

fn is_ignored(path: &Path, ignored: &[PathBuf]) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    ignored.iter().any(|ignored_path| {
        if ignored_path.is_absolute() {
            path.starts_with(ignored_path)
        } else {
            name == ignored_path.to_string_lossy()
        }
    })
}

fn metadata_modified_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn read_meta(index_root: &Path) -> Option<SearchMeta> {
    let text = fs::read_to_string(index_root.join("status.json")).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_meta(index_root: &Path, meta: &SearchMeta) -> ApiResult<()> {
    fs::create_dir_all(index_root).map_err(|error| ApiError::Message(error.to_string()))?;
    let path = index_root.join("status.json");
    let temp = path.with_extension("json.tmp");
    let json = serde_json::to_vec(meta)?;
    fs::write(&temp, json).map_err(|error| ApiError::Message(error.to_string()))?;
    fs::rename(&temp, &path).map_err(|error| ApiError::Message(error.to_string()))?;
    Ok(())
}

fn cleanup_staging_dirs(index_root: &Path) {
    let Ok(entries) = fs::read_dir(index_root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() && (name.starts_with(".staging.") || name.contains(".backup.")) {
            let _ = fs::remove_dir_all(path);
        }
    }
}

fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    let mut total = 0u64;
    for entry in entries.flatten() {
        let path = entry.path();
        if let Ok(metadata) = entry.metadata() {
            if metadata.is_dir() {
                total += dir_size(&path);
            } else {
                total += metadata.len();
            }
        }
    }
    total
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}
#[cfg(test)]
mod rule_tests {
    use super::*;

    fn fixture() -> SearchDoc {
        SearchDoc {
            path: "/Users/test/Pictures/Pikachu.png".to_owned(),
            name: "Pikachu.png".to_owned(),
            extension: "png".to_owned(),
            source_kind: SearchSourceKind::Local,
            provider_type: String::new(),
            remote_name: String::new(),
            remote_path: String::new(),
            mime_type: "image/png".to_owned(),
            is_file: true,
            is_dir: false,
            size: 12 * 1024 * 1024,
            modified_ms: 1_783_123_200_000,
            hidden: false,
        }
    }
    #[test]
    fn structured_rules_apply_all_and_any_modes() {
        let rules = vec![
            SearchQueryRule {
                field: "extension".to_owned(),
                operator: "is".to_owned(),
                value: "png".to_owned(),
            },
            SearchQueryRule {
                field: "size".to_owned(),
                operator: "gt".to_owned(),
                value: "10MB".to_owned(),
            },
        ];
        assert!(matches_query_rules(
            &fixture(),
            &rules,
            &SearchRuleMatchMode::All
        ));
        let failing = vec![
            rules[0].clone(),
            SearchQueryRule {
                field: "hidden".to_owned(),
                operator: "is".to_owned(),
                value: "true".to_owned(),
            },
        ];
        assert!(!matches_query_rules(
            &fixture(),
            &failing,
            &SearchRuleMatchMode::All
        ));
        assert!(matches_query_rules(
            &fixture(),
            &failing,
            &SearchRuleMatchMode::Any
        ));
    }
}

#[cfg(test)]
mod incremental_tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "misty-search-{name}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&root).expect("temp dir");
        root
    }

    fn doc(path: &Path, size: u64) -> SearchDoc {
        SearchDoc {
            path: display_path(path),
            name: path.file_name().unwrap().to_string_lossy().into_owned(),
            extension: "png".to_owned(),
            source_kind: SearchSourceKind::Local,
            provider_type: String::new(),
            remote_name: String::new(),
            remote_path: String::new(),
            mime_type: String::new(),
            is_file: true,
            is_dir: false,
            size,
            modified_ms: 100,
            hidden: false,
        }
    }

    #[test]
    fn only_one_process_may_scan_a_shared_index_at_a_time() {
        let root = temp("lock");
        let first = ScanLock::try_acquire(&root)
            .expect("lock")
            .expect("first scan");
        // A second holder (another Misty process, or a racing request in
        // this one) is refused instead of starting a duplicate walk.
        assert!(ScanLock::try_acquire(&root).expect("lock").is_none());
        drop(first);
        assert!(ScanLock::try_acquire(&root).expect("lock").is_some());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn staging_of_a_running_scan_survives_another_process_starting_up() {
        let index_root = temp("staging");
        let live = index_root.join("index");
        fs::create_dir_all(&live).unwrap();
        let staging = index_root.join(".staging.1.2");
        fs::create_dir_all(&staging).unwrap();
        let held = ScanLock::try_acquire(&index_root).unwrap().unwrap();
        // What init does on first open: housekeeping only under the lock.
        if let Some(_lock) = ScanLock::try_acquire(&index_root).unwrap() {
            cleanup_staging_dirs(&index_root);
        }
        assert!(
            staging.exists(),
            "a running scan's staging must not be deleted"
        );
        drop(held);
        if let Some(_lock) = ScanLock::try_acquire(&index_root).unwrap() {
            cleanup_staging_dirs(&index_root);
        }
        assert!(!staging.exists(), "an abandoned staging copy is reclaimed");
        let _ = fs::remove_dir_all(index_root);
    }

    #[test]
    fn a_publish_interrupted_between_renames_restores_the_last_index() {
        let index_root = temp("recover");
        let live = index_root.join("index");
        let backup = index_root.join("index.backup.123");
        fs::create_dir_all(&backup).unwrap();
        fs::write(backup.join("meta.json"), b"{}").unwrap();
        recover_interrupted_publish(&live);
        assert!(live.join("meta.json").exists());
        assert!(!backup.exists());
        // A present live index is never replaced by a backup.
        fs::create_dir_all(index_root.join("index.backup.999")).unwrap();
        recover_interrupted_publish(&live);
        assert!(live.join("meta.json").exists());
        let _ = fs::remove_dir_all(index_root);
    }

    #[test]
    fn an_unchanged_tree_is_detected_without_any_catalog_writes() {
        let root = temp("probe");
        let home = root.join("home");
        let manifest = open_search_manifest(&root).expect("manifest");
        let docs: Vec<_> = (0..3)
            .map(|i| doc(&home.join(format!("{i}.png")), 10))
            .collect();
        for item in &docs {
            persist_manifest_doc(&manifest, item, 1).unwrap();
        }
        // A read-only walk: every entry matches its signature.
        let mut seen = HashSet::new();
        for item in &docs {
            let key = search_doc_key(item);
            seen.insert(key_hash(&key));
            assert_eq!(
                lookup_signature(&manifest, &key).unwrap(),
                Some(DocSignature::from(item))
            );
        }
        let roots = vec![display_path(&home)];
        assert!(missing_local_keys(&manifest, &roots, &seen, 3)
            .unwrap()
            .1
            .is_empty());
        // A changed size is an update; a vanished file is found by key.
        let mut grown = docs[0].clone();
        grown.size = 11;
        assert_ne!(
            lookup_signature(&manifest, &search_doc_key(&grown)).unwrap(),
            Some(DocSignature::from(&grown))
        );
        let mut partial = HashSet::new();
        partial.insert(key_hash(&search_doc_key(&docs[0])));
        partial.insert(key_hash(&search_doc_key(&docs[1])));
        assert_eq!(
            missing_local_keys(&manifest, &roots, &partial, 2).unwrap(),
            (3, vec![search_doc_key(&docs[2])])
        );
        // Entries outside the walked roots are left alone.
        persist_manifest_doc(&manifest, &doc(&root.join("elsewhere.png"), 1), 1).unwrap();
        assert!(missing_local_keys(&manifest, &roots, &seen, 3)
            .unwrap()
            .1
            .is_empty());
        drop(manifest);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn caches_and_app_data_are_skipped_but_documents_and_chosen_roots_are_not() {
        let home = Path::new("/Users/example");
        let privacy = crate::infra::macos_privacy::BackgroundScanExclusions::new(home);
        let mount = home.join(".misty/mnt");
        let filter = ScanFilter::new(home, home, &mount, &[], &privacy);
        assert!(filter.excludes(&home.join("project/node_modules")));
        assert!(filter.excludes(&home.join(".cargo")));
        assert!(filter.excludes(&home.join(".misty/.cache/search")));
        assert!(!filter.excludes(&home.join(".misty/notes")));
        assert!(filter.excludes(&mount.join("remote")));
        assert!(!filter.excludes(&home.join("Documents/report.pdf")));
        assert!(!filter.excludes(&home.join(".config")));
        if cfg!(target_os = "macos") {
            assert!(filter.excludes(&home.join("Library/Caches")));
            assert!(filter.excludes(&home.join("Library/Developer")));
            assert!(filter.excludes(&home.join("Library/Application Support")));
            assert!(!filter.excludes(&home.join("Library")));
            assert!(!filter.excludes(&home.join("Library/Mobile Documents/com~apple~CloudDocs")));
            assert!(!filter.excludes(&home.join("Library/CloudStorage/Dropbox")));
            // A root the user chose explicitly is walked in full.
            let chosen = home.join("Library/Application Support/Notes Export");
            let filter = ScanFilter::new(&chosen, home, &mount, &[], &privacy);
            assert!(!filter.excludes(&chosen.join("notes.txt")));
            assert!(filter.excludes(&chosen.join("node_modules")));
        }
        // Settings' ignored paths still apply.
        let ignored = vec![home.join("Archive"), PathBuf::from("Scratch")];
        let filter = ScanFilter::new(home, home, &mount, &ignored, &privacy);
        assert!(filter.excludes(&home.join("Archive/old.txt")));
        assert!(filter.excludes(&home.join("Documents/Scratch")));
    }

    #[test]
    fn key_ranges_cover_exactly_the_entries_below_a_root() {
        let (lower, upper) = local_key_range("/Users/a");
        let inside = format!("local\u{0}/Users/a/b");
        let sibling = format!("local\u{0}/Users/ab");
        assert!(inside > lower && inside < upper);
        assert!(!(sibling > lower && sibling < upper));
    }
}

#[cfg(not(target_os = "macos"))]
fn delete_doc(writer: &IndexWriter, fields: &SearchIndexFields, path: &str) -> ApiResult<()> {
    writer.delete_term(Term::from_field_text(fields.path, path));
    Ok(())
}
#[cfg(not(target_os = "macos"))]
fn query_documents(
    reader: &IndexReader,
    fields: SearchIndexFields,
    text: &str,
) -> ApiResult<Vec<SearchDoc>> {
    let searcher = reader.searcher();
    let hits = searcher
        .search(
            &build_query(fields, text),
            &TopDocs::with_limit(10_000).order_by_score(),
        )
        .map_err(|e| ApiError::Message(e.to_string()))?;
    hits.into_iter()
        .filter_map(
            |(_, address)| match searcher.doc::<TantivyDocument>(address) {
                Ok(doc) => doc_from_tantivy(fields, &doc).map(Ok),
                Err(e) => Some(Err(ApiError::Message(e.to_string()))),
            },
        )
        .collect()
}
#[cfg(target_os = "macos")]
#[path = "search_remote_engine.rs"]
mod remote_engine;
#[cfg(target_os = "macos")]
pub(crate) use remote_engine::execute_package_index;
#[cfg(target_os = "macos")]
use remote_engine::{
    add_doc, delete_doc, query_documents, seed_search_manifest, Index, IndexReader, IndexWriter,
    SearchIndexFields,
};
