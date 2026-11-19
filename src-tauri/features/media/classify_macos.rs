//! The image classifier on macOS, straight from Rust through objc2, as the cutout is: Vision has
//! no objc2 bindings in the app, so its classes are messaged by name. `VNClassifyImageRequest` is
//! in macOS 10.15 and later. Every call runs inside an autorelease pool, since the caller is a
//! blocking thread.

use objc2::msg_send;
use objc2::rc::{autoreleasepool, Allocated, Retained};
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2_foundation::{NSArray, NSData, NSDictionary, NSError, NSString};

#[link(name = "Vision", kind = "framework")]
extern "C" {}

const REQUEST: &std::ffi::CStr = c"VNClassifyImageRequest";
const UNSUPPORTED: &str = "Recognizing what's in a picture needs macOS 10.15 or later.";

/// Whether this Mac's Vision has the classifier.
pub(super) fn supported() -> bool {
    AnyClass::get(REQUEST).is_some()
}

fn error_text(error: Option<Retained<NSError>>, fallback: &str) -> String {
    match error {
        Some(error) => error.localizedDescription().to_string(),
        None => fallback.to_string(),
    }
}

/// Every label Vision gives `image` (PNG or JPEG bytes), with its confidence from 0 to 1.
pub(super) fn classify(image: &[u8]) -> Result<Vec<(String, f32)>, String> {
    let requests = AnyClass::get(REQUEST).ok_or(UNSUPPORTED)?;
    let handlers = AnyClass::get(c"VNImageRequestHandler").ok_or(UNSUPPORTED)?;
    autoreleasepool(|_| {
        let data = NSData::with_bytes(image);
        let options = NSDictionary::<AnyObject, AnyObject>::new();
        // SAFETY: `initWithData:options:` takes an NSData and an options NSDictionary; the
        // returned handler is retained by `Retained`.
        let handler: Option<Retained<AnyObject>> = unsafe {
            let allocated: Allocated<AnyObject> = msg_send![handlers, alloc];
            msg_send![allocated, initWithData: &*data, options: &*options]
        };
        let handler = handler.ok_or("The image couldn't be read.")?;
        // SAFETY: `new` on an NSObject subclass answers a retained instance.
        let request: Retained<AnyObject> = unsafe { msg_send![requests, new] };
        let list = NSArray::from_retained_slice(&[request.clone()]);
        let mut error: *mut NSError = std::ptr::null_mut();
        // SAFETY: `performRequests:error:` takes an NSArray of requests and an error out-pointer.
        let done: Bool = unsafe { msg_send![&*handler, performRequests: &*list, error: &mut error] };
        if !done.as_bool() {
            // SAFETY: on failure the error out-pointer holds an autoreleased NSError, or nothing.
            let error = unsafe { Retained::retain(error) };
            return Err(error_text(error, "The picture couldn't be recognized."));
        }
        // SAFETY: `results` answers an NSArray of VNClassificationObservation, or nil.
        let results: Option<Retained<NSArray<AnyObject>>> = unsafe { msg_send![&*request, results] };
        let Some(results) = results else {
            return Ok(Vec::new());
        };
        let mut labels = Vec::with_capacity(results.len());
        for observation in results.to_vec() {
            // SAFETY: a classification observation answers its label as an NSString
            // (`identifier`) and its confidence as a float (`VNConfidence`).
            let (identifier, confidence) = unsafe {
                let identifier: Retained<NSString> = msg_send![&*observation, identifier];
                let confidence: f32 = msg_send![&*observation, confidence];
                (identifier, confidence)
            };
            labels.push((identifier.to_string(), confidence));
        }
        Ok(labels)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_bytes_that_are_no_image() {
        if !supported() {
            return;
        }
        assert!(classify(b"not an image").is_err());
    }

    #[test]
    fn names_what_is_in_a_photo() {
        let photo = std::path::Path::new("/Library/User Pictures/Animals/Parrot.heic");
        if !supported() || !photo.exists() {
            return;
        }
        let labels = classify(&std::fs::read(photo).unwrap()).unwrap();
        assert!(!labels.is_empty());
        assert!(labels
            .iter()
            .all(|(label, confidence)| !label.is_empty() && (0.0..=1.0).contains(confidence)));
    }
}
