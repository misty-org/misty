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
        let png = native_clipboard_png(bytes)?;
        return image::load_from_memory_with_format(&png, image::ImageFormat::Png).ok();
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

    fn stop(&self) {
        self.running.store(false, Ordering::Release);
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(worker) = worker.take() {
                let _ = worker.join();
            }
        }
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
pub fn native_clipboard_file_refs() -> ApiResult<Vec<PasteItem>> {
    use std::path::PathBuf;

    use objc2::rc::autoreleasepool;
    use objc2::ClassType;
    use objc2_app_kit::{NSPasteboard, NSPasteboardURLReadingFileURLsOnlyKey};
    use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSURL};

    Ok(autoreleasepool(|_| {
        let pasteboard = NSPasteboard::generalPasteboard();
        let class_array = NSArray::from_slice(&[NSURL::class()]);
        let file_urls_only = NSNumber::new_bool(true);
        let options = NSDictionary::from_slices(
            &[unsafe { NSPasteboardURLReadingFileURLsOnlyKey }],
            &[file_urls_only.as_ref()],
        );
        let objects =
            unsafe { pasteboard.readObjectsForClasses_options(&class_array, Some(&options)) };

        objects
            .map(|array| {
                array
                    .iter()
                    .filter_map(|object| {
                        object.downcast::<NSURL>().ok().and_then(|url| {
                            url.path().map(|path| {
                                let path = PathBuf::from(path.to_string());
                                PasteItem {
                                    is_directory: path.is_dir(),
                                    path: path.to_string_lossy().into_owned(),
                                    size_bytes: None,
                                    remote_modified: None,
                                }
                            })
                        })
                    })
                    .collect()
            })
            .unwrap_or_default()
    }))
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

#[cfg(not(target_os = "macos"))]
pub fn native_clipboard_file_refs() -> ApiResult<Vec<PasteItem>> {
    Ok(Vec::new())
}

#[cfg(not(target_os = "macos"))]
pub fn write_native_clipboard_file_refs(_items: &[PasteItem]) -> ApiResult<bool> {
    Ok(false)
}

#[cfg(all(test, target_os = "macos"))]
mod image_bridge_tests {
    use super::*;
    use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};

    #[test]
    fn system_and_rust_paths_preserve_existing_clipboard_formats() {
        let original =
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(8, 4, Rgba([128, 64, 32, 128])));
        // TGA has no signature recognized by load_from_memory; it was never a
        // clipboard input format. Files explicitly selects it in its own worker.
        for format in [
            ImageFormat::Png,
            ImageFormat::Bmp,
            ImageFormat::WebP,
            ImageFormat::Gif,
            ImageFormat::Pnm,
            ImageFormat::Jpeg,
        ] {
            let mut encoded = std::io::Cursor::new(Vec::new());
            let source = if matches!(format, ImageFormat::Jpeg | ImageFormat::Pnm) {
                DynamicImage::ImageRgb8(original.to_rgb8())
            } else {
                original.clone()
            };
            source.write_to(&mut encoded, format).unwrap();
            let bytes = encoded.into_inner();
            let expected = image::load_from_memory(&bytes).unwrap().to_rgba8();
            let actual = decode_clipboard_image(&bytes)
                .unwrap_or_else(|| panic!("Clipboard format {format:?} failed"))
                .to_rgba8();
            assert_eq!(actual.dimensions(), expected.dimensions(), "{format:?}");
            // JPEG implementations may round color conversion differently.
            for (actual, expected) in actual.as_raw().iter().zip(expected.as_raw()) {
                assert!(
                    actual.abs_diff(*expected) <= if format == ImageFormat::Jpeg { 2 } else { 0 },
                    "{format:?}: {actual} != {expected}"
                );
            }
        }
        let mut hdr = Vec::new();
        image::codecs::hdr::HdrEncoder::new(&mut hdr)
            .encode(&[image::Rgb([0.5f32, 0.25, 0.1]); 8], 4, 2)
            .unwrap();
        assert_eq!(decode_clipboard_image(&hdr).unwrap().width(), 4);
        assert!(decode_clipboard_image(b"corrupt").is_none());
    }

    #[test]
    fn system_gif_path_keeps_first_frame_and_transparency() {
        let mut bytes = Vec::new();
        {
            let mut encoder = image::codecs::gif::GifEncoder::new(&mut bytes);
            for color in [[255, 0, 0, 255], [0, 255, 0, 255]] {
                let mut image = RgbaImage::from_pixel(8, 4, Rgba(color));
                image.put_pixel(0, 0, Rgba([0, 0, 0, 0]));
                encoder.encode_frame(image::Frame::new(image)).unwrap();
            }
        }
        let decoded = decode_clipboard_image(&bytes).unwrap().to_rgba8();
        assert_eq!(decoded.get_pixel(1, 0).0, [255, 0, 0, 255]);
        assert_eq!(decoded.get_pixel(0, 0).0[3], 0);
    }
}
