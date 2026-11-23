use crate::browser::*;

#[cfg(windows)]
pub(in crate::browser) fn install(webview: &Webview, renderer: bool) {
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
    if !renderer {
        return true;
    }
    let window = webview.window().label().to_owned();
    crate::browser::menus::context_menu::menu_pending(webview.app_handle(), &window)
        || crate::browser::renderer(&window).overlay
}
