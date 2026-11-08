// SPDX-License-Identifier: MIT
//! The window WebKit sees around Misty's tabs, and the popup windows extensions open.
use super::{
    host::MistyExtensionHost,
    tabs::{call_error, Completion, MistyExtensionTab},
};

use objc2::{
    define_class, msg_send,
    rc::{Retained, Weak},
    runtime::{NSObject, ProtocolObject},
    DefinedClass, MainThreadMarker, MainThreadOnly,
};
use objc2_app_kit::{NSApplication, NSScreen, NSWindow, NSWindowStyleMask};
use objc2_foundation::{NSArray, NSObjectProtocol, NSRect};
use objc2_web_kit::{
    WKWebExtensionContext, WKWebExtensionTab, WKWebExtensionWindow, WKWebExtensionWindowState,
    WKWebExtensionWindowType,
};
use serde_json::json;
use std::cell::{Cell, RefCell};

pub(super) struct WindowState {
    pub host: Weak<MistyExtensionHost>,
    pub native: RefCell<Weak<NSWindow>>,
    pub private_window: Cell<bool>,
    /// A popup window an extension opened for its own page (windows.create type "popup").
    pub popup_window: Cell<bool>,
    pub identifier: RefCell<Option<String>>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = WindowState]
    pub(super) struct MistyExtensionWindow;

    unsafe impl NSObjectProtocol for MistyExtensionWindow {}

    unsafe impl WKWebExtensionWindow for MistyExtensionWindow {
        #[unsafe(method_id(tabsForWebExtensionContext:))]
        fn tabs_for_context(
            &self,
            context: &WKWebExtensionContext,
        ) -> Retained<NSArray<ProtocolObject<dyn WKWebExtensionTab>>> {
            let tabs: Vec<Retained<ProtocolObject<dyn WKWebExtensionTab>>> = self
                .tabs_for(context)
                .into_iter()
                .map(ProtocolObject::from_retained)
                .collect();
            NSArray::from_retained_slice(&tabs)
        }

        #[unsafe(method_id(activeTabForWebExtensionContext:))]
        fn active_tab(
            &self,
            context: &WKWebExtensionContext,
        ) -> Option<Retained<ProtocolObject<dyn WKWebExtensionTab>>> {
            self.tabs_for(context)
                .into_iter()
                .find(|tab| tab.ivars().selected.get())
                .map(ProtocolObject::from_retained)
        }

        #[unsafe(method(windowTypeForWebExtensionContext:))]
        fn window_type(&self, _context: &WKWebExtensionContext) -> WKWebExtensionWindowType {
            if self.ivars().popup_window.get() {
                WKWebExtensionWindowType::Popup
            } else {
                WKWebExtensionWindowType::Normal
            }
        }

        #[unsafe(method(windowStateForWebExtensionContext:))]
        fn window_state(&self, _context: &WKWebExtensionContext) -> WKWebExtensionWindowState {
            let Some(window) = self.native() else {
                return WKWebExtensionWindowState::Normal;
            };
            if window.isMiniaturized() {
                WKWebExtensionWindowState::Minimized
            } else if window.styleMask().contains(NSWindowStyleMask::FullScreen) {
                WKWebExtensionWindowState::Fullscreen
            } else if window.isZoomed() {
                WKWebExtensionWindowState::Maximized
            } else {
                WKWebExtensionWindowState::Normal
            }
        }

        #[unsafe(method(setWindowState:forWebExtensionContext:completionHandler:))]
        fn set_window_state(
            &self,
            state: WKWebExtensionWindowState,
            _context: &WKWebExtensionContext,
            done: &Completion,
        ) {
            let Some(window) = self.native() else {
                call_error(done, "This window is not open.");
                return;
            };
            let fullscreen = window.styleMask().contains(NSWindowStyleMask::FullScreen);
            if state != WKWebExtensionWindowState::Minimized && window.isMiniaturized() {
                window.deminiaturize(None);
            }
            if (state == WKWebExtensionWindowState::Fullscreen) != fullscreen {
                window.toggleFullScreen(None);
            }
            if state == WKWebExtensionWindowState::Minimized {
                window.miniaturize(None);
            } else if (state == WKWebExtensionWindowState::Maximized) != window.isZoomed()
                && state != WKWebExtensionWindowState::Fullscreen
            {
                window.zoom(None);
            }
            done.call((std::ptr::null_mut(),));
        }

        #[unsafe(method(isPrivateForWebExtensionContext:))]
        fn is_private_for(&self, _context: &WKWebExtensionContext) -> bool {
            self.ivars().private_window.get()
        }

        #[unsafe(method(frameForWebExtensionContext:))]
        fn frame_for(&self, _context: &WKWebExtensionContext) -> NSRect {
            self.frame_source()
                .map_or(NSRect::ZERO, |window| window.frame())
        }

        #[unsafe(method(screenFrameForWebExtensionContext:))]
        fn screen_frame(&self, _context: &WKWebExtensionContext) -> NSRect {
            let screen = self.frame_source().and_then(|window| window.screen());
            screen
                .or_else(|| NSScreen::mainScreen(self.mtm()))
                .map_or(NSRect::ZERO, |screen| screen.frame())
        }

        #[unsafe(method(focusForWebExtensionContext:completionHandler:))]
        fn focus(&self, _context: &WKWebExtensionContext, done: &Completion) {
            // Popup windows are native; Misty's workspace knows only its own windows.
            let identifier = self.ivars().identifier.borrow().clone();
            if let (Some(identifier), false) = (identifier, self.ivars().popup_window.get()) {
                self.event("focus-window", json!({"windowId": identifier}));
            }
            if let Some(native) = self.native() {
                native.makeKeyAndOrderFront(None);
            }
            done.call((std::ptr::null_mut(),));
        }

        #[unsafe(method(closeForWebExtensionContext:completionHandler:))]
        fn close_window(&self, context: &WKWebExtensionContext, done: &Completion) {
            if self.ivars().popup_window.get() {
                if let Some(native) = self.native() {
                    native.close();
                }
                done.call((std::ptr::null_mut(),));
                return;
            }
            // A Misty workspace window can also contain protected app surfaces and
            // private tabs. Only close browser tabs represented by this extension window.
            for tab in self.tabs_for(context) {
                self.event("close-tab", json!({"tabId": tab.identifier()}));
            }
            done.call((std::ptr::null_mut(),));
        }

        #[unsafe(method(setFrame:forWebExtensionContext:completionHandler:))]
        fn set_frame(&self, frame: NSRect, _context: &WKWebExtensionContext, done: &Completion) {
            if let Some(native) = self.native() {
                native.setFrame_display(frame, true);
            }
            done.call((std::ptr::null_mut(),));
        }
    }
);

impl MistyExtensionWindow {
    pub(super) fn new(mtm: MainThreadMarker, host: &MistyExtensionHost) -> Retained<Self> {
        let this = mtm.alloc::<Self>().set_ivars(WindowState {
            host: Weak::new(host),
            native: RefCell::default(),
            private_window: Cell::new(false),
            popup_window: Cell::new(false),
            identifier: RefCell::default(),
        });
        // SAFETY: NSObject's designated initializer.
        unsafe { msg_send![super(this), init] }
    }

    pub(super) fn native(&self) -> Option<Retained<NSWindow>> {
        self.ivars().native.borrow().load()
    }
    pub(super) fn identifier(&self) -> Option<String> {
        self.ivars().identifier.borrow().clone()
    }
    pub(super) fn is_private(&self) -> bool {
        self.ivars().private_window.get()
    }
    fn event(&self, kind: &str, data: serde_json::Value) {
        if let Some(host) = self.ivars().host.load() {
            host.event(kind, data);
        }
    }

    /// This window's tabs in tab order, as the extension may see them.
    pub(super) fn tabs_for(
        &self,
        context: &WKWebExtensionContext,
    ) -> Vec<Retained<MistyExtensionTab>> {
        let Some(host) = self.ivars().host.load() else {
            return Vec::new();
        };
        let private_access = unsafe { context.hasAccessToPrivateData() };
        let mut tabs = host.all_tabs();
        tabs.sort_by_key(|tab| tab.ivars().position.get());
        tabs.into_iter()
            .filter(|tab| {
                tab.window()
                    .is_some_and(|window| std::ptr::eq(&*window, self))
                    && (!self.ivars().private_window.get() || private_access)
            })
            .collect()
    }

    /// Before a tab's view is attached the window is unknown; report Misty's main window
    /// rather than an empty frame, which extensions use to place their own windows.
    fn frame_source(&self) -> Option<Retained<NSWindow>> {
        self.native().or_else(|| {
            let app = NSApplication::sharedApplication(self.mtm());
            app.mainWindow().or_else(|| app.windows().firstObject())
        })
    }
}
