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
const VIRTUAL_PATH_LIBRARY: &str = "misty://library";
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
}

mod cancellation;
mod clipboard;
mod clipboard_staging;
mod listing;
mod local_mutations;
mod local_use;
mod misc;
mod mutations;
mod path_helpers;
mod preview;
mod preview_render;
mod preview_types;
mod remote_download;
mod remote_jobs;
mod remote_listing;
mod remote_upload;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests_local;
#[cfg(test)]
mod tests_preview;
#[cfg(test)]
mod tests_remote;

use cancellation::*;
use local_mutations::*;
use misc::*;
use path_helpers::*;
use preview_render::*;
use preview_types::*;
#[cfg(test)]
use test_support::*;
