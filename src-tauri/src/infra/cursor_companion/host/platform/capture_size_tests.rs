use super::companion_capture_size;

#[test]
fn captures_stay_inside_the_sizes_vision_providers_keep() {
    for (display, expected) in [
        ((1496, 967), (1188, 768)),
        ((2992, 1934), (1188, 768)),
        ((1920, 1080), (1365, 768)),
        ((3440, 1440), (1568, 656)),
        ((1080, 1920), (768, 1365)),
        ((800, 600), (800, 600)),
    ] {
        let (width, height) = companion_capture_size(display.0, display.1);
        assert_eq!((width, height), expected, "{display:?}");
        assert!(width.min(height) <= 768 && width.max(height) <= 1568);
    }
}
