// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
use super::*;

fn display(width: u32, height: u32, scale: f64) -> DisplayInfo {
    DisplayInfo {
        id: 1,
        name: "Test".into(),
        x: 0,
        y: 0,
        width,
        height,
        scale,
        primary: true,
    }
}

#[test]
fn frame_dims_caps_long_edge() {
    // 3024×1964 shrinks to 1568 on the long edge, ratio preserved.
    let (w, h) = frame_dims(&display(3024, 1964, 2.0));
    assert_eq!(w, 1568);
    assert!((h as f64 - 1964.0 * 1568.0 / 3024.0).abs() < 1.0);
    // Small displays pass through unscaled.
    assert_eq!(frame_dims(&display(1280, 800, 1.0)), (1280, 800));
}

#[test]
fn frame_to_logical_applies_scale_and_origin() {
    let mut d = display(3024, 1964, 2.0);
    d.x = 100;
    d.y = 50;
    let (fw, fh) = frame_dims(&d);
    // Center of the image → center of the display in logical points.
    let (lx, ly) = frame_to_logical(fw as f64 / 2.0, fh as f64 / 2.0, fw, fh, &d);
    assert_eq!(lx, 100 + 3024 / 2 / 2);
    assert_eq!(ly, 50 + 1964 / 2 / 2);
    // Origin maps to the display origin.
    assert_eq!(frame_to_logical(0.0, 0.0, fw, fh, &d), (100, 50));
}

#[test]
fn key_chord_parses_modifiers_and_key() {
    let (mods, key) = parse_key_chord("cmd+shift+t").unwrap();
    assert_eq!(mods, vec![Key::Meta, Key::Shift]);
    assert!(matches!(key, Key::Unicode('t')));

    let (mods, key) = parse_key_chord("enter").unwrap();
    assert!(mods.is_empty());
    assert!(matches!(key, Key::Return));

    // A lone modifier is a pressable key itself.
    let (mods, key) = parse_key_chord("alt").unwrap();
    assert!(mods.is_empty());
    assert!(matches!(key, Key::Alt));
}

#[test]
fn key_chord_rejects_garbage() {
    assert!(parse_key_chord("").is_err());
    assert!(parse_key_chord("c+cmd").is_err());
    assert!(parse_key_chord("cmd+nosuchkey").is_err());
}
