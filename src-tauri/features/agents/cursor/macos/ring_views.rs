//! The mist inside one browser page and inside a whole Misty window while an
//! agent controls it.
use std::{cell::RefCell, ffi::c_void};

use block2::RcBlock;
use objc2::runtime::ProtocolObject;
use objc2::{
    msg_send,
    rc::{Retained, Weak},
    runtime::AnyObject,
    sel,
};
use objc2_app_kit::{
    NSPanel, NSView, NSWindow, NSWindowCollectionBehavior, NSWindowDidResizeNotification,
    NSWindowOrderingMode, NSWindowStyleMask,
};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol, NSOperationQueue};

use super::{
    mist::{mist_in, mist_of, set_waiting, waiting_alpha, MistView},
    ring::{fade_in, ring_panel},
    support::{on_main_later, MainOnly},
};

struct WindowRing {
    panel: Retained<NSPanel>,
    mist: Retained<MistView>,
    observer: Option<Retained<ProtocolObject<dyn NSObjectProtocol>>>,
}

thread_local! {
    static WINDOW_RING: RefCell<Option<WindowRing>> = const { RefCell::new(None) };
}

/// The same mist inside one browser page while an agent holds it. `view` is the
/// page's WKWebView; the mist is its subview, so it follows the page's bounds
/// and rounded corners. WebKit snapshots draw web content only, so the agent's
/// captures never include it.
pub(crate) fn page_ring(view: *mut c_void, active: bool) {
    // SAFETY: the caller passes a live WKWebView, retained here as the block capture was.
    let page = unsafe { Retained::retain(view.cast::<NSView>()) }.map(MainOnly);
    on_main_later(move |mtm| {
        let Some(page) = page.map(MainOnly::into_inner) else {
            return;
        };
        let mist = mist_of(&page);
        if !active {
            if let Some(mist) = mist {
                mist.removeFromSuperview();
            }
            return;
        }
        match mist {
            None => fade_in::<NSView>(&mist_in(mtm, &page, None), waiting_alpha()),
            Some(mist) => mist.fit(),
        }
    });
}

/// The window's own corner radius, which varies by macOS version and style.
fn window_corner_radius(window: &NSWindow) -> f64 {
    if window.styleMask().contains(NSWindowStyleMask::FullScreen) {
        return 0.0;
    }
    let selector = sel!(_cornerRadius);
    if !window.respondsToSelector(selector) {
        return 10.0;
    }
    // SAFETY: a private getter returning a CGFloat, checked to exist above.
    unsafe { msg_send![window, _cornerRadius] }
}

fn fit_window_ring(ring: &WindowRing, window: &NSWindow) {
    ring.panel.setFrame_display(window.frame(), true);
    ring.mist.set_radius(window_corner_radius(window));
    ring.mist.fit();
}

fn remove_window_ring() {
    let Some(ring) = WINDOW_RING.with(|slot| slot.borrow_mut().take()) else {
        return;
    };
    if let Some(observer) = &ring.observer {
        // SAFETY: the observer came from addObserverForName on this center.
        unsafe {
            NSNotificationCenter::defaultCenter()
                .removeObserver(&*(Retained::as_ptr(observer) as *const AnyObject))
        };
    }
    if let Some(parent) = ring.panel.parentWindow() {
        parent.removeChildWindow(&ring.panel);
    }
    ring.panel.orderOut(None);
}

/// The same mist inside a whole Misty window while an agent controls it. `view`
/// is any view in that window. The mist is a click-through child panel, so it
/// moves with the window, and window capture (one window only) leaves it out.
pub(crate) fn window_ring(view: *mut c_void, active: bool) {
    // SAFETY: the caller passes null or a live view of the window.
    let anchor = unsafe { Retained::retain(view.cast::<NSView>()) }.map(MainOnly);
    on_main_later(move |mtm| {
        let window = anchor
            .map(MainOnly::into_inner)
            .and_then(|view| view.window());
        let Some(window) = window.filter(|_| active) else {
            remove_window_ring();
            return;
        };
        let same = WINDOW_RING.with(|slot| {
            slot.borrow()
                .as_ref()
                .and_then(|ring| ring.panel.parentWindow())
                .is_some_and(|parent| parent == window)
        });
        if same {
            WINDOW_RING.with(|slot| {
                if let Some(ring) = slot.borrow().as_ref() {
                    fit_window_ring(ring, &window);
                }
            });
            return;
        }
        remove_window_ring();
        let panel = ring_panel(mtm, window.frame());
        // Above the window it covers, not above other apps.
        panel.setLevel(window.level());
        panel.setCollectionBehavior(
            NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        let Some(content) = panel.contentView() else {
            return;
        };
        let mist = mist_in(mtm, &content, Some(window_corner_radius(&window)));
        // SAFETY: a live panel that is not yet a child of any window.
        unsafe { window.addChildWindow_ordered(&panel, NSWindowOrderingMode::Above) };
        let weak = Weak::from_retained(&window);
        let resized = RcBlock::new(move |_: std::ptr::NonNull<NSNotification>| {
            let Some(window) = weak.load() else { return };
            WINDOW_RING.with(|slot| {
                if let Some(ring) = slot.borrow().as_ref() {
                    fit_window_ring(ring, &window);
                }
            });
        });
        let center = NSNotificationCenter::defaultCenter();
        // SAFETY: the block lives as long as the observer; the window is a valid object.
        let observer = unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(NSWindowDidResizeNotification),
                Some(&*(&*window as *const NSWindow as *const AnyObject)),
                Some(&NSOperationQueue::mainQueue()),
                &resized,
            )
        };
        let ring = WindowRing {
            panel,
            mist,
            observer: Some(observer),
        };
        fit_window_ring(&ring, &window);
        let panel = ring.panel.clone();
        WINDOW_RING.with(|slot| *slot.borrow_mut() = Some(ring));
        if let Some(content) = panel.contentView() {
            fade_in::<NSView>(&content, 1.0);
        }
    });
}

/// While an agent waits for the person every mist thins instead of disappearing.
pub(crate) fn mist_waiting(waiting: bool) {
    on_main_later(move |_| set_waiting(waiting));
}
