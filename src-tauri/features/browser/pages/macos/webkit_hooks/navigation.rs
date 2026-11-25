use std::{cell::Cell, sync::OnceLock};

use objc::runtime::{Object, Sel, YES};
use objc::{msg_send, sel, sel_impl};

use super::{original_of, override_method};

static DECIDE_POLICY: OnceLock<usize> = OnceLock::new();

thread_local! {
    static DECIDING_MAIN_FRAME: Cell<bool> = const { Cell::new(true) };
}

type DecidePolicy =
    unsafe extern "C-unwind" fn(&Object, Sel, *mut Object, *mut Object, *mut Object);

pub(crate) fn navigation_is_main_frame() -> bool {
    DECIDING_MAIN_FRAME.with(Cell::get)
}

pub(super) unsafe fn install() {
    let replacement: DecidePolicy = decide_policy;
    override_method(
        c"WryNavigationDelegate",
        objc2::sel!(webView:decidePolicyForNavigationAction:decisionHandler:),
        std::mem::transmute::<DecidePolicy, objc2::runtime::Imp>(replacement),
        None,
        &DECIDE_POLICY,
    );
}

unsafe fn targets_main_frame(action: *mut Object) -> bool {
    if action.is_null() {
        return true;
    }
    let frame: *mut Object = msg_send![action, targetFrame];
    if frame.is_null() {
        return true;
    }
    let main: objc::runtime::BOOL = msg_send![frame, isMainFrame];
    main == YES
}

unsafe extern "C-unwind" fn decide_policy(
    delegate: &Object,
    command: Sel,
    webview: *mut Object,
    action: *mut Object,
    handler: *mut Object,
) {
    let Some(implementation) = original_of(&DECIDE_POLICY) else {
        return;
    };
    let call = std::mem::transmute::<usize, DecidePolicy>(implementation);
    DECIDING_MAIN_FRAME.with(|main| main.set(targets_main_frame(action)));
    call(delegate, command, webview, action, handler);
    DECIDING_MAIN_FRAME.with(|main| main.set(true));
}
