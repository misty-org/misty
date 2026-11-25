#![allow(unexpected_cfgs)]
use super::site_permissions::{ask, CAMERA, LOCATION, MICROPHONE};
use super::{emit_failed, page_of_view};
use objc::runtime::{Class, Object, Sel};
use objc::{msg_send, sel, sel_impl};

const DELEGATE_CLASS: &str = "MistyWebTabPermissionDelegate";
const GRANT: usize = 1;
const DENY: usize = 2;
const URL_ERROR_DOMAIN: &str = "NSURLErrorDomain";
const WEBKIT_ERROR_DOMAIN: &str = "WebKitErrorDomain";

extern "C" {
    fn _Block_copy(block: *const std::ffi::c_void) -> *mut std::ffi::c_void;
    fn _Block_release(block: *const std::ffi::c_void);
    fn object_setClass(object: *mut Object, class: *const Class) -> *const Class;
}

unsafe fn text(value: *mut Object) -> String {
    if value.is_null() {
        return String::new();
    }
    (*value.cast::<objc2_foundation::NSString>()).to_string()
}

unsafe fn origin_of(origin: *mut Object) -> String {
    if origin.is_null() {
        return String::new();
    }
    let protocol = text(msg_send![origin, protocol]);
    let host = text(msg_send![origin, host]);
    let port: isize = msg_send![origin, port];
    if port > 0 {
        format!("{protocol}://{host}:{port}")
    } else {
        format!("{protocol}://{host}")
    }
}

struct Handler(usize);

fn finish(handler: Handler, call: fn(usize, bool), allow: bool) {
    let run = move || {
        call(handler.0, allow);
        unsafe { _Block_release(handler.0 as *const std::ffi::c_void) };
    };
    match super::app() {
        Some(app) => {
            let _ = app.run_on_main_thread(run);
        }
        None => run(),
    }
}

fn call_media(block: usize, allow: bool) {
    unsafe {
        (&*(block as *const block2::Block<dyn Fn(usize)>)).call((if allow { GRANT } else { DENY },))
    };
}

fn call_location(block: usize, allow: bool) {
    unsafe {
        (&*(block as *const block2::Block<dyn Fn(objc2::runtime::Bool)>))
            .call((objc2::runtime::Bool::new(allow),))
    };
}

fn request(
    webview: *mut Object,
    origin: *mut Object,
    kinds: Vec<&'static str>,
    handler: *mut Object,
    call: fn(usize, bool),
) {
    let kept = Handler(unsafe { _Block_copy(handler as *const std::ffi::c_void) } as usize);
    let Some(page) = page_of_view(webview as usize) else {
        return finish(kept, call, false);
    };
    let origin = unsafe { origin_of(origin) };
    ask(
        &page,
        origin,
        kinds,
        Box::new(move |allow| finish(kept, call, allow)),
    );
}

extern "C" fn media(
    _delegate: &Object,
    _selector: Sel,
    webview: *mut Object,
    origin: *mut Object,
    _frame: *mut Object,
    capture: usize,
    handler: *mut Object,
) {
    let kinds = match capture {
        0 => vec![CAMERA],
        1 => vec![MICROPHONE],
        _ => vec![CAMERA, MICROPHONE],
    };
    request(webview, origin, kinds, handler, call_media);
}

extern "C" fn location(
    _delegate: &Object,
    _selector: Sel,
    webview: *mut Object,
    origin: *mut Object,
    _frame: *mut Object,
    handler: *mut Object,
) {
    request(webview, origin, vec![LOCATION], handler, call_location);
}

extern "C" fn location_for_frame(
    _delegate: &Object,
    _selector: Sel,
    webview: *mut Object,
    frame: *mut Object,
    handler: *mut Object,
) {
    let origin: *mut Object = if frame.is_null() {
        std::ptr::null_mut()
    } else {
        unsafe { msg_send![frame, securityOrigin] }
    };
    request(webview, origin, vec![LOCATION], handler, call_location);
}

pub(super) unsafe fn install_permissions(view: usize) {
    let view = view as *mut Object;
    let delegate: *mut Object = msg_send![view, UIDelegate];
    if delegate.is_null() || (*delegate).class().name() == DELEGATE_CLASS {
        return;
    }
    let subclass = Class::get(DELEGATE_CLASS).unwrap_or_else(|| {
        let mut declaration = objc::declare::ClassDecl::new(DELEGATE_CLASS, (*delegate).class())
            .expect("unique web tab permission delegate class");
        declaration.add_method(
            sel!(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:),
            media as extern "C" fn(&Object, Sel, *mut Object, *mut Object, *mut Object, usize, *mut Object),
        );
        declaration.add_method(
            sel!(_webView:requestGeolocationPermissionForOrigin:initiatedByFrame:decisionHandler:),
            location as extern "C" fn(&Object, Sel, *mut Object, *mut Object, *mut Object, *mut Object),
        );
        declaration.add_method(
            sel!(_webView:requestGeolocationPermissionForFrame:decisionHandler:),
            location_for_frame as extern "C" fn(&Object, Sel, *mut Object, *mut Object, *mut Object),
        );
        declaration.register()
    });
    object_setClass(delegate, subclass);
    let _: () = msg_send![view, setUIDelegate: std::ptr::null_mut::<Object>()];
    let _: () = msg_send![view, setUIDelegate: delegate];
}

pub(in crate::browser) fn page_failed(webview: *mut Object, error: *mut Object) {
    if error.is_null() {
        return;
    }
    let Some(page) = page_of_view(webview as usize) else {
        return;
    };
    unsafe {
        let code: isize = msg_send![error, code];
        let domain = text(msg_send![error, domain]);
        let ignored = (domain == URL_ERROR_DOMAIN && code == -999)
            || (domain == WEBKIT_ERROR_DOMAIN && matches!(code, 102 | 204));
        if ignored {
            return;
        }
        let info: *mut Object = msg_send![error, userInfo];
        let url = if info.is_null() {
            String::new()
        } else {
            let key = objc2_foundation::NSString::from_str("NSErrorFailingURLStringKey");
            let key = &*key as *const objc2_foundation::NSString as *mut Object;
            text(msg_send![info, objectForKey: key])
        };
        let offline = domain == URL_ERROR_DOMAIN && matches!(code, -1009 | -1020);
        let message = text(msg_send![error, localizedDescription]);
        emit_failed(&page, url, offline, message);
    }
}
