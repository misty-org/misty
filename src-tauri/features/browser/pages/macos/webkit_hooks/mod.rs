#![allow(unexpected_cfgs)]

use std::{
    ffi::{c_char, c_uchar, CStr},
    sync::OnceLock,
};

use objc::runtime::Object;
use objc::{msg_send, sel, sel_impl};
use objc2::runtime::{AnyClass, Imp, Method, Sel};

mod keys;
mod media;
mod navigation;
mod user_scripts;

pub(crate) use media::set_trusted_media_origins;
pub(crate) use navigation::navigation_is_main_frame;

pub(crate) fn install() {
    if objc2_foundation::MainThreadMarker::new().is_none() {
        return;
    }
    unsafe {
        user_scripts::install();
        navigation::install();
        keys::install();
        media::install();
    }
}

unsafe fn override_method(
    class_name: &CStr,
    selector: Sel,
    replacement: Imp,
    added_types: Option<&'static CStr>,
    original: &'static OnceLock<usize>,
) {
    unsafe extern "C" {
        fn class_addMethod(
            cls: *const AnyClass,
            name: Sel,
            imp: Imp,
            types: *const c_char,
        ) -> c_uchar;
        fn method_getTypeEncoding(method: *const Method) -> *const c_char;
    }

    if original.get().is_some() {
        return;
    }
    let Some(class) = AnyClass::get(class_name) else {
        return;
    };
    let inherited = class.instance_method(selector);
    let types = match (inherited, added_types) {
        (Some(method), _) => method_getTypeEncoding(method),
        (None, Some(types)) => types.as_ptr(),
        (None, None) => return,
    };
    let _ = original.set(inherited.map_or(0, |method| method.implementation() as usize));
    if class_addMethod(class, selector, replacement, types) != 0 {
        return;
    }
    if let Some(own) = class
        .instance_methods()
        .iter()
        .find(|candidate| candidate.name() == selector)
    {
        let _ = own.set_implementation(replacement);
    }
}

fn original_of(original: &OnceLock<usize>) -> Option<usize> {
    original
        .get()
        .copied()
        .filter(|implementation| *implementation != 0)
}

unsafe fn text_of(value: *mut Object) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let raw: *const c_char = msg_send![value, UTF8String];
    if raw.is_null() {
        return None;
    }
    CStr::from_ptr(raw).to_str().ok().map(str::to_owned)
}
