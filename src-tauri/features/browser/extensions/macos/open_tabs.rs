// SPDX-License-Identifier: MIT
//! Tabs and windows an extension asks Misty to open.
use super::{
    host::MistyExtensionHost,
    policy::may_open,
    support::{error, on_main_after, string},
    tabs::{url_text, MistyExtensionTab, MistyExtensionWindow},
};
use block2::DynBlock;
use objc2::{
    rc::Retained,
    runtime::{AnyObject, ProtocolObject},
    DefinedClass, Message,
};

use objc2_foundation::{NSError, NSURL, NSUUID};
use objc2_web_kit::{
    WKWebExtensionContext, WKWebExtensionTab, WKWebExtensionTabConfiguration, WKWebExtensionWindow,
    WKWebExtensionWindowConfiguration,
};
use serde_json::{json, Map, Value};
use std::time::Duration;

/// The tab or window class behind a protocol object WebKit handed back.
pub(super) fn downcast<T: objc2::ClassType + objc2::DowncastTarget>(
    object: &ProtocolObject<dyn WKWebExtensionTab>,
) -> Option<Retained<T>> {
    let any: &AnyObject = object.as_ref();
    any.downcast_ref::<T>().map(|value| value.retain())
}

fn window_class(
    object: &ProtocolObject<dyn WKWebExtensionWindow>,
) -> Option<Retained<MistyExtensionWindow>> {
    let any: &AnyObject = object.as_ref();
    any.downcast_ref::<MistyExtensionWindow>()
        .map(|value| value.retain())
}

impl MistyExtensionHost {
    /// Asks the app to open a browser tab and answers `done` when the tab exists.
    pub(super) fn open_tab_url(
        &self,
        url: Option<Retained<NSURL>>,
        private: bool,
        options: Value,
        done: super::host::OpenDone,
    ) {
        let url = url.or_else(|| NSURL::URLWithString(&string("about:blank")));
        let Some(url) = url else {
            done(
                None,
                Some(error("This URL cannot be opened by an extension.")),
            );
            return;
        };
        let scheme = url.scheme().map(|s| s.to_string()).unwrap_or_default();
        let text = url_text(&url);
        if !["https", "http", "webkit-extension", "about"].contains(&scheme.as_str())
            || (scheme == "about" && text != "about:blank")
        {
            done(
                None,
                Some(error("This URL cannot be opened by an extension.")),
            );
            return;
        }
        let request_id = NSUUID::new().UUIDString().to_string();
        self.state_mut()
            .open_requests
            .insert(request_id.clone(), done);
        let mut event: Map<String, Value> = match options {
            Value::Object(map) => map,
            _ => Map::new(),
        };
        event.insert("requestId".into(), request_id.clone().into());
        event.insert("url".into(), text.into());
        event.insert("private".into(), private.into());
        self.event("open-tab", Value::Object(event));
        self.expire_open_request(request_id, "The browser tab could not be opened.");
    }

    fn expire_open_request(&self, request_id: String, message: &'static str) {
        let this = self.retain();
        on_main_after(Duration::from_secs(30), move || {
            let pending = this.state_mut().open_requests.remove(&request_id);
            if let Some(pending) = pending {
                pending(None, Some(error(message)));
            }
        });
    }

    pub(super) fn open_new_tab(
        &self,
        configuration: &WKWebExtensionTabConfiguration,
        context: &WKWebExtensionContext,
        done: &DynBlock<dyn Fn(*mut ProtocolObject<dyn WKWebExtensionTab>, *mut NSError)>,
    ) {
        // SAFETY: reads the configuration WebKit built for this request.
        let (window, parent, url, active, index, muted) = unsafe {
            (
                configuration.window(),
                configuration.parentTab(),
                configuration.url(),
                configuration.shouldBeActive(),
                configuration.index(),
                configuration.shouldBeMuted(),
            )
        };
        let private = window
            .as_ref()
            .is_some_and(|window| unsafe { window.isPrivateForWebExtensionContext(context) });
        let private_access = unsafe { context.hasAccessToPrivateData() };
        let respond = |tab: Option<Retained<MistyExtensionTab>>,
                       failure: Option<Retained<NSError>>| {
            let tab = tab.map(ProtocolObject::<dyn WKWebExtensionTab>::from_retained);
            done.call((
                tab.as_ref()
                    .map_or(std::ptr::null_mut(), |tab| Retained::as_ptr(tab).cast_mut()),
                failure.as_ref().map_or(std::ptr::null_mut(), |failure| {
                    Retained::as_ptr(failure).cast_mut()
                }),
            ));
        };
        if private && !private_access {
            respond(None, Some(error("Private access is disabled.")));
            return;
        }
        if !url.as_ref().is_none_or(|url| may_open(context, url)) {
            respond(
                None,
                Some(error("This URL cannot be opened by an extension.")),
            );
            return;
        }
        // Misty has no pinned or reader-mode tabs; those requests open an ordinary tab.
        let mut options = Map::new();
        options.insert("focused".into(), active.into());
        options.insert("index".into(), index.into());
        if let Some(identifier) = window
            .as_ref()
            .and_then(|window| window_class(window))
            .and_then(|window| window.identifier())
        {
            options.insert("windowId".into(), identifier.into());
        }
        let parent = parent
            .as_ref()
            .and_then(|parent| downcast::<MistyExtensionTab>(parent));
        let done = done.copy();
        self.open_tab_url(
            url,
            private,
            Value::Object(options),
            Box::new(move |tab, failure| {
                if let Some(tab) = &tab {
                    *tab.ivars().parent.borrow_mut() = parent
                        .as_deref()
                        .map(objc2::rc::Weak::new)
                        .unwrap_or_default();
                    if muted {
                        tab.set_muted(true);
                    }
                }
                let tab = tab.map(ProtocolObject::<dyn WKWebExtensionTab>::from_retained);
                done.call((
                    tab.as_ref()
                        .map_or(std::ptr::null_mut(), |tab| Retained::as_ptr(tab).cast_mut()),
                    failure.as_ref().map_or(std::ptr::null_mut(), |failure| {
                        Retained::as_ptr(failure).cast_mut()
                    }),
                ));
            }),
        );
    }

    pub(super) fn open_new_window(
        &self,
        configuration: &WKWebExtensionWindowConfiguration,
        context: &WKWebExtensionContext,
        done: &DynBlock<dyn Fn(*mut ProtocolObject<dyn WKWebExtensionWindow>, *mut NSError)>,
    ) {
        let respond = |window: Option<Retained<MistyExtensionWindow>>,
                       failure: Option<Retained<NSError>>| {
            let window = window.map(ProtocolObject::<dyn WKWebExtensionWindow>::from_retained);
            done.call((
                window.as_ref().map_or(std::ptr::null_mut(), |window| {
                    Retained::as_ptr(window).cast_mut()
                }),
                failure.as_ref().map_or(std::ptr::null_mut(), |failure| {
                    Retained::as_ptr(failure).cast_mut()
                }),
            ));
        };
        // SAFETY: reads the configuration WebKit built for this request.
        let (private, focused, tab_urls, tab_count) = unsafe {
            (
                configuration.shouldBePrivate(),
                configuration.shouldBeFocused(),
                configuration.tabURLs(),
                configuration.tabs().count(),
            )
        };
        if private && !unsafe { context.hasAccessToPrivateData() } {
            respond(None, Some(error("Private access is disabled.")));
            return;
        }
        if self.open_popup_window(configuration, context, &respond) {
            return;
        }
        if tab_count > 0 {
            respond(
                None,
                Some(error(
                    "Moving existing tabs into a new window is not available.",
                )),
            );
            return;
        }
        let mut urls = Vec::new();
        for url in tab_urls.iter() {
            let scheme = url.scheme().map(|s| s.to_string()).unwrap_or_default();
            if !["http", "https", "webkit-extension", "about"].contains(&scheme.as_str())
                || !may_open(context, &url)
            {
                respond(None, Some(error("This URL cannot be opened.")));
                return;
            }
            urls.push(Value::String(url_text(&url)));
        }
        let request_id = NSUUID::new().UUIDString().to_string();
        let done = done.copy();
        self.state_mut().open_requests.insert(
            request_id.clone(),
            Box::new(move |tab, failure| {
                let window = tab
                    .and_then(|tab| tab.window())
                    .map(ProtocolObject::<dyn WKWebExtensionWindow>::from_retained);
                done.call((
                    window.as_ref().map_or(std::ptr::null_mut(), |window| {
                        Retained::as_ptr(window).cast_mut()
                    }),
                    failure.as_ref().map_or(std::ptr::null_mut(), |failure| {
                        Retained::as_ptr(failure).cast_mut()
                    }),
                ));
            }),
        );
        self.event(
            "open-window",
            json!({"requestId": request_id, "urls": urls, "tabs": Vec::<String>::new(), "private": private, "focused": focused}),
        );
        self.expire_open_request(request_id, "The browser window could not be opened.");
    }
}
