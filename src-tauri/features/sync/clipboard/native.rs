//! Puts Library items on the system clipboard as files.
use crate::app::error::ApiResult;
use crate::sync::clipboard::PasteItem;

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
    let mut clipboard = arboard::Clipboard::new().map_err(|_| {
        crate::app::error::ApiError::Message("The clipboard is unavailable.".into())
    })?;
    Ok(clipboard.set().file_list(&paths).is_ok())
}
