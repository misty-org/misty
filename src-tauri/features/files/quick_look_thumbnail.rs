use std::{path::Path, sync::mpsc, time::Duration};

use block2::RcBlock;
use objc2::AnyThread;
use objc2_core_foundation::CGSize;
use objc2_foundation::{NSError, NSString, NSURL};
use objc2_quick_look_thumbnailing::{
    QLThumbnailGenerationRequest, QLThumbnailGenerationRequestRepresentationTypes,
    QLThumbnailGenerator, QLThumbnailRepresentation,
};

const WAIT: Duration = Duration::from_secs(10);

pub(crate) fn thumbnail(path: &Path, size: u32) -> Option<(Vec<u8>, &'static str)> {
    let url = NSURL::fileURLWithPath(&NSString::from_str(path.to_str()?));
    let side = f64::from(size);
    // SAFETY: the request is made from a file URL, a size and a representation type, as Quick
    // Look documents.
    let request = unsafe {
        QLThumbnailGenerationRequest::initWithFileAtURL_size_scale_representationTypes(
            QLThumbnailGenerationRequest::alloc(),
            &url,
            CGSize::new(side, side),
            1.0,
            QLThumbnailGenerationRequestRepresentationTypes::Thumbnail,
        )
    };
    let (made, got) = mpsc::channel();
    let done = RcBlock::new(
        move |representation: *mut QLThumbnailRepresentation, _: *mut NSError| {
            // SAFETY: Quick Look hands the completion a live representation or null.
            let picture = unsafe { representation.as_ref() }.and_then(|representation| {
                // SAFETY: a thumbnail representation always carries its CGImage.
                let image = unsafe { representation.CGImage() };
                super::system_thumbnail::encode(&image)
            });
            let _ = made.send(picture);
        },
    );
    // SAFETY: the shared generator runs the request and calls the completion once, off the main
    // thread; this thread only waits for it.
    unsafe {
        QLThumbnailGenerator::sharedGenerator()
            .generateBestRepresentationForRequest_completionHandler(&request, &done);
    }
    match got.recv_timeout(WAIT) {
        Ok(picture) => picture,
        Err(_) => {
            // SAFETY: cancelling a request the shared generator was given is always allowed.
            unsafe { QLThumbnailGenerator::sharedGenerator().cancelRequest(&request) };
            None
        }
    }
}
