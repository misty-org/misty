//! The cutout on macOS, straight from Rust through objc2. Vision has no objc2 bindings in the
//! app, so its three classes are messaged by name; Core Image and Core Video are the app's own
//! bindings. Every call runs inside an autorelease pool, since the caller is a blocking thread.

use objc2::rc::{autoreleasepool, Allocated, Retained};
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2::msg_send;
use objc2_core_graphics::{kCGColorSpaceSRGB, CGColorSpace};
use objc2_core_image::{kCIFormatRGBA8, CIContext, CIImage};
use objc2_core_video::CVPixelBuffer;
use objc2_foundation::{NSArray, NSData, NSDictionary, NSError};

#[link(name = "Vision", kind = "framework")]
extern "C" {}

const REQUEST: &std::ffi::CStr = c"VNGenerateForegroundInstanceMaskRequest";

/// The request Vision cuts subjects out with is in macOS 14 and later.
pub(super) fn supported() -> bool {
    AnyClass::get(REQUEST).is_some()
}

fn error_text(error: Option<Retained<NSError>>, fallback: &str) -> String {
    match error {
        Some(error) => error.localizedDescription().to_string(),
        None => fallback.to_string(),
    }
}

/// `image` (PNG or JPEG bytes) with everything but its subject cleared, as a PNG.
pub(super) fn cut_out(image: &[u8]) -> Result<Vec<u8>, String> {
    let requests = AnyClass::get(REQUEST).ok_or("Removing a background needs macOS 14 or later.")?;
    let handlers = AnyClass::get(c"VNImageRequestHandler")
        .ok_or("Removing a background needs macOS 14 or later.")?;
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
            return Err(error_text(error, "The subject couldn't be found."));
        }
        // SAFETY: `results` answers an NSArray of observations, or nil.
        let results: Option<Retained<NSArray<AnyObject>>> = unsafe { msg_send![&*request, results] };
        let observation = results
            .and_then(|results| results.firstObject())
            .ok_or("No subject was found in this image.")?;
        // SAFETY: `allInstances` answers the NSIndexSet of every subject found.
        let instances: Retained<AnyObject> = unsafe { msg_send![&*observation, allInstances] };
        let mut error: *mut NSError = std::ptr::null_mut();
        // SAFETY: the method takes the instances, the handler that ran the request, whether to crop
        // and an error out-pointer, and answers a pixel buffer the observation owns (not retained
        // for the caller), alive while this pool is.
        let buffer: *mut CVPixelBuffer = unsafe {
            msg_send![
                &*observation,
                generateMaskedImageOfInstances: &*instances,
                fromRequestHandler: &*handler,
                croppedToInstancesExtent: Bool::NO,
                error: &mut error
            ]
        };
        // SAFETY: a non-null answer is a live pixel buffer (see above).
        let Some(buffer) = (unsafe { buffer.as_ref() }) else {
            // SAFETY: as above, the out-pointer holds an NSError or nothing.
            let error = unsafe { Retained::retain(error) };
            return Err(error_text(error, "The subject couldn't be cut out."));
        };
        // SAFETY: Core Image reads the pixel buffer; the context and color space are fresh.
        unsafe {
            let picture = CIImage::imageWithCVPixelBuffer(buffer);
            let context = CIContext::contextWithOptions(None);
            let space = CGColorSpace::with_name(Some(kCGColorSpaceSRGB))
                .ok_or("The image couldn't be written.")?;
            let png = context
                .PNGRepresentationOfImage_format_colorSpace_options(
                    &picture,
                    kCIFormatRGBA8,
                    &space,
                    &NSDictionary::new(),
                )
                .ok_or("The image couldn't be written.")?;
            Ok(png.to_vec())
        }
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
        assert!(cut_out(b"not an image").is_err());
    }

    #[test]
    fn leaves_a_photo_subject_over_transparency() {
        let photo = std::path::Path::new("/Library/User Pictures/Animals/Parrot.heic");
        if !supported() || !photo.exists() {
            return;
        }
        let png = cut_out(&std::fs::read(photo).unwrap()).unwrap();
        let picture = image::load_from_memory_with_format(&png, image::ImageFormat::Png)
            .unwrap()
            .to_rgba8();
        let alpha: Vec<u8> = picture.pixels().map(|pixel| pixel[3]).collect();
        // Some of it is the subject, some of it is cleared.
        assert!(alpha.iter().any(|&a| a == 0));
        assert!(alpha.iter().any(|&a| a == 255));
    }
}
