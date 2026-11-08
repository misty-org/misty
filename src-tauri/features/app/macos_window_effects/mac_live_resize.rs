//! Pages out of sight sit out a live window resize.
//!
//! Every page is a native web view in the window, and AppKit resizes each one that has an
//! autoresizing mask on every step of a drag, hidden or not. Each of those resizes asks that
//! page's process to lay the page out again, so the cost of a step grew with every open tab. For
//! the length of a drag only the views on screen follow the window. The rest catch up once when it
//! ends, so a tab switch still finds its page laid out.
#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use std::cell::RefCell;
use std::rc::Rc;

use cocoa::{base::id, foundation::NSString};
use objc::{class, msg_send, sel, sel_impl};
use objc2::rc::Retained;
use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindow};
use objc2_foundation::NSSize;

/// A page kept alive out of sight waits far past the window's left edge.
const PARKED_X: f64 = -10_000.0;

/// The views sitting out the current drag, each with its own mask, and the size they last followed.
struct SatOut {
    old_size: NSSize,
    views: Vec<(Retained<NSView>, NSAutoresizingMaskOptions)>,
}

unsafe fn sit_out(window: id) -> Option<SatOut> {
    let window: &NSWindow = (window as *const NSWindow).as_ref()?;
    let parent = window.contentView()?;
    let mut views = Vec::new();
    for view in parent.subviews().iter() {
        let mask = view.autoresizingMask();
        let out_of_sight = view.isHidden() || view.frame().origin.x <= PARKED_X;
        if out_of_sight && mask != NSAutoresizingMaskOptions::ViewNotSizable {
            view.setAutoresizingMask(NSAutoresizingMaskOptions::ViewNotSizable);
            views.push((view, mask));
        }
    }
    Some(SatOut {
        old_size: parent.bounds().size,
        views,
    })
}

unsafe fn catch_up(out: SatOut) {
    for (view, mask) in out.views {
        view.setAutoresizingMask(mask);
        // A page closed during the drag has no window left to follow.
        if view.superview().is_some() {
            view.resizeWithOldSuperviewSize(out.old_size);
        }
    }
}

/// Watches every window's live resizes. Only one can run at a time, since it follows the pointer.
pub fn install() {
    let current: Rc<RefCell<Option<SatOut>>> = Rc::default();
    let started = current.clone();
    let start = block2::RcBlock::new(move |notification: *mut std::ffi::c_void| unsafe {
        let window: id = msg_send![notification as id, object];
        *started.borrow_mut() = sit_out(window);
    });
    let end = block2::RcBlock::new(move |_notification: *mut std::ffi::c_void| unsafe {
        let out = current.borrow_mut().take();
        if let Some(out) = out {
            catch_up(out);
        }
    });
    unsafe {
        let center: id = msg_send![class!(NSNotificationCenter), defaultCenter];
        let name =
            NSString::alloc(cocoa::base::nil).init_str("NSWindowWillStartLiveResizeNotification");
        let _: id = msg_send![center,
            addObserverForName: name
            object: cocoa::base::nil
            queue: cocoa::base::nil
            usingBlock: &*start as *const _ as id];
        let name =
            NSString::alloc(cocoa::base::nil).init_str("NSWindowDidEndLiveResizeNotification");
        let _: id = msg_send![center,
            addObserverForName: name
            object: cocoa::base::nil
            queue: cocoa::base::nil
            usingBlock: &*end as *const _ as id];
    }
    // The observers live as long as the app does.
    std::mem::forget(start);
    std::mem::forget(end);
}
