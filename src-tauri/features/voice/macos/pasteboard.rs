use objc2::msg_send;
use objc2::rc::{autoreleasepool, Retained};
use objc2_app_kit::{NSPasteboard, NSPasteboardItem, NSPasteboardTypeString};
use objc2_foundation::{NSArray, NSString};

pub struct Snapshot(Retained<NSArray<NSPasteboardItem>>);

pub(crate) fn snapshot() -> Snapshot {
    autoreleasepool(|_| {
        let mut copies = Vec::new();
        let items = NSPasteboard::generalPasteboard().pasteboardItems();
        for item in items.iter().flat_map(|items| items.iter()) {
            let copy = NSPasteboardItem::new();
            for kind in item.types() {
                if let Some(data) = item.dataForType(&kind) {
                    copy.setData_forType(&data, &kind);
                }
            }
            copies.push(copy);
        }
        Snapshot(NSArray::from_retained_slice(&copies))
    })
}

pub(crate) fn restore(snapshot: Snapshot) {
    autoreleasepool(|_| {
        let board = NSPasteboard::generalPasteboard();
        board.clearContents();
        if snapshot.0.count() > 0 {
            // SAFETY: `NSPasteboardItem` conforms to `NSPasteboardWriting`, which `writeObjects:` needs.
            let _: bool = unsafe { msg_send![&*board, writeObjects: &*snapshot.0] };
        }
    });
}

pub(crate) fn write_text(text: &str) -> i64 {
    autoreleasepool(|_| {
        let board = NSPasteboard::generalPasteboard();
        board.clearContents();
        // SAFETY: `NSPasteboardTypeString` is a constant AppKit defines.
        board.setString_forType(&NSString::from_str(text), unsafe { NSPasteboardTypeString });
        board.changeCount() as i64
    })
}

pub(crate) fn change_count() -> i64 {
    NSPasteboard::generalPasteboard().changeCount() as i64
}
