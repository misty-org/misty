// SPDX-License-Identifier: MIT
//! Popup windows an extension opens for its own pages, as Firefox and Chrome do for
//! `windows.create({type: "popup"})`: a small native window with the page and no browser
//! chrome. The window and its single tab are real to the extension, so windows.update,
//! windows.remove, tabs.query and messaging work as in Chrome.
use super::{
    host::MistyExtensionHost,
    popup_delegate::PopupWindowDelegate,
    tabs::{MistyExtensionTab, MistyExtensionWindow},
};

use objc2::{
    rc::{Retained, Weak},
    runtime::ProtocolObject,
    sel, DefinedClass, MainThreadOnly,
};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSBackingStoreType, NSScreen, NSWindow, NSWindowStyleMask,
    NSWindowWillCloseNotification,
};
use objc2_foundation::{
    NSNotification, NSNotificationCenter, NSPoint, NSRect, NSSize, NSURLRequest, NSUUID,
};
use objc2_web_kit::{
    WKWebExtensionContext, WKWebExtensionWindowConfiguration, WKWebExtensionWindowType, WKWebView,
};

const MINIMUM_SIDE: f64 = 160.0;
const MAXIMUM_SIDE: f64 = 2400.0;

fn intersects(a: NSRect, b: NSRect) -> bool {
    a.origin.x < b.origin.x + b.size.width
        && b.origin.x < a.origin.x + a.size.width
        && a.origin.y < b.origin.y + b.size.height
        && b.origin.y < a.origin.y + a.size.height
        && a.size.width > 0.0
        && a.size.height > 0.0
        && b.size.width > 0.0
        && b.size.height > 0.0
}

impl MistyExtensionHost {
    /// Opens a popup-type window for one of the extension's own pages. Returns false, without
    /// answering, for any other window, which Misty's workspace opens.
    pub(super) fn open_popup_window(
        &self,
        configuration: &WKWebExtensionWindowConfiguration,
        context: &WKWebExtensionContext,
        done: &dyn Fn(
            Option<Retained<MistyExtensionWindow>>,
            Option<Retained<objc2_foundation::NSError>>,
        ),
    ) -> bool {
        let mtm = self.mtm();
        // SAFETY: reads the configuration WebKit built for this request.
        let (kind, urls, tab_count, frame, private, focused) = unsafe {
            (
                configuration.windowType(),
                configuration.tabURLs(),
                configuration.tabs().count(),
                configuration.frame(),
                configuration.shouldBePrivate(),
                configuration.shouldBeFocused(),
            )
        };
        if kind != WKWebExtensionWindowType::Popup || urls.count() != 1 || tab_count > 0 {
            return false;
        }
        let Some(url) = urls.firstObject() else {
            return false;
        };
        let Some(controller) = self.controller() else {
            return false;
        };
        // Web pages keep opening in Misty's own windows; popups are for the extension's pages.
        // SAFETY: asks the controller which context owns the address.
        let owner = unsafe { controller.extensionContextForURL(&url) };
        if !owner.is_some_and(|owner| std::ptr::eq(&*owner, context)) {
            return false;
        }
        // SAFETY: builds a window and view on the main thread.
        let Some(page_configuration) = (unsafe { context.webViewConfiguration() }) else {
            return false;
        };

        let valid = |value: f64| !value.is_nan();
        let sized = frame.size.width > 0.0
            && frame.size.height > 0.0
            && valid(frame.size.width)
            && valid(frame.size.height);
        let (width, height) = if sized {
            (frame.size.width, frame.size.height)
        } else {
            (400.0, 600.0)
        };
        let size = NSSize::new(
            width.clamp(MINIMUM_SIDE, MAXIMUM_SIDE),
            height.clamp(MINIMUM_SIDE, MAXIMUM_SIDE),
        );
        let style = NSWindowStyleMask::Titled
            | NSWindowStyleMask::Closable
            | NSWindowStyleMask::Miniaturizable
            | NSWindowStyleMask::Resizable;
        // SAFETY: AppKit window construction on the main thread.
        let native = unsafe {
            NSWindow::initWithContentRect_styleMask_backing_defer(
                NSWindow::alloc(mtm),
                NSRect::new(NSPoint::new(0.0, 0.0), size),
                style,
                NSBackingStoreType::Buffered,
                false,
            )
        };
        unsafe { native.setReleasedWhenClosed(false) };
        let name = unsafe { context.webExtension().displayName() };
        native.setTitle(&name.unwrap_or_default());
        // WebKit hands over an AppKit frame; one off every screen is centered instead.
        let placed = sized && valid(frame.origin.x) && valid(frame.origin.y);
        if placed {
            native.setFrame_display(NSRect::new(frame.origin, size), false);
        }
        let visible = NSScreen::screens(mtm)
            .iter()
            .any(|screen| intersects(screen.visibleFrame(), native.frame()));
        if !placed || !visible {
            native.center();
        }

        // SAFETY: a view over the extension's own configuration, owned by the window.
        let view = unsafe {
            WKWebView::initWithFrame_configuration(
                WKWebView::alloc(mtm),
                native
                    .contentView()
                    .map_or(NSRect::ZERO, |content| content.bounds()),
                &page_configuration,
            )
        };
        view.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        // Each Space's host has its own delegate, so links open in that Space.
        let delegate = {
            let existing = self.state().popup_window_delegate.clone();
            existing.unwrap_or_else(|| {
                let delegate = PopupWindowDelegate::new(mtm, self);
                self.state_mut().popup_window_delegate = Some(delegate.clone());
                delegate
            })
        };
        // SAFETY: the delegate outlives the view through the host's state.
        unsafe {
            view.setNavigationDelegate(Some(ProtocolObject::from_ref(&*delegate)));
            view.setUIDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        }
        native.setContentView(Some(&view));

        let window = MistyExtensionWindow::new(mtm, self);
        *window.ivars().native.borrow_mut() = Weak::new(&native);
        window.ivars().popup_window.set(true);
        window.ivars().private_window.set(private);
        let window_id = format!("extension-popup-{}", NSUUID::new().UUIDString());
        *window.ivars().identifier.borrow_mut() = Some(window_id.clone());
        let tab_id = format!("extension-popup-tab-{}", NSUUID::new().UUIDString());
        let tab = MistyExtensionTab::new(mtm, &tab_id, self);
        *tab.ivars().window.borrow_mut() = Some(window.clone());
        *tab.ivars().view.borrow_mut() = Weak::new(&view);
        tab.ivars().selected.set(true);
        *tab.ivars().logical_url.borrow_mut() = Some(url.clone());
        {
            let mut state = self.state_mut();
            state.tabs.insert(tab_id, tab.clone());
            state.windows.insert(window_id, window.clone());
            // The tab holds its view weakly; the window owns it, and this list owns the window.
            state.popup_windows.push(native.clone());
        }
        // SAFETY: the selector is defined on the host class; the notification is AppKit's.
        unsafe {
            NSNotificationCenter::defaultCenter().addObserver_selector_name_object(
                self,
                sel!(popupWindowClosing:),
                Some(NSWindowWillCloseNotification),
                Some(&native),
            );
        }
        self.register_open_tab(&tab);
        // SAFETY: loads the extension's own page.
        unsafe { view.loadRequest(&NSURLRequest::requestWithURL(&url)) };
        if focused {
            native.makeKeyAndOrderFront(None);
        } else {
            native.orderFront(None);
        }
        done(Some(window), None);
        true
    }

    /// A popup window is closing: its tab and window leave the controller.
    pub(super) fn popup_window_closing(&self, notification: &NSNotification) {
        let Some(object) = notification.object() else {
            return;
        };
        let Some(native) = object.downcast_ref::<NSWindow>() else {
            return;
        };
        // SAFETY: removes this host's observer for the closing window.
        unsafe {
            NSNotificationCenter::defaultCenter().removeObserver_name_object(
                self,
                Some(NSWindowWillCloseNotification),
                Some(native),
            );
        }
        let keys: Vec<String> = self.state().tabs.keys().cloned().collect();
        for key in keys {
            let Some(tab) = self.tab(&key) else {
                continue;
            };
            let window = tab.window().filter(|window| {
                window.ivars().popup_window.get()
                    && window
                        .native()
                        .is_some_and(|candidate| std::ptr::eq(&*candidate, native))
            });
            let Some(window) = window else {
                continue;
            };
            if let Some(controller) = self.controller() {
                // SAFETY: both conform to their WebKit protocols.
                unsafe {
                    controller.didCloseTab_windowIsClosing(ProtocolObject::from_ref(&*tab), true);
                    controller.didCloseWindow(ProtocolObject::from_ref(&*window));
                }
            }
            let mut state = self.state_mut();
            state.tabs.remove(&key);
            if let Some(identifier) = window.identifier() {
                state.windows.remove(&identifier);
            }
        }
        self.state_mut()
            .popup_windows
            .retain(|candidate| !std::ptr::eq(&**candidate, native));
    }
}
