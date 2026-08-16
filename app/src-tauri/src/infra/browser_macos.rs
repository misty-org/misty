use tauri::Webview;

#[cfg(target_os = "macos")]
pub(super) fn configure_browser_webview(webview: &Webview) -> Result<(), String> {
    use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSViewLayerContentsRedrawPolicy};
    webview
        .with_webview(|platform_webview| unsafe {
            let view: &NSView = &*platform_webview.inner().cast();
            disable_scroll_elasticity(view);
            // AppKit's live-resize loop can pause renderer resize events. A
            // native autoresizing mask keeps the child viewport and its WebKit
            // paint cycle moving with the window instead of trailing JS IPC.
            view.setAutoresizingMask(
                NSAutoresizingMaskOptions::ViewWidthSizable
                    | NSAutoresizingMaskOptions::ViewHeightSizable,
            );
            view.setLayerContentsRedrawPolicy(NSViewLayerContentsRedrawPolicy::DuringViewResize);
            if let Some(parent) = view.superview() {
                parent.setAutoresizesSubviews(true);
            }
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
unsafe fn disable_scroll_elasticity(view: &objc2_app_kit::NSView) {
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSScrollElasticity, NSScrollView};

    let object: &AnyObject = view;
    if let Some(scroll_view) = object.downcast_ref::<NSScrollView>() {
        scroll_view.setHorizontalScrollElasticity(NSScrollElasticity::None);
        scroll_view.setVerticalScrollElasticity(NSScrollElasticity::None);
    }
    for child in view.subviews().iter() {
        disable_scroll_elasticity(&child);
    }
}

#[cfg(not(target_os = "macos"))]
pub(super) fn configure_browser_webview(_webview: &Webview) -> Result<(), String> {
    Ok(())
}
