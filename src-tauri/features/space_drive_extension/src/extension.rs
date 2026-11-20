//! The extension's principal class: one instance per domain (one Space), made by macOS with
//! `initWithDomain:`. Every call is answered on a worker thread from Misty (`link`), never from state
//! kept here. What each call means for the Space follows the drive's rules in Misty:
//!
//! - Moving an item to the Trash, or deleting it (`rm`, Delete Immediately), is a trash move in the
//!   Space: restorable there for 30 days, from Misty. The item then leaves the drive as macOS shows
//!   it, so emptying the Finder Trash never deletes anything in the Space.
//! - If Misty refuses the trash move (someone has the file open), macOS is told the deletion was
//!   rejected and puts the item back as it now is.
//! - Every item is writable. A save goes up saying which version it came from; Misty merges a text
//!   save with what came since or lets the last save win, and answers `refetch` when the file is
//!   no longer what was sent.
//! - Opening a file sets its last-used date, which Misty counts as the file being in use here.
use std::sync::Arc;

use block2::DynBlock;
use objc2::{
    define_class, msg_send,
    rc::{Allocated, Retained},
    runtime::{Bool, ProtocolObject},
    DefinedClass,
};
use objc2_file_provider::{
    NSFileProviderCreateItemOptions, NSFileProviderDeleteItemOptions, NSFileProviderDomain,
    NSFileProviderEnumerating, NSFileProviderEnumerator, NSFileProviderErrorDomain,
    NSFileProviderItem, NSFileProviderItemFields, NSFileProviderItemIdentifier,
    NSFileProviderItemVersion, NSFileProviderModifyItemOptions, NSFileProviderReplicatedExtension,
    NSFileProviderRequest,
};
use objc2_foundation::{
    NSCocoaErrorDomain, NSDate, NSError, NSObject, NSObjectProtocol, NSProgress, NSString, NSURL,
    NSXPCConnectionReplyInvalid,
};
use objc2_uniform_type_identifiers::{UTType, UTTypeDirectory};

use crate::{
    enumerator::DriveEnumerator,
    item::{to_misty, version_parts, DriveItem},
    link::{Changed, ItemInfo, Link, LinkError},
    send,
};

// `NSFileProviderItemFields`, from the SDK's NSFileProviderItem.h.
const CONTENTS: usize = 1 << 0;
const FILENAME: usize = 1 << 1;
const PARENT: usize = 1 << 2;
const LAST_USED: usize = 1 << 3;
const MODIFIED: usize = 1 << 7;

// `NSFileProviderErrorCode`, from the SDK's NSFileProviderError.h.
const NOT_AUTHENTICATED: isize = -1000;
const SERVER_UNREACHABLE: isize = -1004;
const NO_SUCH_ITEM: isize = -1005;
const DIRECTORY_NOT_EMPTY: isize = -1007;
const CANNOT_SYNCHRONIZE: isize = -2005;
const EXCLUDED_FROM_SYNC: isize = -2010;

/// `NSFileProviderCreateItemMayAlreadyExist`: the item may be one Misty already has (after a reset).
const MAY_ALREADY_EXIST: usize = 1 << 0;
/// `NSFileProviderDeleteItemRecursive`: a folder goes with everything in it.
const RECURSIVE: usize = 1 << 0;

/// An error macOS understands, for a call Misty couldn't answer. Codes Misty sends map onto File
/// Provider's own. What may pass on its own (a failed read, a download that didn't match its hash,
/// the server's hiccup) is Cocoa's "reply invalid", which macOS retries; what waits on the person or
/// on Misty (signed out, offline, not mounted, refused) backs off until Misty signals the domain.
pub fn error(failure: LinkError) -> Retained<NSError> {
    let code = match failure.code() {
        "signed_out" => NOT_AUTHENTICATED,
        // Misty isn't running, or this Space isn't mounted now: it signals once it is.
        "server_unreachable" | "not_mounted" => SERVER_UNREACHABLE,
        "not_found" => NO_SUCH_ITEM,
        "not_empty" => DIRECTORY_NOT_EMPTY,
        "excluded" => EXCLUDED_FROM_SYNC,
        "corrupt" | "io" | "store" | "server" | "face" => {
            // SAFETY: framework constant.
            return NSError::new(NSXPCConnectionReplyInvalid, unsafe { NSCocoaErrorDomain });
        }
        // `exists`, `forbidden`, `invalid`, `unsupported` and anything new.
        _ => CANNOT_SYNCHRONIZE,
    };
    let message = match &failure {
        LinkError::Refused { message, .. } if !message.is_empty() => Some(message.as_str()),
        _ => None,
    };
    // SAFETY: framework constant.
    let domain = unsafe { NSFileProviderErrorDomain };
    match message {
        // Misty's sentence becomes the error's description, which macOS shows for the item.
        Some(message) => {
            let text = NSString::from_str(message);
            let info = objc2_foundation::NSDictionary::<
                objc2_foundation::NSErrorUserInfoKey,
                objc2::runtime::AnyObject,
            >::from_slices(&[NSError::NSLocalizedDescriptionKey()], &[text.as_ref()]);
            // SAFETY: a plain dictionary of one string, which the error copies.
            unsafe { NSError::errorWithDomain_code_userInfo(domain, code, Some(&info)) }
        }
        None => NSError::new(code, domain),
    }
}

fn progress() -> Retained<NSProgress> {
    NSProgress::discreteProgressWithTotalUnitCount(1)
}

fn ms(date: Option<Retained<NSDate>>) -> Option<i64> {
    date.map(|date| (date.timeIntervalSince1970() * 1000.0) as i64)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64)
}

fn path(url: &NSURL) -> Option<String> {
    url.path().map(|path| path.to_string())
}

/// What a template or changed item says, read through its protocol's selectors.
struct Described {
    name: String,
    parent: String,
    folder: bool,
    modified_ms: Option<i64>,
    last_used_ms: Option<i64>,
    symlink: bool,
}

fn describe(item: &NSFileProviderItem) -> Described {
    // SAFETY: plain NSFileProviderItem getters; the optional ones are asked only when the item
    // answers them.
    unsafe {
        let name: Retained<NSString> = msg_send![item, filename];
        let parent: Retained<NSFileProviderItemIdentifier> = msg_send![item, parentItemIdentifier];
        let answers =
            |selector: objc2::runtime::Sel| -> bool { msg_send![item, respondsToSelector: selector] };
        // Any directory is a folder to Misty, packages (`.app`, `.rtfd`) included: macOS hands
        // their contents over item by item, never as one file.
        let folder = if answers(objc2::sel!(contentType)) {
            let kind: Retained<UTType> = msg_send![item, contentType];
            kind.conformsToType(UTTypeDirectory)
        } else {
            false
        };
        let modified_ms = if answers(objc2::sel!(contentModificationDate)) {
            ms(msg_send![item, contentModificationDate])
        } else {
            None
        };
        let last_used_ms = if answers(objc2::sel!(lastUsedDate)) {
            ms(msg_send![item, lastUsedDate])
        } else {
            None
        };
        let symlink = if answers(objc2::sel!(symlinkTargetPath)) {
            let target: Option<Retained<NSString>> = msg_send![item, symlinkTargetPath];
            target.is_some()
        } else {
            false
        };
        Described {
            name: name.to_string(),
            parent: to_misty(&parent),
            folder,
            modified_ms,
            last_used_ms,
            symlink,
        }
    }
}

/// The item macOS is told about, as a protocol object it can keep.
fn system_item(info: ItemInfo) -> Retained<ProtocolObject<dyn objc2_file_provider::NSFileProviderItemProtocol>> {
    ProtocolObject::from_retained(DriveItem::new(info))
}

pub struct ExtensionIvars {
    link: Arc<Link>,
    /// The Space's name, which is the root folder's name in Finder.
    name: String,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements, and the extension doesn't implement Drop.
    #[unsafe(super(NSObject))]
    #[name = "MistyDriveExtension"]
    #[ivars = ExtensionIvars]
    pub struct MistyDriveExtension;

    unsafe impl NSObjectProtocol for MistyDriveExtension {}

    unsafe impl NSFileProviderEnumerating for MistyDriveExtension {
        #[unsafe(method_id(enumeratorForContainerItemIdentifier:request:error:))]
        fn enumerator(
            &self,
            container: &NSFileProviderItemIdentifier,
            _request: &NSFileProviderRequest,
            _error: *mut *mut NSError,
        ) -> Option<Retained<ProtocolObject<dyn NSFileProviderEnumerator>>> {
            let enumerator = DriveEnumerator::new(self.ivars().link.clone(), to_misty(container));
            Some(ProtocolObject::from_retained(enumerator))
        }
    }

    unsafe impl NSFileProviderReplicatedExtension for MistyDriveExtension {
        #[unsafe(method_id(initWithDomain:))]
        fn init_with_domain(this: Allocated<Self>, domain: &NSFileProviderDomain) -> Retained<Self> {
            // SAFETY: plain NSFileProviderDomain getters.
            let (identifier, name): (Retained<NSString>, Retained<NSString>) =
                unsafe { (msg_send![domain, identifier], msg_send![domain, displayName]) };
            let link = Arc::new(Link::new(identifier.to_string()));
            link.sweep_staging();
            let this = this.set_ivars(ExtensionIvars {
                link,
                name: name.to_string(),
            });
            // SAFETY: NSObject's designated initializer.
            unsafe { msg_send![super(this), init] }
        }

        #[unsafe(method(invalidate))]
        fn invalidate(&self) {}

        #[unsafe(method_id(itemForIdentifier:request:completionHandler:))]
        fn item_for_identifier(
            &self,
            identifier: &NSFileProviderItemIdentifier,
            _request: &NSFileProviderRequest,
            handler: &DynBlock<dyn Fn(*mut NSFileProviderItem, *mut NSError)>,
        ) -> Retained<NSProgress> {
            let id = to_misty(identifier);
            let link = self.ivars().link.clone();
            let name = self.ivars().name.clone();
            let handler = send::block(handler);
            send::spawn(move || {
                let handler = handler.into_inner();
                // The root is the Space itself; it never changes and needs no question.
                let found = if id == "root" {
                    Ok(ItemInfo {
                        id: "root".into(),
                        parent: "root".into(),
                        name,
                        kind: "folder".into(),
                        size: 0,
                        mtime_ms: 0,
                        last_used_ms: None,
                        content_version: "root".into(),
                        meta_version: "root".into(),
                    })
                } else if id == "trash" || id == "working_set" {
                    // The system's own containers aren't items Misty has.
                    Err(LinkError::Refused {
                        code: "not_found".into(),
                        message: String::new(),
                    })
                } else {
                    link.item(&id)
                };
                match found {
                    Ok(info) => {
                        let item = system_item(info);
                        handler.call((Retained::as_ptr(&item) as *mut _, std::ptr::null_mut()));
                    }
                    Err(failure) => {
                        let error = error(failure);
                        handler.call((std::ptr::null_mut(), Retained::as_ptr(&error) as *mut _));
                    }
                }
            });
            progress()
        }

        #[unsafe(method_id(fetchContentsForItemWithIdentifier:version:request:completionHandler:))]
        fn fetch_contents(
            &self,
            identifier: &NSFileProviderItemIdentifier,
            version: Option<&NSFileProviderItemVersion>,
            _request: &NSFileProviderRequest,
            handler: &DynBlock<dyn Fn(*mut NSURL, *mut NSFileProviderItem, *mut NSError)>,
        ) -> Retained<NSProgress> {
            let _ = version; // Misty always hands over the version it has; macOS checks it.
            let id = to_misty(identifier);
            let link = self.ivars().link.clone();
            let handler = send::block(handler);
            send::spawn(move || {
                let handler = handler.into_inner();
                match link.fetch(&id) {
                    Ok(fetched) => {
                        let url = NSURL::fileURLWithPath(&NSString::from_str(
                            &fetched.path.to_string_lossy(),
                        ));
                        let item = system_item(fetched.item);
                        handler.call((
                            Retained::as_ptr(&url) as *mut _,
                            Retained::as_ptr(&item) as *mut _,
                            std::ptr::null_mut(),
                        ));
                    }
                    Err(failure) => {
                        let error = error(failure);
                        handler.call((
                            std::ptr::null_mut(),
                            std::ptr::null_mut(),
                            Retained::as_ptr(&error) as *mut _,
                        ));
                    }
                }
            });
            progress()
        }

        #[unsafe(method_id(createItemBasedOnTemplate:fields:contents:options:request:completionHandler:))]
        fn create_item(
            &self,
            template: &NSFileProviderItem,
            _fields: NSFileProviderItemFields,
            contents: Option<&NSURL>,
            options: NSFileProviderCreateItemOptions,
            _request: &NSFileProviderRequest,
            handler: &DynBlock<
                dyn Fn(*mut NSFileProviderItem, NSFileProviderItemFields, Bool, *mut NSError),
            >,
        ) -> Retained<NSProgress> {
            let described = describe(template);
            let contents = contents.and_then(path);
            let may_exist = options.0 & MAY_ALREADY_EXIST != 0;
            let link = self.ivars().link.clone();
            let handler = send::block(handler);
            send::spawn(move || {
                let handler = handler.into_inner();
                let created = if described.symlink {
                    // Links stay on this Mac, as in every other place Misty uploads from.
                    Err(LinkError::Refused {
                        code: "excluded".into(),
                        message: String::new(),
                    })
                } else {
                    contents
                        .as_deref()
                        .map(|path| link.stage(std::path::Path::new(path)))
                        .transpose()
                        .and_then(|staged| {
                            let created = link.create(
                                &described.parent,
                                &described.name,
                                described.folder,
                                staged.as_deref(),
                                described.modified_ms.or_else(|| Some(now_ms())),
                                may_exist,
                            );
                            if created.is_err() {
                                Link::unstage(staged.as_deref());
                            }
                            created
                        })
                };
                answer_change(&handler, created);
            });
            progress()
        }

        #[unsafe(method_id(modifyItem:baseVersion:changedFields:contents:options:request:completionHandler:))]
        fn modify_item(
            &self,
            item: &NSFileProviderItem,
            base: &NSFileProviderItemVersion,
            changed: NSFileProviderItemFields,
            contents: Option<&NSURL>,
            _options: NSFileProviderModifyItemOptions,
            _request: &NSFileProviderRequest,
            handler: &DynBlock<
                dyn Fn(*mut NSFileProviderItem, NSFileProviderItemFields, Bool, *mut NSError),
            >,
        ) -> Retained<NSProgress> {
            // SAFETY: a plain NSFileProviderItem getter.
            let identifier: Retained<NSFileProviderItemIdentifier> =
                unsafe { msg_send![item, itemIdentifier] };
            let id = to_misty(&identifier);
            let described = describe(item);
            let (content_version, meta_version) = version_parts(base);
            let contents = contents.and_then(path);
            let changed = changed.0;
            let link = self.ivars().link.clone();
            let handler = send::block(handler);
            send::spawn(move || {
                let handler = handler.into_inner();
                let base = ItemInfo::base_version(&meta_version);
                let modified = if changed & PARENT != 0 && described.parent == "trash" {
                    // Moved to the Trash: a trash move in the Space. Once it's there the item leaves
                    // the drive, so macOS is answered with the item as it handed it over.
                    let trashed = ItemInfo {
                        id: id.clone(),
                        parent: "trash".into(),
                        name: described.name.clone(),
                        kind: if described.folder { "folder" } else { "file" }.into(),
                        size: 0,
                        mtime_ms: described.modified_ms.unwrap_or(0),
                        last_used_ms: described.last_used_ms,
                        content_version: content_version.clone(),
                        meta_version: meta_version.clone(),
                    };
                    move_to_trash(&link, &id, trashed)
                } else {
                    let name = (changed & FILENAME != 0).then_some(described.name.as_str());
                    let parent = (changed & PARENT != 0).then_some(described.parent.as_str());
                    // New content always carries its date: Misty takes an absent one as 0.
                    let mtime = if changed & (MODIFIED | CONTENTS) != 0 {
                        described.modified_ms.or_else(|| (changed & CONTENTS != 0).then(now_ms))
                    } else {
                        None
                    };
                    let staged = if changed & CONTENTS != 0 {
                        contents
                            .as_deref()
                            .map(|path| link.stage(std::path::Path::new(path)))
                            .transpose()
                    } else {
                        Ok(None)
                    };
                    staged.and_then(|staged| {
                        if name.is_none() && parent.is_none() && staged.is_none() && mtime.is_none() {
                            // Only the last-used date (or nothing Misty keeps) changed.
                            return link.item(&id).map(|item| Changed { item, refetch: false });
                        }
                        let modified = link.modify(&id, base, name, parent, staged.as_deref(), mtime);
                        if modified.is_err() {
                            Link::unstage(staged.as_deref());
                        }
                        modified
                    })
                };
                if changed & LAST_USED != 0 {
                    if let Some(at) = described.last_used_ms {
                        // Opened on this Mac: Misty marks the file in use. A failure here only
                        // means the mark is missing, never the change.
                        let _ = link.used(&id, at);
                    }
                }
                // The item answered is what macOS keeps, and Misty doesn't send last-used dates
                // back, so the date macOS just set is kept rather than cleared.
                let modified = modified.map(|mut changed| {
                    if changed.item.last_used_ms.is_none() {
                        changed.item.last_used_ms = described.last_used_ms;
                    }
                    changed
                });
                answer_change(&handler, modified);
            });
            progress()
        }

        #[unsafe(method_id(deleteItemWithIdentifier:baseVersion:options:request:completionHandler:))]
        fn delete_item(
            &self,
            identifier: &NSFileProviderItemIdentifier,
            _base: &NSFileProviderItemVersion,
            options: NSFileProviderDeleteItemOptions,
            _request: &NSFileProviderRequest,
            handler: &DynBlock<dyn Fn(*mut NSError)>,
        ) -> Retained<NSProgress> {
            let id = to_misty(identifier);
            let recursive = options.0 & RECURSIVE != 0;
            let link = self.ivars().link.clone();
            let handler = send::block(handler);
            send::spawn(move || {
                let handler = handler.into_inner();
                // A folder deleted on its own (`rmdir`) goes only when it is empty in the Space
                // too, not just on this Mac, where its items may not have been listed yet.
                if !recursive {
                    if let Ok(page) = link.list(&id, None) {
                        if !page.items.is_empty() {
                            let error = error(LinkError::Refused {
                                code: "not_empty".into(),
                                message: String::new(),
                            });
                            handler.call((Retained::as_ptr(&error) as *mut _,));
                            return;
                        }
                    }
                }
                match link.trash(&id) {
                    Ok(()) => handler.call((std::ptr::null_mut(),)),
                    // Already gone from the Space (trashed from here a moment ago, as emptying
                    // the Finder Trash does after a move to it, or from elsewhere): File Provider
                    // counts an unknown item's deletion as done.
                    Err(failure) if failure.code() == "not_found" => {
                        handler.call((std::ptr::null_mut(),))
                    }
                    Err(failure) if refused_trash(&failure) => {
                        // Misty kept the item (someone has it open): macOS puts it back as it is
                        // now, which it learns through this error.
                        let error = match link.item(&id) {
                            Ok(info) => {
                                let item = system_item(info);
                                // SAFETY: the documented way to build this error, given the item.
                                unsafe {
                                    msg_send![
                                        objc2::class!(NSError),
                                        fileProviderErrorForRejectedDeletionOfItem: &*item
                                    ]
                                }
                            }
                            Err(failure) => error(failure),
                        };
                        let error: Retained<NSError> = error;
                        handler.call((Retained::as_ptr(&error) as *mut _,));
                    }
                    Err(failure) => {
                        let error = error(failure);
                        handler.call((Retained::as_ptr(&error) as *mut _,));
                    }
                }
            });
            progress()
        }
    }
);

/// Answers a create or modify: the item as it now is, nothing left pending, and whether macOS should
/// fetch its contents again.
fn answer_change(
    handler: &block2::RcBlock<
        dyn Fn(*mut NSFileProviderItem, NSFileProviderItemFields, Bool, *mut NSError),
    >,
    result: Result<Changed, LinkError>,
) {
    match result {
        Ok(changed) => {
            let item = system_item(changed.item);
            handler.call((
                Retained::as_ptr(&item) as *mut _,
                NSFileProviderItemFields(0),
                Bool::new(changed.refetch),
                std::ptr::null_mut(),
            ));
        }
        Err(failure) => {
            let error = error(failure);
            handler.call((
                std::ptr::null_mut(),
                NSFileProviderItemFields(0),
                Bool::NO,
                Retained::as_ptr(&error) as *mut _,
            ));
        }
    }
}

/// Misty refused a trash move and kept the item: someone has it open.
fn refused_trash(failure: &LinkError) -> bool {
    failure.code() == "in_use"
}

/// A move to the Trash. If Misty keeps the item, it is answered as it now is, so macOS moves it
/// back out of the Trash.
fn move_to_trash(link: &Link, id: &str, trashed: ItemInfo) -> Result<Changed, LinkError> {
    match link.trash(id) {
        Ok(()) => Ok(Changed {
            item: trashed,
            refetch: false,
        }),
        Err(failure) if refused_trash(&failure) => link.item(id).map(|item| Changed { item, refetch: false }),
        Err(failure) => Err(failure),
    }
}
