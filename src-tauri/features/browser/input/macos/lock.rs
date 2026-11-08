//! Keeps the person's own mouse and keyboard out of a browser view an agent has been granted.
//!
//! Physical events pass through the local app monitor; our explicit scoped view dispatch
//! does not. Thus trusted WebKit events can work without briefly opening the agent-owned
//! view to unrelated human input.

use block2::RcBlock;
use objc2::rc::{Retained, Weak};
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSEvent, NSEventMask, NSEventType, NSView};
use objc2_foundation::MainThreadMarker;
use std::{cell::RefCell, ptr::NonNull};

thread_local! {
    // The monitor and the views it guards live on the main thread, where AppKit runs them.
    static LOCKED: RefCell<Vec<Weak<NSView>>> = const { RefCell::new(Vec::new()) };
    static MONITOR: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
}

/// Locks or unlocks `view`. Called on the main thread.
pub(crate) fn set_locked(view: &NSView, locked: bool) {
    LOCKED.with_borrow_mut(|views| {
        views.retain(|held| held.load().is_some_and(|held| !std::ptr::eq(&*held, view)));
        if locked {
            // SAFETY: `view` is a live NSView; the retain only lasts for the weak registration.
            if let Some(strong) = unsafe { Retained::retain(view as *const NSView as *mut NSView) }
            {
                views.push(Weak::from_retained(&strong));
            }
        }
    });
    if MONITOR.with_borrow(|monitor| monitor.is_some()) {
        return;
    }
    let mask = NSEventMask::LeftMouseDown
        | NSEventMask::LeftMouseUp
        | NSEventMask::RightMouseDown
        | NSEventMask::RightMouseUp
        | NSEventMask::LeftMouseDragged
        | NSEventMask::RightMouseDragged
        | NSEventMask::KeyDown
        | NSEventMask::KeyUp
        | NSEventMask::ScrollWheel;
    let handler = RcBlock::new(|event: NonNull<NSEvent>| -> *mut NSEvent {
        // SAFETY: AppKit passes a live event to the monitor.
        let Some(mtm) = MainThreadMarker::new() else {
            return event.as_ptr();
        };
        if swallows(mtm, unsafe { event.as_ref() }) {
            std::ptr::null_mut()
        } else {
            event.as_ptr()
        }
    });
    // SAFETY: AppKit copies the handler and keeps the monitor for the app's lifetime.
    let monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &handler) };
    MONITOR.with_borrow_mut(|slot| *slot = monitor);
}

/// Whether `event` is aimed into a locked view and so is dropped.
fn swallows(mtm: MainThreadMarker, event: &NSEvent) -> bool {
    let Some(window) = event.window(mtm) else {
        return false;
    };
    let keyboard = matches!(event.r#type(), NSEventType::KeyDown | NSEventType::KeyUp);
    let browsers: Vec<Retained<NSView>> =
        LOCKED.with_borrow(|views| views.iter().filter_map(Weak::load).collect());
    for browser in browsers {
        if browser.window().as_deref() != Some(&*window) || browser.isHiddenOrHasHiddenAncestor() {
            continue;
        }
        let target = if keyboard {
            window
                .firstResponder()
                .and_then(|responder| responder.downcast::<NSView>().ok())
        } else {
            window.contentView().and_then(|content| {
                let point = content.convertPoint_fromView(event.locationInWindow(), None);
                content.hitTest(point)
            })
        };
        if let Some(target) = target {
            if std::ptr::eq(&*target, &*browser) || target.isDescendantOf(&browser) {
                return true;
            }
        }
    }
    false
}
