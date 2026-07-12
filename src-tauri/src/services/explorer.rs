use std::{
    collections::BTreeSet,
    ffi::OsStr,
    fs::File,
    io::{BufReader, BufWriter, Cursor},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, LazyLock, Mutex as StdMutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(target_os = "android")]
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

use image::{
    codecs::{
        gif::GifDecoder,
        png::{CompressionType, FilterType as PngFilterType, PngEncoder},
    },
    imageops::FilterType,
    ImageDecoder, ImageReader, Limits,
};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

#[cfg(target_os = "android")]
use tauri::AppHandle;

#[cfg(target_os = "android")]
use tauri_plugin_document_tree::{DocumentTreeExt, ListChildrenRequest};

use crate::core::clipboard::{ClipboardCache, ClipboardRemoteFileCacheKey};
use crate::core::explorer::{
    list_directory, paste_items, CreateItemRequest, DeleteItemsRequest, DirectoryListing,
    ExplorerLocation, ExplorerLocationKind, ExplorerOperationResult, ExplorerPreviewPayload,
    FileEntry, FileKind, GeneratedImageThumbnail, ListDirectoryRequest, PasteBlobRequest,
    PasteItem, PasteItemsRequest, PasteTextRequest, PrepareDragItemRequest,
    PrepareDragItemsRequest, PrepareOpenItemRequest, PreparedDragItem, PreparedDragItemsResult,
    PreparedDragSkippedItem, PreparedOpenItem, RenameItemRequest,
};
use crate::core::file_master::{
    join_remote_path, normalize_remote_path, virtual_path_parts, RemoteBrowseTarget,
    RemoteJobStart, RemoteJobStatus, RemoteListItem,
};
use crate::core::file_transfer::now_epoch_ms;
use crate::core::file_transfer::{FileTransferItemType, FileTransferRecord, FileTransferType};
use crate::core::listing_cache::ListingCache;
use crate::error::{ApiError, ApiResult};
use crate::services::{
    environment::AppEnvironmentService,
    explorer_library::{ExplorerLibraryItem, ExplorerLibraryService},
    providers::{ProviderRemote, ProviderService},
    storage::{StorageResponse, StorageService},
    transfers::TransferService,
};

const VIRTUAL_PATH_RECENT: &str = "misty://recent";
const VIRTUAL_PATH_STARRED: &str = "misty://starred";
const VIRTUAL_PATH_TRASH: &str = "misty://trash";
#[cfg(target_os = "android")]
const VIRTUAL_PATH_LOCAL: &str = "misty://local";
const MAX_IMAGE_PREVIEW_DIMENSION: u32 = 1600;
const DEFAULT_IMAGE_THUMBNAIL_DIMENSION: u32 = 384;
const MAX_GENERATED_IMAGE_THUMBNAIL_DIMENSION: u32 = 384;
const IMAGE_THUMBNAIL_RESIZE_FILTER: FilterType = FilterType::Triangle;
const IMAGE_THUMBNAIL_PNG_COMPRESSION: CompressionType = CompressionType::Fast;
const IMAGE_THUMBNAIL_PNG_FILTER: PngFilterType = PngFilterType::Adaptive;
const REMOTE_INVENTORY_WAIT_ATTEMPTS: usize = 30;
const REMOTE_INVENTORY_WAIT_INTERVAL: Duration = Duration::from_millis(100);
const REMOTE_LISTING_CACHE_MAX_AGE: Duration = Duration::from_secs(5 * 60);
const REMOTE_JOB_STALE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const REMOTE_JOB_MAX_WAIT: Duration = Duration::from_secs(24 * 60 * 60);

static IMAGE_THUMBNAIL_CACHE_FILE_LOCK: LazyLock<StdMutex<()>> =
    LazyLock::new(|| StdMutex::new(()));
static TEMPORARY_THUMBNAIL_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy)]
struct TransferProgress {
    base_bytes: i64,
    total_bytes: i64,
}

#[derive(Clone)]
pub struct ExplorerService {
    home_dir: PathBuf,
    mount_root: PathBuf,
    proxy: StorageService,
    providers: ProviderService,
    transfers: TransferService,
    explorer_library: ExplorerLibraryService,
    listing_cache: ListingCache,
    remote_file_cache: Arc<Mutex<ClipboardCache>>,
    drag_stage_dir: PathBuf,
    clipboard_text_cache_dir: PathBuf,
    clipboard_blob_cache_dir: PathBuf,
    trash_dir: PathBuf,
    image_thumbnail_cache_dir: PathBuf,
    #[cfg(test)]
    remote_job_cancellation_log: Option<Arc<Mutex<Vec<String>>>>,
}

impl ExplorerService {
    pub fn new(
        environment: AppEnvironmentService,
        proxy: StorageService,
        providers: ProviderService,
        transfers: TransferService,
        explorer_library: ExplorerLibraryService,
    ) -> Self {
        let cache_dir = environment.cache_dir();
        let mount_root = environment.mount_root();
        let mut remote_file_cache = ClipboardCache::new(cache_dir.join("remote-files").join("v1"));
        remote_file_cache
            .import_remote_file_entries_from(&cache_dir.join("remote-open").join("v1"));
        remote_file_cache.cleanup_expired();
        let drag_stage_dir = cache_dir.join("drag-out").join("v1");
        cleanup_expired_drag_stage_dirs(&drag_stage_dir);
        Self {
            home_dir: environment.home_dir(),
            mount_root,
            proxy,
            providers,
            transfers,
            explorer_library,
            listing_cache: ListingCache::new(cache_dir.join("remotes"), cache_dir.join("listings")),
            remote_file_cache: Arc::new(Mutex::new(remote_file_cache)),
            drag_stage_dir,
            clipboard_text_cache_dir: cache_dir.join("clipboard-paste").join("text"),
            clipboard_blob_cache_dir: cache_dir.join("clipboard-paste").join("blob"),
            trash_dir: cache_dir.join("trash"),
            image_thumbnail_cache_dir: cache_dir.join("thumbnails"),
            #[cfg(test)]
            remote_job_cancellation_log: None,
        }
    }

    #[cfg(test)]
    fn with_remote_job_cancellation_log(mut self, log: Arc<Mutex<Vec<String>>>) -> Self {
        self.remote_job_cancellation_log = Some(log);
        self
    }

    pub async fn list_directory(
        &self,
        request: ListDirectoryRequest,
    ) -> ApiResult<DirectoryListing> {
        if let Some(path) = request.path.as_deref().map(str::trim) {
            if path == VIRTUAL_PATH_RECENT || path == VIRTUAL_PATH_STARRED {
                return self.list_library_virtual_directory(path).await;
            }
            if path == VIRTUAL_PATH_TRASH {
                return self.list_trash_virtual_directory().await;
            }
            if path.starts_with("misty://") {
                return Err(ApiError::Message(format!(
                    "Unsupported virtual Explorer location: {path}"
                )));
            }
        }

        let requested = request
            .path
            .as_deref()
            .filter(|path| !path.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| self.home_dir.clone());

        if requested == self.mount_root || requested.starts_with(&self.mount_root) {
            return self
                .list_virtual_directory(
                    &requested,
                    request.show_hidden.unwrap_or(false),
                    request.force_remote_refresh.unwrap_or(false),
                )
                .await;
        }

        let home_dir = self.home_dir.clone();
        tokio::task::spawn_blocking(move || list_directory(home_dir, request))
            .await
            .map_err(|err| ApiError::Message(format!("Explorer worker failed: {err}")))?
    }

    #[cfg(target_os = "android")]
    pub fn is_android_local_virtual_path(&self, path: Option<&str>) -> bool {
        path.map(|value| value.trim().is_empty() || value.starts_with(VIRTUAL_PATH_LOCAL))
            .unwrap_or(true)
    }

    #[cfg(target_os = "android")]
    pub async fn list_android_local_directory(
        &self,
        app: &AppHandle,
        request: ListDirectoryRequest,
    ) -> ApiResult<DirectoryListing> {
        let path = request
            .path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(VIRTUAL_PATH_LOCAL);
        let locations = app.document_tree().persisted_trees().map_err(|error| {
            ApiError::Message(format!("Could not read granted folders: {error}"))
        })?;

        if path == VIRTUAL_PATH_LOCAL {
            let entries = locations
                .iter()
                .map(|location| android_local_location_entry(location))
                .collect::<Vec<_>>();
            return Ok(DirectoryListing {
                path: VIRTUAL_PATH_LOCAL.to_owned(),
                title: Some("Local".to_owned()),
                parent_path: None,
                location: ExplorerLocation::local(),
                hidden_count: 0,
                total_count: entries.len(),
                entries,
                modified_ms: None,
                created_ms: None,
            });
        }

        let (location_id, document_id) = parse_android_local_path(path)?;
        let location = locations
            .iter()
            .find(|location| android_local_location_id(&location.uri) == location_id)
            .ok_or_else(|| {
                ApiError::Message(
                    "This Android folder permission is no longer available.".to_owned(),
                )
            })?;
        let entries = app
            .document_tree()
            .list_children(ListChildrenRequest {
                tree_uri: location.uri.clone(),
                document_id: document_id.clone(),
            })
            .map_err(|error| {
                ApiError::Message(format!("Could not list the selected folder: {error}"))
            })?
            .into_iter()
            .map(|entry| {
                let entry_path = android_local_child_path(path, &entry.document_id);
                let name = entry.name;
                FileEntry {
                    id: entry_path.clone(),
                    path: entry_path,
                    extension: Path::new(&name)
                        .extension()
                        .and_then(|value| value.to_str())
                        .unwrap_or_default()
                        .to_owned(),
                    mime_type: entry.mime_type,
                    remote_modified: None,
                    kind: if entry.is_directory {
                        FileKind::Folder
                    } else {
                        FileKind::File
                    },
                    size_bytes: entry.size_bytes,
                    modified_ms: entry.modified_ms,
                    created_ms: None,
                    readonly: !entry.can_write,
                    hidden: name.starts_with('.'),
                    is_deleted: false,
                    location: ExplorerLocation::local(),
                    name,
                }
            })
            .collect::<Vec<_>>();
        let parent_path = if document_id.is_some() {
            path.rsplit_once('/').map(|(parent, _)| parent.to_owned())
        } else {
            Some(VIRTUAL_PATH_LOCAL.to_owned())
        };
        Ok(DirectoryListing {
            path: path.to_owned(),
            title: Some(location.name.clone()),
            parent_path,
            location: ExplorerLocation::local(),
            hidden_count: 0,
            total_count: entries.len(),
            entries,
            modified_ms: None,
            created_ms: None,
        })
    }

    async fn list_library_virtual_directory(&self, path: &str) -> ApiResult<DirectoryListing> {
        let snapshot = self.explorer_library.snapshot().await?;
        let source_items = if path == VIRTUAL_PATH_RECENT {
            snapshot.recent_files
        } else {
            snapshot.starred_files
        };
        let mut entries: Vec<FileEntry> = source_items
            .into_iter()
            .filter_map(|item| self.library_item_to_file_entry(item, path == VIRTUAL_PATH_RECENT))
            .collect();
        entries.sort_by(|left, right| {
            virtual_folder_rank(&left.kind)
                .cmp(&virtual_folder_rank(&right.kind))
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        let total_count = entries.len();
        Ok(DirectoryListing {
            path: path.to_string(),
            title: None,
            parent_path: None,
            location: ExplorerLocation::local(),
            hidden_count: 0,
            total_count,
            entries,
            modified_ms: None,
            created_ms: None,
        })
    }

    async fn list_trash_virtual_directory(&self) -> ApiResult<DirectoryListing> {
        let trash_dir = self.trash_dir.clone();
        let entries = tokio::task::spawn_blocking(move || trash_virtual_entries(&trash_dir))
            .await
            .map_err(|err| ApiError::Message(format!("Explorer trash worker failed: {err}")))??;
        let total_count = entries.len();
        Ok(DirectoryListing {
            path: VIRTUAL_PATH_TRASH.to_string(),
            title: Some("Trash".to_owned()),
            parent_path: None,
            location: ExplorerLocation::local(),
            hidden_count: 0,
            total_count,
            entries,
            modified_ms: None,
            created_ms: None,
        })
    }

    fn library_item_to_file_entry(
        &self,
        item: ExplorerLibraryItem,
        prune_missing_local: bool,
    ) -> Option<FileEntry> {
        let path = item.path.trim();
        if path.is_empty() {
            return None;
        }
        if self.remote_target(path).is_none() && prune_missing_local && !Path::new(path).exists() {
            return None;
        }
        let path_buf = PathBuf::from(path);
        let name = if item.name.trim().is_empty() {
            path_buf
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(path)
                .to_string()
        } else {
            item.name
        };
        let kind = if item.is_dir {
            FileKind::Folder
        } else {
            FileKind::File
        };
        let location = self
            .remote_target(path)
            .map(|target| ExplorerLocation {
                kind: ExplorerLocationKind::Remote,
                provider_type: Some(target.provider_type),
                remote_name: Some(target.remote_name),
                remote_path: Some(target.remote_path),
            })
            .unwrap_or_else(ExplorerLocation::local);
        let size_bytes = if item.size > 0 && !item.is_dir {
            Some(item.size as u64)
        } else {
            None
        };
        let mime_type = if item.mime_type.trim().is_empty() {
            None
        } else {
            Some(item.mime_type)
        };
        let remote_modified = if item.last_modified.trim().is_empty() {
            None
        } else {
            Some(item.last_modified)
        };
        Some(FileEntry {
            id: if item.id.trim().is_empty() {
                path.to_string()
            } else {
                item.id
            },
            name,
            path: path.to_string(),
            extension: path_buf
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string(),
            mime_type,
            remote_modified,
            kind,
            size_bytes,
            modified_ms: None,
            created_ms: None,
            readonly: false,
            hidden: path_buf
                .file_name()
                .and_then(|value| value.to_str())
                .map(|value| value.starts_with('.'))
                .unwrap_or(false),
            is_deleted: false,
            location,
        })
    }

    pub async fn item_is_directory(&self, path: &str) -> ApiResult<Option<bool>> {
        if let Some(target) = self.remote_target(path) {
            if target.remote_path == "/" {
                return Ok(Some(true));
            }
            let parent = RemoteBrowseTarget {
                provider_type: target.provider_type.clone(),
                remote_name: target.remote_name.clone(),
                remote_path: remote_parent_path(&target.remote_path),
            };
            let items = match self.fetch_remote_items(&parent).await {
                Ok(items) => items,
                Err(error) if is_remote_directory_not_found_error(&error) => return Ok(None),
                Err(error) => return Err(error),
            };
            return remote_item_is_directory(&parent, &target.remote_path, &items);
        }
        self.reject_virtual_mount_container(path, "inspect")?;
        // Match std::filesystem::is_directory in the native Explorer: the
        // decision to browse or open follows a local symlink's target.
        match tokio::fs::metadata(path).await {
            Ok(metadata) => Ok(Some(metadata.is_dir())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(ApiError::Message(format!(
                "Failed to inspect {path}: {error}"
            ))),
        }
    }

    pub async fn preview_item(&self, path: &str) -> ApiResult<ExplorerPreviewPayload> {
        if let Some(source) = self.remote_target(path) {
            let parent = RemoteBrowseTarget {
                provider_type: source.provider_type.clone(),
                remote_name: source.remote_name.clone(),
                remote_path: remote_parent_path(&source.remote_path),
            };
            let items = self.fetch_remote_items(&parent).await?;
            let Some((size_bytes, remote_modified)) =
                remote_preview_metadata_from_items(&parent, &source.remote_path, &items)?
            else {
                return Err(ApiError::Message(format!(
                    "Remote file {} was not found.",
                    source.remote_path
                )));
            };
            let remote_modified = if remote_modified.trim().is_empty() {
                None
            } else {
                Some(remote_modified)
            };
            let prepared = self
                .prepare_remote_file_for_local_use(
                    &source,
                    Some(size_bytes),
                    remote_modified.as_deref(),
                    "Preparing remote file for preview",
                    false,
                )
                .await?;
            return self
                .preview_local_item(Path::new(&prepared.local_path))
                .await;
        }
        self.reject_virtual_mount_container(path, "preview")?;
        self.preview_local_item(Path::new(path)).await
    }

    pub async fn generate_image_thumbnail(
        &self,
        path: &str,
        max_dimension: u32,
        modified_ms: Option<u64>,
        remote_modified: Option<&str>,
        size_bytes: Option<u64>,
    ) -> ApiResult<GeneratedImageThumbnail> {
        if let Some(source) = self.remote_target(path) {
            let (cache_size_bytes, prepare_size_bytes, remote_modified) =
                if let Some(size_bytes) = size_bytes {
                    (
                        size_bytes,
                        i64::try_from(size_bytes).ok(),
                        remote_modified.map(str::to_string),
                    )
                } else {
                    let parent = RemoteBrowseTarget {
                        provider_type: source.provider_type.clone(),
                        remote_name: source.remote_name.clone(),
                        remote_path: remote_parent_path(&source.remote_path),
                    };
                    let items = self.fetch_remote_items(&parent).await?;
                    let Some((size_bytes, remote_modified)) =
                        remote_preview_metadata_from_items(&parent, &source.remote_path, &items)?
                    else {
                        return Err(ApiError::Message(format!(
                            "Remote file {} was not found.",
                            source.remote_path
                        )));
                    };
                    (
                        u64::try_from(size_bytes).unwrap_or_default(),
                        Some(size_bytes),
                        Some(remote_modified),
                    )
                };
            let remote_modified = if remote_modified
                .as_deref()
                .unwrap_or_default()
                .trim()
                .is_empty()
            {
                None
            } else {
                remote_modified
            };
            let prepared = self
                .prepare_remote_file_for_local_use(
                    &source,
                    prepare_size_bytes,
                    remote_modified.as_deref(),
                    "Preparing remote file thumbnail",
                    false,
                )
                .await?;
            let identity = ImageThumbnailIdentity {
                path: path.to_string(),
                size_bytes: cache_size_bytes,
                modified_fingerprint: remote_modified,
            };
            return self
                .generate_local_image_thumbnail(
                    Path::new(&prepared.local_path),
                    max_dimension,
                    Some(identity),
                )
                .await;
        }
        self.reject_virtual_mount_container(path, "thumbnail")?;
        let identity = size_bytes.map(|size_bytes| ImageThumbnailIdentity {
            path: path.to_string(),
            size_bytes,
            modified_fingerprint: modified_ms.map(|value| value.to_string()),
        });
        self.generate_local_image_thumbnail(Path::new(path), max_dimension, identity)
            .await
    }

    async fn generate_local_image_thumbnail(
        &self,
        path: &Path,
        max_dimension: u32,
        identity: Option<ImageThumbnailIdentity>,
    ) -> ApiResult<GeneratedImageThumbnail> {
        let format = image_thumbnail_format(path).ok_or_else(|| {
            ApiError::Message("This file type does not support image thumbnails.".to_string())
        })?;
        let metadata = tokio::fs::metadata(path).await.map_err(|error| {
            ApiError::Message(format!(
                "Failed to inspect image thumbnail file {}: {error}",
                path.display()
            ))
        })?;
        if !metadata.is_file() {
            return Err(ApiError::Message(
                "Only files can be thumbnailed.".to_string(),
            ));
        }
        let max_dimension = normalize_image_thumbnail_dimension(max_dimension);
        let identity =
            identity.unwrap_or_else(|| ImageThumbnailIdentity::from_metadata(path, &metadata));
        let thumbnail_path =
            image_thumbnail_cache_path(&self.image_thumbnail_cache_dir, &identity, max_dimension);
        if tokio::fs::metadata(&thumbnail_path)
            .await
            .is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0)
        {
            return Ok(GeneratedImageThumbnail {
                path: display_path(&thumbnail_path),
                mime_type: "image/png".to_string(),
            });
        }
        if let Some(parent) = thumbnail_path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|error| {
                ApiError::Message(format!(
                    "Failed to create image thumbnail cache {}: {error}",
                    parent.display()
                ))
            })?;
        }
        let source_path = path.to_path_buf();
        let output_path = thumbnail_path.clone();
        let rendered = tokio::task::spawn_blocking(move || {
            render_image_thumbnail_file_blocking(&source_path, &output_path, format, max_dimension)
        })
        .await
        .map_err(|error| ApiError::Message(format!("Image thumbnail worker failed: {error}")))??;
        Ok(rendered)
    }

    async fn preview_local_item(&self, path: &Path) -> ApiResult<ExplorerPreviewPayload> {
        let format = preview_format(path).ok_or_else(|| {
            ApiError::Message("This file type does not support preview.".to_string())
        })?;
        let metadata = tokio::fs::metadata(path).await.map_err(|error| {
            ApiError::Message(format!(
                "Failed to inspect preview file {}: {error}",
                path.display()
            ))
        })?;
        if !metadata.is_file() {
            return Err(ApiError::Message(
                "Only files can be previewed.".to_string(),
            ));
        }
        match format {
            PreviewFormat::Pdf => {
                if let Some(bytes) = render_pdf_preview_png(path, &metadata).await? {
                    return Ok(ExplorerPreviewPayload {
                        mime_type: "image/png".to_string(),
                        bytes,
                    });
                }
                let bytes = read_preview_file(path).await?;
                Ok(ExplorerPreviewPayload {
                    mime_type: "application/pdf".to_string(),
                    bytes,
                })
            }
            PreviewFormat::Image(image_format) => {
                let path = path.to_path_buf();
                let bytes = tokio::task::spawn_blocking(move || {
                    render_image_preview_png_blocking(&path, image_format)
                })
                .await
                .map_err(|error| {
                    ApiError::Message(format!("Image preview worker failed: {error}"))
                })??;
                Ok(ExplorerPreviewPayload {
                    mime_type: "image/png".to_string(),
                    bytes,
                })
            }
            PreviewFormat::Direct(mime_type) => {
                let bytes = read_preview_file(path).await?;
                Ok(ExplorerPreviewPayload {
                    mime_type: mime_type.to_string(),
                    bytes,
                })
            }
            PreviewFormat::TranscodeImage(image_format) => {
                let path = path.to_path_buf();
                let bytes = tokio::task::spawn_blocking(move || {
                    render_image_preview_png_blocking(&path, image_format)
                })
                .await
                .map_err(|error| {
                    ApiError::Message(format!("Image preview worker failed: {error}"))
                })??;
                Ok(ExplorerPreviewPayload {
                    mime_type: "image/png".to_string(),
                    bytes,
                })
            }
            PreviewFormat::Psd => {
                let bytes = read_preview_file(path).await?;
                Ok(ExplorerPreviewPayload {
                    mime_type: "image/png".to_string(),
                    bytes: transcode_psd_preview_png(&bytes, path)?,
                })
            }
        }
    }

    pub async fn remote_virtual_path(
        &self,
        remote_name: &str,
        remote_path: &str,
    ) -> ApiResult<String> {
        let remote_path = normalize_remote_path(remote_path)?;
        let remotes = self.remote_inventory().await?;
        let remote = remotes
            .iter()
            .find(|remote| remote.name == remote_name)
            .ok_or_else(|| ApiError::Message(format!("Remote \"{remote_name}\" was not found.")))?;
        let target = RemoteBrowseTarget {
            provider_type: remote.provider_type.clone(),
            remote_name: remote.name.clone(),
            remote_path,
        };
        Ok(display_path(&target.virtual_path(&self.mount_root)))
    }

    pub async fn prepare_open_item(
        &self,
        request: PrepareOpenItemRequest,
    ) -> ApiResult<PreparedOpenItem> {
        let Some(source) = self.remote_target(&request.path) else {
            self.reject_virtual_mount_container(&request.path, "open")?;
            if !Path::new(&request.path).is_file() {
                return Err(ApiError::Message(format!(
                    "{} is not a file.",
                    request.path
                )));
            }
            return Ok(PreparedOpenItem {
                local_path: request.path,
                cached: true,
                source_path: None,
                cache_path: None,
                cache_hit: true,
            });
        };
        if self.item_is_directory(&request.path).await? != Some(false) {
            return Err(ApiError::Message(
                "Only remote files can be opened.".to_string(),
            ));
        }
        self.prepare_remote_file_for_local_use(
            &source,
            request.size_bytes,
            request.remote_modified.as_deref(),
            "Preparing remote file to open",
            false,
        )
        .await
    }

    pub async fn prepare_drag_items(
        &self,
        request: PrepareDragItemsRequest,
    ) -> ApiResult<PreparedDragItemsResult> {
        let mut prepared = Vec::new();
        let mut skipped = Vec::new();
        for item in request.items {
            match self.prepare_drag_item(item).await {
                Ok(item) => prepared.push(item),
                Err(error) => skipped.push(PreparedDragSkippedItem {
                    source_path: error.0,
                    reason: error.1,
                }),
            }
        }
        Ok(PreparedDragItemsResult {
            items: prepared,
            skipped,
        })
    }

    async fn prepare_drag_item(
        &self,
        request: PrepareDragItemRequest,
    ) -> Result<PreparedDragItem, (String, String)> {
        let source_path = request.path.clone();
        match self.prepare_drag_item_inner(request).await {
            Ok(item) => Ok(item),
            Err(error) => Err((source_path, error.to_string())),
        }
    }

    async fn prepare_drag_item_inner(
        &self,
        request: PrepareDragItemRequest,
    ) -> ApiResult<PreparedDragItem> {
        let Some(source) = self.remote_target(&request.path) else {
            self.reject_virtual_mount_container(&request.path, "drag")?;
            let path = Path::new(&request.path);
            if !path.exists() {
                return Err(ApiError::Message(format!(
                    "{} does not exist.",
                    request.path
                )));
            }
            let is_directory = path.is_dir();
            return Ok(PreparedDragItem {
                source_path: request.path.clone(),
                local_path: request.path,
                is_directory,
                cached: true,
            });
        };

        let file_name = Path::new(&source.remote_path)
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("item")
            .to_string();
        let is_directory = request.is_directory;
        if !is_directory {
            let prepared = self
                .prepare_remote_file_for_local_use(
                    &source,
                    request.size_bytes,
                    request.remote_modified.as_deref(),
                    "Preparing remote file for drag-out",
                    true,
                )
                .await?;
            return Ok(PreparedDragItem {
                source_path: request.path,
                local_path: prepared.local_path,
                is_directory: false,
                cached: prepared.cached,
            });
        }

        cleanup_expired_drag_stage_dirs(&self.drag_stage_dir);
        let stage_path = self
            .drag_stage_dir
            .join(format!(
                "{}-{}",
                now_epoch_ms(),
                sanitize_drag_file_name(&file_name)
            ))
            .join(&file_name);
        if let Some(parent) = stage_path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|error| {
                ApiError::Message(format!(
                    "Failed to prepare drag cache {}: {error}",
                    parent.display()
                ))
            })?;
        }
        let _ = tokio::fs::remove_dir_all(&stage_path).await;
        let mut record = FileTransferRecord::new(
            FileTransferType::Download,
            FileTransferItemType::Remote,
            &file_name,
        );
        record.remote_source_name = source.remote_name.clone();
        record.remote_source_path = source.remote_path.clone();
        record.local_dest_path = display_path(&stage_path);
        record.total_bytes = request.size_bytes.unwrap_or_default();
        record.detail_message = "Preparing remote folder for drag-out".to_string();
        let transfer_id = self.begin_transfer(record).await;
        let result = self
            .download_remote_item(&source, true, &stage_path, transfer_id, None)
            .await;
        self.finish_transfer(transfer_id, result).await?;

        Ok(PreparedDragItem {
            source_path: request.path,
            local_path: display_path(&stage_path),
            is_directory: true,
            cached: false,
        })
    }

    async fn prepare_remote_file_for_local_use(
        &self,
        source: &RemoteBrowseTarget,
        size_bytes: Option<i64>,
        remote_modified: Option<&str>,
        _detail_message: &str,
        record_transfer: bool,
    ) -> ApiResult<PreparedOpenItem> {
        let file_name = Path::new(&source.remote_path)
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| ApiError::Message("Remote file has no name.".to_string()))?
            .to_string();
        let cache_key = ClipboardRemoteFileCacheKey {
            remote_name: source.remote_name.clone(),
            remote_path: source.remote_path.clone(),
            size: size_bytes.unwrap_or_default(),
            last_modified: remote_modified.unwrap_or_default().to_string(),
            is_dir: false,
        };
        let final_path = source.virtual_path(&self.mount_root);
        if let Some(path) = self
            .remote_file_cache
            .lock()
            .await
            .lookup_remote_file(&cache_key)
        {
            return Ok(PreparedOpenItem {
                local_path: display_path(&path),
                cached: true,
                source_path: Some(display_path(&final_path)),
                cache_path: Some(display_path(&path)),
                cache_hit: true,
            });
        }
        if downloaded_file_exists(&final_path).await {
            let mut cache = self.remote_file_cache.lock().await;
            let local_path = cache
                .copy_remote_file_into_cache(&cache_key, &final_path, &file_name)
                .unwrap_or_else(|_| final_path.clone());
            return Ok(PreparedOpenItem {
                local_path: display_path(&local_path),
                cached: true,
                source_path: Some(display_path(&final_path)),
                cache_path: Some(display_path(&local_path)),
                cache_hit: true,
            });
        }

        let temp_path = self
            .remote_file_cache
            .lock()
            .await
            .temp_path_for(&ClipboardCache::remote_file_key(&cache_key), &file_name);
        let transfer_id = if record_transfer {
            let mut record = FileTransferRecord::new(
                FileTransferType::Download,
                FileTransferItemType::Remote,
                &file_name,
            );
            record.remote_source_name = source.remote_name.clone();
            record.remote_source_path = source.remote_path.clone();
            record.local_dest_path = display_path(&temp_path);
            record.total_bytes = size_bytes.unwrap_or_default();
            record.detail_message = _detail_message.to_string();
            self.begin_transfer(record).await
        } else {
            None
        };
        let result = self
            .download_remote_item(source, false, &temp_path, transfer_id, None)
            .await;
        if let Err(error) = result {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return self.finish_transfer(transfer_id, Err(error)).await;
        }
        let mut cache_source_path = temp_path.clone();
        if !downloaded_file_exists(&temp_path).await {
            let _ = tokio::fs::remove_file(&temp_path).await;
            let retry_temp_path = self
                .remote_file_cache
                .lock()
                .await
                .temp_path_for(&ClipboardCache::remote_file_key(&cache_key), &file_name);
            let retry_result = self
                .download_remote_item(source, false, &retry_temp_path, transfer_id, None)
                .await;
            if let Err(error) = retry_result {
                let _ = tokio::fs::remove_file(&retry_temp_path).await;
                return self.finish_transfer(transfer_id, Err(error)).await;
            }
            if !downloaded_file_exists(&retry_temp_path).await {
                let _ = tokio::fs::remove_file(&retry_temp_path).await;
                return self.finish_transfer(
                    transfer_id,
                    Err(ApiError::Message(format!(
                    "Remote download completed but did not create cached file for {file_name}. source={}, cache={}, cache_hit=false",
                    source.remote_path,
                    retry_temp_path.display()
                    ))),
                ).await;
            }
            cache_source_path = retry_temp_path;
        };
        let prepared = self
            .remote_file_cache
            .lock()
            .await
            .store_remote_file(&cache_key, &cache_source_path, &file_name)
            .map(|local_path| PreparedOpenItem {
                local_path: display_path(&local_path),
                cached: false,
                source_path: Some(display_path(&final_path)),
                cache_path: Some(display_path(&local_path)),
                cache_hit: false,
            })
            .map_err(|error| {
                ApiError::Message(format!("Failed to cache remote file {file_name}: {error}"))
            });
        self.finish_transfer(transfer_id, prepared).await
    }

    async fn cached_remote_file_for_paste(
        &self,
        source: &RemoteBrowseTarget,
        item: &PasteItem,
    ) -> Option<PathBuf> {
        let cache_key = ClipboardRemoteFileCacheKey {
            remote_name: source.remote_name.clone(),
            remote_path: source.remote_path.clone(),
            size: item.size_bytes.unwrap_or_default(),
            last_modified: item
                .remote_modified
                .as_deref()
                .unwrap_or_default()
                .to_string(),
            is_dir: false,
        };
        self.remote_file_cache
            .lock()
            .await
            .lookup_remote_file(&cache_key)
    }

    async fn cache_downloaded_remote_file(
        &self,
        source: &RemoteBrowseTarget,
        local_path: &Path,
        size_bytes: Option<i64>,
        remote_modified: Option<&str>,
    ) {
        let size = size_bytes.unwrap_or_else(|| {
            std::fs::metadata(local_path)
                .map(|metadata| metadata.len().min(i64::MAX as u64) as i64)
                .unwrap_or_default()
        });
        let cache_key = ClipboardRemoteFileCacheKey {
            remote_name: source.remote_name.clone(),
            remote_path: source.remote_path.clone(),
            size,
            last_modified: remote_modified.unwrap_or_default().to_string(),
            is_dir: false,
        };
        let file_name = Path::new(&source.remote_path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("item");
        let _ = self
            .remote_file_cache
            .lock()
            .await
            .copy_remote_file_into_cache(&cache_key, local_path, file_name);
    }

    pub async fn create_item(
        &self,
        request: CreateItemRequest,
    ) -> ApiResult<ExplorerOperationResult> {
        self.create_item_impl(request, None, None).await
    }

    pub async fn create_item_with_cancellation(
        &self,
        request: CreateItemRequest,
        cancellation: Arc<AtomicBool>,
    ) -> ApiResult<ExplorerOperationResult> {
        self.create_item_impl(request, Some(cancellation.as_ref()), None)
            .await
    }

    pub async fn create_item_with_cancellation_transfer(
        &self,
        request: CreateItemRequest,
        cancellation: Arc<AtomicBool>,
        transfer_id: u64,
    ) -> ApiResult<ExplorerOperationResult> {
        self.create_item_impl(
            request,
            Some(cancellation.as_ref()),
            nonzero_transfer_id(transfer_id),
        )
        .await
    }

    async fn create_item_impl(
        &self,
        request: CreateItemRequest,
        cancellation: Option<&AtomicBool>,
        existing_transfer_id: Option<u64>,
    ) -> ApiResult<ExplorerOperationResult> {
        ensure_not_canceled_if(cancellation)?;
        if let Some(target) = self.remote_target(&request.directory) {
            let name = validate_remote_name(&request.name)?.to_string();
            let remote_path = normalize_remote_path(&join_remote_path(&target.remote_path, &name))?;
            let mut record = FileTransferRecord::new(
                FileTransferType::Create,
                FileTransferItemType::Remote,
                &name,
            );
            record.remote_dest_name = target.remote_name.clone();
            record.remote_dest_path = remote_path.clone();
            record.detail_message = match request.kind {
                crate::core::explorer::CreateItemKind::Folder => "Creating remote folder",
                crate::core::explorer::CreateItemKind::File => "Creating remote file",
            }
            .to_string();
            let transfer_id = if existing_transfer_id.is_some() {
                existing_transfer_id
            } else {
                self.begin_transfer(record).await
            };
            let operation = match request.kind {
                crate::core::explorer::CreateItemKind::Folder => self
                    .start_json_job(
                        "/api/remote/file/mkdir",
                        serde_json::json!({ "remote": target.remote_name, "path": remote_path }),
                        transfer_id,
                        cancellation,
                    )
                    .await
                    .map(|_| ()),
                crate::core::explorer::CreateItemKind::File => self
                    .start_json_job(
                        "/api/remote/file/create",
                        serde_json::json!({ "remote": target.remote_name, "path": remote_path }),
                        transfer_id,
                        cancellation,
                    )
                    .await
                    .map(|_| ()),
            };
            self.finish_transfer(transfer_id, operation).await?;
            self.listing_cache
                .clear(&target.remote_name, &target.remote_path)
                .await?;
            return Ok(ExplorerOperationResult {
                affected_paths: vec![display_path(
                    &target.virtual_path(&self.mount_root).join(name),
                )],
                parent_path: Some(display_path(&target.virtual_path(&self.mount_root))),
            });
        }
        self.reject_virtual_mount_container(&request.directory, "create")?;
        let mut record = FileTransferRecord::new(
            FileTransferType::Create,
            FileTransferItemType::Local,
            request.name.clone(),
        );
        record.local_dest_path = display_path(&Path::new(&request.directory).join(&request.name));
        record.detail_message = "Creating local item".to_string();
        let transfer_id = if existing_transfer_id.is_some() {
            existing_transfer_id
        } else {
            self.begin_transfer(record).await
        };
        ensure_not_canceled_if(cancellation)?;
        let result = create_local_item_cancellable(request, cancellation).await;
        self.finish_transfer(transfer_id, result).await
    }

    async fn create_empty_remote_file(
        &self,
        target: &RemoteBrowseTarget,
        name: &str,
        transfer_id: Option<u64>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<()> {
        ensure_not_canceled_if(cancellation)?;
        tokio::fs::create_dir_all(&self.clipboard_text_cache_dir)
            .await
            .map_err(|error| {
                ApiError::Message(format!(
                    "Failed to prepare remote file cache {}: {error}",
                    self.clipboard_text_cache_dir.display()
                ))
            })?;
        let stage_path = self.clipboard_text_cache_dir.join(format!(
            "empty-{}-{}",
            now_epoch_ms(),
            sanitize_drag_file_name(name)
        ));
        tokio::fs::write(&stage_path, []).await.map_err(|error| {
            ApiError::Message(format!(
                "Failed to stage empty remote file {}: {error}",
                stage_path.display()
            ))
        })?;
        let result = self
            .upload_remote_file(
                &stage_path,
                &target.remote_name,
                &target.remote_path,
                name,
                transfer_id,
                None,
                cancellation,
            )
            .await;
        let _ = tokio::fs::remove_file(&stage_path).await;
        result
    }

    pub async fn rename_item(
        &self,
        request: RenameItemRequest,
    ) -> ApiResult<ExplorerOperationResult> {
        self.rename_item_impl(request, None, None).await
    }

    pub async fn rename_item_with_cancellation(
        &self,
        request: RenameItemRequest,
        cancellation: Arc<AtomicBool>,
    ) -> ApiResult<ExplorerOperationResult> {
        self.rename_item_impl(request, Some(cancellation.as_ref()), None)
            .await
    }

    pub async fn rename_item_with_cancellation_transfer(
        &self,
        request: RenameItemRequest,
        cancellation: Arc<AtomicBool>,
        transfer_id: u64,
    ) -> ApiResult<ExplorerOperationResult> {
        self.rename_item_impl(
            request,
            Some(cancellation.as_ref()),
            nonzero_transfer_id(transfer_id),
        )
        .await
    }

    async fn rename_item_impl(
        &self,
        request: RenameItemRequest,
        cancellation: Option<&AtomicBool>,
        existing_transfer_id: Option<u64>,
    ) -> ApiResult<ExplorerOperationResult> {
        ensure_not_canceled_if(cancellation)?;
        if let Some(source) = self.remote_target(&request.path) {
            if source.remote_path == "/" {
                return Err(ApiError::Message(
                    "Rename remotes from the Providers workspace.".to_string(),
                ));
            }
            let name = validate_remote_name(&request.new_name)?;
            let parent = remote_parent_path(&source.remote_path);
            let destination_path = normalize_remote_path(&join_remote_path(&parent, name))?;
            let mut record = FileTransferRecord::new(
                FileTransferType::Rename,
                FileTransferItemType::Remote,
                name,
            );
            record.remote_source_name = source.remote_name.clone();
            record.remote_source_path = source.remote_path.clone();
            record.remote_dest_name = source.remote_name.clone();
            record.remote_dest_path = destination_path.clone();
            record.detail_message = "Renaming remote item".to_string();
            let transfer_id = if existing_transfer_id.is_some() {
                existing_transfer_id
            } else {
                self.begin_transfer(record).await
            };
            let operation = if request.source_is_directory.unwrap_or(false) {
                self.start_json_job(
                    "/api/remote/file/move",
                    serde_json::json!({
                        "source_remote": source.remote_name,
                        "source_path": source.remote_path,
                        "dest_remote": source.remote_name,
                        "dest_path": destination_path,
                    }),
                    transfer_id,
                    cancellation,
                )
                .await
            } else {
                self.start_json_job(
                    "/api/remote/file/rename",
                    serde_json::json!({
                        "remote": source.remote_name,
                        "old_path": source.remote_path,
                        "new_path": destination_path,
                    }),
                    transfer_id,
                    cancellation,
                )
                .await
            };
            self.finish_transfer(transfer_id, operation).await?;
            self.listing_cache
                .clear(&source.remote_name, &parent)
                .await?;
            let parent_target = RemoteBrowseTarget {
                provider_type: source.provider_type.clone(),
                remote_name: source.remote_name.clone(),
                remote_path: parent,
            };
            return Ok(ExplorerOperationResult {
                affected_paths: vec![display_path(
                    &parent_target.virtual_path(&self.mount_root).join(name),
                )],
                parent_path: Some(display_path(&parent_target.virtual_path(&self.mount_root))),
            });
        }
        self.reject_virtual_mount_container(&request.path, "rename")?;
        let destination = Path::new(&request.path)
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .join(&request.new_name);
        let mut record = FileTransferRecord::new(
            FileTransferType::Rename,
            FileTransferItemType::Local,
            request.new_name.clone(),
        );
        record.local_source_path = request.path.clone();
        record.local_dest_path = display_path(&destination);
        record.total_bytes = local_item_size(
            Path::new(&request.path),
            request.source_is_directory.unwrap_or(false),
        )
        .await;
        record.detail_message = "Renaming local item".to_string();
        let transfer_id = if existing_transfer_id.is_some() {
            existing_transfer_id
        } else {
            self.begin_transfer(record).await
        };
        ensure_not_canceled_if(cancellation)?;
        let result = rename_local_item_cancellable(request, cancellation).await;
        self.finish_transfer(transfer_id, result).await
    }

    pub async fn delete_items(
        &self,
        request: DeleteItemsRequest,
    ) -> ApiResult<ExplorerOperationResult> {
        self.delete_items_impl(request, None, None).await
    }

    pub async fn delete_items_with_cancellation(
        &self,
        request: DeleteItemsRequest,
        cancellation: Arc<AtomicBool>,
    ) -> ApiResult<ExplorerOperationResult> {
        self.delete_items_impl(request, Some(cancellation.as_ref()), None)
            .await
    }

    pub async fn delete_items_with_cancellation_transfer(
        &self,
        request: DeleteItemsRequest,
        cancellation: Arc<AtomicBool>,
        transfer_id: u64,
    ) -> ApiResult<ExplorerOperationResult> {
        self.delete_items_impl(
            request,
            Some(cancellation.as_ref()),
            nonzero_transfer_id(transfer_id),
        )
        .await
    }

    async fn delete_items_impl(
        &self,
        request: DeleteItemsRequest,
        cancellation: Option<&AtomicBool>,
        existing_transfer_id: Option<u64>,
    ) -> ApiResult<ExplorerOperationResult> {
        ensure_not_canceled_if(cancellation)?;
        let permanent = request.permanent;
        let mut local_paths = Vec::new();
        let mut affected_paths = Vec::new();
        let mut parent_path = None;
        for path in request.paths {
            ensure_not_canceled_if(cancellation)?;
            if let Some(target) = self.remote_target(&path) {
                if !permanent {
                    return Err(ApiError::Message(
                        "Remote items can only be deleted permanently.".to_string(),
                    ));
                }
                if target.remote_path == "/" {
                    return Err(ApiError::Message(
                        "Disconnect remotes from the Providers workspace.".to_string(),
                    ));
                }
                let file_name = Path::new(&target.remote_path)
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or(&target.remote_path)
                    .to_string();
                let mut record = FileTransferRecord::new(
                    FileTransferType::Delete,
                    FileTransferItemType::Remote,
                    file_name,
                );
                record.remote_source_name = target.remote_name.clone();
                record.remote_source_path = target.remote_path.clone();
                record.detail_message = "Deleting remote item".to_string();
                let transfer_id = if existing_transfer_id.is_some() {
                    existing_transfer_id
                } else {
                    self.begin_transfer(record).await
                };
                self.finish_transfer(
                    transfer_id,
                    self.delete_remote_target(&target, transfer_id, cancellation)
                        .await,
                )
                .await?;
                ensure_not_canceled_if(cancellation)?;
                let virtual_path = target.virtual_path(&self.mount_root);
                parent_path.get_or_insert_with(|| {
                    virtual_path.parent().map(display_path).unwrap_or_default()
                });
                affected_paths.push(display_path(&virtual_path));
            } else {
                self.reject_virtual_mount_container(&path, "delete")?;
                local_paths.push(path);
            }
        }
        for local_path in local_paths {
            ensure_not_canceled_if(cancellation)?;
            let file_name = Path::new(&local_path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(&local_path)
                .to_string();
            let metadata = tokio::fs::symlink_metadata(&local_path).await.ok();
            let mut record = FileTransferRecord::new(
                FileTransferType::Delete,
                FileTransferItemType::Local,
                file_name,
            );
            record.local_source_path = local_path.clone();
            record.total_bytes = metadata
                .as_ref()
                .filter(|metadata| metadata.is_file())
                .map(|metadata| metadata.len().min(i64::MAX as u64) as i64)
                .unwrap_or_default();
            record.detail_message = if permanent {
                "Deleting local item".to_string()
            } else {
                "Moving local item to Trash".to_string()
            };
            let transfer_id = if existing_transfer_id.is_some() {
                existing_transfer_id
            } else {
                self.begin_transfer(record).await
            };
            let local_result = if permanent {
                delete_local_path_cancellable(Path::new(&local_path), cancellation).await
            } else {
                trash_local_path_cancellable(Path::new(&local_path), &self.trash_dir, cancellation)
                    .await
                    .map(|_| ())
            }
            .map(|()| ExplorerOperationResult {
                affected_paths: vec![local_path.clone()],
                parent_path: Path::new(&local_path).parent().map(display_path),
            });
            let local_result = self.finish_transfer(transfer_id, local_result).await?;
            if parent_path.is_none() {
                parent_path = local_result.parent_path.clone();
            }
            affected_paths.extend(local_result.affected_paths);
        }
        Ok(ExplorerOperationResult {
            affected_paths,
            parent_path,
        })
    }

    pub async fn paste_items(
        &self,
        request: PasteItemsRequest,
    ) -> ApiResult<ExplorerOperationResult> {
        self.paste_items_impl(request, None, None).await
    }

    async fn paste_items_impl(
        &self,
        request: PasteItemsRequest,
        cancellation: Option<&AtomicBool>,
        existing_transfer_id: Option<u64>,
    ) -> ApiResult<ExplorerOperationResult> {
        ensure_not_canceled_if(cancellation)?;
        if let Some(destination) = self.remote_target(&request.destination_directory) {
            let mut affected_paths = Vec::new();
            for item in &request.sources {
                ensure_not_canceled_if(cancellation)?;
                let source_name = request
                    .target_name
                    .as_deref()
                    .filter(|_| request.sources.len() == 1)
                    .map(validate_remote_name)
                    .transpose()?
                    .map(ToOwned::to_owned)
                    .or_else(|| {
                        Path::new(&item.path)
                            .file_name()
                            .and_then(|value| value.to_str())
                            .map(ToOwned::to_owned)
                    })
                    .ok_or_else(|| ApiError::Message("Source has no file name".to_string()))?;
                if ignored_upload_name(&source_name) {
                    continue;
                }
                let source_target = self.remote_target(&item.path);
                let transfer_type = if source_target.is_some() {
                    match request.operation {
                        crate::core::explorer::ClipboardOperation::Copy => FileTransferType::Copy,
                        crate::core::explorer::ClipboardOperation::Move => FileTransferType::Move,
                    }
                } else {
                    FileTransferType::Upload
                };
                let mut record = FileTransferRecord::new(
                    transfer_type,
                    if source_target.is_some() {
                        FileTransferItemType::Remote
                    } else {
                        FileTransferItemType::Local
                    },
                    &source_name,
                );
                record.remote_dest_name = destination.remote_name.clone();
                record.remote_dest_path = normalize_remote_path(&join_remote_path(
                    &destination.remote_path,
                    &source_name,
                ))?;
                if let Some(source) = &source_target {
                    record.remote_source_name = source.remote_name.clone();
                    record.remote_source_path = source.remote_path.clone();
                } else {
                    record.local_source_path = item.path.clone();
                    record.total_bytes =
                        local_item_size(Path::new(&item.path), item.is_directory).await;
                }
                record.detail_message = if source_target.is_some() {
                    "Transferring remote item".to_string()
                } else {
                    "Uploading local item".to_string()
                };
                let transfer_id = if existing_transfer_id.is_some() {
                    existing_transfer_id
                } else {
                    self.begin_transfer(record).await
                };

                let operation = if let Some(source) = source_target {
                    let destination_path = normalize_remote_path(&join_remote_path(
                        &destination.remote_path,
                        &source_name,
                    ))?;
                    let endpoint = match request.operation {
                        crate::core::explorer::ClipboardOperation::Copy => "/api/remote/file/copy",
                        crate::core::explorer::ClipboardOperation::Move => "/api/remote/file/move",
                    };
                    self.start_json_job(
                        endpoint,
                        serde_json::json!({
                            "source_remote": source.remote_name,
                            "source_path": source.remote_path,
                            "dest_remote": destination.remote_name,
                            "dest_path": destination_path,
                        }),
                        transfer_id,
                        cancellation,
                    )
                    .await
                    .map(|_| ())
                } else {
                    let upload = self
                        .upload_local_item(
                            Path::new(&item.path),
                            item.is_directory,
                            &destination,
                            &source_name,
                            transfer_id,
                            cancellation,
                        )
                        .await;
                    if upload.is_ok()
                        && matches!(
                            request.operation,
                            crate::core::explorer::ClipboardOperation::Move
                        )
                    {
                        remove_local_path(Path::new(&item.path), item.is_directory).await
                    } else {
                        upload
                    }
                };
                self.finish_transfer(transfer_id, operation).await?;
                ensure_not_canceled_if(cancellation)?;
                affected_paths.push(display_path(
                    &destination
                        .virtual_path(&self.mount_root)
                        .join(&source_name),
                ));
            }
            self.listing_cache
                .clear(&destination.remote_name, &destination.remote_path)
                .await?;
            return Ok(ExplorerOperationResult {
                affected_paths,
                parent_path: Some(display_path(&destination.virtual_path(&self.mount_root))),
            });
        }
        self.reject_virtual_mount_container(&request.destination_directory, "paste")?;
        if request
            .sources
            .iter()
            .any(|item| self.remote_target(&item.path).is_some())
        {
            let destination = PathBuf::from(&request.destination_directory);
            let mut affected_paths = Vec::new();
            for item in &request.sources {
                ensure_not_canceled_if(cancellation)?;
                let source = self.remote_target(&item.path).ok_or_else(|| {
                    ApiError::Message(
                        "A single paste cannot mix local and remote sources.".to_string(),
                    )
                })?;
                let name = request
                    .target_name
                    .as_deref()
                    .filter(|_| request.sources.len() == 1)
                    .map(validate_remote_name)
                    .transpose()?
                    .unwrap_or_else(|| {
                        Path::new(&source.remote_path)
                            .file_name()
                            .and_then(|value| value.to_str())
                            .unwrap_or(&source.remote_path)
                    });
                let local_path = destination.join(name);
                ensure_destination_available(&local_path).await?;
                let mut record = FileTransferRecord::new(
                    FileTransferType::Download,
                    FileTransferItemType::Remote,
                    name,
                );
                record.remote_source_name = source.remote_name.clone();
                record.remote_source_path = source.remote_path.clone();
                record.local_dest_path = display_path(&local_path);
                let cached_remote_file = if item.is_directory {
                    None
                } else {
                    self.cached_remote_file_for_paste(&source, item).await
                };
                record.detail_message = if cached_remote_file.is_some() {
                    "Copying cached remote item".to_string()
                } else {
                    "Downloading remote item".to_string()
                };
                let transfer_id = if existing_transfer_id.is_some() {
                    existing_transfer_id
                } else {
                    self.begin_transfer(record).await
                };
                let download = if let Some(cache_path) = cached_remote_file {
                    copy_cached_remote_file_to_destination(&cache_path, &local_path, cancellation)
                        .await
                } else {
                    self.download_remote_item(
                        &source,
                        item.is_directory,
                        &local_path,
                        transfer_id,
                        cancellation,
                    )
                    .await
                };
                let operation = if download.is_ok()
                    && matches!(
                        request.operation,
                        crate::core::explorer::ClipboardOperation::Move
                    ) {
                    self.delete_remote_target(&source, transfer_id, cancellation)
                        .await
                } else {
                    download
                };
                self.finish_transfer(transfer_id, operation).await?;
                ensure_not_canceled_if(cancellation)?;
                if !item.is_directory {
                    self.cache_downloaded_remote_file(
                        &source,
                        &local_path,
                        item.size_bytes,
                        item.remote_modified.as_deref(),
                    )
                    .await;
                }
                affected_paths.push(display_path(&local_path));
            }
            return Ok(ExplorerOperationResult {
                affected_paths,
                parent_path: Some(display_path(&destination)),
            });
        }
        let mut transfer_ids = Vec::with_capacity(request.sources.len());
        for item in &request.sources {
            let file_name = request
                .target_name
                .as_deref()
                .filter(|_| request.sources.len() == 1)
                .unwrap_or_else(|| {
                    Path::new(&item.path)
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or(&item.path)
                })
                .to_string();
            let mut record = FileTransferRecord::new(
                match request.operation {
                    crate::core::explorer::ClipboardOperation::Copy => FileTransferType::Copy,
                    crate::core::explorer::ClipboardOperation::Move => FileTransferType::Move,
                },
                FileTransferItemType::Local,
                &file_name,
            );
            record.local_source_path = item.path.clone();
            record.local_dest_path =
                display_path(&Path::new(&request.destination_directory).join(file_name));
            record.total_bytes = local_item_size(Path::new(&item.path), item.is_directory).await;
            record.detail_message = "Transferring local item".to_string();
            if let Some(id) = if existing_transfer_id.is_some() {
                existing_transfer_id
            } else {
                self.begin_transfer(record).await
            } {
                transfer_ids.push(id);
            }
        }
        let result = tokio::task::spawn_blocking(move || paste_items(request))
            .await
            .map_err(|err| ApiError::Message(format!("Explorer worker failed: {err}")))?;
        self.finish_transfers(&transfer_ids, result).await
    }

    pub async fn paste_items_with_cancellation(
        &self,
        request: PasteItemsRequest,
        cancellation: Arc<AtomicBool>,
    ) -> ApiResult<ExplorerOperationResult> {
        ensure_not_canceled(cancellation.as_ref())?;
        if self.remote_target(&request.destination_directory).is_some()
            || request
                .sources
                .iter()
                .any(|item| self.remote_target(&item.path).is_some())
        {
            let result = self
                .paste_items_impl(request, Some(cancellation.as_ref()), None)
                .await;
            ensure_not_canceled(cancellation.as_ref())?;
            return result;
        }
        self.paste_local_items_with_cancellation(request, cancellation.as_ref(), None)
            .await
    }

    pub async fn paste_items_with_cancellation_transfer(
        &self,
        request: PasteItemsRequest,
        cancellation: Arc<AtomicBool>,
        transfer_id: u64,
    ) -> ApiResult<ExplorerOperationResult> {
        ensure_not_canceled(cancellation.as_ref())?;
        let existing_transfer_id = nonzero_transfer_id(transfer_id);
        if self.remote_target(&request.destination_directory).is_some()
            || request
                .sources
                .iter()
                .any(|item| self.remote_target(&item.path).is_some())
        {
            let result = self
                .paste_items_impl(request, Some(cancellation.as_ref()), existing_transfer_id)
                .await;
            ensure_not_canceled(cancellation.as_ref())?;
            return result;
        }
        self.paste_local_items_with_cancellation(
            request,
            cancellation.as_ref(),
            existing_transfer_id,
        )
        .await
    }

    async fn paste_local_items_with_cancellation(
        &self,
        request: PasteItemsRequest,
        cancellation: &AtomicBool,
        existing_transfer_id: Option<u64>,
    ) -> ApiResult<ExplorerOperationResult> {
        if request.sources.is_empty() {
            return Err(ApiError::Message("Copy or cut an item first.".to_string()));
        }

        self.reject_virtual_mount_container(&request.destination_directory, "paste")?;
        let destination_directory =
            normalize_existing_local_dir(&request.destination_directory).await?;
        let target_name = if request.sources.len() == 1 {
            request
                .target_name
                .as_deref()
                .map(validate_local_file_name)
                .transpose()?
        } else {
            None
        };
        let mut affected_paths = Vec::new();
        let mut transfer_ids = Vec::with_capacity(request.sources.len());

        for item in &request.sources {
            ensure_not_canceled(cancellation)?;
            let source = PathBuf::from(&item.path);
            let source_metadata = tokio::fs::symlink_metadata(&source)
                .await
                .map_err(|error| {
                    ApiError::Message(format!("Failed to inspect {}: {error}", source.display()))
                })?;
            let file_name = target_name
                .map(OsStr::new)
                .or_else(|| source.file_name())
                .ok_or_else(|| ApiError::Message(format!("Cannot paste {}.", source.display())))?;
            let destination = destination_directory.join(file_name);
            ensure_destination_available(&destination).await?;

            if source_metadata.is_dir()
                && !source_metadata.file_type().is_symlink()
                && destination_directory.starts_with(&source)
            {
                return Err(ApiError::Message(
                    "Cannot paste a folder into itself.".to_string(),
                ));
            }

            let file_name = file_name.to_string_lossy().to_string();
            let mut record = FileTransferRecord::new(
                match request.operation {
                    crate::core::explorer::ClipboardOperation::Copy => FileTransferType::Copy,
                    crate::core::explorer::ClipboardOperation::Move => FileTransferType::Move,
                },
                FileTransferItemType::Local,
                &file_name,
            );
            record.local_source_path = display_path(&source);
            record.local_dest_path = display_path(&destination);
            record.total_bytes = local_item_size(&source, item.is_directory).await;
            record.detail_message = "Transferring local item".to_string();
            if let Some(id) = if existing_transfer_id.is_some() {
                existing_transfer_id
            } else {
                self.begin_transfer(record).await
            } {
                transfer_ids.push(id);
            }

            let result = match request.operation {
                crate::core::explorer::ClipboardOperation::Copy => {
                    copy_local_path_cancellable(&source, &destination, cancellation).await
                }
                crate::core::explorer::ClipboardOperation::Move => {
                    move_local_path_cancellable(&source, &destination, cancellation).await
                }
            };
            let result = cleanup_partial_destination_on_cancel(
                &destination,
                source_metadata.is_dir() && !source_metadata.file_type().is_symlink(),
                result,
            )
            .await;
            self.finish_transfers(&transfer_ids, result).await?;
            transfer_ids.clear();
            affected_paths.push(display_path(&destination));
        }

        Ok(ExplorerOperationResult {
            affected_paths,
            parent_path: Some(display_path(&destination_directory)),
        })
    }

    pub async fn stage_clipboard_text_paste(
        &self,
        request: PasteTextRequest,
    ) -> ApiResult<PasteItemsRequest> {
        if request.text.is_empty() {
            return Err(ApiError::Message("Clipboard text is empty.".to_string()));
        }
        let preferred_name =
            validate_remote_name(request.preferred_name.as_deref().unwrap_or("clipboard.txt"))?
                .to_string();
        tokio::fs::create_dir_all(&self.clipboard_text_cache_dir)
            .await
            .map_err(|error| {
                ApiError::Message(format!(
                    "Failed to prepare clipboard cache {}: {error}",
                    self.clipboard_text_cache_dir.display()
                ))
            })?;
        let source_path = self
            .clipboard_text_cache_dir
            .join(format!("clipboard-{}.txt", now_epoch_ms()));
        tokio::fs::write(&source_path, request.text)
            .await
            .map_err(|error| {
                ApiError::Message(format!(
                    "Failed to stage clipboard text {}: {error}",
                    source_path.display()
                ))
            })?;
        Ok(PasteItemsRequest {
            sources: vec![crate::core::explorer::PasteItem {
                path: display_path(&source_path),
                is_directory: false,
                size_bytes: None,
                remote_modified: None,
            }],
            destination_directory: request.destination_directory,
            operation: crate::core::explorer::ClipboardOperation::Copy,
            target_name: Some(preferred_name),
        })
    }

    pub async fn stage_clipboard_blob_paste(
        &self,
        request: PasteBlobRequest,
    ) -> ApiResult<PasteItemsRequest> {
        if request.bytes.is_empty() {
            return Err(ApiError::Message("Clipboard image is empty.".to_string()));
        }
        let preferred_name =
            validate_remote_name(request.preferred_name.as_deref().unwrap_or("clipboard.png"))?
                .to_string();
        tokio::fs::create_dir_all(&self.clipboard_blob_cache_dir)
            .await
            .map_err(|error| {
                ApiError::Message(format!(
                    "Failed to prepare clipboard cache {}: {error}",
                    self.clipboard_blob_cache_dir.display()
                ))
            })?;
        let source_path = self
            .clipboard_blob_cache_dir
            .join(format!("clipboard-{}.bin", now_epoch_ms()));
        tokio::fs::write(&source_path, request.bytes)
            .await
            .map_err(|error| {
                ApiError::Message(format!(
                    "Failed to stage clipboard image {}: {error}",
                    source_path.display()
                ))
            })?;
        Ok(PasteItemsRequest {
            sources: vec![crate::core::explorer::PasteItem {
                path: display_path(&source_path),
                is_directory: false,
                size_bytes: None,
                remote_modified: None,
            }],
            destination_directory: request.destination_directory,
            operation: crate::core::explorer::ClipboardOperation::Copy,
            target_name: Some(preferred_name),
        })
    }

    async fn list_virtual_directory(
        &self,
        path: &Path,
        show_hidden: bool,
        force_remote_refresh: bool,
    ) -> ApiResult<DirectoryListing> {
        let parts = virtual_path_parts(&self.mount_root, path).ok_or_else(|| {
            ApiError::Message(format!("Invalid remote mount path: {}", path.display()))
        })?;
        let mut remotes = self.remote_inventory().await?;

        match parts.len() {
            0 => Ok(self.remote_root_listing(remotes, show_hidden)),
            _ => {
                let mut target = RemoteBrowseTarget::from_virtual_path(&self.mount_root, path)
                    .ok_or_else(|| ApiError::Message("Invalid remote browse path".to_string()))?;
                let mut remote = remotes
                    .iter()
                    .find(|remote| remote.name == target.remote_name)
                    .cloned();
                if remote.is_none() {
                    remotes = self.providers.refresh().await?.remotes;
                    remote = remotes
                        .iter()
                        .find(|remote| remote.name == target.remote_name)
                        .cloned();
                }
                let Some(remote) = remote else {
                    return Err(ApiError::Message(format!(
                        "Remote \"{}\" was not found.",
                        target.remote_name
                    )));
                };
                target.provider_type = remote.provider_type.clone();
                self.remote_listing(target, show_hidden, force_remote_refresh)
                    .await
            }
        }
    }

    async fn remote_inventory(&self) -> ApiResult<Vec<ProviderRemote>> {
        for _ in 0..REMOTE_INVENTORY_WAIT_ATTEMPTS {
            let snapshot = self.providers.snapshot().await?;
            if !snapshot.remotes.is_empty() {
                return Ok(snapshot.remotes);
            }
            if !snapshot.loading {
                break;
            }
            tokio::time::sleep(REMOTE_INVENTORY_WAIT_INTERVAL).await;
        }
        Ok(self.providers.refresh().await?.remotes)
    }

    fn remote_root_listing(
        &self,
        mut remotes: Vec<ProviderRemote>,
        show_hidden: bool,
    ) -> DirectoryListing {
        remotes.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
        let hidden_count = remotes
            .iter()
            .filter(|remote| remote.name.starts_with('.'))
            .count();
        let entries = remotes
            .into_iter()
            .filter(|remote| show_hidden || !remote.name.starts_with('.'))
            .map(|remote| {
                virtual_folder_entry(
                    self.mount_root.join(&remote.name),
                    remote.name.clone(),
                    ExplorerLocation {
                        kind: ExplorerLocationKind::Remote,
                        provider_type: Some(remote.provider_type),
                        remote_name: Some(remote.name),
                        remote_path: Some("/".to_string()),
                    },
                )
            })
            .collect::<Vec<_>>();
        DirectoryListing {
            path: display_path(&self.mount_root),
            title: None,
            parent_path: self.mount_root.parent().map(display_path),
            location: ExplorerLocation {
                kind: ExplorerLocationKind::RemoteProvider,
                provider_type: None,
                remote_name: None,
                remote_path: None,
            },
            total_count: entries.len() + hidden_count,
            hidden_count,
            entries,
            modified_ms: None,
            created_ms: None,
        }
    }

    async fn remote_listing(
        &self,
        target: RemoteBrowseTarget,
        show_hidden: bool,
        force_remote_refresh: bool,
    ) -> ApiResult<DirectoryListing> {
        if !force_remote_refresh {
            if let Some(items) = self.load_fresh_cached_remote_items(&target).await? {
                return self.remote_listing_from_items(target, show_hidden, items);
            }
        }

        let items = match self.fetch_remote_items(&target).await {
            Ok(items) => items,
            Err(remote_error) if is_remote_directory_not_found_error(&remote_error) => {
                let _ = self
                    .listing_cache
                    .clear(&target.remote_name, &target.remote_path)
                    .await;
                return Err(remote_error);
            }
            Err(remote_error) => match self.load_cached_remote_items(&target).await? {
                Some(items) => items,
                None => return Err(remote_error),
            },
        };
        self.remote_listing_from_items(target, show_hidden, items)
    }

    async fn load_fresh_cached_remote_items(
        &self,
        target: &RemoteBrowseTarget,
    ) -> ApiResult<Option<Vec<RemoteListItem>>> {
        let Some(last_write_time) = self
            .listing_cache
            .last_write_time(&target.remote_name, &target.remote_path)
            .await?
        else {
            return Ok(None);
        };
        if last_write_time
            .elapsed()
            .map(|age| age > REMOTE_LISTING_CACHE_MAX_AGE)
            .unwrap_or(true)
        {
            return Ok(None);
        }
        self.load_cached_remote_items(target).await
    }

    async fn load_cached_remote_items(
        &self,
        target: &RemoteBrowseTarget,
    ) -> ApiResult<Option<Vec<RemoteListItem>>> {
        let Some(body) = self
            .listing_cache
            .load(&target.remote_name, &target.remote_path)
            .await?
        else {
            return Ok(None);
        };
        match serde_json::from_slice::<Vec<RemoteListItem>>(&body) {
            Ok(items) => Ok(Some(items)),
            Err(_) => Ok(None),
        }
    }

    fn remote_listing_from_items(
        &self,
        target: RemoteBrowseTarget,
        show_hidden: bool,
        mut items: Vec<RemoteListItem>,
    ) -> ApiResult<DirectoryListing> {
        items.sort_by(|left, right| {
            (!left.is_dir)
                .cmp(&(!right.is_dir))
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        let items = dedupe_remote_list_items(&target, items)?;

        let hidden_count = items
            .iter()
            .filter(|item| item.name.starts_with('.'))
            .count();
        let total_count = items.len();
        let mut entries = Vec::with_capacity(items.len());
        for item in items {
            if !show_hidden && item.name.starts_with('.') {
                continue;
            }
            let remote_path = target.child_remote_path(&item)?;
            let item_target = RemoteBrowseTarget {
                provider_type: target.provider_type.clone(),
                remote_name: target.remote_name.clone(),
                remote_path: remote_path.clone(),
            };
            let virtual_path = item_target.virtual_path(&self.mount_root);
            let name = if item.name.is_empty() {
                Path::new(&remote_path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or(&remote_path)
                    .to_string()
            } else {
                item.name
            };
            entries.push(FileEntry {
                id: display_path(&virtual_path),
                extension: Path::new(&name)
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_string(),
                mime_type: (!item.mime_type.is_empty()).then_some(item.mime_type),
                remote_modified: (!item.mod_time.is_empty()).then_some(item.mod_time),
                hidden: name.starts_with('.'),
                name,
                path: display_path(&virtual_path),
                kind: if item.is_dir {
                    FileKind::Folder
                } else {
                    FileKind::File
                },
                size_bytes: if item.is_dir {
                    None
                } else {
                    Some(item.size.max(0) as u64)
                },
                modified_ms: None,
                created_ms: None,
                readonly: false,
                is_deleted: false,
                location: ExplorerLocation {
                    kind: ExplorerLocationKind::Remote,
                    provider_type: Some(target.provider_type.clone()),
                    remote_name: Some(target.remote_name.clone()),
                    remote_path: Some(remote_path),
                },
            });
        }

        let listing_path = target.virtual_path(&self.mount_root);
        let parent_path = listing_path.parent().map(display_path);
        Ok(DirectoryListing {
            path: display_path(&listing_path),
            title: None,
            parent_path,
            location: ExplorerLocation {
                kind: ExplorerLocationKind::Remote,
                provider_type: Some(target.provider_type),
                remote_name: Some(target.remote_name),
                remote_path: Some(target.remote_path),
            },
            entries,
            total_count,
            hidden_count,
            modified_ms: None,
            created_ms: None,
        })
    }

    async fn upload_local_item(
        &self,
        source: &Path,
        is_directory: bool,
        destination: &RemoteBrowseTarget,
        source_name: &str,
        transfer_id: Option<u64>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<()> {
        ensure_not_canceled_if(cancellation)?;
        let metadata = tokio::fs::symlink_metadata(source).await.map_err(|error| {
            ApiError::Message(format!("Failed to inspect {}: {error}", source.display()))
        })?;
        if is_directory != metadata.is_dir() {
            return Err(ApiError::Message(format!(
                "Source type changed before paste: {}",
                source.display()
            )));
        }
        if ignored_upload_name(source_name) {
            if let Some(transfer_id) = transfer_id {
                let _ = self
                    .transfers
                    .update_detail(
                        transfer_id,
                        format!("Skipped provider-disallowed metadata item {source_name}"),
                    )
                    .await;
            }
            return Ok(());
        }

        if !is_directory {
            return self
                .upload_remote_file(
                    source,
                    &destination.remote_name,
                    &destination.remote_path,
                    source_name,
                    transfer_id,
                    Some(TransferProgress {
                        base_bytes: 0,
                        total_bytes: metadata.len().min(i64::MAX as u64) as i64,
                    }),
                    cancellation,
                )
                .await;
        }

        let total_bytes = local_item_size(source, true).await;
        self.upload_remote_directory(
            source,
            &destination.remote_name,
            &destination.remote_path,
            source_name,
            transfer_id,
            Some(TransferProgress {
                base_bytes: 0,
                total_bytes,
            }),
            cancellation,
        )
        .await
    }

    async fn upload_remote_file(
        &self,
        local_path: &Path,
        remote_name: &str,
        remote_directory: &str,
        file_name: &str,
        transfer_id: Option<u64>,
        progress: Option<TransferProgress>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<()> {
        ensure_not_canceled_if(cancellation)?;
        if ignored_upload_name(file_name) {
            if let Some(transfer_id) = transfer_id {
                let _ = self
                    .transfers
                    .update_detail(
                        transfer_id,
                        format!("Skipped provider-disallowed metadata item {file_name}"),
                    )
                    .await;
            }
            return Ok(());
        }
        let response = self
            .proxy
            .upload_file_with_cancellation(
                remote_name,
                remote_directory,
                local_path,
                file_name,
                cancellation,
            )
            .await?;
        let start: RemoteJobStart = response_json(response, "start remote upload").await?;
        self.wait_for_job(&start.job_id, transfer_id, progress, cancellation)
            .await?;
        Ok(())
    }

    async fn upload_remote_directory(
        &self,
        local_path: &Path,
        remote_name: &str,
        remote_directory: &str,
        directory_name: &str,
        transfer_id: Option<u64>,
        progress: Option<TransferProgress>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<()> {
        ensure_not_canceled_if(cancellation)?;
        if ignored_upload_name(directory_name) {
            if let Some(transfer_id) = transfer_id {
                let _ = self
                    .transfers
                    .update_detail(
                        transfer_id,
                        format!("Skipped provider-disallowed metadata item {directory_name}"),
                    )
                    .await;
            }
            return Ok(());
        }
        let response = self
            .proxy
            .upload_directory_with_cancellation(
                remote_name,
                remote_directory,
                local_path,
                directory_name,
                cancellation,
            )
            .await?;
        let start: RemoteJobStart =
            response_json(response, "start remote directory upload").await?;
        self.wait_for_job(&start.job_id, transfer_id, progress, cancellation)
            .await?;
        Ok(())
    }

    async fn create_remote_directory(
        &self,
        remote_name: &str,
        remote_path: &str,
        transfer_id: Option<u64>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<()> {
        self.start_json_job(
            "/api/remote/file/mkdir",
            serde_json::json!({ "remote": remote_name, "path": remote_path }),
            transfer_id,
            cancellation,
        )
        .await?;
        Ok(())
    }

    async fn download_remote_item(
        &self,
        source: &RemoteBrowseTarget,
        is_directory: bool,
        destination: &Path,
        transfer_id: Option<u64>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<()> {
        ensure_not_canceled_if(cancellation)?;
        if !is_directory {
            return self
                .download_remote_file(source, destination, transfer_id, cancellation)
                .await;
        }

        self.download_remote_directory(source, destination, transfer_id, cancellation)
            .await
    }

    async fn download_remote_file(
        &self,
        source: &RemoteBrowseTarget,
        destination: &Path,
        transfer_id: Option<u64>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<()> {
        ensure_not_canceled_if(cancellation)?;
        let mut direct_download_error = None;
        match self
            .proxy
            .start_download_to_file_with_cancellation(
                &source.remote_name,
                &source.remote_path,
                destination,
                cancellation,
            )
            .await
        {
            Ok(Some(response)) => {
                let direct_result = async {
                    let start: RemoteJobStart =
                        response_json(response, "start embedded remote download").await?;
                    self.wait_for_job(&start.job_id, transfer_id, None, cancellation)
                        .await?;
                    ensure_not_canceled_if(cancellation)?;
                    if downloaded_file_exists(destination).await {
                        return Ok(());
                    }
                    Err(ApiError::Message(format!(
                        "Embedded direct download completed but did not create {}",
                        destination.display()
                    )))
                }
                .await;
                match direct_result {
                    Ok(()) => return Ok(()),
                    Err(error) => direct_download_error = Some(error.to_string()),
                }
            }
            Ok(None) => {}
            Err(error) => direct_download_error = Some(error.to_string()),
        }
        let response = self
            .proxy
            .get_with_query(
                "/api/remote/file/download",
                &[
                    ("remote", source.remote_name.as_str()),
                    ("path", source.remote_path.as_str()),
                ],
            )
            .await?;
        let start: RemoteJobStart = response_json(response, "start remote download").await?;
        self.wait_for_job(&start.job_id, transfer_id, None, cancellation)
            .await?;
        ensure_not_canceled_if(cancellation)?;
        self.proxy
            .download_to_file_with_cancellation(
                &format!("/api/remote/file/jobs/{}/result/download", start.job_id),
                destination,
                cancellation,
            )
            .await?;
        ensure_not_canceled_if(cancellation)?;
        if downloaded_file_exists(destination).await {
            return Ok(());
        }
        let detail = direct_download_error
            .map(|error| format!(" Direct download also failed: {error}"))
            .unwrap_or_default();
        Err(ApiError::Message(format!(
            "Remote download completed but did not create {}.{detail}",
            destination.display()
        )))
    }

    async fn download_remote_directory(
        &self,
        source: &RemoteBrowseTarget,
        destination: &Path,
        transfer_id: Option<u64>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<()> {
        ensure_not_canceled_if(cancellation)?;
        match self
            .proxy
            .start_download_directory_to_path_with_cancellation(
                &source.remote_name,
                &source.remote_path,
                destination,
                cancellation,
            )
            .await?
        {
            Some(response) => {
                let start: RemoteJobStart =
                    response_json(response, "start embedded remote directory download").await?;
                self.wait_for_job(&start.job_id, transfer_id, None, cancellation)
                    .await?;
                ensure_not_canceled_if(cancellation)?;
                if downloaded_directory_exists(destination).await {
                    Ok(())
                } else {
                    Err(ApiError::Message(format!(
                        "Embedded direct download completed but did not create {}",
                        destination.display()
                    )))
                }
            }
            None => Err(ApiError::Message(
                "Embedded direct directory download is unavailable.".to_string(),
            )),
        }
    }

    async fn fetch_remote_items(
        &self,
        target: &RemoteBrowseTarget,
    ) -> ApiResult<Vec<RemoteListItem>> {
        let response = self
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
        self.wait_for_job(&start.job_id, None, None, None).await?;
        let response = self
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
        let items = serde_json::from_str::<Vec<RemoteListItem>>(&body).map_err(|error| {
            ApiError::Message(format!("Failed to parse remote list result: {error}"))
        })?;
        let items = dedupe_remote_list_items(target, items)?;
        let cache_body = serde_json::to_vec(&items).map_err(|error| {
            ApiError::Message(format!("Failed to encode remote list cache: {error}"))
        })?;
        self.listing_cache
            .save(&target.remote_name, &target.remote_path, &cache_body)
            .await?;
        Ok(items)
    }

    async fn delete_remote_target(
        &self,
        target: &RemoteBrowseTarget,
        transfer_id: Option<u64>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<()> {
        ensure_not_canceled_if(cancellation)?;
        let response = self
            .proxy
            .delete_with_query(
                "/api/remote/file",
                &[
                    ("remote", target.remote_name.as_str()),
                    ("path", target.remote_path.as_str()),
                ],
            )
            .await?;
        let start: RemoteJobStart = response_json(response, "start remote delete").await?;
        self.wait_for_job(&start.job_id, transfer_id, None, cancellation)
            .await?;
        self.listing_cache
            .clear(&target.remote_name, &target.remote_path)
            .await?;
        self.listing_cache
            .clear(
                &target.remote_name,
                &remote_parent_path(&target.remote_path),
            )
            .await?;
        Ok(())
    }

    async fn wait_for_job(
        &self,
        job_id: &str,
        transfer_id: Option<u64>,
        progress: Option<TransferProgress>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<RemoteJobStatus> {
        let started_at = Instant::now();
        let mut last_activity_at = started_at;
        let mut last_signature = String::new();
        loop {
            if cancellation.is_some_and(|token| token.load(Ordering::SeqCst)) {
                let _ = self.cancel_remote_job(job_id).await;
                return Err(ApiError::Message("Operation canceled.".to_string()));
            }
            let elapsed = started_at.elapsed();
            if elapsed > REMOTE_JOB_MAX_WAIT {
                let _ = self.cancel_remote_job(job_id).await;
                return Err(ApiError::Message(format!(
                    "Remote operation timed out after {} hours",
                    REMOTE_JOB_MAX_WAIT.as_secs() / 3600
                )));
            }
            if last_activity_at.elapsed() > REMOTE_JOB_STALE_TIMEOUT {
                let _ = self.cancel_remote_job(job_id).await;
                return Err(ApiError::Message(format!(
                    "Remote operation timed out after {} minutes without progress",
                    REMOTE_JOB_STALE_TIMEOUT.as_secs() / 60
                )));
            }
            let response = self
                .proxy
                .get(&format!("/api/remote/file/jobs/{job_id}"))
                .await?;
            let status: RemoteJobStatus = response_json(response, "poll remote job").await?;
            let signature = format!(
                "{}:{}:{}:{}:{}",
                status.state,
                status.phase,
                status.bytes_completed,
                status.bytes_total,
                status.message
            );
            if signature != last_signature {
                last_signature = signature;
                last_activity_at = Instant::now();
            }
            if let Some(transfer_id) = transfer_id {
                let _ = self
                    .transfers
                    .update_progress_with_speed(
                        transfer_id,
                        remote_job_transferred_bytes(&status, progress),
                        remote_job_total_bytes(&status, progress),
                        status.bytes_per_second,
                    )
                    .await;
                let detail = if status.message.is_empty() {
                    status.phase.clone()
                } else {
                    status.message.clone()
                };
                if !detail.is_empty() {
                    let _ = self.transfers.update_detail(transfer_id, detail).await;
                }
            }
            match status.state.as_str() {
                "succeeded" => return Ok(status),
                "failed" | "canceled" | "cancelled" => {
                    let message = if status.message.is_empty() {
                        format!("Remote {} job {}", status.operation, status.state)
                    } else {
                        status.message
                    };
                    return Err(ApiError::Message(message));
                }
                _ => tokio::time::sleep(Duration::from_millis(150)).await,
            }
        }
    }

    async fn cancel_remote_job(&self, job_id: &str) -> ApiResult<()> {
        let path = remote_job_path(job_id);
        #[cfg(test)]
        if let Some(log) = &self.remote_job_cancellation_log {
            log.lock().await.push(format!("DELETE {path}"));
            return Ok(());
        }
        let response = self.proxy.delete(&path).await?;
        if response.status().is_success() || response.status().as_u16() == 404 {
            Ok(())
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(ApiError::Message(if body.is_empty() {
                format!(
                    "Failed to cancel remote job {job_id} (HTTP {})",
                    status.as_u16()
                )
            } else {
                body
            }))
        }
    }

    async fn start_json_job(
        &self,
        path: &str,
        body: serde_json::Value,
        transfer_id: Option<u64>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<RemoteJobStatus> {
        ensure_not_canceled_if(cancellation)?;
        let response = self.proxy.post_json(path, &body).await?;
        let start: RemoteJobStart = response_json(response, "start remote operation").await?;
        if start.job_id.trim().is_empty() {
            return Err(ApiError::Message(
                "Remote operation did not return a job id".to_string(),
            ));
        }
        self.wait_for_job(&start.job_id, transfer_id, None, cancellation)
            .await
    }

    async fn begin_transfer(&self, record: FileTransferRecord) -> Option<u64> {
        self.transfers.start_transfer(record).await.ok()
    }

    async fn finish_transfer<T>(
        &self,
        transfer_id: Option<u64>,
        result: ApiResult<T>,
    ) -> ApiResult<T> {
        match result {
            Ok(value) => {
                if let Some(transfer_id) = transfer_id {
                    let _ = self.transfers.complete_transfer(transfer_id).await;
                }
                Ok(value)
            }
            Err(error) => {
                if let Some(transfer_id) = transfer_id {
                    if is_cancellation_error(&error) {
                        let _ = self
                            .transfers
                            .cancel_transfer(transfer_id, "Canceled".to_string())
                            .await;
                    } else {
                        let _ = self
                            .transfers
                            .fail_transfer(transfer_id, error.to_string())
                            .await;
                    }
                }
                Err(error)
            }
        }
    }

    async fn finish_transfers<T>(
        &self,
        transfer_ids: &[u64],
        result: ApiResult<T>,
    ) -> ApiResult<T> {
        match result {
            Ok(value) => {
                for transfer_id in transfer_ids {
                    let _ = self.transfers.complete_transfer(*transfer_id).await;
                }
                Ok(value)
            }
            Err(error) => {
                let message = error.to_string();
                for transfer_id in transfer_ids {
                    if is_cancellation_error(&error) {
                        let _ = self
                            .transfers
                            .cancel_transfer(*transfer_id, "Canceled".to_string())
                            .await;
                    } else {
                        let _ = self
                            .transfers
                            .fail_transfer(*transfer_id, message.clone())
                            .await;
                    }
                }
                Err(error)
            }
        }
    }

    fn remote_target(&self, path: &str) -> Option<RemoteBrowseTarget> {
        RemoteBrowseTarget::from_virtual_path(&self.mount_root, Path::new(path))
    }

    pub fn remote_target_for_path(&self, path: &str) -> Option<RemoteBrowseTarget> {
        self.remote_target(path)
    }

    fn reject_virtual_mount_container(&self, path: &str, operation: &str) -> ApiResult<()> {
        let path = Path::new(path);
        if path == self.mount_root || path.starts_with(&self.mount_root) {
            return Err(ApiError::Message(format!(
                "Remote {operation} is not available in this migration build yet."
            )));
        }
        Ok(())
    }
}

#[cfg(target_os = "android")]
fn android_local_location_entry(
    location: &tauri_plugin_document_tree::DocumentTreeLocation,
) -> FileEntry {
    let path = format!(
        "{VIRTUAL_PATH_LOCAL}/{}",
        android_local_location_id(&location.uri)
    );
    FileEntry {
        id: path.clone(),
        name: location.name.clone(),
        path,
        extension: String::new(),
        mime_type: None,
        remote_modified: None,
        kind: FileKind::Folder,
        size_bytes: None,
        modified_ms: None,
        created_ms: None,
        readonly: !location.can_write,
        hidden: false,
        is_deleted: false,
        location: ExplorerLocation::local(),
    }
}

#[cfg(target_os = "android")]
fn android_local_location_id(uri: &str) -> String {
    let digest = Sha256::digest(uri.as_bytes());
    hex::encode(&digest[..8])
}

#[cfg(target_os = "android")]
fn parse_android_local_path(path: &str) -> ApiResult<(String, Option<String>)> {
    let remainder = path
        .strip_prefix(VIRTUAL_PATH_LOCAL)
        .and_then(|value| value.strip_prefix('/'))
        .ok_or_else(|| ApiError::Message("Invalid Android local folder path.".to_owned()))?;
    let segments = remainder
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    let location_id = segments
        .first()
        .filter(|value| {
            value.len() == 16 && value.chars().all(|character| character.is_ascii_hexdigit())
        })
        .ok_or_else(|| ApiError::Message("Invalid Android local folder location.".to_owned()))?
        .to_string();
    let document_id = segments
        .last()
        .filter(|_| segments.len() > 1)
        .map(|segment| {
            URL_SAFE_NO_PAD
                .decode(segment)
                .map_err(|_| ApiError::Message("Invalid Android local folder entry.".to_owned()))
                .and_then(|bytes| {
                    String::from_utf8(bytes).map_err(|_| {
                        ApiError::Message("Invalid Android local folder entry.".to_owned())
                    })
                })
        })
        .transpose()?;
    Ok((location_id, document_id))
}

#[cfg(target_os = "android")]
fn android_local_child_path(parent_path: &str, document_id: &str) -> String {
    format!(
        "{parent_path}/{}",
        URL_SAFE_NO_PAD.encode(document_id.as_bytes())
    )
}

async fn local_item_size(path: &Path, is_directory: bool) -> i64 {
    if !is_directory {
        return tokio::fs::metadata(path)
            .await
            .ok()
            .map(|metadata| metadata.len().min(i64::MAX as u64) as i64)
            .unwrap_or_default();
    }

    let mut total = 0_i64;
    let mut pending = vec![path.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let mut children = match tokio::fs::read_dir(&directory).await {
            Ok(children) => children,
            Err(_) => continue,
        };
        while let Ok(Some(child)) = children.next_entry().await {
            let child_name = child.file_name().to_string_lossy().to_string();
            if ignored_upload_name(&child_name) {
                continue;
            }
            let metadata = match child.metadata().await {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            if metadata.is_dir() {
                pending.push(child.path());
            } else if metadata.is_file() {
                total = total.saturating_add(metadata.len().min(i64::MAX as u64) as i64);
            }
        }
    }
    total
}

fn ignored_upload_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    name.starts_with('.')
        || name.starts_with("._")
        || name.starts_with("~$")
        || lower == "thumbs.db"
        || lower == "desktop.ini"
        || lower.ends_with(".swp")
        || lower.ends_with(".swo")
        || lower.ends_with(".tmp")
        || lower.ends_with(".temp")
        || lower.ends_with('~')
}

fn remote_job_transferred_bytes(
    status: &RemoteJobStatus,
    progress: Option<TransferProgress>,
) -> i64 {
    progress
        .map(|progress| {
            progress
                .base_bytes
                .saturating_add(status.bytes_completed.max(0))
        })
        .unwrap_or(status.bytes_completed)
}

fn remote_job_total_bytes(status: &RemoteJobStatus, progress: Option<TransferProgress>) -> i64 {
    progress
        .filter(|progress| progress.total_bytes > 0)
        .map(|progress| progress.total_bytes)
        .unwrap_or(status.bytes_total)
}

fn validate_remote_name(name: &str) -> ApiResult<&str> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.contains('/') || trimmed.contains('\\') {
        return Err(ApiError::Message(
            "Names cannot be empty or contain path separators.".to_string(),
        ));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(ApiError::Message("Choose a different name.".to_string()));
    }
    Ok(trimmed)
}

fn remote_parent_path(path: &str) -> String {
    let parent = Path::new(path)
        .parent()
        .and_then(|value| value.to_str())
        .unwrap_or("/");
    if parent.is_empty() {
        "/".to_string()
    } else {
        parent.to_string()
    }
}

fn remote_item_is_directory(
    parent: &RemoteBrowseTarget,
    target_path: &str,
    items: &[RemoteListItem],
) -> ApiResult<Option<bool>> {
    for item in items {
        if parent.child_remote_path(item)? == target_path {
            return Ok(Some(item.is_dir));
        }
    }
    Ok(None)
}

fn is_remote_directory_not_found_error(error: &ApiError) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    message.contains("directory not found")
        || message.contains("object not found")
        || message.contains("invalidresourceid")
        || message.contains("objecthandle is invalid")
}

fn remote_preview_metadata_from_items(
    parent: &RemoteBrowseTarget,
    target_path: &str,
    items: &[RemoteListItem],
) -> ApiResult<Option<(i64, String)>> {
    for item in items {
        if parent.child_remote_path(item)? != target_path {
            continue;
        }
        if item.is_dir {
            return Err(ApiError::Message(
                "Only files can be previewed.".to_string(),
            ));
        }
        return Ok(Some((item.size, item.mod_time.clone())));
    }
    Ok(None)
}

fn dedupe_remote_list_items(
    parent: &RemoteBrowseTarget,
    items: Vec<RemoteListItem>,
) -> ApiResult<Vec<RemoteListItem>> {
    let mut seen_paths = BTreeSet::new();
    let mut deduped = Vec::with_capacity(items.len());
    for item in items {
        let child_path = parent.child_remote_path(&item)?;
        if seen_paths.insert(child_path) {
            deduped.push(item);
        }
    }
    Ok(deduped)
}

async fn ensure_destination_available(path: &Path) -> ApiResult<()> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(_) => Err(ApiError::Message(format!(
            "{} already exists.",
            path.display()
        ))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ApiError::Message(format!(
            "Failed to inspect {}: {error}",
            path.display()
        ))),
    }
}

async fn normalize_existing_local_dir(path: &str) -> ApiResult<PathBuf> {
    let path = PathBuf::from(path);
    let canonical = tokio::fs::canonicalize(&path).await.map_err(|error| {
        ApiError::Message(format!(
            "Failed to resolve directory {}: {error}",
            path.display()
        ))
    })?;
    let metadata = tokio::fs::metadata(&canonical).await.map_err(|error| {
        ApiError::Message(format!(
            "Failed to inspect {}: {error}",
            canonical.display()
        ))
    })?;
    if !metadata.is_dir() {
        return Err(ApiError::Message(format!(
            "{} is not a directory.",
            canonical.display()
        )));
    }
    Ok(canonical)
}

fn validate_local_file_name(name: &str) -> ApiResult<&str> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ApiError::Message("Enter a name.".to_string()));
    }
    let path = Path::new(trimmed);
    let mut components = path.components();
    match (components.next(), components.next()) {
        (Some(std::path::Component::Normal(_)), None) => Ok(trimmed),
        _ => Err(ApiError::Message(
            "Names cannot contain path separators.".to_string(),
        )),
    }
}

async fn create_local_item_cancellable(
    request: CreateItemRequest,
    cancellation: Option<&AtomicBool>,
) -> ApiResult<ExplorerOperationResult> {
    ensure_not_canceled_if(cancellation)?;
    let directory = normalize_existing_local_dir(&request.directory).await?;
    let name = validate_local_file_name(&request.name)?;
    let path = directory.join(name);
    ensure_destination_available(&path).await?;
    ensure_not_canceled_if(cancellation)?;
    let is_directory = matches!(request.kind, crate::core::explorer::CreateItemKind::Folder);
    let operation = if is_directory {
        tokio::fs::create_dir(&path).await
    } else {
        tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .await
            .map(|_| ())
    };
    operation.map_err(|error| {
        ApiError::Message(format!(
            "Failed to create {} {}: {error}",
            if is_directory { "folder" } else { "file" },
            path.display()
        ))
    })?;
    observe_local_mutation_for_cancellation().await;
    if let Err(error) = ensure_not_canceled_if(cancellation) {
        let _ = remove_local_path(&path, is_directory).await;
        return Err(error);
    }
    Ok(ExplorerOperationResult {
        affected_paths: vec![display_path(&path)],
        parent_path: Some(display_path(&directory)),
    })
}

async fn rename_local_item_cancellable(
    request: RenameItemRequest,
    cancellation: Option<&AtomicBool>,
) -> ApiResult<ExplorerOperationResult> {
    ensure_not_canceled_if(cancellation)?;
    let path = PathBuf::from(&request.path);
    tokio::fs::symlink_metadata(&path).await.map_err(|error| {
        ApiError::Message(format!("Failed to inspect {}: {error}", path.display()))
    })?;
    let parent = path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| ApiError::Message("Cannot rename a filesystem root.".to_string()))?;
    let name = validate_local_file_name(&request.new_name)?;
    let destination = parent.join(name);
    ensure_destination_available(&destination).await?;
    ensure_not_canceled_if(cancellation)?;
    tokio::fs::rename(&path, &destination)
        .await
        .map_err(|error| {
            ApiError::Message(format!(
                "Failed to rename {} to {}: {error}",
                path.display(),
                destination.display()
            ))
        })?;
    observe_local_mutation_for_cancellation().await;
    if let Err(error) = ensure_not_canceled_if(cancellation) {
        let _ = tokio::fs::rename(&destination, &path).await;
        return Err(error);
    }
    Ok(ExplorerOperationResult {
        affected_paths: vec![display_path(&destination)],
        parent_path: Some(display_path(&parent)),
    })
}

#[cfg(test)]
async fn observe_local_mutation_for_cancellation() {
    tokio::time::sleep(Duration::from_millis(10)).await;
}

#[cfg(not(test))]
async fn observe_local_mutation_for_cancellation() {
    tokio::task::yield_now().await;
}

async fn copy_local_path_cancellable(
    source: &Path,
    destination: &Path,
    cancellation: &AtomicBool,
) -> ApiResult<()> {
    ensure_not_canceled(cancellation)?;
    let metadata = tokio::fs::symlink_metadata(source).await.map_err(|error| {
        ApiError::Message(format!("Failed to inspect {}: {error}", source.display()))
    })?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        copy_local_directory_cancellable(source, destination, cancellation).await
    } else {
        copy_local_file_cancellable(source, destination, cancellation).await
    }
}

async fn copy_cached_remote_file_to_destination(
    source: &Path,
    destination: &Path,
    cancellation: Option<&AtomicBool>,
) -> ApiResult<()> {
    ensure_not_canceled_if(cancellation)?;
    tokio::fs::copy(source, destination)
        .await
        .map_err(|error| {
            ApiError::Message(format!(
                "Failed to copy cached remote file from {} to {}: {error}",
                source.display(),
                destination.display()
            ))
        })?;
    ensure_not_canceled_if(cancellation)?;
    Ok(())
}

async fn copy_local_directory_cancellable(
    source: &Path,
    destination: &Path,
    cancellation: &AtomicBool,
) -> ApiResult<()> {
    tokio::fs::create_dir(destination).await.map_err(|error| {
        ApiError::Message(format!(
            "Failed to create folder {}: {error}",
            destination.display()
        ))
    })?;

    let mut pending = vec![(source.to_path_buf(), destination.to_path_buf())];
    while let Some((current_source, current_destination)) = pending.pop() {
        ensure_not_canceled(cancellation)?;
        let mut entries = tokio::fs::read_dir(&current_source)
            .await
            .map_err(|error| {
                ApiError::Message(format!(
                    "Failed to read folder {}: {error}",
                    current_source.display()
                ))
            })?;
        while let Some(entry) = entries.next_entry().await.map_err(|error| {
            ApiError::Message(format!(
                "Failed to read folder {}: {error}",
                current_source.display()
            ))
        })? {
            ensure_not_canceled(cancellation)?;
            let child_source = entry.path();
            let child_destination = current_destination.join(entry.file_name());
            let metadata = tokio::fs::symlink_metadata(&child_source)
                .await
                .map_err(|error| {
                    ApiError::Message(format!(
                        "Failed to inspect {}: {error}",
                        child_source.display()
                    ))
                })?;
            if metadata.is_dir() && !metadata.file_type().is_symlink() {
                tokio::fs::create_dir(&child_destination)
                    .await
                    .map_err(|error| {
                        ApiError::Message(format!(
                            "Failed to create folder {}: {error}",
                            child_destination.display()
                        ))
                    })?;
                pending.push((child_source, child_destination));
            } else {
                copy_local_file_cancellable(&child_source, &child_destination, cancellation)
                    .await?;
            }
        }
    }
    Ok(())
}

async fn copy_local_file_cancellable(
    source: &Path,
    destination: &Path,
    cancellation: &AtomicBool,
) -> ApiResult<()> {
    ensure_not_canceled(cancellation)?;
    if let Some(parent) = destination.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|error| {
            ApiError::Message(format!("Failed to create {}: {error}", parent.display()))
        })?;
    }
    let mut input = tokio::fs::File::open(source).await.map_err(|error| {
        ApiError::Message(format!("Failed to open {}: {error}", source.display()))
    })?;
    let mut output = tokio::fs::File::create(destination)
        .await
        .map_err(|error| {
            ApiError::Message(format!(
                "Failed to create {}: {error}",
                destination.display()
            ))
        })?;
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        ensure_not_canceled(cancellation)?;
        let read = input.read(&mut buffer).await.map_err(|error| {
            ApiError::Message(format!("Failed to read {}: {error}", source.display()))
        })?;
        if read == 0 {
            break;
        }
        output.write_all(&buffer[..read]).await.map_err(|error| {
            ApiError::Message(format!(
                "Failed to write {}: {error}",
                destination.display()
            ))
        })?;
        tokio::task::yield_now().await;
    }
    ensure_not_canceled(cancellation)?;
    output.flush().await.map_err(|error| {
        ApiError::Message(format!(
            "Failed to flush {}: {error}",
            destination.display()
        ))
    })?;
    Ok(())
}

async fn move_local_path_cancellable(
    source: &Path,
    destination: &Path,
    cancellation: &AtomicBool,
) -> ApiResult<()> {
    ensure_not_canceled(cancellation)?;
    match tokio::fs::rename(source, destination).await {
        Ok(()) => Ok(()),
        Err(rename_error) => {
            copy_local_path_cancellable(source, destination, cancellation).await?;
            ensure_not_canceled(cancellation)?;
            let metadata = tokio::fs::symlink_metadata(source).await.map_err(|error| {
                ApiError::Message(format!("Failed to inspect {}: {error}", source.display()))
            })?;
            let remove = if metadata.is_dir() && !metadata.file_type().is_symlink() {
                tokio::fs::remove_dir_all(source).await
            } else {
                tokio::fs::remove_file(source).await
            };
            remove.map_err(|error| {
                ApiError::Message(format!(
                    "Moved copy to {}, but failed to remove source {} after rename failed ({rename_error}): {error}",
                    destination.display(),
                    source.display()
                ))
            })
        }
    }
}

async fn trash_local_path_cancellable(
    source: &Path,
    trash_dir: &Path,
    cancellation: Option<&AtomicBool>,
) -> ApiResult<PathBuf> {
    ensure_not_canceled_if(cancellation)?;
    tokio::fs::symlink_metadata(source).await.map_err(|error| {
        ApiError::Message(format!("Failed to inspect {}: {error}", source.display()))
    })?;
    if source == trash_dir {
        return Err(ApiError::Message(
            "The Misty trash directory cannot be moved to Trash.".to_string(),
        ));
    }
    tokio::fs::create_dir_all(trash_dir)
        .await
        .map_err(|error| {
            ApiError::Message(format!(
                "Failed to create trash directory {}: {error}",
                trash_dir.display()
            ))
        })?;
    let destination = available_trash_destination(trash_dir, source)?;
    let uncanceled = AtomicBool::new(false);
    let cancellation = cancellation.unwrap_or(&uncanceled);
    move_local_path_cancellable(source, &destination, cancellation).await?;
    ensure_not_canceled(cancellation)?;
    Ok(destination)
}

fn available_trash_destination(trash_dir: &Path, source: &Path) -> ApiResult<PathBuf> {
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("item");
    let first_candidate = trash_dir.join(file_name);
    if !first_candidate.exists() {
        return Ok(first_candidate);
    }

    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(file_name);
    let extension = source.extension().and_then(|value| value.to_str());
    for index in 1..10_000 {
        let name = match extension {
            Some(extension) if !extension.is_empty() => format!("{stem} {index}.{extension}"),
            _ => format!("{stem} {index}"),
        };
        let candidate = trash_dir.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(ApiError::Message(format!(
        "Could not create a unique Trash name for {}.",
        source.display()
    )))
}

fn ensure_not_canceled(cancellation: &AtomicBool) -> ApiResult<()> {
    if cancellation.load(Ordering::SeqCst) {
        return Err(ApiError::Message("Operation canceled.".to_string()));
    }
    Ok(())
}

fn ensure_not_canceled_if(cancellation: Option<&AtomicBool>) -> ApiResult<()> {
    if let Some(cancellation) = cancellation {
        ensure_not_canceled(cancellation)?;
    }
    Ok(())
}

fn is_cancellation_error(error: &ApiError) -> bool {
    error
        .to_string()
        .eq_ignore_ascii_case("Operation canceled.")
}

fn nonzero_transfer_id(transfer_id: u64) -> Option<u64> {
    if transfer_id == 0 {
        None
    } else {
        Some(transfer_id)
    }
}

fn remote_job_path(job_id: &str) -> String {
    format!("/api/remote/file/jobs/{job_id}")
}

async fn cleanup_partial_destination_on_cancel<T>(
    destination: &Path,
    is_directory: bool,
    result: ApiResult<T>,
) -> ApiResult<T> {
    if result.as_ref().is_err_and(is_cancellation_error) {
        let _ = remove_local_path(destination, is_directory).await;
    }
    result
}

async fn downloaded_file_exists(destination: &Path) -> bool {
    tokio::fs::metadata(destination)
        .await
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
}

async fn downloaded_directory_exists(destination: &Path) -> bool {
    tokio::fs::metadata(destination)
        .await
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
}

async fn delete_local_path_cancellable(
    path: &Path,
    cancellation: Option<&AtomicBool>,
) -> ApiResult<()> {
    ensure_not_canceled_if(cancellation)?;
    let metadata = tokio::fs::symlink_metadata(path).await.map_err(|error| {
        ApiError::Message(format!("Failed to inspect {}: {error}", path.display()))
    })?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        tokio::fs::remove_file(path).await.map_err(|error| {
            ApiError::Message(format!("Failed to delete file {}: {error}", path.display()))
        })?;
        return Ok(());
    }

    let mut stack = vec![(path.to_path_buf(), false)];
    while let Some((current, visited)) = stack.pop() {
        ensure_not_canceled_if(cancellation)?;
        let metadata = match tokio::fs::symlink_metadata(&current).await {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(ApiError::Message(format!(
                    "Failed to inspect {}: {error}",
                    current.display()
                )));
            }
        };
        if metadata.is_dir() && !metadata.file_type().is_symlink() {
            if visited {
                tokio::fs::remove_dir(&current).await.map_err(|error| {
                    ApiError::Message(format!(
                        "Failed to delete folder {}: {error}",
                        current.display()
                    ))
                })?;
            } else {
                stack.push((current.clone(), true));
                let mut children = tokio::fs::read_dir(&current).await.map_err(|error| {
                    ApiError::Message(format!("Failed to read {}: {error}", current.display()))
                })?;
                while let Some(child) = children.next_entry().await.map_err(|error| {
                    ApiError::Message(format!("Failed to read {}: {error}", current.display()))
                })? {
                    ensure_not_canceled_if(cancellation)?;
                    stack.push((child.path(), false));
                }
            }
        } else {
            tokio::fs::remove_file(&current).await.map_err(|error| {
                ApiError::Message(format!(
                    "Failed to delete file {}: {error}",
                    current.display()
                ))
            })?;
        }
    }
    Ok(())
}

async fn remove_local_path(path: &Path, is_directory: bool) -> ApiResult<()> {
    let result = if is_directory {
        tokio::fs::remove_dir_all(path).await
    } else {
        tokio::fs::remove_file(path).await
    };
    result
        .map_err(|error| ApiError::Message(format!("Failed to remove {}: {error}", path.display())))
}

async fn response_json<T>(response: StorageResponse, operation: &str) -> ApiResult<T>
where
    T: serde::de::DeserializeOwned,
{
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(ApiError::Message(if body.is_empty() {
            format!("Failed to {operation} (HTTP {})", status.as_u16())
        } else {
            body
        }));
    }
    serde_json::from_str(&body).map_err(|error| {
        ApiError::Message(format!("Failed to parse {operation} response: {error}"))
    })
}

fn virtual_folder_entry(path: PathBuf, name: String, location: ExplorerLocation) -> FileEntry {
    FileEntry {
        id: display_path(&path),
        name: name.clone(),
        path: display_path(&path),
        extension: String::new(),
        mime_type: None,
        remote_modified: None,
        kind: FileKind::Folder,
        size_bytes: None,
        modified_ms: None,
        created_ms: None,
        readonly: false,
        hidden: name.starts_with('.'),
        is_deleted: false,
        location,
    }
}

fn trash_virtual_entries(trash_dir: &Path) -> ApiResult<Vec<FileEntry>> {
    if !trash_dir.exists() {
        return Ok(Vec::new());
    }
    let read_dir = std::fs::read_dir(trash_dir).map_err(|err| {
        ApiError::Message(format!(
            "Failed to list trash directory {}: {err}",
            trash_dir.display()
        ))
    })?;
    let mut entries = Vec::new();
    for item in read_dir {
        let item = match item {
            Ok(item) => item,
            Err(_) => continue,
        };
        let path = item.path();
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let name = item.file_name().to_string_lossy().to_string();
        let file_type = metadata.file_type();
        let kind = if file_type.is_symlink() {
            FileKind::Symlink
        } else if file_type.is_dir() {
            FileKind::Folder
        } else if file_type.is_file() {
            FileKind::File
        } else {
            FileKind::Other
        };
        entries.push(FileEntry {
            id: display_path(&path),
            name: name.clone(),
            path: display_path(&path),
            extension: path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string(),
            mime_type: None,
            remote_modified: None,
            kind,
            size_bytes: if metadata.is_file() {
                Some(metadata.len())
            } else {
                None
            },
            modified_ms: metadata.modified().ok().and_then(service_system_time_ms),
            created_ms: metadata.created().ok().and_then(service_system_time_ms),
            readonly: metadata.permissions().readonly(),
            hidden: name.starts_with('.'),
            is_deleted: true,
            location: ExplorerLocation::local(),
        });
    }
    entries.sort_by(|left, right| {
        virtual_folder_rank(&left.kind)
            .cmp(&virtual_folder_rank(&right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

fn service_system_time_ms(time: std::time::SystemTime) -> Option<i64> {
    let duration = time.duration_since(UNIX_EPOCH).ok()?;
    Some(duration.as_millis().try_into().ok()?)
}

fn virtual_folder_rank(kind: &FileKind) -> u8 {
    match kind {
        FileKind::Folder => 0,
        FileKind::Symlink => 1,
        FileKind::File => 2,
        FileKind::Other => 3,
    }
}

#[derive(Clone, Copy)]
enum PreviewFormat {
    Image(image::ImageFormat),
    Direct(&'static str),
    TranscodeImage(image::ImageFormat),
    Pdf,
    Psd,
}

struct ImageThumbnailIdentity {
    path: String,
    size_bytes: u64,
    modified_fingerprint: Option<String>,
}

impl ImageThumbnailIdentity {
    fn from_metadata(path: &Path, metadata: &std::fs::Metadata) -> Self {
        Self {
            path: display_path(path),
            size_bytes: metadata.len(),
            modified_fingerprint: metadata
                .modified()
                .ok()
                .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis().to_string()),
        }
    }
}

fn preview_format(path: &Path) -> Option<PreviewFormat> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some(PreviewFormat::Image(image::ImageFormat::Png)),
        "jpg" | "jpeg" => Some(PreviewFormat::Image(image::ImageFormat::Jpeg)),
        "gif" => Some(PreviewFormat::Image(image::ImageFormat::Gif)),
        "bmp" => Some(PreviewFormat::Image(image::ImageFormat::Bmp)),
        "webp" => Some(PreviewFormat::Image(image::ImageFormat::WebP)),
        "svg" => Some(PreviewFormat::Direct("image/svg+xml")),
        "pdf" => Some(PreviewFormat::Pdf),
        "psd" => Some(PreviewFormat::Psd),
        "txt" | "text" | "log" | "md" | "markdown" | "toml" | "yaml" | "yml" | "ini" | "conf"
        | "cfg" | "csv" | "tsv" | "rs" | "go" | "js" | "jsx" | "ts" | "tsx" | "css" | "html"
        | "xml" | "sh" | "zsh" | "bash" | "fish" | "py" | "rb" | "java" | "c" | "h" | "cpp"
        | "hpp" | "swift" | "kt" | "sql" => {
            Some(PreviewFormat::Direct("text/plain; charset=utf-8"))
        }
        "json" | "jsonc" => Some(PreviewFormat::Direct("application/json; charset=utf-8")),
        "tga" => Some(PreviewFormat::TranscodeImage(image::ImageFormat::Tga)),
        "hdr" | "pic" => Some(PreviewFormat::TranscodeImage(image::ImageFormat::Hdr)),
        "pbm" | "pgm" | "pnm" | "ppm" => {
            Some(PreviewFormat::TranscodeImage(image::ImageFormat::Pnm))
        }
        _ => None,
    }
}

fn image_thumbnail_format(path: &Path) -> Option<PreviewFormat> {
    match preview_format(path)? {
        PreviewFormat::Image(format) => Some(PreviewFormat::Image(format)),
        PreviewFormat::TranscodeImage(format) => Some(PreviewFormat::TranscodeImage(format)),
        PreviewFormat::Psd => Some(PreviewFormat::Psd),
        PreviewFormat::Direct(_) | PreviewFormat::Pdf => None,
    }
}

fn normalize_image_thumbnail_dimension(max_dimension: u32) -> u32 {
    let dimension = if max_dimension == 0 {
        DEFAULT_IMAGE_THUMBNAIL_DIMENSION
    } else {
        max_dimension
    };
    dimension.clamp(1, MAX_GENERATED_IMAGE_THUMBNAIL_DIMENSION)
}

fn normalize_image_preview_dimension(max_dimension: u32) -> u32 {
    let dimension = if max_dimension == 0 {
        MAX_IMAGE_PREVIEW_DIMENSION
    } else {
        max_dimension
    };
    dimension.clamp(1, MAX_IMAGE_PREVIEW_DIMENSION)
}

fn image_thumbnail_cache_path(
    cache_dir: &Path,
    identity: &ImageThumbnailIdentity,
    max_dimension: u32,
) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(identity.path.as_bytes());
    hasher.update([0]);
    hasher.update(identity.size_bytes.to_le_bytes());
    hasher.update([0]);
    if let Some(modified_fingerprint) = &identity.modified_fingerprint {
        hasher.update(modified_fingerprint.as_bytes());
    }
    hasher.update([0]);
    hasher.update(max_dimension.to_le_bytes());
    let digest = hasher.finalize();
    cache_dir.join(format!(
        "misty-image-thumb-{}-{}.png",
        max_dimension,
        hex::encode(&digest[..16])
    ))
}

fn thumbnail_decode_limits() -> Limits {
    Limits::no_limits()
}

fn validate_image_thumbnail_source(width: u32, height: u32) -> ApiResult<()> {
    if width == 0 || height == 0 {
        return Err(ApiError::Message(
            "Image dimensions are invalid.".to_string(),
        ));
    }

    Ok(())
}

fn image_dimensions(path: &Path) -> ApiResult<(u32, u32)> {
    let mut reader = ImageReader::open(path)
        .map_err(|error| {
            ApiError::Message(format!(
                "Failed to open image thumbnail source {}: {error}",
                path.display()
            ))
        })?
        .with_guessed_format()
        .map_err(|error| {
            ApiError::Message(format!(
                "Failed to detect image thumbnail format {}: {error}",
                path.display()
            ))
        })?;
    reader.limits(thumbnail_decode_limits());
    reader.into_dimensions().map_err(|error| {
        ApiError::Message(format!(
            "Failed to read image thumbnail dimensions {}: {error}",
            path.display()
        ))
    })
}

fn is_gif_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("gif"))
}

fn decode_gif_first_frame(path: &Path) -> ApiResult<image::DynamicImage> {
    let file = File::open(path).map_err(|error| {
        ApiError::Message(format!(
            "Failed to open GIF thumbnail source {}: {error}",
            path.display()
        ))
    })?;
    let mut decoder = GifDecoder::new(BufReader::new(file)).map_err(|error| {
        ApiError::Message(format!(
            "Failed to read GIF thumbnail source {}: {error}",
            path.display()
        ))
    })?;
    decoder
        .set_limits(thumbnail_decode_limits())
        .map_err(|error| {
            ApiError::Message(format!(
                "Failed to set GIF thumbnail limits {}: {error}",
                path.display()
            ))
        })?;

    let (screen_width, screen_height) = decoder.dimensions();
    if screen_width == 0 || screen_height == 0 {
        return Err(ApiError::Message("GIF dimensions are invalid.".to_string()));
    }

    let mut buffer = vec![0u8; decoder.total_bytes() as usize];
    decoder.read_image(&mut buffer).map_err(|error| {
        ApiError::Message(format!(
            "Failed to decode GIF thumbnail frame {}: {error}",
            path.display()
        ))
    })?;
    let rgba_image = image::RgbaImage::from_raw(screen_width, screen_height, buffer)
        .ok_or_else(|| ApiError::Message("GIF frame canvas size is invalid.".to_string()))?;
    Ok(image::DynamicImage::ImageRgba8(rgba_image))
}

fn decode_image_thumbnail_source(path: &Path) -> ApiResult<image::DynamicImage> {
    if is_gif_path(path) {
        return decode_gif_first_frame(path);
    }

    let mut reader = ImageReader::open(path)
        .map_err(|error| {
            ApiError::Message(format!(
                "Failed to open image thumbnail source {}: {error}",
                path.display()
            ))
        })?
        .with_guessed_format()
        .map_err(|error| {
            ApiError::Message(format!(
                "Failed to detect image thumbnail format {}: {error}",
                path.display()
            ))
        })?;
    reader.limits(thumbnail_decode_limits());
    reader.decode().map_err(|error| {
        ApiError::Message(format!(
            "Failed to decode image thumbnail source {}: {error}",
            path.display()
        ))
    })
}

fn temporary_image_thumbnail_path(output_path: &Path) -> PathBuf {
    let temporary_id = TEMPORARY_THUMBNAIL_COUNTER.fetch_add(1, Ordering::Relaxed);
    output_path.with_extension(format!("tmp-{temporary_id}"))
}

fn write_image_thumbnail_png(
    thumbnail: &image::DynamicImage,
    thumbnail_path: &Path,
) -> ApiResult<()> {
    let file = File::create(thumbnail_path).map_err(|error| {
        ApiError::Message(format!(
            "Failed to create image thumbnail {}: {error}",
            thumbnail_path.display()
        ))
    })?;
    let writer = BufWriter::new(file);
    let encoder = PngEncoder::new_with_quality(
        writer,
        IMAGE_THUMBNAIL_PNG_COMPRESSION,
        IMAGE_THUMBNAIL_PNG_FILTER,
    );
    thumbnail.write_with_encoder(encoder).map_err(|error| {
        ApiError::Message(format!(
            "Failed to write image thumbnail {}: {error}",
            thumbnail_path.display()
        ))
    })
}

#[cfg(target_os = "macos")]
fn render_image_thumbnail_with_system_tool(
    path: &Path,
    thumbnail_path: &Path,
    max_dimension: u32,
) -> ApiResult<bool> {
    let status = Command::new("/usr/bin/sips")
        .arg("-s")
        .arg("format")
        .arg("png")
        .arg("-Z")
        .arg(normalize_image_thumbnail_dimension(max_dimension).to_string())
        .arg(path)
        .arg("--out")
        .arg(thumbnail_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    if let Ok(status) = status {
        if status.success()
            && std::fs::metadata(thumbnail_path)
                .is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0)
        {
            return Ok(true);
        }
    }

    let _ = std::fs::remove_file(thumbnail_path);
    Ok(false)
}

#[cfg(not(target_os = "macos"))]
fn render_image_thumbnail_with_system_tool(
    _path: &Path,
    _thumbnail_path: &Path,
    _max_dimension: u32,
) -> ApiResult<bool> {
    Ok(false)
}

fn render_image_thumbnail_file_blocking(
    path: &Path,
    output_path: &Path,
    format: PreviewFormat,
    max_dimension: u32,
) -> ApiResult<GeneratedImageThumbnail> {
    {
        let _cache_file_lock = IMAGE_THUMBNAIL_CACHE_FILE_LOCK.lock().map_err(|error| {
            ApiError::Message(format!("Failed to lock thumbnail cache: {error}"))
        })?;
        if output_path.exists() {
            return Ok(GeneratedImageThumbnail {
                path: display_path(output_path),
                mime_type: "image/png".to_string(),
            });
        }
    }

    let temp_path = temporary_image_thumbnail_path(output_path);
    match format {
        PreviewFormat::Image(_) | PreviewFormat::TranscodeImage(_) => {
            let (width, height) = image_dimensions(path)?;
            validate_image_thumbnail_source(width, height)?;
            let rendered_with_system_tool = matches!(format, PreviewFormat::Image(_))
                && !is_gif_path(path)
                && render_image_thumbnail_with_system_tool(path, &temp_path, max_dimension)?;
            if !rendered_with_system_tool {
                let image = decode_image_thumbnail_source(path)?;
                let max_dimension = normalize_image_thumbnail_dimension(max_dimension);
                let thumbnail =
                    image.resize(max_dimension, max_dimension, IMAGE_THUMBNAIL_RESIZE_FILTER);
                if let Err(error) = write_image_thumbnail_png(&thumbnail, &temp_path) {
                    let _ = std::fs::remove_file(&temp_path);
                    return Err(error);
                }
            }
        }
        PreviewFormat::Psd => {
            let bytes = std::fs::read(path).map_err(|error| {
                ApiError::Message(format!(
                    "Failed to read PSD thumbnail {}: {error}",
                    path.display()
                ))
            })?;
            let bytes = transcode_psd_preview_png_with_dimension(&bytes, path, max_dimension)?;
            if let Err(error) = std::fs::write(&temp_path, bytes) {
                let _ = std::fs::remove_file(&temp_path);
                return Err(ApiError::Message(format!(
                    "Failed to write image thumbnail {}: {error}",
                    temp_path.display()
                )));
            }
        }
        PreviewFormat::Direct(_) | PreviewFormat::Pdf => {
            return Err(ApiError::Message(
                "This file type does not support image thumbnails.".to_string(),
            ));
        }
    };

    {
        let _cache_file_lock = IMAGE_THUMBNAIL_CACHE_FILE_LOCK.lock().map_err(|error| {
            ApiError::Message(format!("Failed to lock thumbnail cache: {error}"))
        })?;
        if output_path.exists() {
            let _ = std::fs::remove_file(&temp_path);
            return Ok(GeneratedImageThumbnail {
                path: display_path(output_path),
                mime_type: "image/png".to_string(),
            });
        }
        std::fs::rename(&temp_path, output_path).map_err(|error| {
            let _ = std::fs::remove_file(&temp_path);
            ApiError::Message(format!(
                "Failed to commit image thumbnail {}: {error}",
                output_path.display()
            ))
        })?;
    }
    Ok(GeneratedImageThumbnail {
        path: display_path(output_path),
        mime_type: "image/png".to_string(),
    })
}

fn render_image_preview_png_blocking(
    path: &Path,
    image_format: image::ImageFormat,
) -> ApiResult<Vec<u8>> {
    render_image_preview_png_with_dimension_blocking(
        path,
        image_format,
        MAX_IMAGE_PREVIEW_DIMENSION,
    )
}

fn render_image_preview_png_with_dimension_blocking(
    path: &Path,
    _image_format: image::ImageFormat,
    max_dimension: u32,
) -> ApiResult<Vec<u8>> {
    let image = decode_image_thumbnail_source(path)?;
    encode_preview_image_png_with_dimension(image, path, max_dimension)
}

fn encode_preview_image_png(image: image::DynamicImage, path: &Path) -> ApiResult<Vec<u8>> {
    encode_preview_image_png_with_dimension(image, path, MAX_IMAGE_PREVIEW_DIMENSION)
}

fn encode_preview_image_png_with_dimension(
    image: image::DynamicImage,
    path: &Path,
    max_dimension: u32,
) -> ApiResult<Vec<u8>> {
    let max_dimension = normalize_image_preview_dimension(max_dimension);
    let thumbnail = image.resize(max_dimension, max_dimension, IMAGE_THUMBNAIL_RESIZE_FILTER);
    let mut encoded = Cursor::new(Vec::new());
    let encoder = PngEncoder::new_with_quality(
        &mut encoded,
        IMAGE_THUMBNAIL_PNG_COMPRESSION,
        IMAGE_THUMBNAIL_PNG_FILTER,
    );
    thumbnail.write_with_encoder(encoder).map_err(|error| {
        ApiError::Message(format!(
            "Failed to encode preview image {}: {error}",
            path.display()
        ))
    })?;
    Ok(encoded.into_inner())
}

async fn read_preview_file(path: &Path) -> ApiResult<Vec<u8>> {
    tokio::fs::read(path).await.map_err(|error| {
        ApiError::Message(format!(
            "Failed to read preview file {}: {error}",
            path.display()
        ))
    })
}

fn transcode_psd_preview_png(bytes: &[u8], path: &Path) -> ApiResult<Vec<u8>> {
    transcode_psd_preview_png_with_dimension(bytes, path, MAX_IMAGE_PREVIEW_DIMENSION)
}

fn transcode_psd_preview_png_with_dimension(
    bytes: &[u8],
    path: &Path,
    max_dimension: u32,
) -> ApiResult<Vec<u8>> {
    use zune_psd::zune_core::{bytestream::ZCursor, result::DecodingResult};

    let mut decoder = zune_psd::PSDDecoder::new(ZCursor::new(bytes));
    let decoded = decoder.decode().map_err(|error| {
        ApiError::Message(format!(
            "Failed to decode PSD preview {}: {error:?}",
            path.display()
        ))
    })?;
    let (width, height) = decoder.dimensions().ok_or_else(|| {
        ApiError::Message(format!(
            "Failed to decode PSD preview {}: missing dimensions",
            path.display()
        ))
    })?;
    let color_space = decoder.colorspace().ok_or_else(|| {
        ApiError::Message(format!(
            "Failed to decode PSD preview {}: unsupported color space",
            path.display()
        ))
    })?;
    let rgba = match decoded {
        DecodingResult::U8(pixels) => psd_pixels_to_rgba8(&pixels, color_space),
        DecodingResult::U16(pixels) => {
            let pixels = pixels
                .into_iter()
                .map(|value| (value >> 8) as u8)
                .collect::<Vec<_>>();
            psd_pixels_to_rgba8(&pixels, color_space)
        }
        _ => None,
    }
    .ok_or_else(|| {
        ApiError::Message(format!(
            "Failed to decode PSD preview {}: unsupported pixel layout",
            path.display()
        ))
    })?;
    let image = image::RgbaImage::from_raw(width as u32, height as u32, rgba).ok_or_else(|| {
        ApiError::Message(format!(
            "Failed to decode PSD preview {}: invalid pixel buffer",
            path.display()
        ))
    })?;
    encode_preview_image_png_with_dimension(
        image::DynamicImage::ImageRgba8(image),
        path,
        max_dimension,
    )
}

fn psd_pixels_to_rgba8(
    pixels: &[u8],
    color_space: zune_psd::zune_core::colorspace::ColorSpace,
) -> Option<Vec<u8>> {
    use zune_psd::zune_core::colorspace::ColorSpace;

    let channels = color_space.num_components();
    if channels == 0 || pixels.len() % channels != 0 {
        return None;
    }
    let mut rgba = Vec::with_capacity((pixels.len() / channels) * 4);
    for chunk in pixels.chunks_exact(channels) {
        match color_space {
            ColorSpace::RGB => rgba.extend_from_slice(&[chunk[0], chunk[1], chunk[2], 255]),
            ColorSpace::RGBA => rgba.extend_from_slice(&[chunk[0], chunk[1], chunk[2], chunk[3]]),
            ColorSpace::Luma => rgba.extend_from_slice(&[chunk[0], chunk[0], chunk[0], 255]),
            ColorSpace::LumaA => rgba.extend_from_slice(&[chunk[0], chunk[0], chunk[0], chunk[1]]),
            _ => return None,
        }
    }
    Some(rgba)
}

async fn render_pdf_preview_png(
    path: &Path,
    metadata: &std::fs::Metadata,
) -> ApiResult<Option<Vec<u8>>> {
    let Some(mutool) = find_mutool() else {
        return Ok(None);
    };
    let out_path = pdf_preview_path(path, metadata);
    if let Some(parent) = out_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|error| {
            ApiError::Message(format!(
                "Failed to create PDF preview directory {}: {error}",
                parent.display()
            ))
        })?;
    }
    let status = Command::new(mutool)
        .arg("draw")
        .arg("-o")
        .arg(&out_path)
        .arg("-F")
        .arg("png")
        .arg("-r")
        .arg("140")
        .arg(path)
        .arg("1")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    if !status.is_ok_and(|status| status.success()) {
        return Ok(None);
    }
    match tokio::fs::read(&out_path).await {
        Ok(bytes) if !bytes.is_empty() => Ok(Some(bytes)),
        _ => Ok(None),
    }
}

fn find_mutool() -> Option<&'static str> {
    if Command::new("sh")
        .arg("-c")
        .arg("command -v mutool >/dev/null 2>&1")
        .status()
        .is_ok_and(|status| status.success())
    {
        return Some("mutool");
    }
    #[cfg(target_os = "macos")]
    {
        if Path::new("/opt/homebrew/bin/mutool").is_file() {
            return Some("/opt/homebrew/bin/mutool");
        }
        if Path::new("/usr/local/bin/mutool").is_file() {
            return Some("/usr/local/bin/mutool");
        }
    }
    None
}

fn pdf_preview_path(path: &Path, metadata: &std::fs::Metadata) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update(metadata.len().to_le_bytes());
    if let Ok(modified) = metadata.modified() {
        if let Ok(duration) = modified.duration_since(UNIX_EPOCH) {
            hasher.update(duration.as_millis().to_le_bytes());
        }
    }
    let digest = hasher.finalize();
    std::env::temp_dir().join(format!("misty-preview-{}.png", hex::encode(&digest[..16])))
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn sanitize_drag_file_name(name: &str) -> String {
    let mut sanitized = String::with_capacity(name.len());
    for character in name.chars() {
        if matches!(character, '/' | '\\' | ':' | '\0') || character.is_control() {
            sanitized.push('_');
        } else {
            sanitized.push(character);
        }
    }
    let trimmed = sanitized.trim_matches([' ', '.']).trim();
    if trimmed.is_empty() {
        "item".to_string()
    } else {
        trimmed.to_string()
    }
}

fn cleanup_expired_drag_stage_dirs(root: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64;
    let ttl_ms = ClipboardCache::DEFAULT_TTL_HOURS * 60 * 60 * 1000;

    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_dir() {
            continue;
        }
        let modified_ms = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
            .unwrap_or_default();
        if drag_stage_entry_expired(modified_ms, now_ms, ttl_ms) {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

fn drag_stage_entry_expired(modified_ms: i64, now_ms: i64, ttl_ms: i64) -> bool {
    modified_ms <= 0 || now_ms.saturating_sub(modified_ms) > ttl_ms
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::environment::AppEnvironmentService;
    use std::sync::atomic::AtomicBool;

    #[tokio::test]
    async fn soft_delete_uses_unique_trash_name() {
        let root = unique_test_dir("trash-local-path");
        let source = root.join("notes.txt");
        let trash_dir = root.join("trash");
        let original_trash_item = trash_dir.join("notes.txt");
        let unique_trash_item = trash_dir.join("notes 1.txt");
        tokio::fs::create_dir_all(&root).await.unwrap();
        tokio::fs::write(&source, b"first").await.unwrap();

        let destination = trash_local_path_cancellable(&source, &trash_dir, None)
            .await
            .unwrap();
        assert_eq!(destination, original_trash_item);
        assert!(!source.exists());
        assert_eq!(tokio::fs::read(&destination).await.unwrap(), b"first");

        tokio::fs::write(&source, b"second").await.unwrap();
        let destination = trash_local_path_cancellable(&source, &trash_dir, None)
            .await
            .unwrap();
        assert_eq!(destination, unique_trash_item);
        assert!(!source.exists());
        assert_eq!(tokio::fs::read(&destination).await.unwrap(), b"second");
        assert_eq!(
            tokio::fs::read(&original_trash_item).await.unwrap(),
            b"first"
        );

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[test]
    fn remote_conflict_lookup_accepts_relative_and_full_list_paths() {
        let parent = RemoteBrowseTarget {
            provider_type: "drive".into(),
            remote_name: "work".into(),
            remote_path: "/Documents".into(),
        };
        let items = vec![
            RemoteListItem {
                name: "report.pdf".into(),
                path: "report.pdf".into(),
                is_dir: false,
                ..remote_list_item_default()
            },
            RemoteListItem {
                name: "Archive".into(),
                path: "/Documents/Archive".into(),
                is_dir: true,
                ..remote_list_item_default()
            },
        ];

        assert_eq!(
            remote_item_is_directory(&parent, "/Documents/report.pdf", &items).unwrap(),
            Some(false)
        );
        assert_eq!(
            remote_item_is_directory(&parent, "/Documents/Archive", &items).unwrap(),
            Some(true)
        );
        assert_eq!(
            remote_item_is_directory(&parent, "/Documents/missing.txt", &items).unwrap(),
            None
        );
    }

    #[test]
    fn remote_preview_metadata_rejects_directories_without_size_cap() {
        let parent = RemoteBrowseTarget {
            provider_type: "drive".into(),
            remote_name: "work".into(),
            remote_path: "/Documents".into(),
        };
        let items = vec![
            RemoteListItem {
                name: "notes.txt".into(),
                path: "notes.txt".into(),
                size: 128,
                mod_time: "2026-06-21T00:00:00Z".into(),
                ..remote_list_item_default()
            },
            RemoteListItem {
                name: "Archive".into(),
                path: "Archive".into(),
                is_dir: true,
                ..remote_list_item_default()
            },
            RemoteListItem {
                name: "large.pdf".into(),
                path: "large.pdf".into(),
                size: 512 * 1024 * 1024,
                ..remote_list_item_default()
            },
        ];

        assert_eq!(
            remote_preview_metadata_from_items(&parent, "/Documents/notes.txt", &items).unwrap(),
            Some((128, "2026-06-21T00:00:00Z".into()))
        );
        assert!(remote_preview_metadata_from_items(&parent, "/Documents/Archive", &items).is_err());
        assert_eq!(
            remote_preview_metadata_from_items(&parent, "/Documents/large.pdf", &items).unwrap(),
            Some((512 * 1024 * 1024, "".into()))
        );
        assert_eq!(
            remote_preview_metadata_from_items(&parent, "/Documents/missing.txt", &items).unwrap(),
            None
        );
    }

    #[test]
    fn remote_list_items_are_deduped_by_resolved_path() {
        let parent = RemoteBrowseTarget {
            provider_type: "drive".into(),
            remote_name: "work".into(),
            remote_path: "/Documents".into(),
        };
        let items = vec![
            RemoteListItem {
                name: "fig2_topo.pdf".into(),
                path: "fig2_topo.pdf".into(),
                size: 1024,
                ..remote_list_item_default()
            },
            RemoteListItem {
                name: "fig2_topo.pdf".into(),
                path: "/Documents/fig2_topo.pdf".into(),
                size: 1024,
                ..remote_list_item_default()
            },
            RemoteListItem {
                name: "Misty_Terms_of_Service.docx".into(),
                path: "Misty_Terms_of_Service.docx".into(),
                size: 2048,
                ..remote_list_item_default()
            },
        ];

        let deduped = dedupe_remote_list_items(&parent, items).unwrap();

        assert_eq!(deduped.len(), 2);
        assert_eq!(deduped[0].name, "fig2_topo.pdf");
        assert_eq!(deduped[1].name, "Misty_Terms_of_Service.docx");
    }

    #[test]
    fn trash_virtual_entries_are_marked_deleted() {
        let root = unique_test_dir("trash-virtual");
        let trashed = root.join("deleted.txt");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&trashed, b"deleted").unwrap();

        let entries = trash_virtual_entries(&root).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "deleted.txt");
        assert!(entries[0].is_deleted);
        assert!(matches!(entries[0].kind, FileKind::File));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn local_directory_inspection_follows_symlink_targets() {
        use std::os::unix::fs::symlink;

        let root = unique_test_dir("symlink-directory-inspection");
        let directory = root.join("folder");
        let file = root.join("file.txt");
        let directory_link = root.join("folder-link");
        let file_link = root.join("file-link");
        tokio::fs::create_dir_all(&directory).await.unwrap();
        tokio::fs::write(&file, b"file").await.unwrap();
        symlink(&directory, &directory_link).unwrap();
        symlink(&file, &file_link).unwrap();

        let service = test_explorer_service();
        assert_eq!(
            service
                .item_is_directory(&display_path(&directory_link))
                .await
                .unwrap(),
            Some(true)
        );
        assert_eq!(
            service
                .item_is_directory(&display_path(&file_link))
                .await
                .unwrap(),
            Some(false)
        );

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn local_preview_payload_is_typed_and_rejects_unsupported_files() {
        let root = unique_test_dir("preview-payload");
        let image = root.join("image.png");
        let svg = root.join("vector.svg");
        let pnm = root.join("pixel.ppm");
        let psd = root.join("pixel.psd");
        let text = root.join("notes.txt");
        let unsupported = root.join("payload.bin");
        tokio::fs::create_dir_all(&root).await.unwrap();
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            1,
            1,
            image::Rgba([255, 0, 0, 255]),
        ))
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
        tokio::fs::write(&image, png.into_inner()).await.unwrap();
        tokio::fs::write(&svg, br#"<svg xmlns="http://www.w3.org/2000/svg"/>"#)
            .await
            .unwrap();
        tokio::fs::write(&pnm, b"P3\n1 1\n255\n255 0 0\n")
            .await
            .unwrap();
        tokio::fs::write(&psd, minimal_rgb_psd()).await.unwrap();
        tokio::fs::write(&text, b"notes").await.unwrap();
        tokio::fs::write(&unsupported, b"binary").await.unwrap();

        let service = test_explorer_service();
        let preview = service.preview_item(&display_path(&image)).await.unwrap();
        assert_eq!(preview.mime_type, "image/png");
        assert!(preview.bytes.starts_with(&[0x89, b'P', b'N', b'G']));
        let svg_preview = service.preview_item(&display_path(&svg)).await.unwrap();
        assert_eq!(svg_preview.mime_type, "image/svg+xml");
        assert_eq!(
            svg_preview.bytes,
            br#"<svg xmlns="http://www.w3.org/2000/svg"/>"#
        );
        let transcoded = service.preview_item(&display_path(&pnm)).await.unwrap();
        assert_eq!(transcoded.mime_type, "image/png");
        assert!(transcoded.bytes.starts_with(&[0x89, b'P', b'N', b'G']));
        let psd_preview = service.preview_item(&display_path(&psd)).await.unwrap();
        assert_eq!(psd_preview.mime_type, "image/png");
        assert!(psd_preview.bytes.starts_with(&[0x89, b'P', b'N', b'G']));
        let text_preview = service.preview_item(&display_path(&text)).await.unwrap();
        assert_eq!(text_preview.mime_type, "text/plain; charset=utf-8");
        assert_eq!(text_preview.bytes, b"notes");
        assert!(service
            .preview_item(&display_path(&unsupported))
            .await
            .is_err());

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn generated_image_thumbnail_is_cached_and_dimensioned() {
        let root = unique_test_dir("image-thumbnail-cache");
        let image = root.join("wide.png");
        tokio::fs::create_dir_all(&root).await.unwrap();
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            1000,
            500,
            image::Rgba([0, 128, 255, 255]),
        ))
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
        tokio::fs::write(&image, png.into_inner()).await.unwrap();

        let service = test_explorer_service();
        let first = service
            .generate_image_thumbnail(&display_path(&image), 384, None, None, None)
            .await
            .unwrap();
        let second = service
            .generate_image_thumbnail(&display_path(&image), 384, None, None, None)
            .await
            .unwrap();
        assert_eq!(first.mime_type, "image/png");
        assert_eq!(first.path, second.path);
        assert!(Path::new(&first.path).starts_with(&service.image_thumbnail_cache_dir));
        assert_eq!(
            service.image_thumbnail_cache_dir,
            service
                .home_dir
                .join(".misty")
                .join(".cache")
                .join("thumbnails")
        );
        let thumbnail = image::open(&first.path).unwrap();
        assert!(thumbnail.width() <= 384);
        assert!(thumbnail.height() <= 384);

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn generated_image_thumbnail_writes_small_images_to_cache() {
        let root = unique_test_dir("image-thumbnail-original");
        let image = root.join("small.png");
        tokio::fs::create_dir_all(&root).await.unwrap();
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            16,
            16,
            image::Rgba([0, 128, 255, 255]),
        ))
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
        tokio::fs::write(&image, png.into_inner()).await.unwrap();

        let service = test_explorer_service();
        let thumbnail = service
            .generate_image_thumbnail(&display_path(&image), 384, None, None, None)
            .await
            .unwrap();

        assert_eq!(thumbnail.mime_type, "image/png");
        assert_ne!(thumbnail.path, display_path(&image));
        assert!(Path::new(&thumbnail.path).starts_with(&service.image_thumbnail_cache_dir));

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[test]
    fn preview_format_matches_imgui_radiance_pic_support() {
        assert!(matches!(
            preview_format(Path::new("studio-lighting.pic")),
            Some(PreviewFormat::TranscodeImage(image::ImageFormat::Hdr))
        ));
        assert!(matches!(
            preview_format(Path::new("photo.jpg")),
            Some(PreviewFormat::Image(image::ImageFormat::Jpeg))
        ));
        assert!(matches!(
            preview_format(Path::new("thumbnail.psd")),
            Some(PreviewFormat::Psd)
        ));
    }

    fn minimal_rgb_psd() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"8BPS");
        bytes.extend_from_slice(&1u16.to_be_bytes());
        bytes.extend_from_slice(&[0; 6]);
        bytes.extend_from_slice(&3u16.to_be_bytes());
        bytes.extend_from_slice(&1u32.to_be_bytes());
        bytes.extend_from_slice(&1u32.to_be_bytes());
        bytes.extend_from_slice(&8u16.to_be_bytes());
        bytes.extend_from_slice(&3u16.to_be_bytes());
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes.extend_from_slice(&0u16.to_be_bytes());
        bytes.extend_from_slice(&[255, 0, 0]);
        bytes
    }

    #[tokio::test]
    async fn pdf_preview_path_tracks_file_identity() {
        let root = unique_test_dir("pdf-preview-path");
        let first = root.join("first.pdf");
        let second = root.join("second.pdf");
        tokio::fs::create_dir_all(&root).await.unwrap();
        tokio::fs::write(&first, b"%PDF-first").await.unwrap();
        tokio::fs::write(&second, b"%PDF-second").await.unwrap();

        let first_metadata = tokio::fs::metadata(&first).await.unwrap();
        let second_metadata = tokio::fs::metadata(&second).await.unwrap();
        let first_path = pdf_preview_path(&first, &first_metadata);
        let repeated_first_path = pdf_preview_path(&first, &first_metadata);
        let second_path = pdf_preview_path(&second, &second_metadata);

        assert_eq!(first_path, repeated_first_path);
        assert_ne!(first_path, second_path);
        assert_eq!(
            first_path.extension().and_then(|value| value.to_str()),
            Some("png")
        );

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[test]
    fn drag_stage_file_names_are_sanitized() {
        assert_eq!(sanitize_drag_file_name("report.pdf"), "report.pdf");
        assert_eq!(sanitize_drag_file_name("../bad:name"), "_bad_name");
        assert_eq!(sanitize_drag_file_name("..."), "item");
        assert_eq!(sanitize_drag_file_name("  "), "item");
        assert_eq!(
            sanitize_drag_file_name("bad\u{0007}name.txt"),
            "bad_name.txt"
        );
    }

    #[test]
    fn drag_stage_expiration_uses_remote_file_cache_ttl() {
        let ttl_ms = ClipboardCache::DEFAULT_TTL_HOURS * 60 * 60 * 1000;
        let now_ms = ttl_ms * 2;

        assert!(!drag_stage_entry_expired(now_ms - ttl_ms, now_ms, ttl_ms));
        assert!(drag_stage_entry_expired(
            now_ms - ttl_ms - 1,
            now_ms,
            ttl_ms
        ));
        assert!(drag_stage_entry_expired(0, now_ms, ttl_ms));
    }

    #[tokio::test]
    async fn cancellable_file_copy_stops_when_token_is_set() {
        let root = unique_test_dir("cancel-copy");
        let source = root.join("source.bin");
        let destination = root.join("destination.bin");
        tokio::fs::create_dir_all(&root).await.unwrap();
        tokio::fs::write(&source, vec![7u8; 1024]).await.unwrap();

        let cancellation = AtomicBool::new(true);
        let result = copy_local_file_cancellable(&source, &destination, &cancellation).await;
        assert!(result.as_ref().is_err_and(is_cancellation_error));
        assert!(!destination.exists());

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn canceled_create_item_stops_before_touching_filesystem() {
        let root = unique_test_dir("cancel-create-item");
        tokio::fs::create_dir_all(&root).await.unwrap();
        let service = test_explorer_service();
        let cancellation = Arc::new(AtomicBool::new(true));

        let result = service
            .create_item_with_cancellation(
                CreateItemRequest {
                    directory: display_path(&root),
                    name: "never-created.txt".to_string(),
                    kind: crate::core::explorer::CreateItemKind::File,
                },
                cancellation,
            )
            .await;

        assert!(result.as_ref().is_err_and(is_cancellation_error));
        assert!(!root.join("never-created.txt").exists());

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn canceled_rename_item_stops_before_touching_filesystem() {
        let root = unique_test_dir("cancel-rename-item");
        let source = root.join("original.txt");
        let destination = root.join("renamed.txt");
        tokio::fs::create_dir_all(&root).await.unwrap();
        tokio::fs::write(&source, b"keep name").await.unwrap();
        let service = test_explorer_service();
        let cancellation = Arc::new(AtomicBool::new(true));

        let result = service
            .rename_item_with_cancellation(
                RenameItemRequest {
                    path: display_path(&source),
                    new_name: "renamed.txt".to_string(),
                    source_is_directory: Some(false),
                },
                cancellation,
            )
            .await;

        assert!(result.as_ref().is_err_and(is_cancellation_error));
        assert!(source.exists());
        assert!(!destination.exists());

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn late_canceled_create_cleans_created_item() {
        let root = unique_test_dir("late-cancel-create-item");
        let name = format!("created-then-canceled-{}.txt", unique_test_name(&root));
        let target = root.join(&name);
        tokio::fs::create_dir_all(&root).await.unwrap();
        let service = test_explorer_service();
        let cancellation = Arc::new(AtomicBool::new(false));
        let operation = service.create_item_with_cancellation(
            CreateItemRequest {
                directory: display_path(&root),
                name: name.clone(),
                kind: crate::core::explorer::CreateItemKind::File,
            },
            cancellation.clone(),
        );
        let trigger_cancel = async {
            wait_until_path_exists(&target).await;
            cancellation.store(true, Ordering::SeqCst);
        };

        let (result, _) = tokio::join!(operation, trigger_cancel);

        assert!(result.as_ref().is_err_and(is_cancellation_error));
        assert!(!target.exists());

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn late_canceled_rename_reverts_item() {
        let root = unique_test_dir("late-cancel-rename-item");
        let source = root.join("original.txt");
        let name = format!("renamed-{}.txt", unique_test_name(&root));
        let destination = root.join(&name);
        tokio::fs::create_dir_all(&root).await.unwrap();
        tokio::fs::write(&source, b"keep original").await.unwrap();
        let service = test_explorer_service();
        let cancellation = Arc::new(AtomicBool::new(false));
        let operation = service.rename_item_with_cancellation(
            RenameItemRequest {
                path: display_path(&source),
                new_name: name.clone(),
                source_is_directory: Some(false),
            },
            cancellation.clone(),
        );
        let trigger_cancel = async {
            wait_until_path_exists(&destination).await;
            cancellation.store(true, Ordering::SeqCst);
        };

        let (result, _) = tokio::join!(operation, trigger_cancel);

        assert!(result.as_ref().is_err_and(is_cancellation_error));
        assert!(source.exists());
        assert!(!destination.exists());

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn cancellable_delete_stops_when_token_is_set() {
        let root = unique_test_dir("cancel-delete");
        let source = root.join("source.txt");
        tokio::fs::create_dir_all(&root).await.unwrap();
        tokio::fs::write(&source, b"keep me").await.unwrap();

        let cancellation = AtomicBool::new(true);
        let result = delete_local_path_cancellable(&source, Some(&cancellation)).await;
        assert!(result.as_ref().is_err_and(is_cancellation_error));
        assert!(source.exists());

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn cancellable_delete_removes_nested_directory() {
        let root = unique_test_dir("delete-nested");
        let source = root.join("source");
        let nested = source.join("nested");
        tokio::fs::create_dir_all(&nested).await.unwrap();
        tokio::fs::write(nested.join("file.txt"), b"gone")
            .await
            .unwrap();

        let result = delete_local_path_cancellable(&source, None).await;
        assert!(result.is_ok());
        assert!(!source.exists());

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[test]
    fn upload_filter_ignores_provider_disallowed_metadata() {
        assert!(ignored_upload_name(".DS_Store"));
        assert!(ignored_upload_name("._photo.jpg"));
        assert!(ignored_upload_name("Thumbs.db"));
        assert!(ignored_upload_name("desktop.ini"));
        assert!(ignored_upload_name("notes.tmp"));
        assert!(!ignored_upload_name("photo.jpg"));
    }

    #[test]
    fn remote_job_progress_adds_partial_rclone_bytes_to_transfer_base() {
        let status = test_remote_job_status(25, 25);
        let progress = TransferProgress {
            base_bytes: 100,
            total_bytes: 300,
        };

        assert_eq!(remote_job_transferred_bytes(&status, Some(progress)), 125);
        assert_eq!(remote_job_total_bytes(&status, Some(progress)), 300);
    }

    #[test]
    fn remote_job_progress_keeps_raw_bytes_without_aggregate_context() {
        let status = test_remote_job_status(25, 80);

        assert_eq!(remote_job_transferred_bytes(&status, None), 25);
        assert_eq!(remote_job_total_bytes(&status, None), 80);
    }

    #[tokio::test]
    async fn directory_size_excludes_ignored_upload_metadata() {
        let root = unique_test_dir("upload-size");
        let folder = root.join("folder");
        let nested = folder.join("nested");
        tokio::fs::create_dir_all(&nested).await.unwrap();
        tokio::fs::write(folder.join("a.bin"), vec![1_u8; 10])
            .await
            .unwrap();
        tokio::fs::write(nested.join("b.bin"), vec![2_u8; 15])
            .await
            .unwrap();
        tokio::fs::write(folder.join(".DS_Store"), vec![3_u8; 99])
            .await
            .unwrap();
        tokio::fs::write(nested.join("._b.bin"), vec![4_u8; 99])
            .await
            .unwrap();

        assert_eq!(local_item_size(&folder, true).await, 25);

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn remote_to_remote_paste_skips_provider_disallowed_metadata() {
        let home = unique_test_dir("remote-metadata-skip-home");
        let service = test_explorer_service_for_home(home.clone());
        let source = service.mount_root.join("source-remote").join(".DS_Store");
        let destination = service.mount_root.join("dest-remote");
        let before = service
            .transfers
            .snapshot(crate::services::transfers::TransferFilter::default())
            .await
            .unwrap()
            .rows
            .len();

        let result = service
            .paste_items(PasteItemsRequest {
                sources: vec![PasteItem {
                    path: display_path(&source),
                    is_directory: false,
                    size_bytes: None,
                    remote_modified: None,
                }],
                destination_directory: display_path(&destination),
                operation: crate::core::explorer::ClipboardOperation::Copy,
                target_name: None,
            })
            .await
            .unwrap();

        assert!(result.affected_paths.is_empty());
        let transfers = service
            .transfers
            .snapshot(crate::services::transfers::TransferFilter::default())
            .await
            .unwrap();
        assert_eq!(transfers.rows.len(), before);

        let _ = tokio::fs::remove_dir_all(&home).await;
    }

    #[tokio::test]
    async fn remote_job_cancel_requests_proxy_stop() {
        let cancellations = Arc::new(Mutex::new(Vec::new()));
        let service =
            test_explorer_service().with_remote_job_cancellation_log(cancellations.clone());
        let cancellation = AtomicBool::new(true);

        let result = service
            .wait_for_job("job-1", None, None, Some(&cancellation))
            .await;

        assert!(result.as_ref().is_err_and(is_cancellation_error));
        let cancellations = cancellations.lock().await.clone();
        assert!(
            cancellations
                .iter()
                .any(|request| request == "DELETE /api/remote/file/jobs/job-1"),
            "expected cancellation to delete the remote job, saw {cancellations:?}",
        );
    }

    #[tokio::test]
    async fn cancellation_cleanup_removes_partial_destination() {
        let root = unique_test_dir("cancel-cleanup");
        let destination = root.join("destination.bin");
        tokio::fs::create_dir_all(&root).await.unwrap();
        tokio::fs::write(&destination, b"partial").await.unwrap();

        let result: ApiResult<()> = Err(ApiError::Message("Operation canceled.".to_string()));
        let result = cleanup_partial_destination_on_cancel(&destination, false, result).await;
        assert!(result.as_ref().is_err_and(is_cancellation_error));
        assert!(!destination.exists());

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    fn remote_list_item_default() -> RemoteListItem {
        RemoteListItem {
            name: String::new(),
            path: String::new(),
            is_dir: false,
            size: 0,
            mod_time: String::new(),
            mime_type: String::new(),
        }
    }

    fn test_remote_job_status(bytes_completed: i64, bytes_total: i64) -> RemoteJobStatus {
        RemoteJobStatus {
            job_id: String::new(),
            operation: String::new(),
            state: String::new(),
            phase: String::new(),
            bytes_completed,
            bytes_total,
            bytes_per_second: 0.0,
            source_remote: String::new(),
            source_path: String::new(),
            dest_remote: String::new(),
            dest_path: String::new(),
            message: String::new(),
            result_ready: false,
            result_kind: String::new(),
        }
    }

    fn test_explorer_service() -> ExplorerService {
        test_explorer_service_for_home(unique_test_dir("explorer-service-home"))
    }

    fn test_explorer_service_for_home(home_dir: PathBuf) -> ExplorerService {
        let environment = AppEnvironmentService::for_test_home(home_dir);
        if let Some(db_dir) = environment.misty_db_path().parent() {
            let _ = std::fs::create_dir_all(db_dir);
        }
        let proxy = StorageService::new(environment.clone());
        let providers = ProviderService::new(proxy.clone());
        let transfers = TransferService::new(environment.clone());
        let explorer_library = ExplorerLibraryService::new(environment.clone());
        ExplorerService::new(environment, proxy, providers, transfers, explorer_library)
    }

    #[tokio::test]
    async fn prepared_remote_file_reuses_mounted_file_as_cache() {
        let home = unique_test_dir("remote-files-cache-home");
        let service = test_explorer_service_for_home(home.clone());
        let source = RemoteBrowseTarget {
            provider_type: "drive".into(),
            remote_name: "work".into(),
            remote_path: "/Photos/IMG_7313.PNG".into(),
        };
        let mounted_file = source.virtual_path(&service.mount_root);
        tokio::fs::create_dir_all(mounted_file.parent().unwrap())
            .await
            .unwrap();
        tokio::fs::write(&mounted_file, b"cached image")
            .await
            .unwrap();

        let prepared = service
            .prepare_remote_file_for_local_use(
                &source,
                Some(b"cached image".len() as i64),
                Some("2026-06-26T21:58:36Z"),
                "Preparing remote file to open",
                false,
            )
            .await
            .unwrap();

        let prepared_path = PathBuf::from(&prepared.local_path);
        assert!(prepared.cached);
        assert!(prepared.cache_hit);
        assert_ne!(prepared_path, mounted_file);
        assert!(prepared_path.starts_with(home.join(".misty/.cache/remote-files/v1")));
        assert!(!prepared_path.starts_with(home.join(".misty/.cache/remote-files/v1/remote-files")));
        assert_eq!(
            prepared.source_path.as_deref(),
            Some(mounted_file.to_string_lossy().as_ref())
        );
        assert_eq!(
            prepared.cache_path.as_deref(),
            Some(prepared.local_path.as_str())
        );
        assert_eq!(
            tokio::fs::read(prepared_path).await.unwrap(),
            b"cached image"
        );

        let _ = tokio::fs::remove_dir_all(home).await;
    }

    #[tokio::test]
    async fn remote_to_local_download_reuses_cached_remote_file() {
        let home = unique_test_dir("remote-paste-cache-home");
        let service = test_explorer_service_for_home(home.clone());
        let source = RemoteBrowseTarget {
            provider_type: "drive".into(),
            remote_name: "work".into(),
            remote_path: "/Photos/IMG_7313.PNG".into(),
        };
        let file_name = "IMG_7313.PNG";
        let payload = b"cached download payload";
        let cache_key = ClipboardRemoteFileCacheKey {
            remote_name: source.remote_name.clone(),
            remote_path: source.remote_path.clone(),
            size: payload.len() as i64,
            last_modified: "2026-06-26T21:58:36Z".into(),
            is_dir: false,
        };
        let temp_path = {
            let cache = service.remote_file_cache.lock().await;
            cache.temp_path_for(&ClipboardCache::remote_file_key(&cache_key), file_name)
        };
        tokio::fs::write(&temp_path, payload).await.unwrap();
        service
            .remote_file_cache
            .lock()
            .await
            .store_remote_file(&cache_key, &temp_path, file_name)
            .unwrap();
        let destination = home.join("Downloads");
        tokio::fs::create_dir_all(&destination).await.unwrap();

        let result = service
            .paste_items(PasteItemsRequest {
                sources: vec![PasteItem {
                    path: display_path(&source.virtual_path(&service.mount_root)),
                    is_directory: false,
                    size_bytes: Some(payload.len() as i64),
                    remote_modified: Some("2026-06-26T21:58:36Z".into()),
                }],
                destination_directory: display_path(&destination),
                operation: crate::core::explorer::ClipboardOperation::Copy,
                target_name: None,
            })
            .await
            .unwrap();

        let downloaded = destination.join(file_name);
        assert_eq!(result.affected_paths, vec![display_path(&downloaded)]);
        assert_eq!(tokio::fs::read(downloaded).await.unwrap(), payload);

        let _ = tokio::fs::remove_dir_all(home).await;
    }

    async fn wait_until_path_exists(path: &Path) {
        for _ in 0..100 {
            if path.exists() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("{} did not appear before timeout", path.display());
    }

    fn unique_test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "misty-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn unique_test_name(path: &Path) -> String {
        path.file_name()
            .and_then(OsStr::to_str)
            .unwrap_or("item")
            .replace(['/', '\\', ':'], "-")
    }
}
