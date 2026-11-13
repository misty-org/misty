// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).

use super::*;

fn monitor(x: i32, y: i32, width: u32, height: u32) -> Display {
    Display {
        area: Rect {
            x,
            y,
            width,
            height,
        },
        scale: 1.0,
    }
}

fn state(width: u32, height: u32, x: i32, y: i32) -> SavedGeometry {
    SavedGeometry {
        width,
        height,
        x,
        y,
        maximized: false,
        fullscreen: false,
    }
}

#[test]
fn restore_keeps_geometry_on_a_visible_monitor() {
    let saved = state(1600, 900, 100, 80);
    assert_eq!(
        resolve(Some(&saved), &[monitor(0, 0, 1920, 1080)]).placement,
        Placement::Restore(Rect {
            x: 100,
            y: 80,
            width: 1600,
            height: 900
        })
    );
}

#[test]
fn restore_drops_geometry_on_a_disconnected_monitor() {
    let saved = state(1200, 800, 3000, 200);
    assert!(matches!(
        resolve(Some(&saved), &[monitor(0, 0, 1920, 1080)]).placement,
        Placement::Default { .. }
    ));
}

#[test]
fn restore_drops_geometry_without_monitor_information() {
    assert!(matches!(
        resolve(Some(&state(1200, 800, 0, 0)), &[]).placement,
        Placement::Default { .. }
    ));
}

#[test]
fn restore_clamps_an_oversized_window_to_the_work_area() {
    let Placement::Restore(rect) =
        resolve(Some(&state(3000, 2000, 0, 0)), &[monitor(0, 0, 1920, 1040)]).placement
    else {
        panic!("expected restore");
    };
    assert_eq!((rect.width, rect.height), (1920, 1040));
}

#[test]
fn default_size_shrinks_to_the_work_area_and_centers() {
    assert_eq!(
        resolve(None, &[monitor(0, 0, 1240, 780)]).placement,
        Placement::Default(Rect {
            x: 0,
            y: 0,
            width: 1240,
            height: 780
        })
    );
    assert_eq!(
        resolve(None, &[monitor(0, 0, 2560, 1400)]).placement,
        Placement::Default(Rect {
            x: 640,
            y: 290,
            width: 1280,
            height: 820
        })
    );
}

#[test]
fn restore_raises_an_undersized_window_to_the_minimum() {
    let Placement::Restore(rect) =
        resolve(Some(&state(320, 200, 10, 10)), &[monitor(0, 0, 1920, 1080)]).placement
    else {
        panic!("expected restore");
    };
    assert_eq!((rect.width, rect.height), (640, 420));
}

#[test]
fn implausible_records_fall_back_to_the_default() {
    for saved in [
        state(0, 900, 0, 0),
        state(1400, 0, 0, 0),
        state(50_000, 900, 0, 0),
        state(1400, 900, 99_999, 0),
    ] {
        assert!(
            matches!(
                resolve(Some(&saved), &[monitor(0, 0, 1920, 1080)]).placement,
                Placement::Default { .. }
            ),
            "{saved:?}"
        );
    }
}

#[test]
fn maximized_never_overwrites_the_normal_geometry() {
    let previous = state(1200, 800, 50, 40);
    let next = state_after_event(&previous, (1920, 1040), (0, 0), true, false);
    assert_eq!(
        (next.width, next.height, next.x, next.y),
        (1200, 800, 50, 40)
    );
    assert!(next.maximized);
    let restored = state_after_event(&next, (1200, 800), (50, 40), false, false);
    assert_eq!((restored.width, restored.height), (1200, 800));
    assert!(!restored.maximized);
}

#[test]
fn fullscreen_also_keeps_the_normal_geometry() {
    let next = state_after_event(&state(1400, 900, 10, 20), (2560, 1440), (0, 0), false, true);
    assert_eq!((next.width, next.height), (1400, 900));
    assert!(next.fullscreen);
}

#[test]
fn flags_come_back_through_resolve() {
    let mut saved = state(1400, 900, 20, 30);
    saved.maximized = true;
    let resolution = resolve(Some(&saved), &[monitor(0, 0, 1920, 1080)]);
    assert!(resolution.maximized);
    assert!(!resolution.fullscreen);
}

#[test]
fn records_travel_with_the_open_window() {
    let window = super::super::OpenWindow {
        profile: "personal".into(),
        window_id: "w".into(),
        space: None,
        geometry: Some(state(1600, 1000, -40, 60)),
    };
    let text = serde_json::to_string(&window).unwrap();
    assert!(text.contains("\"geometry\":{\"width\":1600"));
    let back: super::super::OpenWindow = serde_json::from_str(&text).unwrap();
    assert_eq!(back, window);
    // A list saved before geometry was kept still reads.
    let old: super::super::OpenWindow =
        serde_json::from_str(r#"{"profile":"personal","windowId":"w"}"#).unwrap();
    assert_eq!(old.geometry, None);
    remember("w", Some(&state(1600, 1000, -40, 60)));
    assert_eq!(geometry_for("w"), Some(state(1600, 1000, -40, 60)));
    remember("bad", Some(&state(0, 0, 0, 0)));
    assert_eq!(geometry_for("bad"), None);
}

#[test]
fn minimum_size_follows_the_target_display_scale() {
    // Physical pixels (Windows): main screen at 150%, the one to its right at 100%.
    let displays = [
        display_from(monitor(0, 0, 2880, 1680).area, 1.5, false),
        display_from(monitor(2880, 0, 1920, 1040).area, 1.0, false),
    ];
    let Placement::Restore(rect) = resolve(Some(&state(700, 500, 3000, 100)), &displays).placement
    else {
        panic!("expected restore");
    };
    assert_eq!((rect.width, rect.height), (700, 500));
    let Placement::Restore(rect) = resolve(Some(&state(700, 500, 100, 100)), &displays).placement
    else {
        panic!("expected restore");
    };
    assert_eq!((rect.width, rect.height), (960, 630));
}

#[test]
fn default_size_scales_with_the_main_display() {
    let displays = [
        display_from(monitor(0, 0, 2880, 1680).area, 1.5, false),
        display_from(monitor(2880, 0, 1920, 1040).area, 1.0, false),
    ];
    assert_eq!(
        resolve(None, &displays).placement,
        Placement::Default(Rect {
            x: 480,
            y: 225,
            width: 1920,
            height: 1230
        })
    );
}

#[test]
fn mac_mixed_scale_restores_on_the_saved_display_in_points() {
    // A 2x built-in screen and a 1x screen to its right: their physical areas overlap, and
    // only in points do they lie on one grid.
    let displays = [
        display_from(
            Rect {
                x: 0,
                y: 0,
                width: 3456,
                height: 2234,
            },
            2.0,
            true,
        ),
        display_from(
            Rect {
                x: 1728,
                y: 0,
                width: 1920,
                height: 1080,
            },
            1.0,
            true,
        ),
    ];
    assert_eq!(
        displays[0].area,
        Rect {
            x: 0,
            y: 0,
            width: 1728,
            height: 1117
        }
    );
    assert_eq!(
        to_record_units(
            Rect {
                x: 400,
                y: 200,
                width: 2800,
                height: 1800
            },
            2.0,
            true
        ),
        Rect {
            x: 200,
            y: 100,
            width: 1400,
            height: 900
        }
    );
    let window = to_record_units(
        Rect {
            x: 1900,
            y: 100,
            width: 1600,
            height: 1000,
        },
        1.0,
        true,
    );
    let saved = state(window.width, window.height, window.x, window.y);
    let Placement::Restore(rect) = resolve(Some(&saved), &displays).placement else {
        panic!("expected restore");
    };
    assert_eq!(
        rect,
        Rect {
            x: 1900,
            y: 100,
            width: 1600,
            height: 1000
        }
    );
}

#[test]
fn an_invalid_scale_factor_does_not_break_unit_conversion() {
    let rect = Rect {
        x: 10,
        y: 20,
        width: 300,
        height: 400,
    };
    for scale in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        assert_eq!(to_record_units(rect, scale, true), rect, "{scale}");
        assert_eq!(display_from(rect, scale, false).scale, 1.0, "{scale}");
    }
}
