use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    fs,
    io::{BufReader, Read},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, ImageReader};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::{
    core::explorer::{ExplorerLocationKind, FileKind, ListDirectoryRequest},
    error::{ApiError, ApiResult},
    services::{environment::AppEnvironmentService, explorer::ExplorerService},
};

pub const PILOT_SAMPLE_SIZE: usize = 25;
pub const PILOT_ASSET_LIMIT: usize = 500;
pub const MAX_PREVIEW_BATCH_SIZE: usize = 8;
const DEFAULT_PREVIEW_DIMENSION: u32 = 512;
const MIN_PREVIEW_DIMENSION: u32 = 384;

const SUPPORTED_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp", "pnm"];
const KNOWN_IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "gif", "bmp", "pnm", "tif", "tiff", "heic", "heif", "avif",
    "raw", "cr2", "cr3", "nef", "arw", "dng", "psd", "svg",
];

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
    pub preview_supported: bool,
    pub unsupported_reason: Option<String>,
    pub status: SmartLibraryAssetStatus,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub collections: Vec<String>,
    pub confidence: Option<f32>,
    pub failure: Option<String>,
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
                "Choose a Smart Library folder first.".to_owned(),
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

        let discovered = match source_kind {
            SmartLibrarySourceKind::Local => {
                let root = PathBuf::from(&root_path);
                tokio::task::spawn_blocking(move || discover_local(&root))
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
        first_listing: crate::core::explorer::DirectoryListing,
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
                    FileKind::File if is_known_image_extension(&entry.extension) => {
                        let relative_path = relative_display_path(&root_path, &entry.path);
                        let extension = normalize_extension(&entry.extension);
                        let supported_format = is_supported_extension(&extension);
                        let reason = if supported_format {
                            Some("Cloud provider does not expose a preview without downloading the original".to_owned())
                        } else {
                            Some(format!(
                                "Unsupported image format: {}",
                                extension_or_unknown(&extension)
                            ))
                        };
                        let fingerprint = metadata_fingerprint(
                            &relative_path,
                            entry.size_bytes.unwrap_or_default(),
                            entry.modified_ms.unwrap_or_default().max(0) as u64,
                        );
                        discovered.push(DiscoveredAsset {
                            path: entry.path,
                            relative_path,
                            name: entry.name,
                            extension: extension.clone(),
                            mime_type: entry
                                .mime_type
                                .unwrap_or_else(|| mime_for_extension(&extension).to_owned()),
                            size_bytes: entry.size_bytes.unwrap_or_default(),
                            modified_ms: entry.modified_ms.unwrap_or_default().max(0) as u64,
                            fingerprint,
                            preview_supported: false,
                            unsupported_reason: reason,
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
                "Smart Library preview batches are limited to {MAX_PREVIEW_BATCH_SIZE} images."
            )));
        }
        let dimension = request
            .max_dimension
            .unwrap_or(DEFAULT_PREVIEW_DIMENSION)
            .clamp(MIN_PREVIEW_DIMENSION, DEFAULT_PREVIEW_DIMENSION);
        let db_path = self.db_path.clone();
        tokio::task::spawn_blocking(move || {
            prepare_previews(&db_path, &request.asset_ids, dimension)
        })
        .await
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
    size_bytes: u64,
    modified_ms: u64,
    fingerprint: String,
    preview_supported: bool,
    unsupported_reason: Option<String>,
}

fn discover_local(root: &Path) -> ApiResult<Vec<DiscoveredAsset>> {
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
        if !is_known_image_extension(&extension) {
            continue;
        }
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
        let supported = is_supported_extension(&extension);
        let fingerprint = if supported {
            fingerprint_file(path)?
        } else {
            metadata_fingerprint(&path.display().to_string(), metadata.len(), modified_ms)
        };
        assets.push(DiscoveredAsset {
            path: path.display().to_string(),
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
            mime_type: mime_for_extension(&extension).to_owned(),
            size_bytes: metadata.len(),
            modified_ms,
            fingerprint,
            preview_supported: supported,
            unsupported_reason: (!supported).then(|| {
                format!(
                    "Unsupported image format: {}",
                    extension_or_unknown(&extension)
                )
            }),
        });
    }
    Ok(assets)
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
                "Only one Smart Library folder can be active. Remove it before choosing another."
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
        .unwrap_or("Smart Library")
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

    let existing = load_existing_assets(&tx)?;
    let current_paths = discovered
        .iter()
        .map(|asset| asset.path.clone())
        .collect::<HashSet<_>>();
    let mut reusable_by_fingerprint: HashMap<String, Vec<String>> = HashMap::new();
    for asset in existing
        .values()
        .filter(|asset| !current_paths.contains(&asset.path))
    {
        reusable_by_fingerprint
            .entry(asset.fingerprint.clone())
            .or_default()
            .push(asset.asset_id.clone());
    }
    let mut reused = HashSet::new();
    for asset in discovered {
        let same_path = existing.get(&asset.path);
        let unchanged = same_path
            .map(|old| old.fingerprint == asset.fingerprint)
            .unwrap_or(false);
        let asset_id = same_path
            .map(|old| old.asset_id.clone())
            .or_else(|| {
                reusable_by_fingerprint
                    .get_mut(&asset.fingerprint)
                    .and_then(|ids| ids.pop())
                    .inspect(|id| {
                        reused.insert(id.clone());
                    })
            })
            .unwrap_or_else(|| format!("asset_{}", Uuid::new_v4().simple()));
        let prior_status = same_path
            .map(|old| old.status.clone())
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
             (asset_id, path, relative_path, name, mime_type, extension, size_bytes, modified_ms, fingerprint, source_kind, preview_supported, unsupported_reason, status, metadata_json)\
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, COALESCE((SELECT metadata_json FROM smart_library_assets WHERE asset_id=?1), '{}'))\
             ON CONFLICT(asset_id) DO UPDATE SET path=excluded.path, relative_path=excluded.relative_path, name=excluded.name, mime_type=excluded.mime_type, extension=excluded.extension, size_bytes=excluded.size_bytes, modified_ms=excluded.modified_ms, fingerprint=excluded.fingerprint, source_kind=excluded.source_kind, preview_supported=excluded.preview_supported, unsupported_reason=excluded.unsupported_reason, status=excluded.status",
            params![asset_id, asset.path, asset.relative_path, asset.name, asset.mime_type, asset.extension,
                asset.size_bytes, asset.modified_ms, asset.fingerprint, source, asset.preview_supported, asset.unsupported_reason, status.as_str()],
        ).map_err(sql_error)?;
    }
    tx.execute(
        "DELETE FROM smart_library_assets WHERE path NOT IN (SELECT value FROM json_each(?1))",
        params![serde_json::to_string(&current_paths).map_err(json_error)?],
    )
    .map_err(sql_error)?;
    tx.commit().map_err(sql_error)?;
    load_snapshot(db_path)?
        .active_library
        .ok_or_else(|| ApiError::Message("Smart Library scan did not persist.".to_owned()))
}

#[derive(Clone)]
struct ExistingAsset {
    asset_id: String,
    path: String,
    fingerprint: String,
    status: SmartLibraryAssetStatus,
}

fn load_existing_assets(conn: &Connection) -> ApiResult<HashMap<String, ExistingAsset>> {
    let mut statement = conn
        .prepare("SELECT asset_id, path, fingerprint, status FROM smart_library_assets")
        .map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok(ExistingAsset {
                asset_id: row.get(0)?,
                path: row.get(1)?,
                fingerprint: row.get(2)?,
                status: SmartLibraryAssetStatus::from_str(&row.get::<_, String>(3)?),
            })
        })
        .map_err(sql_error)?;
    let mut assets = HashMap::new();
    for row in rows {
        let asset = row.map_err(sql_error)?;
        assets.insert(asset.path.clone(), asset);
    }
    Ok(assets)
}

fn load_snapshot(db_path: &Path) -> ApiResult<SmartLibrarySnapshot> {
    let conn = open_database(db_path)?;
    load_snapshot_with_connection(&conn)
}

fn load_snapshot_with_connection(conn: &Connection) -> ApiResult<SmartLibrarySnapshot> {
    let root: Option<(String, Option<String>, String, String, String, u64, u64)> = conn.query_row(
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
        "SELECT asset_id, relative_path, name, mime_type, extension, size_bytes, modified_ms, fingerprint, source_kind, preview_supported, unsupported_reason, status, metadata_json FROM smart_library_assets ORDER BY relative_path COLLATE NOCASE"
    ).map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            let metadata: StoredMetadata =
                serde_json::from_str(&row.get::<_, String>(12)?).unwrap_or_default();
            Ok(SmartLibraryAsset {
                asset_id: row.get(0)?,
                relative_path: row.get(1)?,
                name: row.get(2)?,
                mime_type: row.get(3)?,
                extension: row.get(4)?,
                size_bytes: row.get(5)?,
                modified_ms: row.get(6)?,
                fingerprint: row.get(7)?,
                source_kind: if row.get::<_, String>(8)? == "cloud" {
                    SmartLibrarySourceKind::Cloud
                } else {
                    SmartLibrarySourceKind::Local
                },
                preview_supported: row.get(9)?,
                unsupported_reason: row.get(10)?,
                status: SmartLibraryAssetStatus::from_str(&row.get::<_, String>(11)?),
                description: metadata.description,
                tags: metadata.tags,
                collections: metadata.collections,
                confidence: metadata.confidence,
                failure: metadata.failure,
            })
        })
        .map_err(sql_error)?;
    let assets = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(sql_error)?;
    let preflight = build_preflight(&assets);
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
        let asset: Option<(String, String, bool)> = conn.query_row(
            "SELECT path, fingerprint, preview_supported FROM smart_library_assets WHERE asset_id=?1",
            params![asset_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).optional().map_err(sql_error)?;
        let Some((path, fingerprint, preview_supported)) = asset else {
            continue;
        };
        if !preview_supported {
            continue;
        }
        let reader = ImageReader::open(&path)
            .map_err(|error| ApiError::Message(format!("Could not open image preview: {error}")))?;
        let decoded = reader
            .with_guessed_format()
            .map_err(|error| {
                ApiError::Message(format!("Could not identify image preview: {error}"))
            })?
            .decode()
            .map_err(|error| {
                ApiError::Message(format!("Could not decode image preview: {error}"))
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
        previews.push(PreparedSmartLibraryPreview {
            asset_id: asset_id.clone(),
            fingerprint,
            mime_type: "image/jpeg".to_owned(),
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
        tx.execute(
            "UPDATE smart_library_assets SET status=?1, metadata_json=?2 WHERE asset_id=?3",
            params![
                status,
                serde_json::to_string(&metadata).map_err(json_error)?,
                result.asset_id
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
           asset_id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, relative_path TEXT NOT NULL, name TEXT NOT NULL, mime_type TEXT NOT NULL, extension TEXT NOT NULL, size_bytes INTEGER NOT NULL, modified_ms INTEGER NOT NULL, fingerprint TEXT NOT NULL, source_kind TEXT NOT NULL, preview_supported INTEGER NOT NULL, unsupported_reason TEXT, status TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}'\
         );\
         CREATE INDEX IF NOT EXISTS smart_library_asset_fingerprint ON smart_library_assets(fingerprint);\
         CREATE INDEX IF NOT EXISTS smart_library_asset_status ON smart_library_assets(status);"
    ).map_err(sql_error)?;
    Ok(conn)
}

fn fingerprint_file(path: &Path) -> ApiResult<String> {
    let file = fs::File::open(path).map_err(io_error)?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = reader.read(&mut buffer).map_err(io_error)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hex::encode(hasher.finalize()))
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
fn is_supported_extension(value: &str) -> bool {
    SUPPORTED_EXTENSIONS.contains(&value)
}
fn is_known_image_extension(value: &str) -> bool {
    KNOWN_IMAGE_EXTENSIONS.contains(&normalize_extension(value).as_str())
}
fn extension_or_unknown(value: &str) -> &str {
    if value.is_empty() {
        "unknown"
    } else {
        value
    }
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
    ApiError::Message(format!("Smart Library worker failed: {error}"))
}
fn sql_error(error: rusqlite::Error) -> ApiError {
    ApiError::Message(format!("Smart Library database failed: {error}"))
}
fn io_error(error: std::io::Error) -> ApiError {
    ApiError::Message(format!("Smart Library file access failed: {error}"))
}
fn json_error(error: serde_json::Error) -> ApiError {
    ApiError::Message(format!("Smart Library metadata failed: {error}"))
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
            preview_supported: true,
            unsupported_reason: None,
            status: SmartLibraryAssetStatus::Pending,
            description: None,
            tags: vec![],
            collections: vec![],
            confidence: None,
            failure: None,
        }
    }

    fn discovered(path: &str, relative_path: &str, fingerprint: &str) -> DiscoveredAsset {
        DiscoveredAsset {
            path: path.to_owned(),
            relative_path: relative_path.to_owned(),
            name: relative_path.to_owned(),
            extension: "jpg".to_owned(),
            mime_type: "image/jpeg".to_owned(),
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
    fn preflight_enforces_sample_and_pilot_caps() {
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
        assert_eq!(preflight.pilot_capped_images, 500);
        assert_eq!(preflight.sample_asset_ids.len(), 25);
        assert_eq!(preflight.estimate.billable_images, 475);
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
        assert!(error.to_string().contains("Only one Smart Library folder"));
        let _ = fs::remove_file(&db);
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
}
