//! Debug-harness-only clipboard checks. Original clipboard data never leaves this module.
#![allow(deprecated, unexpected_cfgs)]
use crate::platform::mini_app::{self, MiniAppState};
use cocoa::{
    appkit::{NSPasteboard, NSPasteboardItem},
    base::{id, nil, YES},
    foundation::{NSArray, NSData, NSString},
};
use objc::{class, msg_send, sel, sel_impl};
use serde_json::Value;
use std::ffi::CStr;
use tauri::{AppHandle, State, Webview};

struct Snapshot {
    count: i64,
    items: Vec<Vec<(String, Vec<u8>)>>,
}
impl Snapshot {
    unsafe fn capture(board: id) -> Result<Self, String> {
        let count = NSPasteboard::changeCount(board);
        let native_items = NSPasteboard::pasteboardItems(board);
        let length = if native_items == nil {
            0
        } else {
            native_items.count()
        };
        if length > 64 {
            return Err("Clipboard has too many items for a reversible probe".into());
        }
        let mut items = Vec::new();
        let mut total = 0usize;
        for index in 0..length {
            let item = native_items.objectAtIndex(index);
            let types = NSPasteboardItem::types(item);
            if types.count() > 128 {
                return Err("Clipboard has too many formats for a reversible probe".into());
            }
            let mut formats = Vec::new();
            for index in 0..types.count() {
                let kind = types.objectAtIndex(index);
                let name = CStr::from_ptr(kind.UTF8String())
                    .to_str()
                    .map_err(|_| "Invalid clipboard type")?
                    .to_owned();
                let data = NSPasteboardItem::dataForType(item, kind);
                if data == nil {
                    return Err("A clipboard format cannot be preserved; probe refused".into());
                }
                let length = data.length() as usize;
                total = total.checked_add(length).ok_or("Clipboard size overflow")?;
                if total > 64 * 1024 * 1024 {
                    return Err("Clipboard is too large for a reversible probe".into());
                }
                let bytes = if length == 0 {
                    Vec::new()
                } else {
                    std::slice::from_raw_parts(data.bytes() as *const u8, length).to_vec()
                };
                formats.push((name, bytes));
            }
            items.push(formats);
        }
        if NSPasteboard::changeCount(board) != count {
            return Err("Clipboard changed while preparing probe".into());
        }
        Ok(Self { count, items })
    }
    unsafe fn restore(&self, board: id, expected: i64) -> Result<(), String> {
        if NSPasteboard::changeCount(board) != expected {
            return Err(
                "Clipboard changed outside the probe; newer contents were preserved".into(),
            );
        }
        if expected == self.count {
            return Ok(());
        }
        // Prepare every item before clearing, so an allocation/format error leaves the current board intact.
        let mut objects = Vec::new();
        for formats in &self.items {
            let item: id = msg_send![class!(NSPasteboardItem), new];
            let item: id = msg_send![item, autorelease];
            for (name, bytes) in formats {
                let kind = NSString::alloc(nil).init_str(name);
                let kind: id = msg_send![kind, autorelease];
                let data =
                    NSData::dataWithBytes_length_(nil, bytes.as_ptr().cast(), bytes.len() as _);
                if NSPasteboardItem::setData_forType(item, data, kind) != YES {
                    return Err("Could not prepare original clipboard format".into());
                }
            }
            objects.push(item);
        }
        if NSPasteboard::changeCount(board) != expected {
            return Err(
                "Clipboard changed outside the probe; newer contents were preserved".into(),
            );
        }
        NSPasteboard::clearContents(board);
        if !objects.is_empty()
            && NSPasteboard::writeObjects(board, NSArray::arrayWithObjects(nil, &objects)) != YES
        {
            return Err("Could not restore the original clipboard".into());
        }
        Ok(())
    }
}

fn board_count() -> i64 {
    unsafe { NSPasteboard::changeCount(NSPasteboard::generalPasteboard(nil)) }
}

pub async fn call(
    app: AppHandle,
    webview: Webview,
    state: State<'_, MiniAppState>,
    instance: String,
    method: String,
    params: Value,
) -> Result<Value, String> {
    if !matches!(
        method.as_str(),
        "clipboard.readText"
            | "clipboard.writeText"
            | "clipboard.readImage"
            | "clipboard.writeImage"
    ) {
        return Err("Unsupported clipboard probe method".into());
    }
    let original = unsafe { Snapshot::capture(NSPasteboard::generalPasteboard(nil))? };
    // Read probes receive synthetic clipboard contents; package code never sees the user's clipboard.
    if method == "clipboard.readText" {
        arboard::Clipboard::new()
            .map_err(|error| error.to_string())?
            .set_text("SDK clipboard text")
            .map_err(|error| error.to_string())?;
    } else if method == "clipboard.readImage" {
        arboard::Clipboard::new()
            .map_err(|error| error.to_string())?
            .set_image(arboard::ImageData {
                width: 1,
                height: 1,
                bytes: std::borrow::Cow::Owned(vec![23, 45, 67, 255]),
            })
            .map_err(|error| error.to_string())?;
    }
    let seeded_count = board_count();
    let result = mini_app::permissions::mini_app_device_call(
        app,
        webview,
        state,
        instance,
        method.clone(),
        params.clone(),
    )
    .await;
    let expected_count = board_count();
    if method.starts_with("clipboard.read") && expected_count != seeded_count {
        return Err("Clipboard changed outside the probe; newer contents were preserved".into());
    }
    let checked = result.and_then(|value| {
        if method == "clipboard.readText"
            && value.get("text").and_then(Value::as_str) != Some("SDK clipboard text")
        {
            return Err("Native clipboard text read failed".into());
        }

        if method == "clipboard.writeText" {
            let actual = arboard::Clipboard::new()
                .map_err(|error| error.to_string())?
                .get_text()
                .map_err(|error| error.to_string())?;
            if Some(actual.as_str()) != params.get("text").and_then(Value::as_str) {
                return Err("Native clipboard text round trip failed".into());
            }
        } else if method == "clipboard.writeImage" {
            use base64::Engine;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(
                    params
                        .get("data")
                        .and_then(Value::as_str)
                        .ok_or("Missing PNG")?,
                )
                .map_err(|error| error.to_string())?;
            let expected = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
                .map_err(|error| error.to_string())?
                .to_rgba8();
            let actual = arboard::Clipboard::new()
                .map_err(|error| error.to_string())?
                .get_image()
                .map_err(|error| error.to_string())?;
            if actual.width != expected.width() as usize
                || actual.height != expected.height() as usize
                || actual.bytes.as_ref() != expected.as_raw()
            {
                return Err("Native clipboard PNG round trip failed".into());
            }
        }
        Ok(value)
    });
    if method.starts_with("clipboard.write") && checked.is_err() && expected_count != original.count
    {
        // A failed round trip may mean another process copied something new.
        return checked;
    }
    // Do not overwrite a subsequent user copy. The snapshot and its bytes are dropped here.
    unsafe {
        original.restore(NSPasteboard::generalPasteboard(nil), expected_count)?;
    }
    checked
}

#[cfg(test)]
mod tests {
    use super::*;
    unsafe fn put(board: id, text: &str) {
        NSPasteboard::clearContents(board);
        let kind = NSString::alloc(nil).init_str("public.utf8-plain-text");
        let value = NSString::alloc(nil).init_str(text);
        assert_eq!(NSPasteboard::setString_forType(board, value, kind), YES);
        let _: () = msg_send![kind, release];
        let _: () = msg_send![value, release];
    }
    #[test]
    fn restores_preserved_formats_and_keeps_a_newer_external_copy() {
        unsafe {
            let board = NSPasteboard::pasteboardWithUniqueName(nil);
            put(board, "Original unicode: 雾");
            let binary_kind = NSString::alloc(nil).init_str("com.misty.sdk-probe.binary");
            let binary = [0u8, 1, 255, 3];
            let data =
                NSData::dataWithBytes_length_(nil, binary.as_ptr().cast(), binary.len() as _);
            assert_eq!(NSPasteboard::setData_forType(board, data, binary_kind), YES);
            let original = Snapshot::capture(board).unwrap();
            put(board, "Fixture copy");
            original
                .restore(board, NSPasteboard::changeCount(board))
                .unwrap();
            let restored = Snapshot::capture(board).unwrap();
            assert_eq!(original.items, restored.items);
            put(board, "Fixture copy");
            let fixture_count = NSPasteboard::changeCount(board);
            put(board, "Newer external copy");
            let newer = Snapshot::capture(board).unwrap();
            assert!(original.restore(board, fixture_count).is_err());
            assert_eq!(newer.items, Snapshot::capture(board).unwrap().items);
            let _: () = msg_send![binary_kind, release];
            NSPasteboard::releaseGlobally(board);
        }
    }
}
