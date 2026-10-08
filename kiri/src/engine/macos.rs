//! WebKit on macOS: the UI delegate's media-capture callback, and capture
//! state on the view.
#![allow(unexpected_cfgs)]

use super::{media_verdict, MediaRequest, PageFacts, Reply, StoreScope};
use crate::permissions::{canonical_origin, MediaKind, Verdict};
use objc::runtime::{Class, Object, Sel};
use objc::{msg_send, sel, sel_impl};
use objc2_foundation::NSProcessInfo;
use objc2_web_kit::{WKMediaCaptureState, WKSecurityOrigin, WKWebView};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    rc::Rc,
    sync::{Mutex, OnceLock},
};
use tauri::Webview;

const DELEGATE_CLASS: &str = "KiriMediaPermissionDelegate";

/// Native view → the embedder's tab label, recorded at install.
fn labels() -> &'static Mutex<HashMap<usize, String>> {
    static LABELS: OnceLock<Mutex<HashMap<usize, String>>> = OnceLock::new();
    LABELS.get_or_init(Mutex::default)
}

unsafe fn store_scope(view: &WKWebView) -> StoreScope {
    persistent_identifier(view)
        .map(StoreScope::Persistent)
        .unwrap_or_else(|| {
            StoreScope::Temporary(&*view.configuration().websiteDataStore() as *const _ as usize)
        })
}

unsafe fn persistent_identifier(view: &WKWebView) -> Option<String> {
    let store = view.configuration().websiteDataStore();
    // The identifier selector was added in macOS 14. Ephemeral stores never persist choices.
    if !store.isPersistent()
        || NSProcessInfo::processInfo()
            .operatingSystemVersion()
            .majorVersion
            < 14
    {
        return None;
    }
    store.identifier().map(|id| id.UUIDString().to_string())
}

unsafe fn page_url(view: &WKWebView) -> Option<String> {
    Some(view.URL()?.absoluteString()?.to_string())
}

unsafe fn requester_origin(origin: &WKSecurityOrigin) -> Option<String> {
    let host = origin.host().to_string();
    let host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host
    };
    let port = origin.port();
    let port = if port > 0 {
        format!(":{port}")
    } else {
        String::new()
    };
    canonical_origin(&format!("{}://{host}{port}", origin.protocol())).ok()
}

extern "C" fn media_permission(
    _delegate: &Object,
    _selector: Sel,
    webview: *mut Object,
    origin: *mut Object,
    _frame: *mut Object,
    capture_type: usize,
    handler: *mut Object,
) {
    unsafe {
        let view = &*webview.cast::<WKWebView>();
        let request = MediaRequest {
            webview: labels()
                .lock()
                .ok()
                .and_then(|labels| labels.get(&(webview as usize)).cloned())
                .unwrap_or_default(),
            top_origin: page_url(view).and_then(|url| canonical_origin(&url).ok()),
            requester_origin: requester_origin(&*origin.cast::<WKSecurityOrigin>()),
            // WKMediaCaptureType: Camera=0, Microphone=1, CameraAndMicrophone=2.
            kind: match capture_type {
                0 => Some(MediaKind::Camera),
                1 => Some(MediaKind::Microphone),
                2 => Some(MediaKind::CameraAndMicrophone),
                _ => None,
            },
            store: Some(store_scope(view)),
        };
        // WKPermissionDecision: Prompt=0, Grant=1, Deny=2.
        let decision: usize = match media_verdict(&request) {
            Verdict::Prompt => 0,
            Verdict::Grant => 1,
            Verdict::Deny => 2,
        };
        (&*handler.cast::<block2::Block<dyn Fn(usize)>>()).call((decision,));
    }
}

pub(super) fn install_media_permissions(webview: &Webview) -> Result<(), String> {
    let label = webview.label().to_owned();
    webview
        .with_webview(move |native| unsafe {
            let view = native.inner() as *mut Object;
            if let Ok(mut labels) = labels().lock() {
                labels.insert(view as usize, label);
            }
            let delegate: *mut Object = msg_send![view, UIDelegate];
            if delegate.is_null() || (*delegate).class().name() == DELEGATE_CLASS {
                return;
            }
            let subclass = Class::get(DELEGATE_CLASS).unwrap_or_else(|| {
                let mut declaration =
                    objc::declare::ClassDecl::new(DELEGATE_CLASS, (*delegate).class())
                        .expect("unique media permission delegate class");
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

pub(super) fn page_facts(
    webview: &Webview,
    reply: Reply<Result<PageFacts, String>>,
) -> Result<(), String> {
    webview
        .with_webview(move |native| unsafe {
            let view: &WKWebView = &*native.inner().cast();
            let facts = page_url(view)
                .ok_or_else(|| "The page has no website address.".to_owned())
                .map(|url| PageFacts {
                    secure: view.hasOnlySecureContent() && url.starts_with("https:"),
                    url,
                    store: Some(store_scope(view)),
                });
            let _ = reply.send(facts);
        })
        .map_err(|error| error.to_string())
}

pub(super) fn stop_capture(
    webview: &Webview,
    store: Option<StoreScope>,
    camera: bool,
    microphone: bool,
    reply: Reply<()>,
) -> Result<(), String> {
    webview
        .with_webview(move |native| unsafe {
            let view: &WKWebView = &*native.inner().cast();
            if store.is_some_and(|store| store != store_scope(view)) {
                let _ = reply.send(());
                return;
            }
            let remaining = Rc::new(Cell::new(usize::from(camera) + usize::from(microphone)));
            let reply = Rc::new(RefCell::new(Some(reply)));
            let done = block2::RcBlock::new(move || {
                remaining.set(remaining.get().saturating_sub(1));
                if remaining.get() == 0 {
                    if let Some(reply) = reply.borrow_mut().take() {
                        let _ = reply.send(());
                    }
                }
            });
            if camera {
                view.setCameraCaptureState_completionHandler(WKMediaCaptureState::None, Some(&done));
            }
            if microphone {
                view.setMicrophoneCaptureState_completionHandler(WKMediaCaptureState::None, Some(&done));
            }
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
