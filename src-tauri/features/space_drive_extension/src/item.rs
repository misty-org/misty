//! One file or folder of the drive (a Space's folder, or something in one), as macOS asks about it (`NSFileProviderItem`), made from
//! what Misty says (`link::ItemInfo`).
use objc2::{define_class, msg_send, rc::Retained, AnyThread, DefinedClass, Message};
use objc2_file_provider::{
    NSFileProviderItemCapabilities, NSFileProviderItemIdentifier, NSFileProviderItemProtocol,
    NSFileProviderItemVersion, NSFileProviderRootContainerItemIdentifier,
    NSFileProviderTrashContainerItemIdentifier, NSFileProviderWorkingSetContainerItemIdentifier,
};
use objc2_foundation::{NSData, NSDate, NSNumber, NSObject, NSObjectProtocol, NSString};
use objc2_uniform_type_identifiers::{UTType, UTTypeData, UTTypeFolder};

use crate::link::ItemInfo;

// `NSFileProviderItemCapabilities`, from the SDK's NSFileProviderItem.h.
const READING: usize = 1 << 0;
const WRITING: usize = 1 << 1; // also "adding sub-items" on a folder
const REPARENTING: usize = 1 << 2;
const RENAMING: usize = 1 << 3;
const TRASHING: usize = 1 << 4;
const DELETING: usize = 1 << 5;

/// The system's own identifiers, and the names Misty uses for them.
pub fn to_misty(identifier: &NSString) -> String {
    // SAFETY: framework constants.
    let (root, trash, working) = unsafe {
        (
            NSFileProviderRootContainerItemIdentifier,
            NSFileProviderTrashContainerItemIdentifier,
            NSFileProviderWorkingSetContainerItemIdentifier,
        )
    };
    if identifier.isEqualToString(root) {
        "root".into()
    } else if identifier.isEqualToString(trash) {
        "trash".into()
    } else if identifier.isEqualToString(working) {
        "working_set".into()
    } else {
        identifier.to_string()
    }
}

pub fn to_system(id: &str) -> Retained<NSFileProviderItemIdentifier> {
    // SAFETY: framework constants.
    unsafe {
        match id {
            "root" => NSFileProviderRootContainerItemIdentifier.retain(),
            "trash" => NSFileProviderTrashContainerItemIdentifier.retain(),
            "working_set" => NSFileProviderWorkingSetContainerItemIdentifier.retain(),
            other => NSString::from_str(other),
        }
    }
}

pub struct ItemIvars {
    info: ItemInfo,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements, and DriveItem doesn't implement Drop.
    #[unsafe(super(NSObject))]
    #[name = "MistyDriveItem"]
    #[ivars = ItemIvars]
    pub struct DriveItem;

    unsafe impl NSObjectProtocol for DriveItem {}

    unsafe impl NSFileProviderItemProtocol for DriveItem {
        #[unsafe(method_id(itemIdentifier))]
        fn item_identifier(&self) -> Retained<NSFileProviderItemIdentifier> {
            to_system(&self.ivars().info.id)
        }

        #[unsafe(method_id(parentItemIdentifier))]
        fn parent_item_identifier(&self) -> Retained<NSFileProviderItemIdentifier> {
            to_system(&self.ivars().info.parent)
        }

        #[unsafe(method_id(filename))]
        fn filename(&self) -> Retained<NSString> {
            NSString::from_str(&self.ivars().info.name)
        }

        #[unsafe(method_id(contentType))]
        fn content_type(&self) -> Retained<UTType> {
            content_type(&self.ivars().info)
        }

        #[unsafe(method(capabilities))]
        fn capabilities(&self) -> NSFileProviderItemCapabilities {
            NSFileProviderItemCapabilities(capabilities(&self.ivars().info))
        }

        #[unsafe(method_id(documentSize))]
        fn document_size(&self) -> Option<Retained<NSNumber>> {
            let info = &self.ivars().info;
            (!info.is_folder()).then(|| NSNumber::new_u64(info.size))
        }

        #[unsafe(method_id(contentModificationDate))]
        fn content_modification_date(&self) -> Option<Retained<NSDate>> {
            date(self.ivars().info.mtime_ms)
        }

        #[unsafe(method_id(lastUsedDate))]
        fn last_used_date(&self) -> Option<Retained<NSDate>> {
            self.ivars().info.last_used_ms.and_then(date)
        }

        #[unsafe(method_id(itemVersion))]
        fn item_version(&self) -> Retained<NSFileProviderItemVersion> {
            let info = &self.ivars().info;
            version(&info.content_version, &info.meta_version)
        }
    }
);

impl DriveItem {
    pub fn new(info: ItemInfo) -> Retained<Self> {
        let this = Self::alloc().set_ivars(ItemIvars { info });
        // SAFETY: NSObject's designated initializer.
        unsafe { msg_send![super(this), init] }
    }
}

/// What macOS may do with an item: everything, even with a file someone else is editing (saves
/// merge or the last one wins). A trashed item can be put back (reparented) or forgotten here
/// (deleted from this Mac's view; it stays in the Space's trash on the server). The drive's
/// layout holds still: the root takes nothing but the Spaces' folders, and a Space's folder
/// takes new items but is never renamed, moved or deleted.
fn capabilities(info: &ItemInfo) -> usize {
    if info.id == "root" {
        return READING;
    }
    if info.is_space() {
        return READING | WRITING;
    }
    if info.parent == "trash" {
        return READING | REPARENTING | DELETING;
    }
    READING | WRITING | REPARENTING | RENAMING | TRASHING | DELETING
}

/// A folder's type, else the type its name's extension says, else plain data.
fn content_type(info: &ItemInfo) -> Retained<UTType> {
    // SAFETY: framework constants.
    if info.is_folder() {
        return unsafe { UTTypeFolder }.retain();
    }
    std::path::Path::new(&info.name)
        .extension()
        .and_then(|extension| extension.to_str())
        .and_then(|extension| UTType::typeWithFilenameExtension(&NSString::from_str(extension)))
        .unwrap_or_else(|| unsafe { UTTypeData }.retain())
}

fn date(ms: i64) -> Option<Retained<NSDate>> {
    (ms > 0).then(|| NSDate::dateWithTimeIntervalSince1970(ms as f64 / 1000.0))
}

/// An item's version: its content and its name and place, so a rename never makes macOS fetch the
/// file again.
pub fn version(content: &str, meta: &str) -> Retained<NSFileProviderItemVersion> {
    let content = NSData::with_bytes(content.as_bytes());
    let meta = NSData::with_bytes(meta.as_bytes());
    // SAFETY: the designated initializer, given two data objects it copies.
    unsafe {
        msg_send![
            NSFileProviderItemVersion::alloc(),
            initWithContentVersion: &*content,
            metadataVersion: &*meta
        ]
    }
}

/// The text of a version macOS hands back (`baseVersion`), as Misty wrote it.
pub fn version_parts(version: &NSFileProviderItemVersion) -> (String, String) {
    // SAFETY: plain getters.
    let (content, meta): (Retained<NSData>, Retained<NSData>) =
        unsafe { (msg_send![version, contentVersion], msg_send![version, metadataVersion]) };
    (
        String::from_utf8_lossy(&content.to_vec()).into_owned(),
        String::from_utf8_lossy(&meta.to_vec()).into_owned(),
    )
}
