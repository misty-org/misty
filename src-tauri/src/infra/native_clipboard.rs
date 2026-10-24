use std::{
    borrow::Cow,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use crate::domain::{
    clipboard::{
        ClipboardFileRef, ClipboardImage, ClipboardOrigin, ClipboardPayload, ClipboardPayloadKind,
        NativeClipboard,
    },
    explorer::PasteItem,
};
use crate::error::ApiResult;
use sha2::{Digest, Sha256};

/// The macOS clipboard bridge uses the system's image decoder. App preview
/// processing remains in the downloaded Files service.
#[cfg(target_os = "macos")]
fn native_clipboard_png(bytes: &[u8]) -> Option<Vec<u8>> {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    use objc2_foundation::{NSData, NSDictionary};
    objc2::rc::autoreleasepool(|_| {
        let data = NSData::with_bytes(bytes);
        let image = NSBitmapImageRep::imageRepWithData(&data)?;
        // Empty dictionary contains no incorrectly typed properties.
        unsafe {
            image.representationUsingType_properties(
                NSBitmapImageFileType::PNG,
                &NSDictionary::new(),
            )
        }
        .map(|data| data.to_vec())
    })
}

fn decode_clipboard_image(bytes: &[u8]) -> Option<image::DynamicImage> {
    #[cfg(target_os = "macos")]
    if matches!(
        image::guess_format(bytes).ok(),
        Some(
            image::ImageFormat::Jpeg
                | image::ImageFormat::Gif
                | image::ImageFormat::Bmp
                | image::ImageFormat::WebP
        )
    ) {
        // AppKit applies color management, but it rejects some valid encodings
        // (for example 32-bit BMPs with alpha); those still decode in Rust.
        if let Some(image) = native_clipboard_png(bytes)
            .and_then(|png| image::load_from_memory_with_format(&png, image::ImageFormat::Png).ok())
        {
            return Some(image);
        }
    }
    image::load_from_memory(bytes).ok()
}

pub struct SystemClipboardAdapter {
    running: Arc<AtomicBool>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}

impl SystemClipboardAdapter {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            running: Arc::new(AtomicBool::new(false)),
            worker: Mutex::new(None),
        })
    }
}

impl NativeClipboard for SystemClipboardAdapter {
    fn supported(&self) -> bool {
        cfg!(any(target_os = "macos", windows)) && arboard::Clipboard::new().is_ok()
    }

    fn start(&self, on_changed: Arc<dyn Fn() + Send + Sync + 'static>) -> bool {
        if self.running.swap(true, Ordering::AcqRel) {
            return true;
        }
        let running = self.running.clone();
        let worker = thread::spawn(move || {
            while running.load(Ordering::Acquire) {
                on_changed();
                thread::sleep(Duration::from_millis(500));
            }
        });
        if let Ok(mut slot) = self.worker.lock() {
            *slot = Some(worker);
        }
        true
    }

    fn read_payload(&self) -> Option<ClipboardPayload> {
        let mut clipboard = arboard::Clipboard::new().ok()?;
        if let Ok(paths) = clipboard.get().file_list() {
            let file_refs: Vec<_> = paths
                .into_iter()
                .take(100)
                .filter(|path| path.exists())
                .map(|path| ClipboardFileRef {
                    display_name: path
                        .file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                        .unwrap_or_else(|| "File".to_owned()),
                    local_path: path.to_string_lossy().into_owned(),
                    is_dir: path.is_dir(),
                    ..ClipboardFileRef::default()
                })
                .collect();
            if !file_refs.is_empty() {
                return Some(ClipboardPayload {
                    kind: ClipboardPayloadKind::FileRefs,
                    file_refs,
                    origin: ClipboardOrigin::LocalSystem,
                    ..ClipboardPayload::default()
                });
            }
        }
        if let Ok(html) = clipboard.get().html() {
            if html.len() <= 1024 * 1024 {
                let text = clipboard.get_text().unwrap_or_default();
                return Some(ClipboardPayload {
                    kind: ClipboardPayloadKind::Html,
                    html,
                    text,
                    origin: ClipboardOrigin::LocalSystem,
                    ..ClipboardPayload::default()
                });
            }
        }
        if let Ok(image) = clipboard.get_image() {
            let mut png = Vec::new();
            let encoded = image::codecs::png::PngEncoder::new(&mut png);
            if image::ImageEncoder::write_image(
                encoded,
                &image.bytes,
                image.width as u32,
                image.height as u32,
                image::ExtendedColorType::Rgba8,
            )
            .is_ok()
                && png.len() <= 10 * 1024 * 1024
            {
                let checksum = hex::encode(Sha256::digest(&png));
                return Some(ClipboardPayload {
                    kind: ClipboardPayloadKind::Image,
                    images: vec![ClipboardImage {
                        mime_type: "image/png".to_owned(),
                        blob_id: format!("clipboard_{checksum}"),
                        checksum,
                        size_bytes: png.len() as u64,
                        width: image.width as i32,
                        height: image.height as i32,
                        bytes: png,
                    }],
                    origin: ClipboardOrigin::LocalSystem,
                    ..ClipboardPayload::default()
                });
            }
        }
        let text = clipboard.get_text().ok()?;
        (text.len() <= 1024 * 1024).then(|| ClipboardPayload {
            kind: ClipboardPayloadKind::Text,
            text,
            origin: ClipboardOrigin::LocalSystem,
            ..ClipboardPayload::default()
        })
    }

    fn write_payload(&self, payload: &ClipboardPayload) -> bool {
        let Ok(mut clipboard) = arboard::Clipboard::new() else {
            return false;
        };
        match payload.kind {
            ClipboardPayloadKind::Text => clipboard.set_text(payload.text.clone()).is_ok(),
            ClipboardPayloadKind::Html => clipboard
                .set_html(payload.html.clone(), Some(payload.text.clone()))
                .is_ok(),
            ClipboardPayloadKind::Image => payload
                .images
                .first()
                .and_then(|image| decode_clipboard_image(&image.bytes))
                .is_some_and(|image| {
                    let rgba = image.to_rgba8();
                    let (width, height) = rgba.dimensions();
                    clipboard
                        .set_image(arboard::ImageData {
                            width: width as usize,
                            height: height as usize,
                            bytes: Cow::Owned(rgba.into_raw()),
                        })
                        .is_ok()
                }),
            ClipboardPayloadKind::FileRefs => {
                let paths: Vec<PathBuf> = payload
                    .file_refs
                    .iter()
                    .filter(|item| !item.local_path.is_empty())
                    .map(|item| PathBuf::from(&item.local_path))
                    .filter(|path| path.exists())
                    .collect();
                if paths.is_empty() {
                    clipboard.set_text(payload.text.clone()).is_ok()
                } else {
                    clipboard.set().file_list(&paths).is_ok()
                }
            }
            ClipboardPayloadKind::Empty => false,
        }
    }
}

#[cfg(target_os = "macos")]
pub fn write_native_clipboard_file_refs(items: &[PasteItem]) -> ApiResult<bool> {
    use std::path::Path;

    use objc2::rc::autoreleasepool;
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::NSPasteboard;
    use objc2_app_kit::NSPasteboardWriting;
    use objc2_foundation::{NSArray, NSString, NSURL};

    let urls = items
        .iter()
        .filter(|item| !item.path.trim().is_empty())
        .map(|item| {
            let path = Path::new(&item.path);
            let path_string = path.to_string_lossy();
            let ns_path = NSString::from_str(&path_string);
            NSURL::fileURLWithPath_isDirectory(&ns_path, item.is_directory)
        })
        .collect::<Vec<_>>();
    if urls.is_empty() {
        return Ok(false);
    }

    Ok(autoreleasepool(|_| {
        let pasteboard = NSPasteboard::generalPasteboard();
        pasteboard.clearContents();
        let url_array = NSArray::from_retained_slice(&urls);
        let pasteboard_items =
            unsafe { url_array.cast_unchecked::<ProtocolObject<dyn NSPasteboardWriting>>() };
        pasteboard.writeObjects(pasteboard_items)
    }))
}

/// Puts files on the clipboard so File Explorer can paste them (CF_HDROP).
#[cfg(not(target_os = "macos"))]
pub fn write_native_clipboard_file_refs(items: &[PasteItem]) -> ApiResult<bool> {
    let paths = items
        .iter()
        .map(|item| item.path.trim())
        .filter(|path| !path.is_empty())
        .collect::<Vec<_>>();
    if paths.is_empty() {
        return Ok(false);
    }
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|_| crate::error::ApiError::Message("The clipboard is unavailable.".into()))?;
    Ok(clipboard.set().file_list(&paths).is_ok())
}

#[cfg(all(test, target_os = "macos"))]
mod image_bridge_tests;
