//! Google sign-in in macOS's web authentication session, used only while Misty is the default
//! browser: opening the link would land in one of Misty's own tabs, and Google's policy rules out
//! embedded webviews. macOS opens another browser's window for it, which Misty can't size or place.
//! The server ends the sign-in on a misty:// link, which the session catches and closes on.

use std::cell::RefCell;

use block2::RcBlock;
use objc2::{
    class, define_class, msg_send,
    rc::{Allocated, Retained},
    runtime::{AnyObject, Bool, NSObject},
    MainThreadMarker, MainThreadOnly,
};
use objc2_foundation::{NSObjectProtocol, NSString, NSURL};
use tauri::{ipc::Channel, AppHandle, Webview};

#[link(name = "AuthenticationServices", kind = "framework")]
extern "C" {}

const CALLBACK_SCHEME: &str = "misty";

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    struct MistyGoogleSheetAnchor;

    unsafe impl NSObjectProtocol for MistyGoogleSheetAnchor {}

    impl MistyGoogleSheetAnchor {
        /// The window the sheet opens over.
        #[unsafe(method(presentationAnchorForWebAuthenticationSession:))]
        fn presentation_anchor(&self, _session: *mut AnyObject) -> *mut AnyObject {
            unsafe {
                let application: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
                let key: *mut AnyObject = msg_send![application, keyWindow];
                if !key.is_null() {
                    return key;
                }
                msg_send![application, mainWindow]
            }
        }
    }
);

impl MistyGoogleSheetAnchor {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = mtm.alloc::<Self>().set_ivars(());
        unsafe { msg_send![super(this), init] }
    }
}

/// AppKit holds neither of these for us while the sheet is up.
struct Sheet {
    session: Retained<AnyObject>,
    _anchor: Retained<MistyGoogleSheetAnchor>,
}

thread_local! {
    /// Only touched on the main thread: synchronous commands and `run_on_main_thread`.
    static SHEET: RefCell<Option<Sheet>> = const { RefCell::new(None) };
}

fn dismiss() {
    let Some(sheet) = SHEET.with(|current| current.borrow_mut().take()) else {
        return;
    };
    unsafe {
        let _: () = msg_send![&*sheet.session, cancel];
    }
}

/// `closed` gets the misty:// link the sign-in ended on, or nothing if the sheet was closed.
/// An error means no sheet opened, so the caller uses the system browser.
#[tauri::command]
pub fn google_sign_in_sheet_open(
    caller: Webview,
    app: AppHandle,
    url: String,
    closed: Channel<Option<String>>,
) -> Result<(), String> {
    // Web pages must not be able to put up a sign-in sheet.
    if caller.label().starts_with("misty-browser-") {
        return Err("Only Misty can open the sign-in sheet.".to_owned());
    }
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("The sign-in sheet only opens web addresses.".to_owned());
    }
    let mtm = MainThreadMarker::new().ok_or("The sign-in sheet opens on the main thread.")?;
    let address = NSURL::URLWithString(&NSString::from_str(&url))
        .ok_or("The sign-in address could not be read.")?;
    dismiss();

    let completed = RcBlock::new(move |callback: *mut NSURL, _error: *mut AnyObject| {
        let link = (!callback.is_null()).then(|| unsafe {
            let text: *mut NSString = msg_send![callback, absoluteString];
            text.as_ref().map(|text| text.to_string())
        });
        let _ = closed.send(link.flatten());
        let _ = app.run_on_main_thread(|| SHEET.with(|current| drop(current.borrow_mut().take())));
    });
    let anchor = MistyGoogleSheetAnchor::new(mtm);
    let scheme = NSString::from_str(CALLBACK_SCHEME);
    unsafe {
        let allocated: Allocated<AnyObject> = msg_send![class!(ASWebAuthenticationSession), alloc];
        let session: Option<Retained<AnyObject>> = msg_send![
            allocated,
            initWithURL: &*address,
            callbackURLScheme: &*scheme,
            completionHandler: &*completed
        ];
        let session = session.ok_or("The sign-in sheet could not be made.")?;
        let provider: *const MistyGoogleSheetAnchor = &*anchor;
        let provider = provider as *mut AnyObject;
        let _: () = msg_send![&*session, setPresentationContextProvider: provider];
        let started: Bool = msg_send![&*session, start];
        if !started.as_bool() {
            return Err("The sign-in sheet could not open.".to_owned());
        }
        SHEET.with(|current| {
            *current.borrow_mut() = Some(Sheet {
                session,
                _anchor: anchor,
            });
        });
    }
    Ok(())
}

/// Closes the sheet when the sign-in ended some other way.
#[tauri::command]
pub fn google_sign_in_sheet_close() {
    dismiss();
}
