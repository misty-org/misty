use objc2_core_foundation::{
    CFBoolean, CFData, CFDictionary, CFMutableData, CFNumber, CFString, CFType,
};
use objc2_core_graphics::{CGImage, CGImageAlphaInfo};
use objc2_image_io::{
    kCGImageDestinationLossyCompressionQuality, kCGImageSourceCreateThumbnailFromImageAlways,
    kCGImageSourceCreateThumbnailWithTransform, kCGImageSourceShouldCache,
    kCGImageSourceThumbnailMaxPixelSize, CGImageDestination, CGImageSource,
};

const JPEG_QUALITY: f64 = 0.85;

pub(crate) fn thumbnail(bytes: &[u8], size: u32) -> Option<(Vec<u8>, &'static str)> {
    let data = CFData::from_bytes(bytes);
    // SAFETY: the ImageIO keys are constant CFStrings the framework defines.
    let (should_cache, from_image, with_transform, max_size) = unsafe {
        (
            kCGImageSourceShouldCache,
            kCGImageSourceCreateThumbnailFromImageAlways,
            kCGImageSourceCreateThumbnailWithTransform,
            kCGImageSourceThumbnailMaxPixelSize,
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
        let source = CGImageSource::with_data(&data, Some(as_plain(&opening)))?;
        source.thumbnail_at_index(0, Some(as_plain(&making)))?
    };
    encode(&image)
}

pub(crate) fn encode(image: &CGImage) -> Option<(Vec<u8>, &'static str)> {
    // SAFETY: the ImageIO key is a constant CFString the framework defines.
    let quality = unsafe { kCGImageDestinationLossyCompressionQuality };
    let alpha = CGImage::alpha_info(Some(image));
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
        destination.add_image(image, opaque.then(|| as_plain(&writing)));
        destination.finalize()
    };
    written.then(|| (out.to_vec(), mime))
}

fn as_plain(dictionary: &CFDictionary<CFString, CFType>) -> &CFDictionary {
    AsRef::<CFDictionary>::as_ref(dictionary)
}
