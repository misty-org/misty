use std::{
    collections::{HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, RwLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
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
    core::{
        explorer::{ExplorerLocation, ExplorerLocationKind, FileEntry, FileKind},
        file_master::{
            join_remote_path, normalize_remote_path, RemoteBrowseTarget, RemoteJobStart,
            RemoteJobStatus, RemoteListItem,
        },
        listing_cache::ListingCache,
    },
    error::{ApiError, ApiResult},
    services::{
        environment::AppEnvironmentService,
        providers::{ProviderRemote, ProviderService},
        storage::{StorageResponse, StorageService},
    },
};

const SEARCH_SCHEMA_VERSION: u32 = 1;
const INDEX_MEMORY_BUDGET_BYTES: usize = 96 * 1024 * 1024;
const DEFAULT_RESULT_LIMIT: usize = 100;
const DEFAULT_MAX_DEPTH: usize = 18;
const DEFAULT_REMOTE_MAX_DEPTH: usize = 12;
const REMOTE_DIRECTORY_LIMIT: usize = 20_000;

#[derive(Clone)]
pub struct SearchService {
    inner: Arc<SearchInner>,
}

struct SearchInner {
    index_root: PathBuf,
    live_index_dir: PathBuf,
    mount_root: PathBuf,
    home_dir: PathBuf,
    providers: ProviderService,
    proxy: StorageService,
    listing_cache: ListingCache,
    state: RwLock<SearchState>,
    cancel_flag: Arc<AtomicBool>,
}

struct SearchState {
    status: SearchStatus,
    index: Option<Index>,
    reader: Option<IndexReader>,
    fields: Option<SearchIndexFields>,
}

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
}

#[derive(Debug, Clone)]
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

pub fn default_true() -> bool {
    true
}

impl SearchService {
    pub fn new(
        environment: AppEnvironmentService,
        providers: ProviderService,
        proxy: StorageService,
    ) -> Self {
        let index_root = environment.cache_dir().join("search").join("v1");
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
        };
        Self {
            inner: Arc::new(SearchInner {
                index_root,
                live_index_dir,
                mount_root: environment.mount_root(),
                home_dir: environment.home_dir(),
                providers,
                proxy,
                listing_cache: ListingCache::new(
                    environment.cache_dir().join("remotes"),
                    environment.cache_dir().join("listings"),
                ),
                state: RwLock::new(SearchState {
                    status,
                    index: None,
                    reader: None,
                    fields: None,
                }),
                cancel_flag: Arc::new(AtomicBool::new(false)),
            }),
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
        cleanup_staging_dirs(&self.inner.index_root);
        let (index, reader, fields) = open_or_create_index(&self.inner.live_index_dir)?;
        let meta = read_meta(&self.inner.index_root);
        let indexed_item_count = reader.searcher().num_docs();
        let mut state = self
            .inner
            .state
            .write()
            .map_err(|error| ApiError::Message(error.to_string()))?;
        state.index = Some(index);
        state.reader = Some(reader);
        state.fields = Some(fields);
        state.status.indexed_item_count = indexed_item_count;
        state.status.index_size_bytes = dir_size(&self.inner.live_index_dir);
        if let Some(meta) = meta.filter(|meta| meta.schema_version == SEARCH_SCHEMA_VERSION) {
            state.status.last_scan_time_ms = meta.last_scan_time_ms;
            state.status.last_scan_outcome = meta.last_scan_outcome;
            state.status.last_scan_error = meta.last_scan_error;
            state.status.indexed_local_item_count = meta.indexed_local_item_count;
            state.status.indexed_remote_item_count = meta.indexed_remote_item_count;
            state.status.indexed_local_roots = meta.indexed_local_roots;
            state.status.indexed_remote_names = meta.indexed_remote_names;
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
        }

        let service = self.clone();
        tokio::spawn(async move {
            service.run_scan(request).await;
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
        if query_text.is_empty() {
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
            let searcher = reader.searcher();
            let query = build_query(fields, &query_text);
            let top_docs = searcher
                .search(&query, &TopDocs::with_limit(10_000))
                .map_err(|error| ApiError::Message(error.to_string()))?;
            let mut results = Vec::new();
            for (_tantivy_score, doc_address) in top_docs {
                let retrieved = searcher
                    .doc::<TantivyDocument>(doc_address)
                    .map_err(|error| ApiError::Message(error.to_string()))?;
                let Some(doc) = doc_from_tantivy(fields, &retrieved) else {
                    continue;
                };
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
                let score = score_result(&query_text, &doc, &current_path);
                if score < min_score(query_text.len()) {
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
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging_dir);
        }
        let finished = now_ms();
        let mut state = match self.inner.state.write() {
            Ok(state) => state,
            Err(_) => return,
        };
        let canceled = self.inner.cancel_flag.load(Ordering::SeqCst);
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
        if let Ok((
            index,
            reader,
            fields,
            count,
            local_count,
            remote_count,
            local_roots,
            remote_names,
        )) = result
        {
            state.index = Some(index);
            state.reader = Some(reader);
            state.fields = Some(fields);
            state.status.last_scan_time_ms = Some(finished);
            state.status.indexed_item_count = count;
            state.status.indexed_local_item_count = local_count;
            state.status.indexed_remote_item_count = remote_count;
            state.status.index_size_bytes = dir_size(&self.inner.live_index_dir);
            state.status.indexed_local_roots = local_roots;
            state.status.indexed_remote_names = remote_names;
        }
        let _ = write_meta(
            &self.inner.index_root,
            &SearchMeta {
                schema_version: SEARCH_SCHEMA_VERSION,
                indexed_item_count: state.status.indexed_item_count,
                indexed_local_item_count: state.status.indexed_local_item_count,
                indexed_remote_item_count: state.status.indexed_remote_item_count,
                last_scan_time_ms: state.status.last_scan_time_ms,
                last_scan_outcome: state.status.last_scan_outcome.clone(),
                last_scan_error: state.status.last_scan_error.clone(),
                indexed_local_roots: state.status.indexed_local_roots.clone(),
                indexed_remote_names: state.status.indexed_remote_names.clone(),
            },
        );
    }

    async fn run_scan_inner(
        &self,
        request: &SearchScanRequest,
        staging_dir: &Path,
    ) -> ApiResult<(
        Index,
        IndexReader,
        SearchIndexFields,
        u64,
        u64,
        u64,
        Vec<String>,
        Vec<String>,
    )> {
        let (index, fields) = create_fresh_index(staging_dir)?;
        let mut writer = index
            .writer_with_num_threads(1, INDEX_MEMORY_BUDGET_BYTES)
            .map_err(|error| ApiError::Message(error.to_string()))?;
        let ignored = ignored_paths(&request.ignored_paths, &self.inner.index_root);
        let mut count = 0u64;
        let mut local_count = 0u64;
        let mut remote_count = 0u64;
        let mut indexed_local_roots = Vec::new();
        let mut indexed_remote_names = Vec::new();

        if request.include_local {
            let roots = local_roots(request, &self.inner.home_dir);
            for root in roots {
                if self.inner.cancel_flag.load(Ordering::SeqCst) {
                    return Err(ApiError::Message("Search scan canceled.".to_string()));
                }
                self.set_scan_progress(Some("Local".to_string()), Some(display_path(&root)));
                match self.scan_local_root(&root, request.max_depth, &ignored, &fields, &writer) {
                    Ok(indexed) => {
                        count += indexed;
                        local_count += indexed;
                        indexed_local_roots.push(display_path(&root));
                        self.set_indexed_count(count);
                    }
                    Err(error) => self.push_scan_error(display_path(&root), error.to_string()),
                }
            }
        }

        if request.include_remotes {
            let remotes = self.selected_remotes(request).await;
            for remote in remotes {
                if self.inner.cancel_flag.load(Ordering::SeqCst) {
                    return Err(ApiError::Message("Search scan canceled.".to_string()));
                }
                self.set_scan_progress(
                    Some(format!("Remote {}", remote.name)),
                    Some("/".to_string()),
                );
                match self
                    .scan_remote(&remote, request.max_depth, &fields, &writer)
                    .await
                {
                    Ok(indexed) => {
                        count += indexed;
                        remote_count += indexed;
                        indexed_remote_names.push(remote.name.clone());
                        self.set_indexed_count(count);
                    }
                    Err(error) => self.push_scan_error(remote.name.clone(), error.to_string()),
                }
            }
        }

        {
            let mut state = self
                .inner
                .state
                .write()
                .map_err(|error| ApiError::Message(error.to_string()))?;
            state.status.scan_phase = SearchScanPhase::Committing;
        }
        writer
            .commit()
            .map_err(|error| ApiError::Message(error.to_string()))?;
        drop(writer);
        drop(index);
        replace_index(staging_dir, &self.inner.live_index_dir)?;
        let (index, reader, fields) = open_or_create_index(&self.inner.live_index_dir)?;
        Ok((
            index,
            reader,
            fields,
            count,
            local_count,
            remote_count,
            indexed_local_roots,
            indexed_remote_names,
        ))
    }

    fn scan_local_root(
        &self,
        root: &Path,
        max_depth: Option<usize>,
        ignored: &[PathBuf],
        fields: &SearchIndexFields,
        writer: &IndexWriter,
    ) -> ApiResult<u64> {
        if !root.exists() || !root.is_dir() {
            return Ok(0);
        }
        let mut count = 0u64;
        for entry in WalkDir::new(root)
            .follow_links(false)
            .max_depth(max_depth.unwrap_or(DEFAULT_MAX_DEPTH).max(1))
            .into_iter()
            .filter_entry(|entry| !is_ignored(entry.path(), ignored))
        {
            if self.inner.cancel_flag.load(Ordering::SeqCst) {
                return Err(ApiError::Message("Search scan canceled.".to_string()));
            }
            let Ok(entry) = entry else {
                continue;
            };
            if entry.depth() == 0 {
                continue;
            }
            let path = entry.path();
            self.set_current_path_throttled(display_path(path), count);
            if is_ignored(path, ignored) {
                continue;
            }
            let Ok(metadata) = fs::symlink_metadata(path) else {
                continue;
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
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
            if add_doc(writer, fields, &doc).is_ok() {
                count += 1;
            }
        }
        Ok(count)
    }

    async fn selected_remotes(&self, request: &SearchScanRequest) -> Vec<ProviderRemote> {
        let snapshot = match self.inner.providers.snapshot().await {
            Ok(snapshot) if !snapshot.remotes.is_empty() || snapshot.loading => Ok(snapshot),
            _ => self.inner.providers.refresh().await,
        };
        let Ok(snapshot) = snapshot else {
            return Vec::new();
        };
        let selected: HashSet<String> = request.remote_names.iter().cloned().collect();
        snapshot
            .remotes
            .into_iter()
            .filter(|remote| selected.is_empty() || selected.contains(&remote.name))
            .filter(|remote| !remote.needs_reconnect)
            .collect()
    }

    async fn scan_remote(
        &self,
        remote: &ProviderRemote,
        max_depth: Option<usize>,
        fields: &SearchIndexFields,
        writer: &IndexWriter,
    ) -> ApiResult<u64> {
        let mut count = 0u64;
        let mut visited = HashSet::new();
        let mut pending = VecDeque::new();
        pending.push_back(("/".to_string(), 0usize));
        while let Some((remote_path, depth)) = pending.pop_front() {
            if self.inner.cancel_flag.load(Ordering::SeqCst) {
                return Err(ApiError::Message("Search scan canceled.".to_string()));
            }
            if depth > max_depth.unwrap_or(DEFAULT_REMOTE_MAX_DEPTH).max(1) {
                continue;
            }
            if visited.len() >= REMOTE_DIRECTORY_LIMIT {
                break;
            }
            let normalized = normalize_remote_path(&remote_path)?;
            if !visited.insert(normalized.clone()) {
                continue;
            }
            self.set_scan_progress(
                Some(format!("Remote {}", remote.name)),
                Some(normalized.clone()),
            );
            let target = RemoteBrowseTarget {
                provider_type: remote.provider_type.clone(),
                remote_name: remote.name.clone(),
                remote_path: normalized.clone(),
            };
            let items = self.fetch_remote_items(&target).await?;
            for item in items {
                if self.inner.cancel_flag.load(Ordering::SeqCst) {
                    return Err(ApiError::Message("Search scan canceled.".to_string()));
                }
                let child_remote_path = target.child_remote_path(&item)?;
                let name = remote_item_name(&item, &child_remote_path);
                let item_target = RemoteBrowseTarget {
                    provider_type: remote.provider_type.clone(),
                    remote_name: remote.name.clone(),
                    remote_path: child_remote_path.clone(),
                };
                let virtual_path = item_target.virtual_path(&self.inner.mount_root);
                let modified_ms = parse_remote_modified_ms(&item.mod_time);
                let doc = SearchDoc {
                    path: display_path(&virtual_path),
                    name,
                    extension: Path::new(&child_remote_path)
                        .extension()
                        .and_then(|value| value.to_str())
                        .unwrap_or_default()
                        .to_ascii_lowercase(),
                    source_kind: SearchSourceKind::Remote,
                    provider_type: remote.provider_type.clone(),
                    remote_name: remote.name.clone(),
                    remote_path: child_remote_path.clone(),
                    mime_type: item.mime_type,
                    is_file: !item.is_dir,
                    is_dir: item.is_dir,
                    size: item.size.max(0) as u64,
                    modified_ms,
                    hidden: Path::new(&child_remote_path)
                        .file_name()
                        .and_then(|value| value.to_str())
                        .map(|value| value.starts_with('.'))
                        .unwrap_or(false),
                };
                if add_doc(writer, fields, &doc).is_ok() {
                    count += 1;
                    if count % 200 == 0 {
                        self.set_indexed_count(count);
                    }
                }
                if item.is_dir {
                    pending.push_back((child_remote_path, depth + 1));
                }
            }
        }
        Ok(count)
    }

    async fn fetch_remote_items(
        &self,
        target: &RemoteBrowseTarget,
    ) -> ApiResult<Vec<RemoteListItem>> {
        let response = self
            .inner
            .proxy
            .get_with_query(
                "/api/remote/file/list",
                &[
                    ("remote", target.remote_name.as_str()),
                    ("path", target.remote_path.as_str()),
                ],
            )
            .await?;
        let start: RemoteJobStart = response_json(response, "start remote list").await?;
        self.wait_for_remote_job(&start.job_id).await?;
        let response = self
            .inner
            .proxy
            .get(&format!(
                "/api/remote/file/jobs/{}/result/list",
                start.job_id
            ))
            .await?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(ApiError::Message(if body.is_empty() {
                format!(
                    "Failed to load remote list result (HTTP {})",
                    status.as_u16()
                )
            } else {
                body
            }));
        }
        let items = serde_json::from_str::<Vec<RemoteListItem>>(&body)
            .map_err(|error| ApiError::Message(format!("Failed to parse remote list: {error}")))?;
        let cache_body = serde_json::to_vec(&items)
            .map_err(|error| ApiError::Message(format!("Failed to encode remote list: {error}")))?;
        self.inner
            .listing_cache
            .save(&target.remote_name, &target.remote_path, &cache_body)
            .await?;
        Ok(items)
    }

    async fn wait_for_remote_job(&self, job_id: &str) -> ApiResult<RemoteJobStatus> {
        for _ in 0..1_200 {
            if self.inner.cancel_flag.load(Ordering::SeqCst) {
                let _ = self
                    .inner
                    .proxy
                    .delete(&format!("/api/remote/file/jobs/{job_id}"))
                    .await;
                return Err(ApiError::Message("Search scan canceled.".to_string()));
            }
            let response = self
                .inner
                .proxy
                .get(&format!("/api/remote/file/jobs/{job_id}"))
                .await?;
            let status: RemoteJobStatus = response_json(response, "poll remote list").await?;
            match status.state.as_str() {
                "succeeded" => return Ok(status),
                "failed" | "canceled" | "cancelled" => {
                    return Err(ApiError::Message(if status.message.is_empty() {
                        format!("Remote {} job {}", status.operation, status.state)
                    } else {
                        status.message
                    }))
                }
                _ => tokio::time::sleep(Duration::from_millis(150)).await,
            }
        }
        Err(ApiError::Message(
            "Remote search scan timed out.".to_string(),
        ))
    }

    fn set_scan_progress(&self, source: Option<String>, path: Option<String>) {
        if let Ok(mut state) = self.inner.state.write() {
            state.status.current_source = source;
            state.status.current_path = path;
        }
    }

    fn set_current_path_throttled(&self, path: String, count: u64) {
        if count % 250 != 0 {
            return;
        }
        if let Ok(mut state) = self.inner.state.write() {
            state.status.current_path = Some(path);
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

fn text_field(doc: &TantivyDocument, field: Field) -> Option<String> {
    doc.get_first(field)
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}

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

fn parse_remote_modified_ms(value: &str) -> u64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|value| value.timestamp_millis().max(0) as u64)
        .unwrap_or(0)
}

fn remote_item_name(item: &RemoteListItem, remote_path: &str) -> String {
    if !item.name.is_empty() {
        return item.name.clone();
    }
    Path::new(remote_path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(remote_path)
        .to_string()
}

async fn response_json<T: serde::de::DeserializeOwned>(
    response: StorageResponse,
    operation: &str,
) -> ApiResult<T> {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(ApiError::Message(if body.is_empty() {
            format!("{operation} failed (HTTP {})", status.as_u16())
        } else {
            body
        }));
    }
    serde_json::from_str::<T>(&body)
        .map_err(|error| ApiError::Message(format!("Failed to parse {operation}: {error}")))
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
