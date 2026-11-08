// SPDX-License-Identifier: MIT
//! The entry points the page layer calls: configurations, tab registration, tab events and navigation.
use super::{
    bridge::{all_hosts, host_for_space},
    host::MistyExtensionHost,
    policy::navigation_allowed,
    support::string,
    tabs::{url_text, MistyExtensionTab, MistyExtensionWindow},
};
use block2::Block;
use objc2::{
    rc::{Retained, Weak},
    runtime::{AnyObject, ProtocolObject},
    DefinedClass, MainThreadMarker, Message as _,
};
use objc2_foundation::{NSString, NSURLRequest, NSURL};
use objc2_web_kit::{
    WKNavigationAction, WKScriptMessage, WKUserContentController,
    WKWebExtensionTabChangedProperties, WKWebView, WKWebViewConfiguration,
};
use serde_json::{json, Value};
use std::ffi::c_void;

/// The host whose tab shows `view`.
fn host_for_view(view: &WKWebView) -> Option<Retained<MistyExtensionHost>> {
    all_hosts().into_iter().find(|host| {
        host.all_tabs()
            .iter()
            .any(|tab| tab.view().is_some_and(|v| std::ptr::eq(&*v, view)))
    })
}

/// Answers one compatibility request Kiri's transport admitted.
///
/// # Safety
/// `message` is a live `WKScriptMessage`, and `reply` its WebKit reply block
/// `void (^)(id, NSString *)`, which is called exactly once.
pub unsafe fn compat_message(message: *mut c_void, reply: *mut c_void) {
    // SAFETY: per the contract above.
    let (message, block) = unsafe {
        (
            &*(message as *const WKScriptMessage),
            &*(reply as *const Block<dyn Fn(*mut AnyObject, *mut NSString)>),
        )
    };
    let block = block.copy();
    let answer = move |result: Option<Value>, failure: Option<String>| {
        let object = result.and_then(|value| super::support::to_object(&value));
        let failure = failure.map(|text| string(&text));
        block.call((
            object.as_ref().map_or(std::ptr::null_mut(), |object| {
                Retained::as_ptr(object).cast_mut()
            }),
            failure.as_ref().map_or(std::ptr::null_mut(), |failure| {
                Retained::as_ptr(failure).cast_mut()
            }),
        ));
    };
    // The compat page that asked belongs to exactly one Space's host.
    // SAFETY: reads the message's page.
    let view = unsafe { message.webView() };
    let host = view.and_then(|view| {
        all_hosts()
            .into_iter()
            .find(|host| host.owns_compat_view(&view))
    });
    match host {
        Some(host) => host.compat_message(message, Box::new(answer)),
        None => answer(None, Some("The extension host stopped.".into())),
    }
}

/// A page configuration wired to the Space's extension controller. An extension's own page
/// gets its extension's configuration instead. WebKit ties extension-origin configurations to
/// their background view, so changing that configuration's store is invalid: website pages keep
/// the Space's store; extension pages use their extension's shared storage and swap views
/// before website navigation.
pub fn configuration(
    mtm: MainThreadMarker,
    space: &str,
    config: &WKWebViewConfiguration,
    url: &str,
) -> Option<Retained<WKWebViewConfiguration>> {
    let host = host_for_space(space)?;
    host.account()?;
    let controller = host.controller()?;
    let url = NSURL::URLWithString(&string(url));
    // SAFETY: WebKit configuration calls on the main thread.
    unsafe {
        let context = url.and_then(|url| controller.extensionContextForURL(&url));
        match context {
            Some(context) => {
                let own = context.webViewConfiguration()?;
                own.setUserContentController(&WKUserContentController::new(mtm));
                Some(own)
            }
            None => {
                config.setWebExtensionController(Some(&controller));
                Some(config.retain())
            }
        }
    }
}

/// Binds a native view to the extension tab of the same identifier.
pub fn register_tab(space: &str, view: &WKWebView, identifier: &str, private: bool, url: &str) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let Some(host) = host_for_space(space) else {
        return;
    };
    let Some(controller) = host.controller() else {
        return;
    };
    let tab = host
        .tab(identifier)
        .unwrap_or_else(|| MistyExtensionTab::new(mtm, identifier, &host));
    *tab.ivars().view.borrow_mut() = Weak::new(view);
    let intended = NSURL::URLWithString(&string(url));
    *tab.ivars().configured_origin.borrow_mut() = intended.and_then(|url| {
        (url.scheme().map(|s| s.to_string()).as_deref() == Some("webkit-extension"))
            .then(|| url.host().map(|h| h.to_string()))
            .flatten()
    });
    // SAFETY: reads the view's window.
    let native = view.window();
    if tab.window().is_none() {
        for other in host.all_tabs() {
            let Some(window) = other.window() else {
                continue;
            };
            let same_native = match (window.native(), &native) {
                (Some(a), Some(b)) => std::ptr::eq(&*a, &**b),
                (None, None) => true,
                _ => false,
            };
            if same_native && window.is_private() == private {
                *tab.ivars().window.borrow_mut() = Some(window);
                break;
            }
        }
    }
    if tab.window().is_none() {
        let window = MistyExtensionWindow::new(mtm, &host);
        *window.ivars().native.borrow_mut() = native.as_deref().map(Weak::new).unwrap_or_default();
        window.ivars().private_window.set(private);
        *tab.ivars().window.borrow_mut() = Some(window.clone());
        // SAFETY: the window conforms to WKWebExtensionWindow.
        unsafe { controller.didOpenWindow(ProtocolObject::from_ref(&*window)) };
    }
    if let Some(window) = tab.window() {
        *window.ivars().native.borrow_mut() = native.as_deref().map(Weak::new).unwrap_or_default();
    }
    host.state_mut()
        .tabs
        .insert(identifier.to_owned(), tab.clone());
    host.register_open_tab(&tab);
    let pending = tab.ivars().pending_navigation.borrow_mut().take();
    if let Some(request) = pending {
        // SAFETY: loads the request the app asked this view to take over.
        unsafe { view.loadRequest(&request) };
    }
    let request_id = host.state().opening_tabs.get(identifier).cloned();
    let done = request_id
        .as_ref()
        .and_then(|id| host.state_mut().open_requests.remove(id));
    if let Some(done) = done {
        host.state_mut().opening_tabs.remove(identifier);
        done(Some(tab), None);
    }
}

/// Tells extensions a tab closed, activated or changed. An empty `space` finds the host that
/// knows the tab (a closing tab whose window is gone).
pub fn tab_event(space: &str, identifier: &str, event: &str) {
    let mut host = (!space.is_empty()).then(|| host_for_space(space)).flatten();
    // The host that registered the tab, when the page's Space now names another (a tab opened
    // before its window took a Space, a window that switched Space), so extensions hear every close.
    if host
        .as_ref()
        .and_then(|host| host.tab(identifier))
        .is_none()
    {
        if let Some(candidate) = all_hosts()
            .into_iter()
            .find(|candidate| candidate.tab(identifier).is_some())
        {
            host = Some(candidate);
        }
    }
    let Some(host) = host else {
        return;
    };
    let Some(tab) = host.tab(identifier) else {
        return;
    };
    let Some(controller) = host.controller() else {
        return;
    };
    if event != "close" {
        host.register_open_tab(&tab);
    }
    // SAFETY: the tabs conform to WKWebExtensionTab.
    unsafe {
        if event == "close" {
            controller.didCloseTab_windowIsClosing(ProtocolObject::from_ref(&*tab), false);
            host.state_mut().tabs.remove(identifier);
        } else if event == "activate" {
            let previous = host.active_tab();
            if let Some(previous) = &previous {
                previous.ivars().selected.set(false);
            }
            host.state_mut().active_tab = Some(identifier.to_owned());
            tab.ivars().selected.set(true);
            controller.didActivateTab_previousActiveTab(
                ProtocolObject::from_ref(&*tab),
                previous
                    .as_ref()
                    .map(|previous| ProtocolObject::from_ref(&**previous)),
            );
        } else {
            controller.didChangeTabProperties_forTab(
                WKWebExtensionTabChangedProperties::URL
                    | WKWebExtensionTabChangedProperties::Title
                    | WKWebExtensionTabChangedProperties::Loading,
                ProtocolObject::from_ref(&*tab),
            );
        }
    }
}

/// Whether the extension host takes this navigation over (true cancels it in WebKit): an OAuth
/// redirect to an extension, or a tab moving between a website view and an extension view.
pub fn navigation(view: &WKWebView, action: &WKNavigationAction) -> bool {
    // SAFETY: reads the action's frame and request.
    let (main_frame, url, request) = unsafe {
        (
            action
                .targetFrame()
                .is_some_and(|frame| frame.isMainFrame()),
            action.request().URL(),
            action.request(),
        )
    };
    let Some(url) = url.filter(|_| main_frame) else {
        return false;
    };
    let scheme = url.scheme().map(|s| s.to_string()).unwrap_or_default();
    if !["http", "https", "webkit-extension"].contains(&scheme.as_str()) {
        return false;
    }
    // Only the Space that owns this tab may redirect it into its extensions.
    let Some(host) = host_for_view(view) else {
        return false;
    };
    let identity = host.identity_redirect(&url);
    for tab in host.all_tabs() {
        if !tab.view().is_some_and(|v| std::ptr::eq(&*v, view)) {
            continue;
        }
        if let Some(identity) = identity {
            *tab.ivars().pending_navigation.borrow_mut() =
                Some(NSURLRequest::requestWithURL(&identity));
            host.event(
                "replace-view",
                json!({"tabId": tab.identifier(), "url": url_text(&identity)}),
            );
            return true;
        }
        let origin = (scheme == "webkit-extension")
            .then(|| url.host().map(|h| h.to_string()))
            .flatten();
        let configured = tab.ivars().configured_origin.borrow().clone();
        match (&origin, &configured) {
            (None, None) => return false,
            (Some(a), Some(b)) if a == b => return false,
            _ => {}
        }
        // Swapping views makes this Misty's own load, so WebKit's check on extension pages
        // never runs. A private window has no extension view to swap to at all.
        let private = tab.window().is_some_and(|window| window.is_private());
        if origin.is_some()
            && (private
                || !navigation_allowed(
                    Some(tab.identifier()),
                    &url,
                    unsafe { view.URL() }.as_deref(),
                ))
        {
            return true;
        }
        // Preserve the actual request, including POST bodies. Only the native view changes;
        // tab identity and granted browser scope remain intact.
        *tab.ivars().pending_navigation.borrow_mut() = Some(request.clone());
        host.event(
            "replace-view",
            json!({"tabId": tab.identifier(), "url": url_text(&url)}),
        );
        return true;
    }
    false
}
