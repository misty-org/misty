use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::{Duration, UNIX_EPOCH},
};

use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, ImageReader, Limits};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::{
    domain::explorer::{ExplorerLocationKind, FileKind, ListDirectoryRequest},
    error::{ApiError, ApiResult},
    infra::{
        environment::AppEnvironmentService,
        explorer::ExplorerService,
        smart_library_ingestion::{self, SemanticAssetKind},
    },
};

mod preflight;
pub use preflight::SmartLibraryImportPreflight;
pub const PILOT_SAMPLE_SIZE: usize = 25;
// The original pilot capped the device catalog at 500. Analysis/billing limits belong on the
// server; the local catalog must be able to represent a selected disk.
pub const PILOT_ASSET_LIMIT: usize = 1_000_000;
pub const MAX_PREVIEW_BATCH_SIZE: usize = 8;
pub const MAX_MANUAL_IMPORT_FILES: usize = 500;
const DEFAULT_PREVIEW_DIMENSION: u32 = 512;
const MIN_PREVIEW_DIMENSION: u32 = 384;

const RENDERABLE_IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "gif", "bmp", "pnm", "tga", "hdr",
];
const MAX_IMAGE_DIMENSION: u32 = 32_768;
const MAX_IMAGE_DECODE_ALLOC: u64 = 128 * 1024 * 1024;
const CURRENT_INDEX_VERSION: &str = "mika-semantic-v4";
const SNAPSHOT_ASSET_LIMIT: usize = 1_000;
const MAX_ASSET_PAGE_SIZE: usize = 500;
const SAMPLE_CANDIDATE_WINDOW: usize = 5_000;
const PREPARE_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub struct SmartLibraryService {
    db_path: PathBuf,
    explorer: ExplorerService,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartLibraryScanRequest {
    pub root_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartLibraryImportFilesRequest {
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartLibraryImportResult {
    pub library: FolderLibraryStatus,
    pub imported_asset_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareSmartLibraryPreviewsRequest {
    pub asset_ids: Vec<String>,
    #[serde(default)]
    pub max_dimension: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplySmartLibraryResultsRequest {
    pub results: Vec<SmartLibraryAnalysisResult>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartLibrarySearchRequest {
    pub query: String,
    #[serde(default)]
    pub collection: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveSmartLibraryAssetsRequest {
    pub asset_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartLibraryAssetsPageRequest {
    #[serde(default)]
    pub after_asset_id: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub reindex_only: bool,
    #[serde(default)]
    pub index_version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartLibraryAssetsPage {
    pub assets: Vec<SmartLibraryAsset>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSmartLibraryAsset {
    pub asset_id: String,
    pub path: String,
    pub relative_path: String,
    pub name: String,
    pub source_kind: SmartLibrarySourceKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SmartLibrarySourceKind {
    Local,
    Cloud,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SmartLibraryAssetStatus {
    Pending,
    Queued,
    Analyzed,
    Failed,
    Changed,
    Unsupported,
}

impl SmartLibraryAssetStatus {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Queued => "queued",
            Self::Analyzed => "analyzed",
            Self::Failed => "failed",
            Self::Changed => "changed",
            Self::Unsupported => "unsupported",
        }
    }

    fn from_str(value: &str) -> Self {
        match value {
            "queued" => Self::Queued,
            "analyzed" => Self::Analyzed,
            "failed" => Self::Failed,
            "changed" => Self::Changed,
            "unsupported" => Self::Unsupported,
            _ => Self::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PilotAllowance {
    pub sample_images: usize,
    pub maximum_analyzed_images: usize,
    pub sample_included: bool,
    pub remaining_images: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisEstimate {
    pub eligible_images: usize,
    pub included_images: usize,
    pub billable_images: usize,
    pub credit_units: usize,
    pub price_minor: Option<u64>,
    pub currency: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FolderPreflight {
    pub total_images: usize,
    pub supported_images: usize,
    pub unsupported_images: usize,
    pub already_analyzed_images: usize,
    pub changed_images: usize,
    pub new_images: usize,
    pub duplicate_images: usize,
    pub eligible_images: usize,
    pub pilot_capped_images: usize,
    pub skipped_full_original_images: usize,
    pub sample_asset_ids: Vec<String>,
    pub unsupported_reasons: BTreeMap<String, usize>,
    pub allowance: PilotAllowance,
    pub estimate: AnalysisEstimate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartLibraryAsset {
    pub asset_id: String,
    pub relative_path: String,
    pub name: String,
    pub mime_type: String,
    pub extension: String,
    pub size_bytes: u64,
    pub modified_ms: u64,
    pub fingerprint: String,
    pub source_kind: SmartLibrarySourceKind,
    pub asset_kind: SemanticAssetKind,
    pub preview_supported: bool,
    pub unsupported_reason: Option<String>,
    pub status: SmartLibraryAssetStatus,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub collections: Vec<String>,
    pub confidence: Option<f32>,
    pub failure: Option<String>,
    pub index_version: Option<String>,
    pub indexed_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderLibraryStatus {
    pub library_id: String,
    pub server_folder_id: Option<String>,
    pub root_path: String,
    pub display_name: String,
    pub source_kind: SmartLibrarySourceKind,
    pub created_at_ms: u64,
    pub last_scanned_at_ms: u64,
    pub preflight: FolderPreflight,
    pub assets: Vec<SmartLibraryAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SmartLibrarySnapshot {
    pub active_library: Option<FolderLibraryStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedSmartLibraryPreview {
    pub asset_id: String,
    pub fingerprint: String,
    pub mime_type: String,
    pub asset_kind: SemanticAssetKind,
    pub extracted_text: Option<String>,
    pub metadata: BTreeMap<String, String>,
    pub truncated: bool,
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SmartLibraryAnalysisResult {
    pub asset_id: String,
    pub status: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub suggested_collections: Vec<String>,
    #[serde(default)]
    pub confidence: Option<f32>,
    #[serde(default)]
    pub failure: Option<String>,
    #[serde(default)]
    pub index_version: Option<String>,
}

impl SmartLibraryService {
    pub fn new(environment: AppEnvironmentService, explorer: ExplorerService) -> Self {
        Self {
            db_path: environment
                .cache_dir()
                .join("smart-library")
                .join("v1.sqlite3"),
            explorer,
        }
    }

    pub async fn snapshot(&self) -> ApiResult<SmartLibrarySnapshot> {
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || load_snapshot(&db_path))
            .await
            .map_err(worker_error)?
    }

    pub async fn scan(&self, request: SmartLibraryScanRequest) -> ApiResult<FolderLibraryStatus> {
        let root_path = request.root_path.trim().to_owned();
        if root_path.is_empty() {
            return Err(ApiError::Message(
                "Choose a Library folder first.".to_owned(),
            ));
        }
        let first_listing = self
            .explorer
            .list_directory(ListDirectoryRequest {
                path: Some(root_path.clone()),
                show_hidden: Some(false),
                force_remote_refresh: Some(false),
            })
            .await?;
        let source_kind = match first_listing.location.kind {
            ExplorerLocationKind::Local => SmartLibrarySourceKind::Local,
            _ => SmartLibrarySourceKind::Cloud,
        };
        if source_kind != SmartLibrarySourceKind::Local {
            return Err(ApiError::Message(
                "Private Library only accepts files stored on this device.".to_owned(),
            ));
        }

        let discovered = match source_kind {
            SmartLibrarySourceKind::Local => {
                let root = PathBuf::from(&root_path);
                let db_path = self.db_path.clone();
                tokio::task::spawn_blocking(move || {
                    let hints = load_scan_hints(&db_path)?;
                    discover_local(&root, &hints)
                })
                .await
                .map_err(worker_error)??
            }
            SmartLibrarySourceKind::Cloud => {
                self.discover_cloud(root_path.clone(), first_listing)
                    .await?
            }
        };
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || {
            persist_scan(&db_path, &root_path, source_kind, discovered)
        })
        .await
        .map_err(worker_error)?
    }

    async fn discover_cloud(
        &self,
        root_path: String,
        first_listing: crate::domain::explorer::DirectoryListing,
    ) -> ApiResult<Vec<DiscoveredAsset>> {
        let mut queue = VecDeque::from([(root_path.clone(), Some(first_listing))]);
        let mut discovered = Vec::new();
        let mut visited = HashSet::new();
        while let Some((directory, cached)) = queue.pop_front() {
            if !visited.insert(directory.clone()) {
                continue;
            }
            let listing = match cached {
                Some(listing) => listing,
                None => {
                    self.explorer
                        .list_directory(ListDirectoryRequest {
                            path: Some(directory.clone()),
                            show_hidden: Some(false),
                            force_remote_refresh: Some(false),
                        })
                        .await?
                }
            };
            for entry in listing.entries {
                match entry.kind {
                    FileKind::Folder => queue.push_back((entry.path, None)),
                    FileKind::File => {
                        let relative_path = relative_display_path(&root_path, &entry.path);
                        let extension = normalize_extension(&entry.extension);
                        let size_bytes = entry.size_bytes.unwrap_or_default();
                        let classification = smart_library_ingestion::classify_with_declared_mime(
                            &extension,
                            size_bytes,
                            entry.mime_type.as_deref(),
                        );
                        let fingerprint = metadata_fingerprint(
                            &relative_path,
                            size_bytes,
                            entry.modified_ms.unwrap_or_default().max(0) as u64,
                        );
                        discovered.push(DiscoveredAsset {
                            path: entry.path,
                            relative_path,
                            name: entry.name,
                            extension: extension.clone(),
                            mime_type: entry.mime_type.unwrap_or(classification.mime_type),
                            asset_kind: classification.kind,
                            size_bytes,
                            modified_ms: entry.modified_ms.unwrap_or_default().max(0) as u64,
                            fingerprint,
                            preview_supported: classification.analysis_supported,
                            unsupported_reason: classification.unsupported_reason,
                        });
                    }
                    _ => {}
                }
            }
        }
        Ok(discovered)
    }

    pub async fn prepare_previews(
        &self,
        request: PrepareSmartLibraryPreviewsRequest,
    ) -> ApiResult<Vec<PreparedSmartLibraryPreview>> {
        if request.asset_ids.is_empty() {
            return Ok(Vec::new());
        }
        if request.asset_ids.len() > MAX_PREVIEW_BATCH_SIZE {
            return Err(ApiError::Message(format!(
                "Library analysis batches are limited to {MAX_PREVIEW_BATCH_SIZE} assets."
            )));
        }
        let dimension = request
            .max_dimension
            .unwrap_or(DEFAULT_PREVIEW_DIMENSION)
            .clamp(MIN_PREVIEW_DIMENSION, DEFAULT_PREVIEW_DIMENSION);
        let db_path = self.db_path.clone();
        tokio::time::timeout(
            PREPARE_TIMEOUT,
            tokio::task::spawn_blocking(move || {
                prepare_previews(&db_path, &request.asset_ids, dimension)
            }),
        )
        .await
        .map_err(|_| ApiError::Message("Library extraction timed out safely.".to_owned()))?
        .map_err(worker_error)?
    }

    pub async fn apply_results(
        &self,
        request: ApplySmartLibraryResultsRequest,
    ) -> ApiResult<SmartLibrarySnapshot> {
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || apply_results(&db_path, request.results))
            .await
            .map_err(worker_error)?
    }

    pub async fn set_server_folder_id(
        &self,
        server_folder_id: String,
    ) -> ApiResult<SmartLibrarySnapshot> {
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || {
            let conn = open_database(&db_path)?;
            conn.execute(
                "UPDATE smart_library_root SET server_folder_id = ?1 WHERE singleton = 1",
                params![server_folder_id],
            )
            .map_err(sql_error)?;
            load_snapshot_with_connection(&conn)
        })
        .await
        .map_err(worker_error)?
    }

    pub async fn search(
        &self,
        request: SmartLibrarySearchRequest,
    ) -> ApiResult<Vec<SmartLibraryAsset>> {
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || search_assets(&db_path, request))
            .await
            .map_err(worker_error)?
    }

    pub async fn resolve_assets(
        &self,
        request: ResolveSmartLibraryAssetsRequest,
    ) -> ApiResult<Vec<ResolvedSmartLibraryAsset>> {
        if request.asset_ids.len() > 500 {
            return Err(ApiError::Message(
                "At most 500 opaque Library assets can be resolved at once.".to_owned(),
            ));
        }
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || resolve_assets(&db_path, request.asset_ids))
            .await
            .map_err(worker_error)?
    }

    pub async fn assets_page(
        &self,
        request: SmartLibraryAssetsPageRequest,
    ) -> ApiResult<SmartLibraryAssetsPage> {
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || load_assets_page(&db_path, request))
            .await
            .map_err(worker_error)?
    }

    pub async fn delete(&self) -> ApiResult<SmartLibrarySnapshot> {
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || {
            let conn = open_database(&db_path)?;
            conn.execute("DELETE FROM smart_library_assets", [])
                .map_err(sql_error)?;
            conn.execute("DELETE FROM smart_library_root", [])
                .map_err(sql_error)?;
            Ok(SmartLibrarySnapshot::default())
        })
        .await
        .map_err(worker_error)?
    }
}

#[derive(Debug, Clone)]
struct DiscoveredAsset {
    path: String,
    relative_path: String,
    name: String,
    extension: String,
    mime_type: String,
    asset_kind: SemanticAssetKind,
    size_bytes: u64,
    modified_ms: u64,
    fingerprint: String,
    preview_supported: bool,
    unsupported_reason: Option<String>,
}

#[derive(Debug, Clone)]
struct ScanHint {
    size_bytes: u64,
    modified_ms: u64,
    fingerprint: String,
}

fn load_scan_hints(db_path: &Path) -> ApiResult<HashMap<String, ScanHint>> {
    if !db_path.exists() {
        return Ok(HashMap::new());
    }
    let conn = open_database(db_path)?;
    let mut statement = conn
        .prepare("SELECT path, size_bytes, modified_ms, fingerprint FROM smart_library_assets")
        .map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                ScanHint {
                    size_bytes: row.get(1)?,
                    modified_ms: row.get(2)?,
                    fingerprint: row.get(3)?,
                },
            ))
        })
        .map_err(sql_error)?;
    rows.collect::<rusqlite::Result<HashMap<_, _>>>()
        .map_err(sql_error)
}

fn discover_local(
    root: &Path,
    hints: &HashMap<String, ScanHint>,
) -> ApiResult<Vec<DiscoveredAsset>> {
    if !root.is_dir() {
        return Err(ApiError::Message(format!(
            "{} is not a folder.",
            root.display()
        )));
    }
    let mut assets = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            entry.depth() == 0 || !entry.file_name().to_string_lossy().starts_with('.')
        })
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let extension = normalize_extension(
            path.extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default(),
        );
        let metadata = match entry.metadata() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let modified_ms = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_millis() as u64)
            .unwrap_or_default();
        let mut classification = smart_library_ingestion::classify(&extension, metadata.len());
        if extension == "ts" && smart_library_ingestion::is_mpeg_transport_stream(path) {
            classification.analysis_supported = false;
            classification.mime_type = "video/mp2t".to_owned();
            classification.unsupported_reason =
                Some("Video formats are excluded from semantic indexing".to_owned());
        }
        let path_string = path.display().to_string();
        let fingerprint =
            fingerprint_for_scan(path, metadata.len(), modified_ms, hints.get(&path_string))?;
        assets.push(DiscoveredAsset {
            path: path_string,
            relative_path: path
                .strip_prefix(root)
                .unwrap_or(path)
                .display()
                .to_string(),
            name: path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_owned(),
            extension: extension.clone(),
            mime_type: classification.mime_type,
            asset_kind: classification.kind,
            size_bytes: metadata.len(),
            modified_ms,
            fingerprint,
            preview_supported: classification.analysis_supported,
            unsupported_reason: classification.unsupported_reason,
        });
    }
    Ok(assets)
}

fn discover_selected_local(
    paths: &[String],
    hints: &HashMap<String, ScanHint>,
) -> ApiResult<Vec<DiscoveredAsset>> {
    let mut discovered = Vec::new();
    let mut seen = HashSet::new();
    for raw_path in paths {
        let path = PathBuf::from(raw_path.trim());
        if !seen.insert(path.clone()) {
            continue;
        }
        if path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.starts_with('.'))
        {
            return Err(ApiError::Message(
                "Hidden files cannot be added to Library.".to_owned(),
            ));
        }
        let metadata = path.metadata().map_err(io_error)?;
        if !metadata.is_file() {
            return Err(ApiError::Message(format!(
                "{} is not a file.",
                path.display()
            )));
        }
        let extension = normalize_extension(
            path.extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default(),
        );
        let modified_ms = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_millis() as u64)
            .unwrap_or_default();
        let mut classification = smart_library_ingestion::classify(&extension, metadata.len());
        if extension == "ts" && smart_library_ingestion::is_mpeg_transport_stream(&path) {
            classification.analysis_supported = false;
            classification.mime_type = "video/mp2t".to_owned();
            classification.unsupported_reason =
                Some("Video formats are excluded from semantic indexing".to_owned());
        }
        let path_string = path.display().to_string();
        discovered.push(DiscoveredAsset {
            path: path_string.clone(),
            relative_path: path_string.clone(),
            name: path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_owned(),
            extension: extension.clone(),
            mime_type: classification.mime_type,
            asset_kind: classification.kind,
            size_bytes: metadata.len(),
            modified_ms,
            fingerprint: fingerprint_for_scan(
                &path,
                metadata.len(),
                modified_ms,
                hints.get(&path_string),
            )?,
            preview_supported: classification.analysis_supported,
            unsupported_reason: classification.unsupported_reason,
        });
    }
    if discovered.is_empty() {
        return Err(ApiError::Message(
            "Choose at least one new file to add to Library.".to_owned(),
        ));
    }
    Ok(discovered)
}

fn persist_imported_files(
    db_path: &Path,
    discovered: Vec<DiscoveredAsset>,
) -> ApiResult<SmartLibraryImportResult> {
    let mut conn = open_database(db_path)?;
    let existing_root: Option<(String, String, u64)> = conn
        .query_row(
            "SELECT library_id, source_kind, created_at_ms FROM smart_library_root WHERE singleton=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(sql_error)?;
    if existing_root
        .as_ref()
        .is_some_and(|(_, source, _)| source == "cloud")
    {
        return Err(ApiError::Message(
            "Remove the existing cloud Library before adding local files.".to_owned(),
        ));
    }
    let now = now_ms();
    let library_id = existing_root
        .as_ref()
        .map(|value| value.0.clone())
        .unwrap_or_else(|| format!("lib_{}", Uuid::new_v4().simple()));
    let created_at_ms = existing_root.as_ref().map(|value| value.2).unwrap_or(now);
    let tx = conn.transaction().map_err(sql_error)?;
    tx.execute(
        "INSERT INTO smart_library_root (singleton,library_id,root_path,display_name,source_kind,created_at_ms,last_scanned_at_ms)\
         VALUES(1,?1,'misty://library','Library','local',?2,?3)\
         ON CONFLICT(singleton) DO UPDATE SET root_path='misty://library',display_name='Library',source_kind='local',last_scanned_at_ms=excluded.last_scanned_at_ms",
        params![library_id, created_at_ms, now],
    )
    .map_err(sql_error)?;
    tx.execute(
        "UPDATE smart_library_assets SET relative_path=path WHERE source_kind='local'",
        [],
    )
    .map_err(sql_error)?;

    let mut imported_asset_ids = Vec::with_capacity(discovered.len());
    for asset in discovered {
        let existing: Option<(String, String, String)> = tx
            .query_row(
                "SELECT asset_id,fingerprint,status FROM smart_library_assets WHERE path=?1",
                params![asset.path],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(sql_error)?;
        let unchanged = existing
            .as_ref()
            .is_some_and(|(_, fingerprint, _)| fingerprint == &asset.fingerprint);
        let asset_id = existing
            .as_ref()
            .map(|value| value.0.clone())
            .unwrap_or_else(|| format!("asset_{}", Uuid::new_v4().simple()));
        let prior_status = existing
            .as_ref()
            .map(|value| SmartLibraryAssetStatus::from_str(&value.2))
            .unwrap_or(SmartLibraryAssetStatus::Pending);
        let status = if !asset.preview_supported {
            SmartLibraryAssetStatus::Unsupported
        } else if unchanged {
            prior_status
        } else if existing.is_some() {
            SmartLibraryAssetStatus::Changed
        } else {
            SmartLibraryAssetStatus::Pending
        };
        tx.execute(
            "INSERT INTO smart_library_assets\
             (asset_id,path,relative_path,name,mime_type,extension,asset_kind,size_bytes,modified_ms,fingerprint,source_kind,preview_supported,unsupported_reason,status,metadata_json)\
             VALUES(?1,?2,?2,?3,?4,?5,?6,?7,?8,?9,'local',?10,?11,?12,COALESCE((SELECT metadata_json FROM smart_library_assets WHERE asset_id=?1),'{}'))\
             ON CONFLICT(asset_id) DO UPDATE SET path=excluded.path,relative_path=excluded.path,name=excluded.name,mime_type=excluded.mime_type,extension=excluded.extension,asset_kind=excluded.asset_kind,size_bytes=excluded.size_bytes,modified_ms=excluded.modified_ms,fingerprint=excluded.fingerprint,source_kind='local',preview_supported=excluded.preview_supported,unsupported_reason=excluded.unsupported_reason,status=excluded.status,indexed_fingerprint=CASE WHEN smart_library_assets.fingerprint=excluded.fingerprint THEN smart_library_assets.indexed_fingerprint ELSE NULL END",
            params![asset_id, asset.path, asset.name, asset.mime_type, asset.extension,
                asset.asset_kind.as_str(), asset.size_bytes, asset.modified_ms, asset.fingerprint,
                asset.preview_supported, asset.unsupported_reason, status.as_str()],
        )
        .map_err(sql_error)?;
        imported_asset_ids.push(asset_id);
    }
    tx.commit().map_err(sql_error)?;
    let library = load_snapshot(db_path)?
        .active_library
        .ok_or_else(|| ApiError::Message("Library import did not persist.".to_owned()))?;
    Ok(SmartLibraryImportResult {
        library,
        imported_asset_ids,
    })
}

fn persist_scan(
    db_path: &Path,
    root_path: &str,
    source_kind: SmartLibrarySourceKind,
    discovered: Vec<DiscoveredAsset>,
) -> ApiResult<FolderLibraryStatus> {
    let mut conn = open_database(db_path)?;
    let existing_root: Option<(String, String, u64)> = conn.query_row(
        "SELECT library_id, root_path, created_at_ms FROM smart_library_root WHERE singleton = 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).optional().map_err(sql_error)?;
    if let Some((_, existing_path, _)) = &existing_root {
        if existing_path != root_path {
            return Err(ApiError::Message(
                "Only one Library folder can be active. Remove it before choosing another."
                    .to_owned(),
            ));
        }
    }
    let now = now_ms();
    let library_id = existing_root
        .as_ref()
        .map(|value| value.0.clone())
        .unwrap_or_else(|| format!("lib_{}", Uuid::new_v4().simple()));
    let created_at_ms = existing_root.as_ref().map(|value| value.2).unwrap_or(now);
    let display_name = Path::new(root_path)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Library")
        .to_owned();
    let source = match source_kind {
        SmartLibrarySourceKind::Local => "local",
        SmartLibrarySourceKind::Cloud => "cloud",
    };
    let tx = conn.transaction().map_err(sql_error)?;
    tx.execute(
        "INSERT INTO smart_library_root (singleton, library_id, root_path, display_name, source_kind, created_at_ms, last_scanned_at_ms)\
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)\
         ON CONFLICT(singleton) DO UPDATE SET display_name=excluded.display_name, source_kind=excluded.source_kind, last_scanned_at_ms=excluded.last_scanned_at_ms",
        params![library_id, root_path, display_name, source, created_at_ms, now],
    ).map_err(sql_error)?;

    // A temporary SQLite set avoids materializing a second in-memory copy of every path and
    // avoids sending a disk-sized JSON value through SQLite merely to remove stale rows.
    tx.execute_batch(
        "CREATE TEMP TABLE IF NOT EXISTS smart_library_scan_paths (path TEXT PRIMARY KEY) WITHOUT ROWID;
         DELETE FROM smart_library_scan_paths;",
    )
    .map_err(sql_error)?;
    {
        let mut insert_path = tx
            .prepare("INSERT OR IGNORE INTO smart_library_scan_paths(path) VALUES (?1)")
            .map_err(sql_error)?;
        for asset in &discovered {
            insert_path
                .execute(params![asset.path])
                .map_err(sql_error)?;
        }
    }
    for asset in discovered {
        let same_path: Option<(String, String, String)> = tx
            .query_row(
                "SELECT asset_id, fingerprint, status FROM smart_library_assets WHERE path=?1",
                params![asset.path],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(sql_error)?;
        let unchanged = same_path
            .as_ref()
            .map(|old| old.1 == asset.fingerprint)
            .unwrap_or(false);
        let reusable_id = if same_path.is_none() {
            tx.query_row(
                "SELECT asset_id FROM smart_library_assets WHERE fingerprint=?1 AND path NOT IN (SELECT path FROM smart_library_scan_paths) LIMIT 1",
                params![asset.fingerprint],
                |row| row.get(0),
            )
            .optional()
            .map_err(sql_error)?
        } else {
            None
        };
        let asset_id = same_path
            .as_ref()
            .map(|old| old.0.clone())
            .or(reusable_id)
            .unwrap_or_else(|| format!("asset_{}", Uuid::new_v4().simple()));
        let prior_status = same_path
            .as_ref()
            .map(|old| SmartLibraryAssetStatus::from_str(&old.2))
            .unwrap_or(SmartLibraryAssetStatus::Pending);
        let status = if !asset.preview_supported {
            SmartLibraryAssetStatus::Unsupported
        } else if unchanged {
            prior_status
        } else if same_path.is_some() {
            SmartLibraryAssetStatus::Changed
        } else {
            SmartLibraryAssetStatus::Pending
        };
        tx.execute(
            "INSERT INTO smart_library_assets\
             (asset_id, path, relative_path, name, mime_type, extension, asset_kind, size_bytes, modified_ms, fingerprint, source_kind, preview_supported, unsupported_reason, status, metadata_json)\
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, COALESCE((SELECT metadata_json FROM smart_library_assets WHERE asset_id=?1), '{}'))\
             ON CONFLICT(asset_id) DO UPDATE SET path=excluded.path, relative_path=excluded.relative_path, name=excluded.name, mime_type=excluded.mime_type, extension=excluded.extension, asset_kind=excluded.asset_kind, size_bytes=excluded.size_bytes, modified_ms=excluded.modified_ms, fingerprint=excluded.fingerprint, source_kind=excluded.source_kind, preview_supported=excluded.preview_supported, unsupported_reason=excluded.unsupported_reason, status=excluded.status, indexed_fingerprint=CASE WHEN smart_library_assets.fingerprint=excluded.fingerprint THEN smart_library_assets.indexed_fingerprint ELSE NULL END",
            params![asset_id, asset.path, asset.relative_path, asset.name, asset.mime_type, asset.extension,
                asset.asset_kind.as_str(), asset.size_bytes, asset.modified_ms, asset.fingerprint, source, asset.preview_supported, asset.unsupported_reason, status.as_str()],
        ).map_err(sql_error)?;
    }
    tx.execute(
        "DELETE FROM smart_library_assets WHERE path NOT IN (SELECT path FROM smart_library_scan_paths)",
        [],
    )
    .map_err(sql_error)?;
    tx.commit().map_err(sql_error)?;
    load_snapshot(db_path)?
        .active_library
        .ok_or_else(|| ApiError::Message("Library scan did not persist.".to_owned()))
}

fn load_snapshot(db_path: &Path) -> ApiResult<SmartLibrarySnapshot> {
    let conn = open_database(db_path)?;
    load_snapshot_with_connection(&conn)
}

type SmartLibraryRootRow = (String, Option<String>, String, String, String, u64, u64);

fn load_snapshot_with_connection(conn: &Connection) -> ApiResult<SmartLibrarySnapshot> {
    let root: Option<SmartLibraryRootRow> = conn.query_row(
        "SELECT library_id, server_folder_id, root_path, display_name, source_kind, created_at_ms, last_scanned_at_ms FROM smart_library_root WHERE singleton=1",
        [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)),
    ).optional().map_err(sql_error)?;
    let Some((
        library_id,
        server_folder_id,
        root_path,
        display_name,
        source,
        created_at_ms,
        last_scanned_at_ms,
    )) = root
    else {
        return Ok(SmartLibrarySnapshot::default());
    };
    let source_kind = if source == "cloud" {
        SmartLibrarySourceKind::Cloud
    } else {
        SmartLibrarySourceKind::Local
    };
    let mut statement = conn.prepare(
        "SELECT asset_id, relative_path, name, mime_type, extension, asset_kind, size_bytes, modified_ms, fingerprint, source_kind, preview_supported, unsupported_reason, status, metadata_json, index_version, indexed_fingerprint FROM smart_library_assets ORDER BY relative_path COLLATE NOCASE LIMIT ?1"
    ).map_err(sql_error)?;
    let rows = statement
        .query_map(params![SNAPSHOT_ASSET_LIMIT], row_to_asset)
        .map_err(sql_error)?;
    let assets = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(sql_error)?;
    let preflight = build_preflight_from_database(conn)?;
    Ok(SmartLibrarySnapshot {
        active_library: Some(FolderLibraryStatus {
            library_id,
            server_folder_id,
            root_path,
            display_name,
            source_kind,
            created_at_ms,
            last_scanned_at_ms,
            preflight,
            assets,
        }),
    })
}

fn row_to_asset(row: &rusqlite::Row<'_>) -> rusqlite::Result<SmartLibraryAsset> {
    let metadata: StoredMetadata =
        serde_json::from_str(&row.get::<_, String>(13)?).unwrap_or_default();
    Ok(SmartLibraryAsset {
        asset_id: row.get(0)?,
        relative_path: row.get(1)?,
        name: row.get(2)?,
        mime_type: row.get(3)?,
        extension: row.get(4)?,
        asset_kind: SemanticAssetKind::from_str(&row.get::<_, String>(5)?),
        size_bytes: row.get(6)?,
        modified_ms: row.get(7)?,
        fingerprint: row.get(8)?,
        source_kind: if row.get::<_, String>(9)? == "cloud" {
            SmartLibrarySourceKind::Cloud
        } else {
            SmartLibrarySourceKind::Local
        },
        preview_supported: row.get(10)?,
        unsupported_reason: row.get(11)?,
        status: SmartLibraryAssetStatus::from_str(&row.get::<_, String>(12)?),
        description: metadata.description,
        tags: metadata.tags,
        collections: metadata.collections,
        confidence: metadata.confidence,
        failure: metadata.failure,
        index_version: row.get(14)?,
        indexed_fingerprint: row.get(15)?,
    })
}

fn build_preflight_from_database(conn: &Connection) -> ApiResult<FolderPreflight> {
    let (total, supported, analyzed, changed, pending, eligible, distinct_fingerprints): (
        usize,
        usize,
        usize,
        usize,
        usize,
        usize,
        usize,
    ) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN preview_supported=1 THEN 1 ELSE 0 END),0), COALESCE(SUM(CASE WHEN preview_supported=1 AND status='analyzed' THEN 1 ELSE 0 END),0), COALESCE(SUM(CASE WHEN preview_supported=1 AND status='changed' THEN 1 ELSE 0 END),0), COALESCE(SUM(CASE WHEN preview_supported=1 AND status='pending' THEN 1 ELSE 0 END),0), COALESCE(SUM(CASE WHEN preview_supported=1 AND status IN ('pending','changed','failed') THEN 1 ELSE 0 END),0), COUNT(DISTINCT CASE WHEN preview_supported=1 THEN fingerprint END) FROM smart_library_assets",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)),
        )
        .map_err(sql_error)?;
    let mut reasons = BTreeMap::new();
    let mut reason_statement = conn
        .prepare("SELECT COALESCE(unsupported_reason, 'Unsupported'), COUNT(*) FROM smart_library_assets WHERE preview_supported=0 GROUP BY 1")
        .map_err(sql_error)?;
    let reason_rows = reason_statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, usize>(1)?))
        })
        .map_err(sql_error)?;
    for row in reason_rows {
        let (reason, count) = row.map_err(sql_error)?;
        reasons.insert(reason, count);
    }
    let mut candidates = Vec::new();
    let mut candidate_statement = conn.prepare(
        "SELECT asset_id, relative_path, name, extension, modified_ms, fingerprint, asset_kind FROM smart_library_assets WHERE preview_supported=1 AND status IN ('pending','changed','failed') ORDER BY fingerprint LIMIT ?1"
    ).map_err(sql_error)?;
    let rows = candidate_statement
        .query_map(params![SAMPLE_CANDIDATE_WINDOW], |row| {
            Ok(SmartLibraryAsset {
                asset_id: row.get(0)?,
                relative_path: row.get(1)?,
                name: row.get(2)?,
                mime_type: String::new(),
                extension: row.get(3)?,
                size_bytes: 0,
                modified_ms: row.get(4)?,
                fingerprint: row.get(5)?,
                source_kind: SmartLibrarySourceKind::Local,
                asset_kind: SemanticAssetKind::from_str(&row.get::<_, String>(6)?),
                preview_supported: true,
                unsupported_reason: None,
                status: SmartLibraryAssetStatus::Pending,
                description: None,
                tags: vec![],
                collections: vec![],
                confidence: None,
                failure: None,
                index_version: None,
                indexed_fingerprint: None,
            })
        })
        .map_err(sql_error)?;
    for row in rows {
        candidates.push(row.map_err(sql_error)?);
    }
    let pilot_capped = eligible.min(PILOT_ASSET_LIMIT.saturating_sub(analyzed));
    let included = PILOT_SAMPLE_SIZE.min(pilot_capped);
    Ok(FolderPreflight {
        total_images: total,
        supported_images: supported,
        unsupported_images: total.saturating_sub(supported),
        already_analyzed_images: analyzed,
        changed_images: changed,
        new_images: pending,
        duplicate_images: supported.saturating_sub(distinct_fingerprints),
        eligible_images: eligible,
        pilot_capped_images: pilot_capped,
        skipped_full_original_images: 0,
        sample_asset_ids: representative_sample(&candidates, included),
        unsupported_reasons: reasons,
        allowance: PilotAllowance {
            sample_images: included,
            maximum_analyzed_images: PILOT_ASSET_LIMIT,
            sample_included: true,
            remaining_images: PILOT_ASSET_LIMIT.saturating_sub(analyzed),
        },
        estimate: AnalysisEstimate {
            eligible_images: pilot_capped,
            included_images: included,
            billable_images: pilot_capped.saturating_sub(included),
            credit_units: pilot_capped.saturating_sub(included),
            price_minor: None,
            currency: None,
        },
    })
}

fn build_preflight(assets: &[SmartLibraryAsset]) -> FolderPreflight {
    let supported = assets
        .iter()
        .filter(|asset| asset.preview_supported)
        .collect::<Vec<_>>();
    let analyzed = supported
        .iter()
        .filter(|asset| asset.status == SmartLibraryAssetStatus::Analyzed)
        .count();
    let changed = supported
        .iter()
        .filter(|asset| asset.status == SmartLibraryAssetStatus::Changed)
        .count();
    let new_images = supported
        .iter()
        .filter(|asset| asset.status == SmartLibraryAssetStatus::Pending)
        .count();
    let eligible = supported
        .iter()
        .filter(|asset| {
            matches!(
                asset.status,
                SmartLibraryAssetStatus::Pending
                    | SmartLibraryAssetStatus::Changed
                    | SmartLibraryAssetStatus::Failed
            )
        })
        .count();
    let remaining_capacity = PILOT_ASSET_LIMIT.saturating_sub(analyzed);
    let pilot_capped = eligible.min(remaining_capacity);
    let mut fingerprints = HashSet::new();
    let duplicates = supported
        .iter()
        .filter(|asset| !fingerprints.insert(asset.fingerprint.clone()))
        .count();
    let mut unsupported_reasons = BTreeMap::new();
    for asset in assets.iter().filter(|asset| !asset.preview_supported) {
        *unsupported_reasons
            .entry(
                asset
                    .unsupported_reason
                    .clone()
                    .unwrap_or_else(|| "Unsupported".to_owned()),
            )
            .or_insert(0) += 1;
    }
    let sample_candidates = supported
        .iter()
        .filter(|asset| {
            matches!(
                asset.status,
                SmartLibraryAssetStatus::Pending
                    | SmartLibraryAssetStatus::Changed
                    | SmartLibraryAssetStatus::Failed
            )
        })
        .map(|asset| (*asset).clone())
        .collect::<Vec<_>>();
    let sample_asset_ids =
        representative_sample(&sample_candidates, PILOT_SAMPLE_SIZE.min(pilot_capped));
    let included = PILOT_SAMPLE_SIZE.min(pilot_capped);
    FolderPreflight {
        total_images: assets.len(),
        supported_images: supported.len(),
        unsupported_images: assets.len() - supported.len(),
        already_analyzed_images: analyzed,
        changed_images: changed,
        new_images,
        duplicate_images: duplicates,
        eligible_images: eligible,
        pilot_capped_images: pilot_capped,
        skipped_full_original_images: assets
            .iter()
            .filter(|asset| {
                asset.source_kind == SmartLibrarySourceKind::Cloud && !asset.preview_supported
            })
            .count(),
        sample_asset_ids,
        unsupported_reasons,
        allowance: PilotAllowance {
            sample_images: included,
            maximum_analyzed_images: PILOT_ASSET_LIMIT,
            sample_included: true,
            remaining_images: remaining_capacity,
        },
        estimate: AnalysisEstimate {
            eligible_images: pilot_capped,
            included_images: included,
            billable_images: pilot_capped.saturating_sub(included),
            credit_units: pilot_capped.saturating_sub(included),
            price_minor: None,
            currency: None,
        },
    }
}

pub(crate) fn representative_sample(assets: &[SmartLibraryAsset], limit: usize) -> Vec<String> {
    if limit == 0 {
        return Vec::new();
    }
    let mut buckets: BTreeMap<String, Vec<&SmartLibraryAsset>> = BTreeMap::new();
    for asset in assets {
        let top_folder = asset
            .relative_path
            .split(['/', '\\'])
            .next()
            .unwrap_or_default()
            .to_lowercase();
        let month = asset.modified_ms / (30 * 24 * 60 * 60 * 1000);
        buckets
            .entry(format!("{top_folder}|{}|{month}", asset.extension))
            .or_default()
            .push(asset);
    }
    for bucket in buckets.values_mut() {
        bucket.sort_by(|a, b| a.fingerprint.cmp(&b.fingerprint));
    }
    let mut picked = Vec::new();
    let mut index = 0;
    while picked.len() < limit {
        let before = picked.len();
        for bucket in buckets.values() {
            if let Some(asset) = bucket.get(index) {
                picked.push(asset.asset_id.clone());
                if picked.len() == limit {
                    break;
                }
            }
        }
        if picked.len() == before {
            break;
        }
        index += 1;
    }
    picked
}

fn prepare_previews(
    db_path: &Path,
    asset_ids: &[String],
    dimension: u32,
) -> ApiResult<Vec<PreparedSmartLibraryPreview>> {
    let conn = open_database(db_path)?;
    let mut previews = Vec::new();
    for asset_id in asset_ids {
        let asset: Option<(String, String, bool, String, String, String, u64)> = conn.query_row(
            "SELECT path, fingerprint, preview_supported, extension, mime_type, asset_kind, size_bytes FROM smart_library_assets WHERE asset_id=?1",
            params![asset_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)),
        ).optional().map_err(sql_error)?;
        let Some((path, fingerprint, preview_supported, extension, source_mime, kind, size_bytes)) =
            asset
        else {
            continue;
        };
        if !preview_supported {
            continue;
        }
        let kind = SemanticAssetKind::from_str(&kind);
        let mut metadata = BTreeMap::from([
            ("sourceMimeType".to_owned(), source_mime.clone()),
            ("extension".to_owned(), extension.clone()),
            ("sizeBytes".to_owned(), size_bytes.to_string()),
        ]);
        let mut extracted_text = None;
        let mut truncated = false;
        let mut bytes = Vec::new();
        let mut width = 0;
        let mut height = 0;
        let mut payload_mime = source_mime;
        if kind == SemanticAssetKind::Image
            && RENDERABLE_IMAGE_EXTENSIONS.contains(&extension.as_str())
        {
            if let Ok(rendered) = render_private_image_preview(Path::new(&path), dimension) {
                (bytes, width, height) = rendered;
                payload_mime = "image/jpeg".to_owned();
            } else {
                metadata.insert(
                    "extraction".to_owned(),
                    "metadata_only_decode_failed".to_owned(),
                );
            }
        } else {
            match smart_library_ingestion::extract(Path::new(&path), &extension, kind) {
                Ok(extracted) => {
                    extracted_text = extracted.text;
                    metadata.extend(extracted.metadata);
                    truncated = extracted.truncated;
                }
                Err(_) => {
                    // A corrupt or adversarial file must not fail the rest of an approved batch.
                    metadata.insert(
                        "extraction".to_owned(),
                        "content_extraction_failed".to_owned(),
                    );
                }
            }
        }
        previews.push(PreparedSmartLibraryPreview {
            asset_id: asset_id.clone(),
            fingerprint,
            mime_type: payload_mime,
            asset_kind: kind,
            extracted_text,
            metadata,
            truncated,
            bytes,
            width,
            height,
        });
    }
    Ok(previews)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StoredMetadata {
    description: Option<String>,
    tags: Vec<String>,
    collections: Vec<String>,
    confidence: Option<f32>,
    failure: Option<String>,
}

fn apply_results(
    db_path: &Path,
    results: Vec<SmartLibraryAnalysisResult>,
) -> ApiResult<SmartLibrarySnapshot> {
    let mut conn = open_database(db_path)?;
    let tx = conn.transaction().map_err(sql_error)?;
    for result in results {
        let status = if result.status == "analyzed" {
            "analyzed"
        } else {
            "failed"
        };
        let metadata = StoredMetadata {
            description: result.description,
            tags: sanitize_values(result.tags),
            collections: sanitize_values(result.suggested_collections),
            confidence: result.confidence.map(|value| value.clamp(0.0, 1.0)),
            failure: result.failure,
        };
        let index_version = result
            .index_version
            .unwrap_or_else(|| CURRENT_INDEX_VERSION.to_owned());
        tx.execute(
            "UPDATE smart_library_assets SET status=?1, metadata_json=?2, index_version=CASE WHEN ?1='analyzed' THEN ?4 ELSE index_version END, indexed_fingerprint=CASE WHEN ?1='analyzed' THEN fingerprint ELSE indexed_fingerprint END WHERE asset_id=?3",
            params![
                status,
                serde_json::to_string(&metadata).map_err(json_error)?,
                result.asset_id,
                index_version,
            ],
        )
        .map_err(sql_error)?;
    }
    tx.commit().map_err(sql_error)?;
    load_snapshot(db_path)
}

fn search_assets(
    db_path: &Path,
    request: SmartLibrarySearchRequest,
) -> ApiResult<Vec<SmartLibraryAsset>> {
    let snapshot = load_snapshot(db_path)?;
    let Some(library) = snapshot.active_library else {
        return Ok(Vec::new());
    };
    let terms = request
        .query
        .to_lowercase()
        .split_whitespace()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let collection = request.collection.as_deref().map(str::to_lowercase);
    let limit = request.limit.unwrap_or(100).min(500);
    Ok(library
        .assets
        .into_iter()
        .filter(|asset| {
            if asset.status != SmartLibraryAssetStatus::Analyzed {
                return false;
            }
            if let Some(collection) = &collection {
                if !asset
                    .collections
                    .iter()
                    .any(|value| value.to_lowercase() == *collection)
                {
                    return false;
                }
            }
            if terms.is_empty() {
                return true;
            }
            let haystack = format!(
                "{} {} {} {}",
                asset.name,
                asset.description.as_deref().unwrap_or_default(),
                asset.tags.join(" "),
                asset.collections.join(" ")
            )
            .to_lowercase();
            terms.iter().all(|term| haystack.contains(term))
        })
        .take(limit)
        .collect())
}

fn resolve_assets(
    db_path: &Path,
    asset_ids: Vec<String>,
) -> ApiResult<Vec<ResolvedSmartLibraryAsset>> {
    let conn = open_database(db_path)?;
    let mut seen = HashSet::new();
    let mut resolved = Vec::new();
    for asset_id in asset_ids {
        if !seen.insert(asset_id.clone()) {
            continue;
        }
        let asset = conn
            .query_row(
                "SELECT asset_id, path, relative_path, name, source_kind FROM smart_library_assets WHERE asset_id=?1",
                params![asset_id],
                |row| {
                    Ok(ResolvedSmartLibraryAsset {
                        asset_id: row.get(0)?,
                        path: row.get(1)?,
                        relative_path: row.get(2)?,
                        name: row.get(3)?,
                        source_kind: if row.get::<_, String>(4)? == "cloud" {
                            SmartLibrarySourceKind::Cloud
                        } else {
                            SmartLibrarySourceKind::Local
                        },
                    })
                },
            )
            .optional()
            .map_err(sql_error)?;
        if let Some(asset) = asset {
            resolved.push(asset);
        }
    }
    Ok(resolved)
}

fn load_assets_page(
    db_path: &Path,
    request: SmartLibraryAssetsPageRequest,
) -> ApiResult<SmartLibraryAssetsPage> {
    let conn = open_database(db_path)?;
    let limit = request.limit.unwrap_or(100).clamp(1, MAX_ASSET_PAGE_SIZE);
    let after = request.after_asset_id.unwrap_or_default();
    let version = request
        .index_version
        .unwrap_or_else(|| CURRENT_INDEX_VERSION.to_owned());
    let reindex = i64::from(request.reindex_only);
    let mut statement = conn.prepare(
        "SELECT asset_id, relative_path, name, mime_type, extension, asset_kind, size_bytes, modified_ms, fingerprint, source_kind, preview_supported, unsupported_reason, status, metadata_json, index_version, indexed_fingerprint
         FROM smart_library_assets
         WHERE asset_id > ?1 AND preview_supported=1
           AND (?2=0 OR status IN ('pending','changed','failed') OR index_version IS NULL OR index_version != ?3 OR indexed_fingerprint IS NULL OR indexed_fingerprint != fingerprint)
         ORDER BY asset_id LIMIT ?4"
    ).map_err(sql_error)?;
    let rows = statement
        .query_map(params![after, reindex, version, limit + 1], row_to_asset)
        .map_err(sql_error)?;
    let mut assets = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(sql_error)?;
    let has_more = assets.len() > limit;
    assets.truncate(limit);
    let next_cursor = has_more
        .then(|| assets.last().map(|asset| asset.asset_id.clone()))
        .flatten();
    Ok(SmartLibraryAssetsPage {
        assets,
        next_cursor,
    })
}

fn render_private_image_preview(path: &Path, dimension: u32) -> ApiResult<(Vec<u8>, u32, u32)> {
    let mut reader = ImageReader::open(path)
        .map_err(|error| ApiError::Message(format!("Could not open image preview: {error}")))?
        .with_guessed_format()
        .map_err(|error| ApiError::Message(format!("Could not identify image preview: {error}")))?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_DIMENSION);
    limits.max_image_height = Some(MAX_IMAGE_DIMENSION);
    limits.max_alloc = Some(MAX_IMAGE_DECODE_ALLOC);
    reader.limits(limits);
    let decoded = reader.decode().map_err(|error| {
        ApiError::Message(format!("Could not decode bounded image preview: {error}"))
    })?;
    let resized = decoded
        .resize(dimension, dimension, FilterType::Triangle)
        .to_rgb8();
    let (width, height) = resized.dimensions();
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, 82)
        .encode_image(&resized)
        .map_err(|error| {
            ApiError::Message(format!("Could not encode private image preview: {error}"))
        })?;
    Ok((bytes, width, height))
}

fn open_database(path: &Path) -> ApiResult<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(io_error)?;
    }
    let conn = Connection::open(path).map_err(sql_error)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;\
         PRAGMA foreign_keys=ON;\
         CREATE TABLE IF NOT EXISTS smart_library_root (\
           singleton INTEGER PRIMARY KEY CHECK(singleton=1), library_id TEXT NOT NULL UNIQUE, server_folder_id TEXT, root_path TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, source_kind TEXT NOT NULL, created_at_ms INTEGER NOT NULL, last_scanned_at_ms INTEGER NOT NULL\
         );\
         CREATE TABLE IF NOT EXISTS smart_library_assets (\
           asset_id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, relative_path TEXT NOT NULL, name TEXT NOT NULL, mime_type TEXT NOT NULL, extension TEXT NOT NULL, asset_kind TEXT NOT NULL DEFAULT 'binary', size_bytes INTEGER NOT NULL, modified_ms INTEGER NOT NULL, fingerprint TEXT NOT NULL, source_kind TEXT NOT NULL, preview_supported INTEGER NOT NULL, unsupported_reason TEXT, status TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', index_version TEXT, indexed_fingerprint TEXT\
         );\
         CREATE INDEX IF NOT EXISTS smart_library_asset_fingerprint ON smart_library_assets(fingerprint);\
         CREATE INDEX IF NOT EXISTS smart_library_asset_status ON smart_library_assets(status);"
    ).map_err(sql_error)?;
    ensure_column(
        &conn,
        "smart_library_assets",
        "asset_kind",
        "TEXT NOT NULL DEFAULT 'binary'",
    )?;
    ensure_column(&conn, "smart_library_assets", "index_version", "TEXT")?;
    ensure_column(&conn, "smart_library_assets", "indexed_fingerprint", "TEXT")?;
    Ok(conn)
}

fn ensure_column(conn: &Connection, table: &str, column: &str, declaration: &str) -> ApiResult<()> {
    let mut statement = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(sql_error)?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(sql_error)?
        .collect::<rusqlite::Result<HashSet<_>>>()
        .map_err(sql_error)?;
    if !names.contains(column) {
        conn.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {declaration}"
        ))
        .map_err(sql_error)?;
    }
    Ok(())
}

fn fingerprint_file_bounded(path: &Path) -> ApiResult<String> {
    const CHUNK: usize = 64 * 1024;
    let mut file = fs::File::open(path).map_err(io_error)?;
    let size = file.metadata().map_err(io_error)?.len();
    let mut hasher = Sha256::new();
    hasher.update(b"misty-sampled-sha256-v1");
    hasher.update(size.to_le_bytes());
    let mut buffer = vec![0_u8; CHUNK];
    let offsets = if size <= (CHUNK * 3) as u64 {
        vec![0]
    } else {
        vec![0, size / 2 - (CHUNK / 2) as u64, size - CHUNK as u64]
    };
    for offset in offsets {
        file.seek(SeekFrom::Start(offset)).map_err(io_error)?;
        let mut read = 0;
        while read < CHUNK {
            let count = file.read(&mut buffer[read..]).map_err(io_error)?;
            if count == 0 {
                break;
            }
            read += count;
        }
        hasher.update(offset.to_le_bytes());
        hasher.update(&buffer[..read]);
        if size <= (CHUNK * 3) as u64 {
            while read == CHUNK {
                read = file.read(&mut buffer).map_err(io_error)?;
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
            }
        }
    }
    Ok(hex::encode(hasher.finalize()))
}

fn fingerprint_for_scan(
    path: &Path,
    size_bytes: u64,
    modified_ms: u64,
    hint: Option<&ScanHint>,
) -> ApiResult<String> {
    if let Some(hint) = hint {
        if hint.size_bytes == size_bytes && hint.modified_ms == modified_ms {
            return Ok(hint.fingerprint.clone());
        }
    }
    fingerprint_file_bounded(path)
}

fn metadata_fingerprint(path: &str, size: u64, modified: u64) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    hasher.update(size.to_le_bytes());
    hasher.update(modified.to_le_bytes());
    hex::encode(hasher.finalize())
}

fn normalize_extension(value: &str) -> String {
    value.trim_start_matches('.').to_lowercase()
}
fn mime_for_extension(extension: &str) -> &'static str {
    match extension {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "tif" | "tiff" => "image/tiff",
        "heic" | "heif" => "image/heic",
        _ => "application/octet-stream",
    }
}
fn relative_display_path(root: &str, path: &str) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .trim_start_matches(['/', '\\'])
        .to_owned()
}
fn sanitize_values(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty() && seen.insert(value.to_lowercase()))
        .take(32)
        .collect()
}
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default()
}
fn worker_error(error: tokio::task::JoinError) -> ApiError {
    ApiError::Message(format!("Library worker failed: {error}"))
}
fn sql_error(error: rusqlite::Error) -> ApiError {
    ApiError::Message(format!("Library database failed: {error}"))
}
fn io_error(error: std::io::Error) -> ApiError {
    ApiError::Message(format!("Library file access failed: {error}"))
}
fn json_error(error: serde_json::Error) -> ApiError {
    ApiError::Message(format!("Library metadata failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(id: &str, path: &str, extension: &str, modified_ms: u64) -> SmartLibraryAsset {
        SmartLibraryAsset {
            asset_id: id.to_owned(),
            relative_path: path.to_owned(),
            name: path.to_owned(),
            mime_type: mime_for_extension(extension).to_owned(),
            extension: extension.to_owned(),
            size_bytes: 1,
            modified_ms,
            fingerprint: format!("fingerprint-{id}"),
            source_kind: SmartLibrarySourceKind::Local,
            asset_kind: SemanticAssetKind::Image,
            preview_supported: true,
            unsupported_reason: None,
            status: SmartLibraryAssetStatus::Pending,
            description: None,
            tags: vec![],
            collections: vec![],
            confidence: None,
            failure: None,
            index_version: None,
            indexed_fingerprint: None,
        }
    }

    fn discovered(path: &str, relative_path: &str, fingerprint: &str) -> DiscoveredAsset {
        DiscoveredAsset {
            path: path.to_owned(),
            relative_path: relative_path.to_owned(),
            name: relative_path.to_owned(),
            extension: "jpg".to_owned(),
            mime_type: "image/jpeg".to_owned(),
            asset_kind: SemanticAssetKind::Image,
            size_bytes: 10,
            modified_ms: 1,
            fingerprint: fingerprint.to_owned(),
            preview_supported: true,
            unsupported_reason: None,
        }
    }

    fn temporary_database(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "misty-smart-library-{name}-{}.sqlite3",
            Uuid::new_v4()
        ))
    }

    #[test]
    fn sample_spans_subfolders_formats_and_dates() {
        let assets = vec![
            asset("a", "alpha/001.jpg", "jpg", 1),
            asset("b", "alpha/002.jpg", "jpg", 1),
            asset("c", "beta/003.png", "png", 1),
            asset("d", "beta/004.png", "png", 4_000_000_000),
            asset("e", "gamma/005.webp", "webp", 8_000_000_000),
        ];
        let sample = representative_sample(&assets, 4);
        assert_eq!(sample.len(), 4);
        assert!(sample.contains(&"c".to_owned()));
        assert!(sample.contains(&"d".to_owned()));
        assert!(sample.contains(&"e".to_owned()));
    }

    #[test]
    fn preflight_samples_without_truncating_device_catalog() {
        let assets = (0..550)
            .map(|index| {
                asset(
                    &format!("{index}"),
                    &format!("set/{index}.jpg"),
                    "jpg",
                    index,
                )
            })
            .collect::<Vec<_>>();
        let preflight = build_preflight(&assets);
        assert_eq!(preflight.pilot_capped_images, 550);
        assert_eq!(preflight.sample_asset_ids.len(), 25);
        assert_eq!(preflight.estimate.billable_images, 525);
    }

    #[test]
    fn database_enforces_one_root_and_preserves_identity_across_rename() {
        let db = temporary_database("one-root");
        let first = persist_scan(
            &db,
            "/photos",
            SmartLibrarySourceKind::Local,
            vec![discovered("/photos/one.jpg", "one.jpg", "same-content")],
        )
        .unwrap();
        let original_id = first.assets[0].asset_id.clone();

        let renamed = persist_scan(
            &db,
            "/photos",
            SmartLibrarySourceKind::Local,
            vec![discovered(
                "/photos/renamed.jpg",
                "renamed.jpg",
                "same-content",
            )],
        )
        .unwrap();
        assert_eq!(renamed.assets[0].asset_id, original_id);
        assert_eq!(renamed.assets[0].relative_path, "renamed.jpg");

        let error =
            persist_scan(&db, "/other", SmartLibrarySourceKind::Local, Vec::new()).unwrap_err();
        assert!(error.to_string().contains("Only one Library folder"));
        let _ = fs::remove_file(&db);
    }

    #[test]
    fn manual_import_builds_one_local_library_without_removing_existing_files() {
        let db = temporary_database("manual-import");
        let first = persist_imported_files(
            &db,
            vec![discovered("/photos/one.jpg", "/photos/one.jpg", "first")],
        )
        .unwrap();
        assert_eq!(first.library.display_name, "Library");
        assert_eq!(first.library.root_path, "misty://library");
        assert_eq!(first.imported_asset_ids.len(), 1);

        let second = persist_imported_files(
            &db,
            vec![discovered(
                "/documents/two.jpg",
                "/documents/two.jpg",
                "second",
            )],
        )
        .unwrap();
        assert_eq!(second.library.assets.len(), 2);
        assert!(second
            .library
            .assets
            .iter()
            .any(|asset| asset.relative_path == "/photos/one.jpg"));
        assert!(second
            .library
            .assets
            .iter()
            .any(|asset| asset.relative_path == "/documents/two.jpg"));
        let _ = fs::remove_file(&db);
    }

    #[test]
    fn manual_discovery_rejects_hidden_files() {
        let path = std::env::temp_dir().join(format!(".misty-hidden-{}", Uuid::new_v4()));
        fs::write(&path, "secret").unwrap();
        let error =
            discover_selected_local(&[path.display().to_string()], &HashMap::new()).unwrap_err();
        assert!(error.to_string().contains("Hidden files"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn changed_fingerprint_requires_explicit_reanalysis() {
        let db = temporary_database("changed");
        persist_scan(
            &db,
            "/photos",
            SmartLibrarySourceKind::Local,
            vec![discovered("/photos/one.jpg", "one.jpg", "first")],
        )
        .unwrap();
        let changed = persist_scan(
            &db,
            "/photos",
            SmartLibrarySourceKind::Local,
            vec![discovered("/photos/one.jpg", "one.jpg", "second")],
        )
        .unwrap();
        assert_eq!(changed.preflight.changed_images, 1);
        assert_eq!(changed.assets[0].status, SmartLibraryAssetStatus::Changed);
        let _ = fs::remove_file(&db);
    }

    #[test]
    fn applying_revised_tags_removes_them_from_device_database() {
        let db = temporary_database("tag-removal");
        let snapshot = persist_scan(
            &db,
            "/photos",
            SmartLibrarySourceKind::Local,
            vec![discovered("/photos/one.jpg", "one.jpg", "tagged-content")],
        )
        .unwrap();
        let asset_id = snapshot.assets[0].asset_id.clone();
        let initial = SmartLibraryAnalysisResult {
            asset_id: asset_id.clone(),
            status: "analyzed".to_owned(),
            tags: vec!["favorite".to_owned(), "Pokemon".to_owned()],
            ..SmartLibraryAnalysisResult::default()
        };
        let tagged = apply_results(&db, vec![initial]).unwrap();
        assert_eq!(
            tagged.active_library.unwrap().assets[0].tags,
            vec!["favorite", "Pokemon"]
        );

        let revised = SmartLibraryAnalysisResult {
            asset_id,
            status: "analyzed".to_owned(),
            tags: vec!["Pokemon".to_owned()],
            ..SmartLibraryAnalysisResult::default()
        };
        let updated = apply_results(&db, vec![revised]).unwrap();
        assert_eq!(
            updated.active_library.unwrap().assets[0].tags,
            vec!["Pokemon"]
        );
        let _ = fs::remove_file(&db);
    }

    #[test]
    fn unchanged_scan_hint_does_not_open_file_again() {
        let hint = ScanHint {
            size_bytes: 42,
            modified_ms: 7,
            fingerprint: "already-hashed".to_owned(),
        };
        let fingerprint =
            fingerprint_for_scan(Path::new("/path/that/does/not/exist"), 42, 7, Some(&hint))
                .unwrap();
        assert_eq!(fingerprint, "already-hashed");
    }

    #[test]
    fn sampled_fingerprint_detects_changes_across_large_file() {
        use std::io::{Seek, Write};
        let path = std::env::temp_dir().join(format!("misty-fingerprint-{}", Uuid::new_v4()));
        fs::write(&path, vec![0_u8; 512 * 1024]).unwrap();
        let before = fingerprint_file_bounded(&path).unwrap();
        let mut file = fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.seek(SeekFrom::Start(256 * 1024)).unwrap();
        file.write_all(b"semantic change").unwrap();
        let after = fingerprint_file_bounded(&path).unwrap();
        assert_ne!(before, after);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn local_discovery_catalogs_documents_unknown_binaries_and_rejects_video() {
        let root = std::env::temp_dir().join(format!("misty-discovery-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("notes.md"), "Pikachu notes").unwrap();
        fs::write(root.join("model.bin"), b"opaque format").unwrap();
        fs::write(root.join("movie.mp4"), b"video").unwrap();
        fs::write(root.join(".env"), b"OPENAI_API_KEY=secret").unwrap();
        let discovered = discover_local(&root, &HashMap::new()).unwrap();
        assert_eq!(discovered.len(), 3);
        assert!(discovered
            .iter()
            .find(|asset| asset.extension == "md")
            .is_some_and(|asset| asset.asset_kind == SemanticAssetKind::Text));
        assert!(discovered
            .iter()
            .find(|asset| asset.extension == "bin")
            .is_some_and(|asset| asset.preview_supported));
        assert!(discovered
            .iter()
            .find(|asset| asset.extension == "mp4")
            .is_some_and(|asset| !asset.preview_supported));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn prepared_text_payload_is_path_free_and_resolvable_only_on_device() {
        let root = std::env::temp_dir().join(format!("misty-payload-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("private-notes.txt");
        fs::write(&source, "Pikachu file manager").unwrap();
        let db = temporary_database("text-payload");
        let discovered = discover_local(&root, &HashMap::new()).unwrap();
        let status = persist_scan(
            &db,
            root.to_str().unwrap(),
            SmartLibrarySourceKind::Local,
            discovered,
        )
        .unwrap();
        let asset_id = status.assets[0].asset_id.clone();
        let prepared = prepare_previews(&db, std::slice::from_ref(&asset_id), 512).unwrap();
        assert_eq!(prepared[0].asset_kind, SemanticAssetKind::Text);
        assert_eq!(
            prepared[0].extracted_text.as_deref(),
            Some("Pikachu file manager")
        );
        let serialized = serde_json::to_string(&prepared[0]).unwrap();
        assert!(!serialized.contains(root.to_str().unwrap()));
        assert!(!serialized.contains("private-notes.txt"));
        let resolved = resolve_assets(&db, vec![asset_id]).unwrap();
        assert_eq!(resolved[0].path, source.display().to_string());
        let _ = fs::remove_file(db);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn snapshot_is_bounded_while_sql_preflight_and_pages_cover_full_catalog() {
        let db = temporary_database("paged-catalog");
        let discovered = (0..1_205)
            .map(|index| DiscoveredAsset {
                path: format!("/disk/{index}.txt"),
                relative_path: format!("{index}.txt"),
                name: format!("{index}.txt"),
                extension: "txt".to_owned(),
                mime_type: "text/plain".to_owned(),
                asset_kind: SemanticAssetKind::Text,
                size_bytes: 10,
                modified_ms: index,
                fingerprint: format!("{index:064x}"),
                preview_supported: true,
                unsupported_reason: None,
            })
            .collect();
        let snapshot =
            persist_scan(&db, "/disk", SmartLibrarySourceKind::Local, discovered).unwrap();
        assert_eq!(snapshot.assets.len(), SNAPSHOT_ASSET_LIMIT);
        assert_eq!(snapshot.preflight.total_images, 1_205);
        let first = load_assets_page(
            &db,
            SmartLibraryAssetsPageRequest {
                after_asset_id: None,
                limit: Some(500),
                reindex_only: true,
                index_version: Some(CURRENT_INDEX_VERSION.to_owned()),
            },
        )
        .unwrap();
        assert_eq!(first.assets.len(), 500);
        assert!(first.next_cursor.is_some());
        let second = load_assets_page(
            &db,
            SmartLibraryAssetsPageRequest {
                after_asset_id: first.next_cursor,
                limit: Some(500),
                reindex_only: true,
                index_version: Some(CURRENT_INDEX_VERSION.to_owned()),
            },
        )
        .unwrap();
        assert_eq!(second.assets.len(), 500);
        let _ = fs::remove_file(db);
    }
}
