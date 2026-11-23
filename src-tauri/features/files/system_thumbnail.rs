use std::path::Path;

use objc2_core_foundation::{
    CFBoolean, CFDictionary, CFMutableData, CFNumber, CFString, CFType, CFURL,
};
use objc2_core_graphics::{CGImage, CGImageAlphaInfo};
use objc2_image_io::{
    kCGImageDestinationLossyCompressionQuality, kCGImageSourceCreateThumbnailFromImageAlways,
    kCGImageSourceCreateThumbnailWithTransform, kCGImageSourceShouldCache,
    kCGImageSourceThumbnailMaxPixelSize, CGImageDestination, CGImageSource,
};

const JPEG_QUALITY: f64 = 0.85;

pub(crate) fn thumbnail(path: &Path, size: u32) -> Option<(Vec<u8>, &'static str)> {
    let url = CFURL::from_file_path(path)?;
    // SAFETY: the ImageIO keys are constant CFStrings the framework defines.
    let (should_cache, from_image, with_transform, max_size, quality) = unsafe {
        (
            kCGImageSourceShouldCache,
            kCGImageSourceCreateThumbnailFromImageAlways,
            kCGImageSourceCreateThumbnailWithTransform,
            kCGImageSourceThumbnailMaxPixelSize,
            kCGImageDestinationLossyCompressionQuality,
        )
    };
    let yes: &CFType = CFBoolean::new(true);
    let no: &CFType = CFBoolean::new(false);
    let opening = CFDictionary::<CFString, CFType>::from_slices(&[should_cache], &[no]);
    let pixels = CFNumber::new_i32(i32::try_from(size).ok()?);
    let longest: &CFType = &pixels;
    let making = CFDictionary::<CFString, CFType>::from_slices(
        &[from_image, with_transform, max_size, should_cache],
        &[yes, yes, longest, no],
    );
    // SAFETY: the dictionaries map CFString keys to the CFTypes ImageIO documents for them.
    let image = unsafe {
        let source = CGImageSource::with_url(&url, Some(as_plain(&opening)))?;
        source.thumbnail_at_index(0, Some(as_plain(&making)))?
    };
    let alpha = CGImage::alpha_info(Some(&*image));
    let opaque = [
        CGImageAlphaInfo::None,
        CGImageAlphaInfo::NoneSkipLast,
        CGImageAlphaInfo::NoneSkipFirst,
    ]
    .contains(&alpha);
    let (kind, mime) = if opaque {
        ("public.jpeg", "image/jpeg")
    } else {
        ("public.png", "image/png")
    };
    let out = CFMutableData::new(None, 0)?;
    let compression = CFNumber::new_f64(JPEG_QUALITY);
    let compression: &CFType = &compression;
    let writing = CFDictionary::<CFString, CFType>::from_slices(&[quality], &[compression]);
    // SAFETY: the destination writes one image into `out`; the property dictionary maps a CFString
    // key to the CFNumber ImageIO documents for it.
    let written = unsafe {
        let destination =
            CGImageDestination::with_data(&out, &CFString::from_static_str(kind), 1, None)?;
        destination.add_image(&image, opaque.then(|| as_plain(&writing)));
        destination.finalize()
    };
    written.then(|| (out.to_vec(), mime))
}

fn as_plain(dictionary: &CFDictionary<CFString, CFType>) -> &CFDictionary {
    AsRef::<CFDictionary>::as_ref(dictionary)
}
