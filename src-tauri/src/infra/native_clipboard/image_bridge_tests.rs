use super::*;
use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};

#[test]
fn system_and_rust_paths_preserve_existing_clipboard_formats() {
    let original = DynamicImage::ImageRgba8(RgbaImage::from_pixel(8, 4, Rgba([128, 64, 32, 128])));
    // TGA has no signature recognized by load_from_memory; it was never a
    // clipboard input format. Files explicitly selects it in its own worker.
    for format in [
        ImageFormat::Png,
        ImageFormat::Bmp,
        ImageFormat::WebP,
        ImageFormat::Gif,
        ImageFormat::Pnm,
        ImageFormat::Jpeg,
    ] {
        let mut encoded = std::io::Cursor::new(Vec::new());
        let source = if matches!(format, ImageFormat::Jpeg | ImageFormat::Pnm) {
            DynamicImage::ImageRgb8(original.to_rgb8())
        } else {
            original.clone()
        };
        source.write_to(&mut encoded, format).unwrap();
        let bytes = encoded.into_inner();
        let expected = image::load_from_memory(&bytes).unwrap().to_rgba8();
        let actual = decode_clipboard_image(&bytes)
            .unwrap_or_else(|| panic!("Clipboard format {format:?} failed"))
            .to_rgba8();
        assert_eq!(actual.dimensions(), expected.dimensions(), "{format:?}");
        // JPEG implementations may round color conversion differently.
        for (actual, expected) in actual.as_raw().iter().zip(expected.as_raw()) {
            assert!(
                actual.abs_diff(*expected) <= if format == ImageFormat::Jpeg { 2 } else { 0 },
                "{format:?}: {actual} != {expected}"
            );
        }
    }
    let mut hdr = Vec::new();
    image::codecs::hdr::HdrEncoder::new(&mut hdr)
        .encode(&[image::Rgb([0.5f32, 0.25, 0.1]); 8], 4, 2)
        .unwrap();
    assert_eq!(decode_clipboard_image(&hdr).unwrap().width(), 4);
    assert!(decode_clipboard_image(b"corrupt").is_none());
}

#[test]
fn system_gif_path_keeps_first_frame_and_transparency() {
    let mut bytes = Vec::new();
    {
        let mut encoder = image::codecs::gif::GifEncoder::new(&mut bytes);
        for color in [[255, 0, 0, 255], [0, 255, 0, 255]] {
            let mut image = RgbaImage::from_pixel(8, 4, Rgba(color));
            image.put_pixel(0, 0, Rgba([0, 0, 0, 0]));
            encoder.encode_frame(image::Frame::new(image)).unwrap();
        }
    }
    let decoded = decode_clipboard_image(&bytes).unwrap().to_rgba8();
    assert_eq!(decoded.get_pixel(1, 0).0, [255, 0, 0, 255]);
    assert_eq!(decoded.get_pixel(0, 0).0[3], 0);
}
