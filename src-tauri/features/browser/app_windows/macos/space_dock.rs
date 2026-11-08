//! The Dock menu lists the account's Spaces, with a checkmark beside each one that has a
//! window open; choosing one opens or focuses its window. Tauri has no Dock menu, so the
//! app delegate learns `applicationDockMenu:` here.

use dispatch2::DispatchQueue;
use objc2::ffi::class_addMethod;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, Sel};
use objc2::{define_class, msg_send, sel, MainThreadOnly};
use objc2_app_kit::{
    NSApplication, NSControlStateValueOff, NSControlStateValueOn, NSMenu, NSMenuItem,
};
use objc2_foundation::{MainThreadMarker, NSString};
use std::cell::RefCell;

/// One Space in the Dock menu.
pub(crate) struct DockSpace {
    pub key: String,
    pub name: String,
    pub open: bool,
}

#[derive(Default)]
struct State {
    choice: Option<fn(&str)>,
    target: Option<Retained<DockTarget>>,
    menu: Option<Retained<NSMenu>>,
}

thread_local! {
    // Only ever touched on the main thread, where AppKit calls the menu and its target.
    static STATE: RefCell<State> = RefCell::new(State::default());
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "MistySpaceDockTarget"]
    struct DockTarget;

    impl DockTarget {
        #[unsafe(method(open:))]
        fn open(&self, item: &NSMenuItem) {
            let key = item
                .representedObject()
                .and_then(|object| object.downcast::<NSString>().ok());
            let choice = STATE.with_borrow(|state| state.choice);
            if let (Some(choice), Some(key)) = (choice, key) {
                choice(&key.to_string());
            }
        }
    }
);

/// What `-applicationDockMenu:` returns, added to the app delegate's class.
extern "C-unwind" fn application_dock_menu(
    _this: &AnyObject,
    _cmd: Sel,
    _app: &NSApplication,
) -> *mut NSMenu {
    STATE.with_borrow(|state| {
        state.menu.as_ref().map_or(std::ptr::null_mut(), |menu| {
            Retained::as_ptr(menu).cast_mut()
        })
    })
}

fn ensure_parts(mtm: MainThreadMarker) {
    STATE.with_borrow_mut(|state| {
        if state.target.is_none() {
            state.target = Some(unsafe { msg_send![DockTarget::alloc(mtm), init] });
        }
        if state.menu.is_none() {
            state.menu = Some(NSMenu::initWithTitle(
                NSMenu::alloc(mtm),
                &NSString::from_str("Spaces"),
            ));
        }
    });
}

/// Installs the Dock menu once; `callback` runs on the main thread with the chosen key.
pub(crate) fn install(callback: fn(&str)) {
    DispatchQueue::main().exec_async(move || {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        STATE.with_borrow_mut(|state| state.choice = Some(callback));
        ensure_parts(mtm);
        let app = NSApplication::sharedApplication(mtm);
        let delegate: Option<Retained<AnyObject>> = unsafe { msg_send![&*app, delegate] };
        let Some(delegate) = delegate else {
            return;
        };
        let class = delegate.class();
        let selector = sel!(applicationDockMenu:);
        if !class.responds_to(selector) {
            // SAFETY: the implementation has the signature `@@:@` that the type encoding names.
            unsafe {
                class_addMethod(
                    (class as *const objc2::runtime::AnyClass).cast_mut().cast(),
                    selector,
                    std::mem::transmute::<
                        extern "C-unwind" fn(&AnyObject, Sel, &NSApplication) -> *mut NSMenu,
                        unsafe extern "C-unwind" fn(),
                    >(application_dock_menu),
                    c"@@:@".as_ptr(),
                );
            }
        }
    });
}

/// Replaces the Spaces listed.
pub(crate) fn set(spaces: Vec<DockSpace>) {
    DispatchQueue::main().exec_async(move || {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        ensure_parts(mtm);
        let (menu, target) = STATE.with_borrow(|state| (state.menu.clone(), state.target.clone()));
        let (Some(menu), Some(target)) = (menu, target) else {
            return;
        };
        menu.removeAllItems();
        for space in spaces {
            // SAFETY: `open:` is defined on the target above and takes the menu item.
            let item = unsafe {
                NSMenuItem::initWithTitle_action_keyEquivalent(
                    NSMenuItem::alloc(mtm),
                    &NSString::from_str(&space.name),
                    Some(sel!(open:)),
                    &NSString::new(),
                )
            };
            unsafe { item.setTarget(Some(&target)) };
            unsafe { item.setRepresentedObject(Some(&NSString::from_str(&space.key))) };
            item.setState(if space.open {
                NSControlStateValueOn
            } else {
                NSControlStateValueOff
            });
            menu.addItem(&item);
        }
    });
}
