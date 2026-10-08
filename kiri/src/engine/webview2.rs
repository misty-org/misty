//! WebView2 on Windows: the PermissionRequested event. WebView2 has no call to
//! stop capture, so the page script keeps the streams it handed out and the
//! host asks it to end them.

use super::{media_verdict, MediaRequest, PageFacts, Reply, StoreScope};
use crate::permissions::{canonical_origin, MediaKind, Verdict};
use std::{cell::RefCell, thread::LocalKey};
use tauri::Webview;
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2PermissionRequestedEventArgs, COREWEBVIEW2_PERMISSION_KIND,
        COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW, COREWEBVIEW2_PERMISSION_STATE_DEFAULT,
        COREWEBVIEW2_PERMISSION_STATE_DENY,
    },
    CallDevToolsProtocolMethodCompletedHandler, PermissionRequestedEventHandler,
};
use windows::core::{Interface, HSTRING, PWSTR};
use windows::Win32::System::Com::CoTaskMemFree;

// Native views that already have one of Kiri's handlers. Holding them keeps a
// closed view's address from passing for a new one; closed views, whose calls
// fail, are dropped as new ones are added. Used on the UI thread only.
thread_local! {
    static MEDIA_HANDLED: RefCell<Vec<ICoreWebView2>> = RefCell::default();
    static FILTERED: RefCell<Vec<ICoreWebView2>> = RefCell::default();
}

/// Records `core` in `views`; false when it was already there.
fn first_install(views: &'static LocalKey<RefCell<Vec<ICoreWebView2>>>, core: &ICoreWebView2) -> bool {
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
unsafe fn take_string(read: impl FnOnce(*mut PWSTR) -> windows::core::Result<()>) -> Option<String> {
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
            let handler = PermissionRequestedEventHandler::create(Box::new(move |sender, args| {
                match args {
                    Some(args) => decide(&label, sender, &args),
                    None => Ok(()),
                }
            }));
            let mut token = 0i64;
            let _ = core.add_PermissionRequested(&handler, &mut token);
        })
        .map_err(|error| error.to_string())
}

pub(super) fn page_facts(
    webview: &Webview,
    reply: Reply<Result<PageFacts, String>>,
) -> Result<(), String> {
    webview
        .with_webview(move |platform| unsafe {
            let url = platform
                .controller()
                .CoreWebView2()
                .ok()
                .and_then(|core| take_string(|p| core.Source(p)));
            let facts = url
                .ok_or_else(|| "The page has no website address.".to_owned())
                .map(|url| PageFacts {
                    // WebView2 does not report mixed content; HTTPS is the best signal.
                    secure: url.starts_with("https:"),
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
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(())));
            let _ = core.CallDevToolsProtocolMethod(
                &HSTRING::from("Input.dispatchKeyEvent"),
                &HSTRING::from(parameters.as_str()),
                &handler,
            );
        })
        .map_err(|error| error.to_string())
}

/// WebView2 has no rule lists, so every request is checked against the
/// content filter as it starts. The handler reads the live configuration, so
/// installing it once per view is enough.
pub(super) fn install_content_filter(webview: &Webview) -> Result<(), String> {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_2, COREWEBVIEW2_WEB_RESOURCE_CONTEXT,
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT,
        },
        WebResourceRequestedEventHandler,
    };
    webview
        .with_webview(move |platform| unsafe {
            let Ok(core) = platform.controller().CoreWebView2() else {
                return;
            };
            if !first_install(&FILTERED, &core) {
                return;
            }
            let Ok(environment) = core.cast::<ICoreWebView2_2>().and_then(|core| core.Environment())
            else {
                return;
            };
            if core
                .AddWebResourceRequestedFilter(
                    &HSTRING::from("*"),
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                )
                .is_err()
            {
                return;
            }
            let handler = WebResourceRequestedEventHandler::create(Box::new(move |sender, args| {
                let Some(args) = args else { return Ok(()) };
                let mut context = COREWEBVIEW2_WEB_RESOURCE_CONTEXT::default();
                args.ResourceContext(&mut context)?;
                let Some(url) = args.Request().ok().and_then(|request| take_string(|p| request.Uri(p)))
                else {
                    return Ok(());
                };
                let page = sender.and_then(|view| take_string(|p| view.Source(p)));
                if crate::content_filter::should_block(
                    &url,
                    page.as_deref(),
                    context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT,
                ) {
                    let response = environment.CreateWebResourceResponse(
                        None::<&windows::Win32::System::Com::IStream>,
                        403,
                        &HSTRING::from("Blocked"),
                        &HSTRING::from(""),
                    )?;
                    args.SetResponse(&response)?;
                }
                Ok(())
            }));
            let mut token = 0i64;
            let _ = core.add_WebResourceRequested(&handler, &mut token);
        })
        .map_err(|error| error.to_string())
}
