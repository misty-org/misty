use crate::core::explorer::PasteItem;
use crate::error::ApiResult;

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
