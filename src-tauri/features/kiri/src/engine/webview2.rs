//! WebView2 on Windows: the PermissionRequested event, answered with a refusal for everything a
//! page asks for, so WebView2 never asks the person.

use std::cell::RefCell;
use tauri::Webview;
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler,
    Microsoft::Web::WebView2::Win32::{ICoreWebView2, COREWEBVIEW2_PERMISSION_STATE_DENY},
    PermissionRequestedEventHandler,
};
use windows::core::HSTRING;

// Native views that already have Kiri's handler. Holding them keeps a closed view's address from
// passing for a new one; closed views, whose calls fail, are dropped as new ones are added. Used
// on the UI thread only.
thread_local! {
    static HANDLED: RefCell<Vec<ICoreWebView2>> = RefCell::default();
}

/// Records `core`; false when it was already there.
fn first_install(core: &ICoreWebView2) -> bool {
    HANDLED.with(|views| {
        let mut views = views.borrow_mut();
        views.retain(|view| unsafe { view.Settings() }.is_ok());
        if views.contains(core) {
            return false;
        }
        views.push(core.clone());
        true
    })
}

pub(super) fn deny_permission_requests(webview: &Webview) -> Result<(), String> {
    webview
        .with_webview(move |platform| unsafe {
            let Ok(core) = platform.controller().CoreWebView2() else {
                return;
            };
            if !first_install(&core) {
                return;
            }
            let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| match args {
                Some(args) => args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY),
                None => Ok(()),
            }));
            let mut token = 0i64;
            let _ = core.add_PermissionRequested(&handler, &mut token);
        })
        .map_err(|error| error.to_string())
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
