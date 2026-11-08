// SPDX-License-Identifier: MIT
//! Small helpers every file of the extension host shares: JSON and Foundation
//! objects, errors, and work queued on the main thread.
use dispatch2::{DispatchQueue, DispatchTime};
use objc2::{rc::Retained, runtime::AnyObject};
use objc2_foundation::{
    NSArray, NSData, NSDictionary, NSError, NSJSONReadingOptions, NSJSONSerialization,
    NSJSONWritingOptions, NSLocalizedDescriptionKey, NSString,
};
use serde_json::Value;
use std::{
    cell::Cell,
    rc::Rc,
    sync::{Arc, Mutex},
    time::Duration,
};

/// What a request answers with. Always called on the main thread.
pub type Reply = Box<dyn FnOnce(Value)>;

pub(super) fn string(text: &str) -> Retained<NSString> {
    NSString::from_str(text)
}

/// The error the host hands WebKit and extensions.
pub(super) fn error(message: &str) -> Retained<NSError> {
    let value: Retained<AnyObject> = Retained::into_super(Retained::into_super(string(message)));
    // SAFETY: the key is a static string constant of Foundation.
    let key = unsafe { NSLocalizedDescriptionKey };
    let info = NSDictionary::from_retained_objects(&[key], &[value]);
    // SAFETY: a plain domain, code and user-info dictionary.
    unsafe { NSError::errorWithDomain_code_userInfo(&string("MistyExtensions"), 1, Some(&info)) }
}

/// A JSON value as the Foundation object it names (`NSNull`, `NSNumber`, `NSString`,
/// `NSArray` or `NSDictionary`). The value is wrapped in an array so fragments work.
pub(super) fn to_object(value: &Value) -> Option<Retained<AnyObject>> {
    let bytes = serde_json::to_vec(&Value::Array(vec![value.clone()])).ok()?;
    let parsed = {
        NSJSONSerialization::JSONObjectWithData_options_error(
            &NSData::with_bytes(&bytes),
            NSJSONReadingOptions(0),
        )
    }
    .ok()?;
    let array = parsed.downcast::<NSArray>().ok()?;
    array.firstObject()
}

/// A Foundation object (a script message body or WebKit's answer) as JSON. Objects JSON
/// cannot hold become null rather than raising.
pub(super) fn to_json(object: &AnyObject) -> Value {
    let wrapper = NSArray::from_slice(&[object]);
    // SAFETY: validity is checked first, so serialization cannot raise.
    unsafe {
        if !NSJSONSerialization::isValidJSONObject(&wrapper) {
            return Value::Null;
        }
        let Ok(data) = NSJSONSerialization::dataWithJSONObject_options_error(
            &wrapper,
            NSJSONWritingOptions(0),
        ) else {
            return Value::Null;
        };
        match serde_json::from_slice::<Value>(data.to_vec().as_slice()) {
            Ok(Value::Array(mut items)) if items.len() == 1 => items.remove(0),
            _ => Value::Null,
        }
    }
}

/// A JSON object as an `NSDictionary`, for WebKit calls that take arguments by name.
pub(super) fn to_dictionary(value: &Value) -> Retained<NSDictionary<NSString, AnyObject>> {
    to_object(value)
        .and_then(|object| object.downcast::<NSDictionary>().ok())
        // SAFETY: JSON objects have string keys.
        .map(|dictionary| unsafe { Retained::cast_unchecked(dictionary) })
        .unwrap_or_default()
}

pub(super) fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// Mirrors `-[NSNumber boolValue]` on a loosely typed JSON field.
pub(super) fn truthy(value: &Value) -> bool {
    match value {
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0),
        Value::String(text) => {
            matches!(text.chars().next(), Some('Y' | 'y' | 'T' | 't' | '1'..='9'))
        }
        _ => false,
    }
}

/// Mirrors `-[NSNumber unsignedIntegerValue]`.
pub(super) fn unsigned(value: &Value) -> usize {
    value
        .as_f64()
        .map_or(0, |n| if n < 0.0 { 0 } else { n as usize })
}

/// Closures only ever run on the main thread, where every Foundation object they hold lives.
struct MainOnly<F>(F);
// SAFETY: queued on the main queue below and run there, never moved to another thread's use.
unsafe impl<F> Send for MainOnly<F> {}
impl<F: FnOnce()> MainOnly<F> {
    fn run(self) {
        (self.0)()
    }
}

/// `dispatch_async(dispatch_get_main_queue(), ...)`.
pub(super) fn on_main(work: impl FnOnce() + 'static) {
    let work = MainOnly(work);
    DispatchQueue::main().exec_async(move || work.run());
}

/// `dispatch_after(..., dispatch_get_main_queue(), ...)`.
pub(super) fn on_main_after(delay: Duration, work: impl FnOnce() + 'static) {
    let work = MainOnly(work);
    if let Ok(when) = DispatchTime::try_from(delay) {
        let _ = DispatchQueue::main().after(when, move || work.run());
    }
}

/// Wraps a one-shot function so it can be called through a shared `Fn` handle (a block, or a
/// closure cloned into several blocks). Calls after the first do nothing.
pub(super) fn once<A: 'static>(work: impl FnOnce(A) + 'static) -> Rc<dyn Fn(A)> {
    let slot = Cell::new(Some(work));
    Rc::new(move |argument| {
        if let Some(work) = slot.take() {
            work(argument);
        }
    })
}

/// A value handed to a system callback that may run on another thread, which must only
/// hand it back to the main thread and never use it there.
pub(super) struct Handoff<T>(Arc<Mutex<Option<T>>>);
// SAFETY: the value is only ever taken out on the main thread (see `on_main`); other
// threads only move the handle around.
unsafe impl<T> Send for Handoff<T> {}
unsafe impl<T> Sync for Handoff<T> {}
impl<T> Clone for Handoff<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}
impl<T> Handoff<T> {
    pub(super) fn new(value: T) -> Self {
        Self(Arc::new(Mutex::new(Some(value))))
    }
    pub(super) fn take(&self) -> Option<T> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).take()
    }
}
