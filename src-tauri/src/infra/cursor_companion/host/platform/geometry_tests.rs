use super::*;

#[test]
fn retina_overlay_covers_the_display_in_points_without_a_pixel_offset() {
    let display = super::super::Display {
        id: 1,
        x: 0.,
        y: 0.,
        width: 1728.,
        height: 1117.,
        scale: 2.,
    };
    let frame = overlay_frame(&display, 1117.);
    assert_eq!(frame.origin.x, 0.);
    assert_eq!(frame.origin.y, 0.);
    assert_eq!(frame.size.width, 1728.);
    assert_eq!(frame.size.height, 1117.);
}

#[test]
fn secondary_displays_keep_their_global_origins_at_mixed_scales() {
    for (x, y, scale, expected_y) in [
        (-1440., 0., 1., 217.),
        (1728., 150., 2., 67.),
        (0., -900., 1., 1117.),
        (0., 1117., 2., -900.),
    ] {
        let display = super::super::Display {
            id: 2,
            x,
            y,
            width: 1440.,
            height: 900.,
            scale,
        };
        let frame = overlay_frame(&display, 1117.);
        assert_eq!(frame.origin.x, x);
        assert_eq!(frame.origin.y, expected_y);
        assert_eq!(frame.size.height, 900.);
    }
}
