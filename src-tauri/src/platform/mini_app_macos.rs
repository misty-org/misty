//! App content never receives WebKit's automatic media or file-upload grants.
//! Keep the host's Wry delegate intact; only App WebViews get this delegate.
#![allow(unexpected_cfgs)] // objc 0.2 macros reference the retired cargo-clippy cfg.
use objc::{
    declare::ClassDecl,
    msg_send,
    runtime::{Class, Object, Protocol, Sel},
    sel, sel_impl,
};
use std::ffi::c_void;

static DELEGATE_KEY: u8 = 0;

// CSP does not mediate PeerConnection traffic. Disable the engine feature before
// loading any package, rather than replacing a JavaScript global that App code
// could recover. These WebKit SPI selectors are checked at runtime: an engine
// without the required policy cannot run arbitrary App content.
unsafe fn restrict_preferences(view: *mut Object) -> Result<(), String> {
    let configuration: *mut Object = msg_send![view, configuration];
    let preferences: *mut Object = msg_send![configuration, preferences];
    if preferences.is_null() {
        return Err("App WebKit preferences are unavailable.".into());
    }
    for (setter, getter) in [
        (
            sel!(_setPeerConnectionEnabled:),
            sel!(_peerConnectionEnabled),
        ),
        (sel!(_setMediaDevicesEnabled:), sel!(_mediaDevicesEnabled)),
        (
            sel!(_setJavaScriptCanAccessClipboard:),
            sel!(_javaScriptCanAccessClipboard),
        ),
        (sel!(_setDOMPasteAllowed:), sel!(_domPasteAllowed)),
    ] {
        let has_setter: objc::runtime::BOOL = msg_send![preferences, respondsToSelector: setter];
        let has_getter: objc::runtime::BOOL = msg_send![preferences, respondsToSelector: getter];
        if has_setter == objc::runtime::NO || has_getter == objc::runtime::NO {
            return Err("This WebKit version cannot enforce App device isolation.".into());
        }
        let _: () = objc::Message::send_message(&*preferences, setter, (objc::runtime::NO,))
            .map_err(|_| "App device policy configuration failed.")?;
        let value: objc::runtime::BOOL = objc::Message::send_message(&*preferences, getter, ())
            .map_err(|_| "App device policy verification failed.")?;
        if value != objc::runtime::NO {
            return Err("App device isolation could not be enabled.".into());
        }
    }
    Ok(())
}
#[link(name = "objc")]
extern "C" {
    fn objc_setAssociatedObject(
        object: *mut Object,
        key: *const c_void,
        value: *mut Object,
        policy: usize,
    );
}

extern "C" fn deny_media(
    _: &Object,
    _: Sel,
    _: *mut Object,
    _: *mut Object,
    _: *mut Object,
    _: isize,
    handler: *mut Object,
) {
    unsafe {
        (&*handler.cast::<block2::Block<dyn Fn(isize)>>()).call((2,));
    }
}
extern "C" fn deny_motion(
    _: &Object,
    _: Sel,
    _: *mut Object,
    _: *mut Object,
    _: *mut Object,
    handler: *mut Object,
) {
    unsafe {
        (&*handler.cast::<block2::Block<dyn Fn(isize)>>()).call((2,));
    }
}
extern "C" fn deny_files(
    _: &Object,
    _: Sel,
    _: *mut Object,
    _: *mut Object,
    _: *mut Object,
    handler: *mut Object,
) {
    unsafe {
        (&*handler.cast::<block2::Block<dyn Fn(*mut objc2::runtime::AnyObject)>>())
            .call((std::ptr::null_mut(),));
    }
}

unsafe fn install(view: *mut Object) -> Result<(), String> {
    if view.is_null() {
        return Err("Native App WebView is unavailable.".into());
    }
    restrict_preferences(view)?;
    let class = if let Some(class) = Class::get("MistyMiniAppUIDelegate") {
        class
    } else {
        let mut class = ClassDecl::new(
            "MistyMiniAppUIDelegate",
            Class::get("NSObject").ok_or("NSObject unavailable.")?,
        )
        .ok_or("App delegate could not be created.")?;
        class.add_protocol(Protocol::get("WKUIDelegate").ok_or("WebKit UI protocol unavailable.")?);
        class.add_method(sel!(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:), deny_media as extern "C" fn(&Object, Sel, *mut Object, *mut Object, *mut Object, isize, *mut Object));
        class.add_method(sel!(webView:requestDeviceOrientationAndMotionPermissionForOrigin:initiatedByFrame:decisionHandler:), deny_motion as extern "C" fn(&Object, Sel, *mut Object, *mut Object, *mut Object, *mut Object));
        class.add_method(
            sel!(webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:),
            deny_files
                as extern "C" fn(&Object, Sel, *mut Object, *mut Object, *mut Object, *mut Object),
        );
        class.register()
    };
    let delegate: *mut Object = msg_send![class, new];
    if delegate.is_null() {
        return Err("App delegate allocation failed.".into());
    }
    // WKUIDelegate is weak. Associate a strong owner with this WebView only.
    objc_setAssociatedObject(view, (&DELEGATE_KEY as *const u8).cast(), delegate, 1);
    let _: () = msg_send![view, setUIDelegate: delegate];
    #[cfg(debug_assertions)]
    {
        // Exercise the Objective-C callback ABI without requesting any device.
        let result = std::sync::Arc::new(std::sync::atomic::AtomicIsize::new(-1));
        let observed = result.clone();
        let decision = block2::RcBlock::new(move |value: isize| {
            observed.store(value, std::sync::atomic::Ordering::SeqCst);
        });
        let callback = block2::RcBlock::as_ptr(&decision) as *mut Object;
        let nil: *mut Object = std::ptr::null_mut();
        let _: () = msg_send![delegate, webView: view requestMediaCapturePermissionForOrigin: nil initiatedByFrame: nil type: 0isize decisionHandler: callback];
        if result.load(std::sync::atomic::Ordering::SeqCst) != 2 {
            return Err("App media policy did not deny direct capture.".into());
        }
    }
    let _: () = msg_send![delegate, release];
    Ok(())
}

pub async fn configure(view: &tauri::Webview) -> Result<(), String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    view.with_webview(move |platform| {
        let result = unsafe { install(platform.inner().cast()) };
        let _ = sender.send(result);
    })
    .map_err(|e| e.to_string())?;
    receiver
        .await
        .map_err(|_| "App permission configuration failed.")?
}
