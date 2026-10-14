//! WebView2 on Windows: the PermissionRequested event. WebView2 has no call to
//! stop capture, so the page script keeps the streams it handed out and the
//! host asks it to end them. Whether a page arrived wholly over secure
//! connections comes from Chromium's DevTools Security domain, which WebView2
//! has no property for.

use super::{media_verdict, MediaRequest, PageFacts, Reply, StoreScope};
use crate::permissions::{canonical_origin, MediaKind, Verdict};
use std::{cell::RefCell, thread::LocalKey};
use tauri::Webview;
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler, DevToolsProtocolEventReceivedEventHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2PermissionRequestedEventArgs, COREWEBVIEW2_PERMISSION_KIND,
        COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW, COREWEBVIEW2_PERMISSION_STATE_DEFAULT,
        COREWEBVIEW2_PERMISSION_STATE_DENY,
    },
    PermissionRequestedEventHandler,
};
use windows::core::{HSTRING, PWSTR};
use windows::Win32::System::Com::CoTaskMemFree;

// Native views that already have one of Kiri's handlers. Holding them keeps a
// closed view's address from passing for a new one; closed views, whose calls
// fail, are dropped as new ones are added. Used on the UI thread only.
thread_local! {
    static MEDIA_HANDLED: RefCell<Vec<ICoreWebView2>> = RefCell::default();
    /// The last state Chromium reported for each view: whether everything on
    /// the page arrived over secure connections.
    static SECURE: RefCell<Vec<(ICoreWebView2, bool)>> = RefCell::default();
}

fn record_security(view: ICoreWebView2, secure: bool) {
    SECURE.with(|states| {
        let mut states = states.borrow_mut();
        states.retain(|(other, _)| unsafe { other.Settings() }.is_ok() && *other != view);
        states.push((view, secure));
    });
}

fn reported_security(view: &ICoreWebView2) -> Option<bool> {
    SECURE.with(|states| {
        states
            .borrow()
            .iter()
            .find(|(other, _)| other == view)
            .map(|(_, secure)| *secure)
    })
}

/// Follows the page's security state: mixed content or a certificate
/// problem makes Chromium report it as other than `secure`.
unsafe fn watch_security(core: &ICoreWebView2) {
    let Ok(receiver) = core
        .GetDevToolsProtocolEventReceiver(&HSTRING::from("Security.visibleSecurityStateChanged"))
    else {
        return;
    };
    // The view arrives as the sender; holding it here would keep it alive.
    let handler = DevToolsProtocolEventReceivedEventHandler::create(Box::new(|sender, args| {
        let state = args
            .and_then(|args| take_string(|p| args.ParameterObjectAsJson(p)))
            .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok());
        if let (Some(view), Some(state)) = (sender, state) {
            let level = &state["visibleSecurityState"]["securityState"];
            record_security(view, level == "secure");
        }
        Ok(())
    }));
    let mut token = 0i64;
    if receiver
        .add_DevToolsProtocolEventReceived(&handler, &mut token)
        .is_err()
    {
        return;
    }
    let enabled = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(())));
    let _ = core.CallDevToolsProtocolMethod(
        &HSTRING::from("Security.enable"),
        &HSTRING::from("{}"),
        &enabled,
    );
}

/// Records `core` in `views`; false when it was already there.
fn first_install(
    views: &'static LocalKey<RefCell<Vec<ICoreWebView2>>>,
    core: &ICoreWebView2,
) -> bool {
    views.with(|views| {
        let mut views = views.borrow_mut();
        views.retain(|view| unsafe { view.Settings() }.is_ok());
        if views.contains(core) {
            return false;
        }
        views.push(core.clone());
        true
    })
}

// Frees native strings even when the call fails after allocating them.
unsafe fn take_string(
    read: impl FnOnce(*mut PWSTR) -> windows::core::Result<()>,
) -> Option<String> {
    let mut pointer = PWSTR::null();
    let status = read(&mut pointer);
    let value = if status.is_ok() && !pointer.is_null() {
        pointer.to_string().ok()
    } else {
        None
    };
    if !pointer.is_null() {
        CoTaskMemFree(Some(pointer.0.cast()));
    }
    value
}

fn origin(url: Option<String>) -> Option<String> {
    url.and_then(|url| canonical_origin(&url).ok())
}

fn decide(
    label: &str,
    sender: Option<ICoreWebView2>,
    args: &ICoreWebView2PermissionRequestedEventArgs,
) -> windows::core::Result<()> {
    unsafe {
        let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
        args.PermissionKind(&mut kind)?;
        let kind = if kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA {
            MediaKind::Camera
        } else if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
            MediaKind::Microphone
        } else {
            // Other permissions keep WebView2's own handling.
            return Ok(());
        };
        let request = MediaRequest {
            webview: label.to_owned(),
            top_origin: origin(sender.and_then(|view| take_string(|p| view.Source(p)))),
            requester_origin: origin(take_string(|p| args.Uri(p))),
            kind: Some(kind),
            store: None,
        };
        args.SetState(match media_verdict(&request) {
            Verdict::Prompt => COREWEBVIEW2_PERMISSION_STATE_DEFAULT,
            Verdict::Grant => COREWEBVIEW2_PERMISSION_STATE_ALLOW,
            Verdict::Deny => COREWEBVIEW2_PERMISSION_STATE_DENY,
        })
    }
}

pub(super) fn install_media_permissions(webview: &Webview) -> Result<(), String> {
    let label = webview.label().to_owned();
    webview
        .with_webview(move |platform| unsafe {
            let Ok(core) = platform.controller().CoreWebView2() else {
                return;
            };
            if !first_install(&MEDIA_HANDLED, &core) {
                return;
            }
            let handler =
                PermissionRequestedEventHandler::create(Box::new(move |sender, args| match args {
                    Some(args) => decide(&label, sender, &args),
                    None => Ok(()),
                }));
            let mut token = 0i64;
            let _ = core.add_PermissionRequested(&handler, &mut token);
            watch_security(&core);
        })
        .map_err(|error| error.to_string())
}

pub(super) fn page_facts(
    webview: &Webview,
    reply: Reply<Result<PageFacts, String>>,
) -> Result<(), String> {
    webview
        .with_webview(move |platform| unsafe {
            let core = platform.controller().CoreWebView2().ok();
            let url = core
                .as_ref()
                .and_then(|core| take_string(|p| core.Source(p)));
            // Before Chromium's first report, HTTPS is the best signal.
            let reported = core.as_ref().and_then(reported_security);
            let facts = url
                .ok_or_else(|| "The page has no website address.".to_owned())
                .map(|url| PageFacts {
                    secure: url.starts_with("https:") && reported != Some(false),
                    url,
                    store: None,
                });
            let _ = reply.send(facts);
        })
        .map_err(|error| error.to_string())
}

pub(super) fn stop_capture(
    webview: &Webview,
    _store: Option<StoreScope>,
    camera: bool,
    microphone: bool,
    reply: Reply<()>,
) -> Result<(), String> {
    // The hook is defined by the media shim before site scripts run, and
    // cannot be replaced by them.
    webview
        .eval(format!(
            "(() => {{ const stop = window.__kiriStopCapture; if (typeof stop === 'function') stop({camera}, {microphone}); }})();"
        ))
        .map_err(|error| error.to_string())?;
    let _ = reply.send(());
    Ok(())
}

/// WebView2 has no editing-command call; the DevTools Protocol runs the same
/// editor commands a key binding would, without a user gesture.
pub(super) fn edit(webview: &Webview, command: super::EditCommand) -> Result<(), String> {
    let name = match command {
        super::EditCommand::Copy => "copy",
        super::EditCommand::Cut => "cut",
        super::EditCommand::Paste => "paste",
    };
    let parameters = format!(r#"{{"type":"rawKeyDown","commands":["{name}"]}}"#);
    webview
        .with_webview(move |platform| unsafe {
            let Ok(core) = platform.controller().CoreWebView2() else {
                return;
            };
            let handler =
                CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(())));
            let _ = core.CallDevToolsProtocolMethod(
                &HSTRING::from("Input.dispatchKeyEvent"),
                &HSTRING::from(parameters.as_str()),
                &handler,
            );
        })
        .map_err(|error| error.to_string())
}
