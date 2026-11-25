use std::sync::OnceLock;

use objc::runtime::{Object, Sel, BOOL, YES};
use objc::{msg_send, sel, sel_impl};

use super::{override_method, text_of};

const GRANT: isize = 1;
const DENY: isize = 2;
const SHARE_SCREEN: isize = 1;
const REFUSE_SCREEN: isize = 0;

static TRUSTED_ORIGINS: OnceLock<Vec<String>> = OnceLock::new();
static MEDIA: OnceLock<usize> = OnceLock::new();
static DISPLAY: OnceLock<usize> = OnceLock::new();

type MediaPermission = unsafe extern "C-unwind" fn(
    &Object,
    Sel,
    *mut Object,
    *mut Object,
    *mut Object,
    isize,
    *mut Object,
);
type DisplayPermission = unsafe extern "C-unwind" fn(
    &Object,
    Sel,
    *mut Object,
    *mut Object,
    *mut Object,
    BOOL,
    *mut Object,
);
type Decision = block2::Block<dyn Fn(isize)>;

pub(crate) fn set_trusted_media_origins(origins: Vec<String>) {
    let _ = TRUSTED_ORIGINS.set(
        origins
            .into_iter()
            .map(|origin| origin.trim_end_matches('/').to_ascii_lowercase())
            .collect(),
    );
}

pub(super) unsafe fn install() {
    let media: MediaPermission = media_permission;
    override_method(
        c"WryWebViewUIDelegate",
        objc2::sel!(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:),
        std::mem::transmute::<MediaPermission, objc2::runtime::Imp>(media),
        None,
        &MEDIA,
    );
    let display: DisplayPermission = display_permission;
    override_method(
        c"WryWebViewUIDelegate",
        objc2::sel!(_webView:requestDisplayCapturePermissionForOrigin:initiatedByFrame:withSystemAudio:decisionHandler:),
        std::mem::transmute::<DisplayPermission, objc2::runtime::Imp>(display),
        Some(c"v@:@@@B@?"),
        &DISPLAY,
    );
}

unsafe fn trusted(origin: *mut Object, frame: *mut Object) -> bool {
    if origin.is_null() || frame.is_null() {
        return false;
    }
    let main: BOOL = msg_send![frame, isMainFrame];
    if main != YES {
        return false;
    }
    let Some(trusted) = TRUSTED_ORIGINS.get() else {
        return false;
    };
    let protocol: *mut Object = msg_send![origin, protocol];
    let host: *mut Object = msg_send![origin, host];
    let port: isize = msg_send![origin, port];
    let (Some(protocol), Some(host)) = (text_of(protocol), text_of(host)) else {
        return false;
    };
    let mut name = format!("{protocol}://{host}").to_ascii_lowercase();
    if port != 0 {
        name.push_str(&format!(":{port}"));
    }
    trusted.iter().any(|item| *item == name)
}

unsafe fn answer(handler: *mut Object, decision: isize) {
    if let Some(handler) = (handler as *const Decision).as_ref() {
        handler.call((decision,));
    }
}

unsafe extern "C-unwind" fn media_permission(
    _delegate: &Object,
    _command: Sel,
    _webview: *mut Object,
    origin: *mut Object,
    frame: *mut Object,
    _kind: isize,
    handler: *mut Object,
) {
    answer(handler, if trusted(origin, frame) { GRANT } else { DENY });
}

unsafe extern "C-unwind" fn display_permission(
    _delegate: &Object,
    _command: Sel,
    _webview: *mut Object,
    origin: *mut Object,
    frame: *mut Object,
    _system_audio: BOOL,
    handler: *mut Object,
) {
    answer(
        handler,
        if trusted(origin, frame) {
            SHARE_SCREEN
        } else {
            REFUSE_SCREEN
        },
    );
}
