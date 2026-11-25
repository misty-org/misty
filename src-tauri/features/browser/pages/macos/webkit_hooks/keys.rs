use std::sync::OnceLock;

use objc::runtime::{Class, Object, Sel, BOOL, NO, YES};
use objc::{msg_send, sel, sel_impl};

use super::override_method;

static KEY_EQUIVALENT: OnceLock<usize> = OnceLock::new();

type KeyEquivalent = unsafe extern "C-unwind" fn(&Object, Sel, *mut Object) -> BOOL;

pub(super) unsafe fn install() {
    let replacement: KeyEquivalent = key_equivalent;
    override_method(
        c"WryWebView",
        objc2::sel!(performKeyEquivalent:),
        std::mem::transmute::<KeyEquivalent, objc2::runtime::Imp>(replacement),
        None,
        &KEY_EQUIVALENT,
    );
}

fn webkit_key_equivalent() -> Option<KeyEquivalent> {
    static WEBKIT: OnceLock<usize> = OnceLock::new();
    let implementation = *WEBKIT.get_or_init(|| {
        objc2::runtime::AnyClass::get(c"WKWebView")
            .and_then(|class| class.instance_method(objc2::sel!(performKeyEquivalent:)))
            .map_or(0, |method| method.implementation() as usize)
    });
    (implementation != 0)
        .then(|| unsafe { std::mem::transmute::<usize, KeyEquivalent>(implementation) })
}

unsafe fn is_child(view: &Object) -> bool {
    let parent: *mut Object = msg_send![view, superview];
    parent.is_null() || (*parent).class().name() != "WryWebViewParent"
}

unsafe fn holds_focus(view: &Object) -> bool {
    let window: *mut Object = msg_send![view, window];
    if window.is_null() {
        return false;
    }
    let responder: *mut Object = msg_send![window, firstResponder];
    let Some(view_class) = Class::get("NSView") else {
        return false;
    };
    if responder.is_null() {
        return false;
    }
    let is_view: BOOL = msg_send![responder, isKindOfClass: view_class];
    if is_view != YES {
        return false;
    }
    let inside: BOOL = msg_send![responder, isDescendantOf: view as *const Object];
    inside == YES
}

unsafe fn menu_takes(event: *mut Object) -> bool {
    let Some(application) = Class::get("NSApplication") else {
        return false;
    };
    let application: *mut Object = msg_send![application, sharedApplication];
    if application.is_null() {
        return false;
    }
    let menu: *mut Object = msg_send![application, mainMenu];
    if menu.is_null() {
        return false;
    }
    let taken: BOOL = msg_send![menu, performKeyEquivalent: event];
    taken == YES
}

unsafe extern "C-unwind" fn key_equivalent(
    view: &Object,
    command: Sel,
    event: *mut Object,
) -> BOOL {
    let Some(webkit) = webkit_key_equivalent() else {
        return NO;
    };
    if !is_child(view) {
        return webkit(view, command, event);
    }
    if menu_takes(event) {
        return YES;
    }
    if !holds_focus(view) {
        return NO;
    }
    webkit(view, command, event)
}
