use std::{
    collections::HashMap,
    ffi::OsStr,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, LazyLock, Mutex as StdMutex,
    },
    time::UNIX_EPOCH,
};

#[cfg(not(target_os = "macos"))]
use std::{
    fs::File,
    io::{BufReader, BufWriter, Cursor},
};

#[cfg(not(target_os = "macos"))]
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

use crate::domain::explorer::{
    list_directory, paste_items, CreateItemRequest, DeleteItemsRequest, DirectoryListing,
    ExplorerLocation, ExplorerOperationResult, ExplorerPreviewPayload, FileEntry, FileKind,
    GeneratedImageThumbnail, ListDirectoryRequest, PasteBlobRequest, PasteItemsRequest,
    PasteTextRequest, PrepareDragItemRequest, PrepareDragItemsRequest, PrepareOpenItemRequest,
    PreparedDragItem, PreparedDragItemsResult, PreparedDragSkippedItem, PreparedOpenItem,
    RenameItemRequest,
};
use crate::domain::clock::now_epoch_ms;
use crate::domain::listing_cache::ListingCache;
use crate::error::{ApiError, ApiResult};
use crate::infra::{
    environment::AppEnvironmentService,
    explorer_library::{ExplorerLibraryItem, ExplorerLibraryService},
};

const VIRTUAL_PATH_RECENT: &str = "misty://recent";
const VIRTUAL_PATH_STARRED: &str = "misty://starred";
const VIRTUAL_PATH_TRASH: &str = "misty://trash";
const VIRTUAL_PATH_LIBRARY: &str = "misty://library";

const MAX_IMAGE_PREVIEW_DIMENSION: u32 = 1600;
const DEFAULT_IMAGE_THUMBNAIL_DIMENSION: u32 = 384;
const MAX_GENERATED_IMAGE_THUMBNAIL_DIMENSION: u32 = 384;
#[cfg(not(target_os = "macos"))]
const IMAGE_THUMBNAIL_RESIZE_FILTER: FilterType = FilterType::Triangle;
#[cfg(not(target_os = "macos"))]
const IMAGE_THUMBNAIL_PNG_COMPRESSION: CompressionType = CompressionType::Fast;
#[cfg(not(target_os = "macos"))]
const IMAGE_THUMBNAIL_PNG_FILTER: PngFilterType = PngFilterType::Adaptive;

static IMAGE_THUMBNAIL_CACHE_FILE_LOCK: LazyLock<StdMutex<()>> =
    LazyLock::new(|| StdMutex::new(()));
static TEMPORARY_THUMBNAIL_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone)]
pub struct ExplorerService {
    home_dir: PathBuf,
    mount_root: PathBuf,
    explorer_library: ExplorerLibraryService,
    listing_cache: ListingCache,
    drag_preparation_cancellations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    clipboard_text_cache_dir: PathBuf,
    clipboard_blob_cache_dir: PathBuf,
    trash_dir: PathBuf,
    image_thumbnail_cache_dir: PathBuf,
}

impl ExplorerService {
    /// Image previews are not available on macOS: they need a confined worker
    /// and no caller provides one. The error return type is uninhabited so
    /// every code path past it is statically unreachable.
    #[cfg(target_os = "macos")]
    fn image_service(&self) -> ApiResult<std::convert::Infallible> {
        Err(ApiError::Message("Image previews are unavailable.".into()))
    }

    pub fn new(
        environment: AppEnvironmentService,
        explorer_library: ExplorerLibraryService,
    ) -> Self {
        let cache_dir = environment.cache_dir();
        let mount_root = environment.mount_root();
        Self {
            home_dir: environment.home_dir(),
            mount_root,
            explorer_library,
            listing_cache: ListingCache::new(cache_dir.join("remotes"), cache_dir.join("listings")),
            drag_preparation_cancellations: Arc::new(Mutex::new(HashMap::new())),
            clipboard_text_cache_dir: cache_dir.join("clipboard-paste").join("text"),
            clipboard_blob_cache_dir: cache_dir.join("clipboard-paste").join("blob"),
            trash_dir: cache_dir.join("trash"),
            image_thumbnail_cache_dir: cache_dir.join("thumbnails"),
        }
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
mod paste_guard;
mod path_helpers;
mod preview;
mod preview_render;
mod preview_types;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests_local;
#[cfg(test)]
mod tests_preview;

use cancellation::*;
use local_mutations::*;
use misc::*;
use path_helpers::*;
pub use preview::SavePreviewRequest;
use preview_render::*;
use preview_types::*;
#[cfg(test)]
use test_support::*;
