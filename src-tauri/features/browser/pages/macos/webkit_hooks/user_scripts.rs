use std::sync::OnceLock;

use objc::runtime::{Class, Object, Sel, BOOL};
use objc::{msg_send, sel, sel_impl};

use super::{original_of, override_method, text_of};

const IPC_START: &str = "Object.defineProperty(window, 'ipc', { value: Object.freeze(";
const IPC_END: &str = " });";
const UTF8: usize = 4;

static ADD_USER_SCRIPT: OnceLock<usize> = OnceLock::new();

type AddUserScript = unsafe extern "C-unwind" fn(&Object, Sel, *mut Object);

pub(super) unsafe fn install() {
    let replacement: AddUserScript = add_user_script;
    override_method(
        c"WKUserContentController",
        objc2::sel!(addUserScript:),
        std::mem::transmute::<AddUserScript, objc2::runtime::Imp>(replacement),
        None,
        &ADD_USER_SCRIPT,
    );
}

fn writable_ipc(source: &str) -> Option<String> {
    if !source.starts_with(IPC_START) || source.contains("writable") {
        return None;
    }
    let body = source.trim_end().strip_suffix(IPC_END)?;
    Some(format!("{body}, writable: true, enumerable: true{IPC_END}"))
}

unsafe fn rewritten(script: *mut Object) -> Option<*mut Object> {
    let source: *mut Object = msg_send![script, source];
    let source = writable_ipc(&text_of(source)?)?;
    let injection: isize = msg_send![script, injectionTime];
    let main_frame_only: BOOL = msg_send![script, isForMainFrameOnly];
    let text: *mut Object = msg_send![Class::get("NSString")?, alloc];
    let text: *mut Object =
        msg_send![text, initWithBytes: source.as_ptr() length: source.len() encoding: UTF8];
    if text.is_null() {
        return None;
    }
    let fresh: *mut Object = msg_send![Class::get("WKUserScript")?, alloc];
    let fresh: *mut Object = msg_send![fresh, initWithSource: text injectionTime: injection forMainFrameOnly: main_frame_only];
    let _: () = msg_send![text, release];
    (!fresh.is_null()).then_some(fresh)
}

unsafe extern "C-unwind" fn add_user_script(
    controller: &Object,
    command: Sel,
    script: *mut Object,
) {
    let Some(implementation) = original_of(&ADD_USER_SCRIPT) else {
        return;
    };
    let call = std::mem::transmute::<usize, AddUserScript>(implementation);
    let fresh = if script.is_null() {
        None
    } else {
        rewritten(script)
    };
    match fresh {
        Some(fresh) => {
            call(controller, command, fresh);
            let _: () = msg_send![fresh, release];
        }
        None => call(controller, command, script),
    }
}

#[cfg(test)]
mod tests {
    use super::writable_ipc;

    #[test]
    fn wry_ipc_bridge_becomes_writable() {
        let wry = "Object.defineProperty(window, 'ipc', { value: Object.freeze({ postMessage: function(s) { window.webkit.messageHandlers.ipc.postMessage(s) } }) });";
        assert_eq!(
            writable_ipc(wry).as_deref(),
            Some("Object.defineProperty(window, 'ipc', { value: Object.freeze({ postMessage: function(s) { window.webkit.messageHandlers.ipc.postMessage(s) } }), writable: true, enumerable: true });")
        );
        assert_eq!(writable_ipc("window.misty = 1;"), None);
    }
}
