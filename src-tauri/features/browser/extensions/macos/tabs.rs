// SPDX-License-Identifier: MIT
//! WebKit's view of Misty's browser tabs and windows: the objects an extension's
//! `tabs` and `windows` APIs talk to.
use super::{host::MistyExtensionHost, support::error};
use block2::DynBlock;
use objc2::{
    define_class, msg_send,
    rc::{Retained, Weak},
    runtime::{NSObject, ProtocolObject},
    sel, DefinedClass, MainThreadMarker, MainThreadOnly,
};

pub(super) use super::windows::MistyExtensionWindow;
use objc2_foundation::{
    NSError, NSLocale, NSNotFound, NSObjectProtocol, NSSize, NSString, NSUInteger, NSURLRequest,
    NSURL,
};
use objc2_web_kit::{
    WKWebExtensionContext, WKWebExtensionTab, WKWebExtensionTabChangedProperties,
    WKWebExtensionTabConfiguration, WKWebExtensionWindow, WKWebView,
};
use serde_json::json;
use std::cell::{Cell, RefCell};

pub(super) struct TabState {
    pub identifier: String,
    pub host: Weak<MistyExtensionHost>,
    pub view: RefCell<Weak<WKWebView>>,
    pub window: RefCell<Option<Retained<MistyExtensionWindow>>>,
    pub parent: RefCell<Weak<MistyExtensionTab>>,
    pub selected: Cell<bool>,
    pub muted: Cell<bool>,
    pub audible: Cell<bool>,
    pub position: Cell<usize>,
    pub logical_url: RefCell<Option<Retained<NSURL>>>,
    pub logical_title: RefCell<Option<Retained<NSString>>>,
    pub configured_origin: RefCell<Option<String>>,
    pub pending_navigation: RefCell<Option<Retained<NSURLRequest>>>,
}

/// Sets WebKit's page-level mute. The same private call backs Misty's own tab mute
/// control; it is skipped when unavailable.
pub(super) fn set_page_muted(view: &WKWebView, muted: bool) {
    if view.respondsToSelector(sel!(_setPageMuted:)) {
        // SAFETY: `_setPageMuted:` takes one `_WKMediaMutedState` (an NSUInteger bit set);
        // 1 mutes audio and 0 restores it.
        let _: () = unsafe { msg_send![view, _setPageMuted: NSUInteger::from(muted)] };
    }
}

pub(super) type Completion = DynBlock<dyn Fn(*mut NSError)>;
pub(super) type TabCompletion =
    DynBlock<dyn Fn(*mut ProtocolObject<dyn WKWebExtensionTab>, *mut NSError)>;

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = TabState]
    pub(super) struct MistyExtensionTab;

    unsafe impl NSObjectProtocol for MistyExtensionTab {}

    unsafe impl WKWebExtensionTab for MistyExtensionTab {
        #[unsafe(method_id(windowForWebExtensionContext:))]
        fn window_for(
            &self,
            _context: &WKWebExtensionContext,
        ) -> Option<Retained<ProtocolObject<dyn WKWebExtensionWindow>>> {
            self.window().map(ProtocolObject::from_retained)
        }

        #[unsafe(method(indexInWindowForWebExtensionContext:))]
        fn index_in_window(&self, context: &WKWebExtensionContext) -> NSUInteger {
            let Some(window) = self.window() else {
                return NSNotFound as NSUInteger;
            };
            window
                .tabs_for(context)
                .iter()
                .position(|tab| std::ptr::eq(&**tab, self))
                .unwrap_or(NSNotFound as usize)
        }

        #[unsafe(method_id(parentTabForWebExtensionContext:))]
        fn parent_tab(
            &self,
            _context: &WKWebExtensionContext,
        ) -> Option<Retained<ProtocolObject<dyn WKWebExtensionTab>>> {
            match self.ivars().parent.borrow().load() {
                Some(parent) if parent.window().is_some() => {
                    Some(ProtocolObject::from_retained(parent))
                }
                _ => None,
            }
        }

        #[unsafe(method(setParentTab:forWebExtensionContext:completionHandler:))]
        fn set_parent_tab(
            &self,
            parent: Option<&ProtocolObject<dyn WKWebExtensionTab>>,
            _context: &WKWebExtensionContext,
            done: &Completion,
        ) {
            let parent = parent.and_then(|tab| {
                let object: &objc2::runtime::AnyObject = tab.as_ref();
                object.downcast_ref::<MistyExtensionTab>().map(Weak::new)
            });
            *self.ivars().parent.borrow_mut() = parent.unwrap_or_default();
            done.call((std::ptr::null_mut(),));
        }

        #[unsafe(method_id(webViewForWebExtensionContext:))]
        fn web_view_for(&self, _context: &WKWebExtensionContext) -> Option<Retained<WKWebView>> {
            self.view()
        }

        #[unsafe(method_id(titleForWebExtensionContext:))]
        fn title_for(&self, _context: &WKWebExtensionContext) -> Option<Retained<NSString>> {
            self.view()
                .and_then(|view| unsafe { view.title() })
                .or_else(|| self.ivars().logical_title.borrow().clone())
        }

        #[unsafe(method_id(urlForWebExtensionContext:))]
        fn url_for(&self, _context: &WKWebExtensionContext) -> Option<Retained<NSURL>> {
            self.current_url()
        }

        #[unsafe(method(isLoadingCompleteForWebExtensionContext:))]
        fn is_loading_complete(&self, _context: &WKWebExtensionContext) -> bool {
            !self.view().is_some_and(|view| unsafe { view.isLoading() })
        }

        #[unsafe(method(isSelectedForWebExtensionContext:))]
        fn is_selected(&self, _context: &WKWebExtensionContext) -> bool {
            self.ivars().selected.get()
        }

        #[unsafe(method(isPlayingAudioForWebExtensionContext:))]
        fn is_playing_audio(&self, _context: &WKWebExtensionContext) -> bool {
            self.ivars().audible.get()
        }

        #[unsafe(method(isMutedForWebExtensionContext:))]
        fn is_muted(&self, _context: &WKWebExtensionContext) -> bool {
            self.ivars().muted.get()
        }

        #[unsafe(method(setMuted:forWebExtensionContext:completionHandler:))]
        fn set_muted_for(&self, muted: bool, _context: &WKWebExtensionContext, done: &Completion) {
            self.set_muted(muted);
            done.call((std::ptr::null_mut(),));
        }

        #[unsafe(method(sizeForWebExtensionContext:))]
        fn size_for(&self, _context: &WKWebExtensionContext) -> NSSize {
            self.view().map_or(NSSize::ZERO, |view| view.bounds().size)
        }

        #[unsafe(method(zoomFactorForWebExtensionContext:))]
        fn zoom_factor(&self, _context: &WKWebExtensionContext) -> f64 {
            self.view().map_or(0.0, |view| unsafe { view.pageZoom() })
        }

        #[unsafe(method(setZoomFactor:forWebExtensionContext:completionHandler:))]
        fn set_zoom_factor(&self, zoom: f64, _context: &WKWebExtensionContext, done: &Completion) {
            if let Some(view) = self.view() {
                unsafe { view.setPageZoom(zoom) };
            }
            done.call((std::ptr::null_mut(),));
        }

        #[unsafe(method(detectWebpageLocaleForWebExtensionContext:completionHandler:))]
        fn detect_locale(
            &self,
            _context: &WKWebExtensionContext,
            done: &DynBlock<dyn Fn(*mut NSLocale, *mut NSError)>,
        ) {
            self.detect_locale_now(done);
        }

        #[unsafe(method(reloadFromOrigin:forWebExtensionContext:completionHandler:))]
        fn reload(&self, origin: bool, _context: &WKWebExtensionContext, done: &Completion) {
            if let Some(view) = self.view() {
                unsafe {
                    if origin {
                        view.reloadFromOrigin();
                    } else {
                        view.reload();
                    }
                }
            }
            done.call((std::ptr::null_mut(),));
        }

        #[unsafe(method(goBackForWebExtensionContext:completionHandler:))]
        fn go_back(&self, _context: &WKWebExtensionContext, done: &Completion) {
            if let Some(view) = self.view() {
                unsafe { view.goBack() };
            }
            done.call((std::ptr::null_mut(),));
        }

        #[unsafe(method(goForwardForWebExtensionContext:completionHandler:))]
        fn go_forward(&self, _context: &WKWebExtensionContext, done: &Completion) {
            if let Some(view) = self.view() {
                unsafe { view.goForward() };
            }
            done.call((std::ptr::null_mut(),));
        }

        #[unsafe(method(loadURL:forWebExtensionContext:completionHandler:))]
        fn load_url(&self, url: &NSURL, context: &WKWebExtensionContext, done: &Completion) {
            self.navigate(url, context, done);
        }

        #[unsafe(method(activateForWebExtensionContext:completionHandler:))]
        fn activate(&self, _context: &WKWebExtensionContext, done: &Completion) {
            self.bring_forward(done);
        }

        #[unsafe(method(duplicateUsingConfiguration:forWebExtensionContext:completionHandler:))]
        fn duplicate(
            &self,
            configuration: &WKWebExtensionTabConfiguration,
            _context: &WKWebExtensionContext,
            done: &TabCompletion,
        ) {
            self.duplicate_tab(configuration, done);
        }

        #[unsafe(method(closeForWebExtensionContext:completionHandler:))]
        fn close(&self, _context: &WKWebExtensionContext, done: &Completion) {
            self.close_tab(done);
        }
    }
);

pub(super) fn call_error(done: &Completion, message: &str) {
    let failure = error(message);
    done.call((Retained::as_ptr(&failure).cast_mut(),));
}

pub(super) fn url_text(url: &NSURL) -> String {
    url.absoluteString()
        .map(|s| s.to_string())
        .unwrap_or_default()
}

impl MistyExtensionTab {
    pub(super) fn new(
        mtm: MainThreadMarker,
        identifier: &str,
        host: &MistyExtensionHost,
    ) -> Retained<Self> {
        let this = mtm.alloc::<Self>().set_ivars(TabState {
            identifier: identifier.to_owned(),
            host: Weak::new(host),
            view: RefCell::default(),
            window: RefCell::default(),
            parent: RefCell::default(),
            selected: Cell::new(false),
            muted: Cell::new(false),
            audible: Cell::new(false),
            position: Cell::new(0),
            logical_url: RefCell::default(),
            logical_title: RefCell::default(),
            configured_origin: RefCell::default(),
            pending_navigation: RefCell::default(),
        });
        // SAFETY: NSObject's designated initializer.
        unsafe { msg_send![super(this), init] }
    }

    pub(super) fn identifier(&self) -> &str {
        &self.ivars().identifier
    }
    pub(super) fn view(&self) -> Option<Retained<WKWebView>> {
        self.ivars().view.borrow().load()
    }
    pub(super) fn window(&self) -> Option<Retained<MistyExtensionWindow>> {
        self.ivars().window.borrow().clone()
    }
    pub(super) fn current_url(&self) -> Option<Retained<NSURL>> {
        self.view()
            .and_then(|view| unsafe { view.URL() })
            .or_else(|| self.ivars().logical_url.borrow().clone())
    }
    pub(super) fn event(&self, kind: &str, data: serde_json::Value) {
        if let Some(host) = self.ivars().host.load() {
            host.event(kind, data);
        }
    }

    /// Sets the page mute and tells the extension and Misty's tab strip, which owns the
    /// visible mute state.
    pub(super) fn set_muted(&self, muted: bool) {
        if let Some(view) = self.view() {
            set_page_muted(&view, muted);
        }
        self.ivars().muted.set(muted);
        if let Some(host) = self.ivars().host.load() {
            host.event(
                "tab-muted",
                json!({"tabId": self.ivars().identifier, "muted": muted}),
            );
            host.did_change_tab(self, WKWebExtensionTabChangedProperties::Muted);
        }
    }
}
