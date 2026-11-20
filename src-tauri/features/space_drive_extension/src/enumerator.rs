//! Lists a folder of a Space's drive for macOS, and what changed since a sync anchor. Folders are
//! listed a page at a time from Misty; changes are asked for on the working set, which macOS keeps
//! for the whole domain, with Misty's change sequence as the anchor.
use std::sync::Arc;

use objc2::{
    define_class, msg_send, rc::Retained, runtime::ProtocolObject, AnyThread, DefinedClass,
};
use objc2_file_provider::{
    NSFileProviderChangeObserver, NSFileProviderEnumerationObserver, NSFileProviderEnumerator,
    NSFileProviderItemIdentifier, NSFileProviderItemProtocol, NSFileProviderPage,
    NSFileProviderSyncAnchor,
};
use objc2_foundation::{NSArray, NSData, NSError, NSObject, NSObjectProtocol};

use crate::{
    extension::error,
    item::{to_system, DriveItem},
    link::{ItemInfo, Link},
    send,
};

/// Pages Misty made start with this, so macOS's own first-page markers are told apart.
const PAGE_PREFIX: &str = "misty-page:";
/// `NSFileProviderErrorSyncAnchorExpired`: macOS lists everything again.
const ANCHOR_EXPIRED: isize = -1002;

pub struct EnumeratorIvars {
    link: Arc<Link>,
    /// `"root"`, `"trash"`, `"working_set"` or an item id.
    container: String,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements, and DriveEnumerator doesn't implement Drop.
    #[unsafe(super(NSObject))]
    #[name = "MistyDriveEnumerator"]
    #[ivars = EnumeratorIvars]
    pub struct DriveEnumerator;

    unsafe impl NSObjectProtocol for DriveEnumerator {}

    unsafe impl NSFileProviderEnumerator for DriveEnumerator {
        #[unsafe(method(invalidate))]
        fn invalidate(&self) {}

        #[unsafe(method(enumerateItemsForObserver:startingAtPage:))]
        fn enumerate_items(
            &self,
            observer: &ProtocolObject<dyn NSFileProviderEnumerationObserver>,
            page: &NSFileProviderPage,
        ) {
            let link = self.ivars().link.clone();
            let container = self.ivars().container.clone();
            let page = misty_page(page);
            let observer = send::object(observer);
            send::spawn(move || {
                let observer = observer.into_inner();
                match link.list(&container, page.as_deref()) {
                    Ok(listed) => {
                        let items = items(listed.items);
                        // SAFETY: observers may be called from any thread, with an array of items.
                        let _: () = unsafe { msg_send![&*observer, didEnumerateItems: &*items] };
                        let next = listed
                            .next_page
                            .map(|next| NSData::with_bytes(format!("{PAGE_PREFIX}{next}").as_bytes()));
                        let _: () =
                            unsafe { msg_send![&*observer, finishEnumeratingUpToPage: next.as_deref()] };
                    }
                    Err(failure) => {
                        let error = error(failure);
                        let _: () = unsafe { msg_send![&*observer, finishEnumeratingWithError: &*error] };
                    }
                }
            });
        }

        #[unsafe(method(enumerateChangesForObserver:fromSyncAnchor:))]
        fn enumerate_changes(
            &self,
            observer: &ProtocolObject<dyn NSFileProviderChangeObserver>,
            anchor: &NSFileProviderSyncAnchor,
        ) {
            let link = self.ivars().link.clone();
            let since = String::from_utf8_lossy(&anchor.to_vec()).into_owned();
            let observer = send::object(observer);
            send::spawn(move || {
                let observer = observer.into_inner();
                match link.changes(&since) {
                    Ok(changes) => {
                        if !changes.updated.is_empty() {
                            let updated = items(changes.updated);
                            // SAFETY: observers may be called from any thread.
                            let _: () = unsafe { msg_send![&*observer, didUpdateItems: &*updated] };
                        }
                        if !changes.deleted.is_empty() {
                            let ids: Vec<Retained<NSFileProviderItemIdentifier>> =
                                changes.deleted.iter().map(|id| to_system(id)).collect();
                            let deleted = NSArray::from_retained_slice(&ids);
                            let _: () = unsafe {
                                msg_send![&*observer, didDeleteItemsWithIdentifiers: &*deleted]
                            };
                        }
                        let anchor = NSData::with_bytes(changes.anchor.as_bytes());
                        let _: () = unsafe {
                            msg_send![
                                &*observer,
                                finishEnumeratingChangesUpToSyncAnchor: &*anchor,
                                moreComing: changes.more
                            ]
                        };
                    }
                    Err(crate::link::LinkError::Refused { code, .. }) if code == "anchor_expired" => {
                        // SAFETY: framework constant.
                        let domain = unsafe { objc2_file_provider::NSFileProviderErrorDomain };
                        let error = NSError::new(ANCHOR_EXPIRED, domain);
                        let _: () = unsafe { msg_send![&*observer, finishEnumeratingWithError: &*error] };
                    }
                    Err(failure) => {
                        let error = error(failure);
                        let _: () = unsafe { msg_send![&*observer, finishEnumeratingWithError: &*error] };
                    }
                }
            });
        }

        #[unsafe(method(currentSyncAnchorWithCompletionHandler:))]
        fn current_sync_anchor(&self, handler: &block2::DynBlock<dyn Fn(*mut NSFileProviderSyncAnchor)>) {
            let link = self.ivars().link.clone();
            let handler = send::block(handler);
            send::spawn(move || {
                let handler = handler.into_inner();
                match link.anchor() {
                    Ok(anchor) => {
                        let anchor = NSData::with_bytes(anchor.as_bytes());
                        handler.call((Retained::as_ptr(&anchor) as *mut NSFileProviderSyncAnchor,));
                    }
                    // No anchor yet: macOS asks again, and lists folders meanwhile.
                    Err(_) => handler.call((std::ptr::null_mut(),)),
                }
            });
        }
    }
);

impl DriveEnumerator {
    pub fn new(link: Arc<Link>, container: String) -> Retained<Self> {
        let this = Self::alloc().set_ivars(EnumeratorIvars { link, container });
        // SAFETY: NSObject's designated initializer.
        unsafe { msg_send![super(this), init] }
    }
}

/// Misty's page token, or `None` for macOS's first-page markers.
fn misty_page(page: &NSFileProviderPage) -> Option<String> {
    let bytes = page.to_vec();
    let text = std::str::from_utf8(&bytes).ok()?;
    text.strip_prefix(PAGE_PREFIX).map(str::to_owned)
}

fn items(infos: Vec<ItemInfo>) -> Retained<NSArray<ProtocolObject<dyn NSFileProviderItemProtocol>>> {
    let items: Vec<Retained<ProtocolObject<dyn NSFileProviderItemProtocol>>> = infos
        .into_iter()
        .map(|info| ProtocolObject::from_retained(DriveItem::new(info)))
        .collect();
    NSArray::from_retained_slice(&items)
}
