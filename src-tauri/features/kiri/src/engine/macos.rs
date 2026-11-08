//! WebKit on macOS: the UI delegate's media-capture and geolocation
//! callbacks, and capture state on the view. A request still to be asked is held here while the
//! host asks in its own interface. The positions themselves come from `macos_location`.
#![allow(unexpected_cfgs)]

use super::{
    ask, location_verdict, media_verdict, AskAnswer, LocationRequest, MediaRequest, PageFacts,
    PermissionAsk, Reply, StoreScope,
};
use crate::permissions::{canonical_origin, MediaKind, PermissionKind, Verdict};
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

const DELEGATE_CLASS: &str = "KiriSitePermissionDelegate";

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

fn label(webview: *mut Object) -> String {
    labels()
        .lock()
        .ok()
        .and_then(|labels| labels.get(&(webview as usize)).cloned())
        .unwrap_or_default()
}

/// WKPermissionDecision: Prompt=0, Grant=1, Deny=2. On Prompt WebKit shows its
/// own sheet naming the requesting site.
fn decision(verdict: Verdict) -> usize {
    match verdict {
        Verdict::Prompt => 0,
        Verdict::Grant => 1,
        Verdict::Deny => 2,
    }
}

type DecisionBlock = block2::Block<dyn Fn(usize)>;

/// Answers a request, first offering one still to be asked to the host. The handler outlives this
/// callback only as the copy the answer holds.
unsafe fn answer(handler: *mut Object, verdict: Verdict, request: impl FnOnce() -> PermissionAsk) {
    let handler = handler.cast::<DecisionBlock>();
    if verdict == Verdict::Prompt {
        if let Some(held) = block2::RcBlock::copy(handler) {
            let answer = AskAnswer::new(move |allow| {
                held.call((decision(if allow { Verdict::Grant } else { Verdict::Deny }),));
            });
            let Some(returned) = ask(request(), answer) else {
                return;
            };
            // The host won't ask. Forget the held answer without answering: WebKit asks instead.
            std::mem::forget(returned);
        }
    }
    (&*handler).call((decision(verdict),));
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
            webview: label(webview),
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
        let ask = PermissionAsk {
            webview: request.webview.clone(),
            top_origin: request.top_origin.clone(),
            requester_origin: request.requester_origin.clone(),
            kinds: match request.kind {
                Some(MediaKind::Camera) => vec![PermissionKind::Camera],
                Some(MediaKind::Microphone) => vec![PermissionKind::Microphone],
                Some(MediaKind::CameraAndMicrophone) => {
                    vec![PermissionKind::Camera, PermissionKind::Microphone]
                }
                None => Vec::new(),
            },
            store: request.store.clone(),
        };
        answer(handler, media_verdict(&request), || ask);
    }
}

/// WebKit's private `WKUIDelegatePrivate` geolocation callback (macOS 12+).
/// Without it WebKit refuses every location request on macOS. A grant then
/// reads the position through `macos_location`.
extern "C" fn location_permission(
    _delegate: &Object,
    _selector: Sel,
    webview: *mut Object,
    origin: *mut Object,
    _frame: *mut Object,
    handler: *mut Object,
) {
    unsafe {
        let view = &*webview.cast::<WKWebView>();
        let request = LocationRequest {
            webview: label(webview),
            top_origin: page_url(view).and_then(|url| canonical_origin(&url).ok()),
            requester_origin: requester_origin(&*origin.cast::<WKSecurityOrigin>()),
            store: Some(store_scope(view)),
        };
        let ask = PermissionAsk {
            webview: request.webview.clone(),
            top_origin: request.top_origin.clone(),
            requester_origin: request.requester_origin.clone(),
            kinds: vec![PermissionKind::Location],
            store: request.store.clone(),
        };
        answer(handler, location_verdict(&request), || ask);
    }
}

pub(super) fn install_site_permissions(webview: &Webview) -> Result<(), String> {
    let label = webview.label().to_owned();
    webview
        .with_webview(move |native| unsafe {
            let view = native.inner() as *mut Object;
            if let Ok(mut labels) = labels().lock() {
                labels.insert(view as usize, label);
            }
            super::macos_location::attach(view);
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
                declaration.add_method(
                    sel!(_webView:requestGeolocationPermissionForOrigin:initiatedByFrame:decisionHandler:),
                    location_permission
                        as extern "C" fn(&Object, Sel, *mut Object, *mut Object, *mut Object, *mut Object),
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
                view.setCameraCaptureState_completionHandler(
                    WKMediaCaptureState::None,
                    Some(&done),
                );
            }
            if microphone {
                view.setMicrophoneCaptureState_completionHandler(
                    WKMediaCaptureState::None,
                    Some(&done),
                );
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
