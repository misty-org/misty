//! The transport for extension pages on macOS. Extension pages run in views
//! WebKit's extension controller creates, where Tauri IPC does not exist, and
//! the compat layer's requests need answers. Kiri therefore registers a
//! reply-capable script message handler, `kiriExtension`, in the page world of
//! the compat host page, admits only well-formed top-level requests, and hands
//! each to the embedder's extension host, which answers against the
//! permissions the account granted.
#![allow(unexpected_cfgs)]

use objc::runtime::{Class, Object, Sel, BOOL, YES};
use objc::{msg_send, sel, sel_impl};
use std::{
    ffi::{c_void, CString},
    sync::{Arc, OnceLock},
};

/// The name `compat/host.js` posts to.
pub const HANDLER_NAME: &str = "kiriExtension";
const HANDLER_CLASS: &str = "KiriExtensionHandler";

pub trait ExtensionChannel: Send + Sync + 'static {
    /// Answers one request on the main thread.
    ///
    /// # Safety
    /// `message` is a live `WKScriptMessage` whose body is a dictionary, and
    /// `reply` its WebKit reply block, `void (^)(id, NSString *)`. The
    /// implementation must call `reply` exactly once.
    unsafe fn receive(&self, message: *mut c_void, reply: *mut c_void);
}

static CHANNEL: OnceLock<Arc<dyn ExtensionChannel>> = OnceLock::new();

/// Installs the embedder's extension host. The first call wins.
pub fn set_extension_channel(channel: impl ExtensionChannel) {
    let _ = CHANNEL.set(Arc::new(channel));
}

unsafe fn string(text: &str) -> *mut Object {
    let text = CString::new(text).unwrap_or_default();
    msg_send![Class::get("NSString").expect("NSString"), stringWithUTF8String: text.as_ptr()]
}

unsafe fn fail(reply: *mut Object, error: &str) {
    let reply = &*(reply as *const block2::Block<dyn Fn(*mut c_void, *mut c_void)>);
    reply.call((std::ptr::null_mut(), string(error).cast()));
}

extern "C" fn receive(_handler: &Object, _selector: Sel, _controller: *mut Object, message: *mut Object, reply: *mut Object) {
    unsafe {
        let frame: *mut Object = msg_send![message, frameInfo];
        let main_frame: BOOL = msg_send![frame, isMainFrame];
        let body: *mut Object = msg_send![message, body];
        let dictionary: BOOL = if body.is_null() {
            objc::runtime::NO
        } else {
            msg_send![body, isKindOfClass: Class::get("NSDictionary").expect("NSDictionary")]
        };
        match CHANNEL.get() {
            Some(channel) if main_frame == YES && dictionary == YES => {
                channel.receive(message.cast(), reply.cast());
            }
            Some(_) => fail(reply, "Invalid extension request."),
            None => fail(reply, "The extension host stopped."),
        }
    }
}

/// Registers the handler on a compat host page's content controller.
///
/// # Safety
/// `controller` is a live `WKUserContentController` without a handler of this
/// name. Call on the main thread.
pub unsafe fn install(controller: *mut c_void) {
    let controller = controller as *mut Object;
    let class = Class::get(HANDLER_CLASS).unwrap_or_else(|| {
        let mut declaration =
            objc::declare::ClassDecl::new(HANDLER_CLASS, Class::get("NSObject").expect("NSObject"))
                .expect("unique extension handler class");
        declaration.add_method(
            sel!(userContentController:didReceiveScriptMessage:replyHandler:),
            receive as extern "C" fn(&Object, Sel, *mut Object, *mut Object, *mut Object),
        );
        if let Some(protocol) = objc::runtime::Protocol::get("WKScriptMessageHandlerWithReply") {
            declaration.add_protocol(protocol);
        }
        declaration.register()
    });
    let Some(worlds) = Class::get("WKContentWorld") else {
        return;
    };
    let world: *mut Object = msg_send![worlds, pageWorld];
    let handler: *mut Object = msg_send![class, new];
    let _: () = msg_send![controller, addScriptMessageHandlerWithReply: handler contentWorld: world name: string(HANDLER_NAME)];
    let _: () = msg_send![handler, release];
}
