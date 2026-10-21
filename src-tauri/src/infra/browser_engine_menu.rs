//! Keeps WebView2's own context menu from opening beside Misty's.
//!
//! A right-click on a page opens Misty's menu, drawn by the renderer. Repeated
//! right-clicks can still reach the engine while that menu is on its way or
//! open, or land on the renderer while the page sits beneath it, and the
//! engine's menu then flashes over the page for a few frames before the
//! renderer takes focus and closes it. Fields keep the engine's menu for
//! spelling, AutoFill and passwords.
use super::*;

/// `renderer` is Misty's own view; otherwise `webview` is a browser page.
#[cfg(windows)]
pub(super) fn install(webview: &Webview, renderer: bool) {
    use webview2_com::{
        ContextMenuRequestedEventHandler, Microsoft::Web::WebView2::Win32::ICoreWebView2_11,
    };
    use windows::core::Interface;
    let target = webview.clone();
    let _ = webview.with_webview(move |platform| {
        let handler = ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut editable = windows::core::BOOL(0);
            // SAFETY: event arguments are valid for the handler's duration.
            unsafe { args.ContextMenuTarget()?.IsEditable(&mut editable)? };
            if !editable.as_bool() && suppressed(&target, renderer) {
                // Handled with no menu of our own: the engine shows nothing.
                unsafe { args.SetHandled(true)? };
            }
            Ok(())
        }));
        // SAFETY: the controller is live during this UI-thread callback.
        let _ = unsafe {
            platform.controller().CoreWebView2().and_then(|core| {
                let mut token = Default::default();
                core.cast::<ICoreWebView2_11>()?
                    .add_ContextMenuRequested(&handler, &mut token)
            })
        };
    });
}

#[cfg(windows)]
fn suppressed(webview: &Webview, renderer: bool) -> bool {
    let window = webview.window().label().to_owned();
    context_menu::menu_pending(webview.app_handle(), &window)
        // The page is beneath the renderer: a click there was meant for the page.
        || (renderer && super::renderer(&window).overlay)
}
