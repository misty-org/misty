// SPDX-License-Identifier: MIT
//! What an extension can do to a tab through WebKit: load, activate, duplicate, close.
use super::{
    policy::may_open,
    support::string,
    tabs::{call_error, url_text, Completion, MistyExtensionTab, TabCompletion},
};
use block2::DynBlock;
use objc2::{
    rc::{Retained, Weak},
    runtime::ProtocolObject,
    DefinedClass, MainThreadOnly, Message,
};

use objc2_foundation::{NSError, NSLocale, NSString, NSURLRequest, NSURL};
use objc2_web_kit::{
    WKContentWorld, WKWebExtensionContext, WKWebExtensionTab, WKWebExtensionTabConfiguration,
};
use serde_json::json;

impl MistyExtensionTab {
    pub(super) fn detect_locale_now(&self, done: &DynBlock<dyn Fn(*mut NSLocale, *mut NSError)>) {
        let Some(view) = self.view() else {
            done.call((std::ptr::null_mut(), std::ptr::null_mut()));
            return;
        };
        let done = done.copy();
        let handler = block2::RcBlock::new(
            move |result: *mut objc2::runtime::AnyObject, _error: *mut NSError| {
                // SAFETY: WebKit passes a live object or null.
                let language = unsafe { result.as_ref() }
                    .and_then(|object| object.downcast_ref::<NSString>())
                    .map(|text| {
                        text.to_string()
                            .trim_matches(|c| c == ' ' || c == '\t')
                            .to_owned()
                    })
                    .unwrap_or_default();
                let locale = (!language.is_empty() && language.chars().count() < 36)
                    .then(|| NSLocale::localeWithLocaleIdentifier(&string(&language)));
                let pointer = locale.as_ref().map_or(std::ptr::null_mut(), |locale| {
                    Retained::as_ptr(locale).cast_mut()
                });
                done.call((pointer, std::ptr::null_mut()));
            },
        );
        // SAFETY: the script is a constant expression; the handler is called once.
        unsafe {
            view.evaluateJavaScript_inFrame_inContentWorld_completionHandler(
                &string("document.documentElement.lang || ''"),
                None,
                &WKContentWorld::defaultClientWorld(self.mtm()),
                Some(&handler),
            );
        }
    }

    pub(super) fn navigate(&self, url: &NSURL, context: &WKWebExtensionContext, done: &Completion) {
        let scheme = url.scheme().map(|s| s.to_string()).unwrap_or_default();
        if !matches!(scheme.as_str(), "https" | "http" | "webkit-extension")
            || !may_open(context, url)
        {
            call_error(done, "This URL cannot be opened by an extension.");
            return;
        }
        let popup = self
            .window()
            .is_some_and(|window| window.ivars().popup_window.get());
        if popup {
            if let Some(view) = self.view() {
                unsafe { view.loadRequest(&NSURLRequest::requestWithURL(url)) };
            }
        } else {
            self.event(
                "navigate",
                json!({"tabId": self.ivars().identifier, "url": url_text(url)}),
            );
        }
        done.call((std::ptr::null_mut(),));
    }

    pub(super) fn bring_forward(&self, done: &Completion) {
        if let Some(window) = self
            .window()
            .filter(|window| window.ivars().popup_window.get())
        {
            if let Some(native) = window.native() {
                native.makeKeyAndOrderFront(None);
            }
        } else {
            self.event("activate-tab", json!({"tabId": self.ivars().identifier}));
        }
        done.call((std::ptr::null_mut(),));
    }

    pub(super) fn duplicate_tab(
        &self,
        configuration: &WKWebExtensionTabConfiguration,
        done: &TabCompletion,
    ) {
        let Some(host) = self.ivars().host.load() else {
            return;
        };
        let url = self.current_url();
        let options = json!({
            "focused": unsafe { configuration.shouldBeActive() },
            "index": self.ivars().position.get() + 1,
        });
        let private = self
            .window()
            .is_some_and(|window| window.ivars().private_window.get());
        let this = self.retain();
        let done = done.copy();
        host.open_tab_url(
            url,
            private,
            options,
            Box::new(move |tab, failure| {
                if let Some(tab) = &tab {
                    *tab.ivars().parent.borrow_mut() = Weak::new(&this);
                }
                let tab = tab.map(ProtocolObject::<dyn WKWebExtensionTab>::from_retained);
                done.call((
                    tab.as_ref()
                        .map_or(std::ptr::null_mut(), |t| Retained::as_ptr(t).cast_mut()),
                    failure
                        .as_ref()
                        .map_or(std::ptr::null_mut(), |e| Retained::as_ptr(e).cast_mut()),
                ));
            }),
        );
    }

    pub(super) fn close_tab(&self, done: &Completion) {
        if let Some(window) = self
            .window()
            .filter(|window| window.ivars().popup_window.get())
        {
            if let Some(native) = window.native() {
                native.close();
            }
        } else {
            self.event("close-tab", json!({"tabId": self.ivars().identifier}));
        }
        done.call((std::ptr::null_mut(),));
    }
}
