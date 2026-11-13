//! WebKit on macOS: the UI delegate's media-capture callback, answered with a refusal. Without the
//! method WebKit asks the person itself. Location needs no hook: WebKit refuses it on macOS unless
//! the delegate answers its private geolocation callback.
#![allow(unexpected_cfgs)]

use objc::runtime::{Class, Object, Sel};
use objc::{msg_send, sel, sel_impl};
use tauri::Webview;

const DELEGATE_CLASS: &str = "KiriSitePermissionDelegate";

/// WKPermissionDecisionDeny.
const DENY: usize = 2;

type DecisionBlock = block2::Block<dyn Fn(usize)>;

extern "C" fn media_permission(
    _delegate: &Object,
    _selector: Sel,
    _webview: *mut Object,
    _origin: *mut Object,
    _frame: *mut Object,
    _capture_type: usize,
    handler: *mut Object,
) {
    unsafe { (&*handler.cast::<DecisionBlock>()).call((DENY,)) };
}

pub(super) fn deny_permission_requests(webview: &Webview) -> Result<(), String> {
    webview
        .with_webview(move |native| unsafe {
            let view = native.inner() as *mut Object;
            let delegate: *mut Object = msg_send![view, UIDelegate];
            if delegate.is_null() || (*delegate).class().name() == DELEGATE_CLASS {
                return;
            }
            let subclass = Class::get(DELEGATE_CLASS).unwrap_or_else(|| {
                let mut declaration =
                    objc::declare::ClassDecl::new(DELEGATE_CLASS, (*delegate).class())
                        .expect("unique site permission delegate class");
                declaration.add_method(
                    sel!(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:),
                    media_permission
                        as extern "C" fn(&Object, Sel, *mut Object, *mut Object, *mut Object, usize, *mut Object),
                );
                declaration.register()
            });
            extern "C" {
                fn object_setClass(object: *mut Object, class: *const Class) -> *const Class;
            }
            // Same-size subclass preserves Wry's upload and popup delegate behavior.
            object_setClass(delegate, subclass);
            let _: () = msg_send![view, setUIDelegate: std::ptr::null_mut::<Object>()];
            let _: () = msg_send![view, setUIDelegate: delegate];
        })
        .map_err(|error| error.to_string())
}

pub(super) fn edit(webview: &Webview, command: super::EditCommand) -> Result<(), String> {
    webview
        .with_webview(move |native| unsafe {
            let view = native.inner() as *mut Object;
            let sender = std::ptr::null_mut::<Object>();
            let _: () = match command {
                super::EditCommand::Copy => msg_send![view, copy: sender],
                super::EditCommand::Cut => msg_send![view, cut: sender],
                super::EditCommand::Paste => msg_send![view, paste: sender],
            };
        })
        .map_err(|error| error.to_string())
}
