use super::{choose_primary, platform, Display};

fn display(id: u32, x: f64) -> Display {
    Display {
        id,
        x,
        y: 0.,
        width: 1920.,
        height: 1080.,
        scale: 1.,
    }
}
fn window(handle: isize, x: f64) -> platform::ForegroundWindow {
    platform::ForegroundWindow {
        handle,
        x,
        y: 100.,
        width: 1200.,
        height: 800.,
        app: "Code".into(),
        title: "main.rs".into(),
        monitor: None,
    }
}

#[test]
fn the_window_in_front_beats_the_cursor() {
    let frames = [display(1, 0.), display(2, 1920.)];
    let editor = window(7, 2100.);
    assert_eq!(
        choose_primary(&frames, Some(&editor), (500., 500.)),
        Some((2, true))
    );
    let reported = platform::ForegroundWindow {
        monitor: Some((1920., 0., 1920., 1080.)),
        x: 1500.,
        ..editor
    };
    assert_eq!(
        choose_primary(&frames, Some(&reported), (500., 500.)),
        Some((2, true))
    );
}

#[test]
fn the_companion_in_front_falls_back_to_the_cursor() {
    let frames = [display(1, 0.), display(2, 1920.)];
    let companion = platform::usable_foreground(window(9, 2100.), &[9]);
    assert_eq!(companion, None);
    assert_eq!(
        choose_primary(&frames, companion.as_ref(), (500., 500.)),
        Some((1, false))
    );
    assert_eq!(
        choose_primary(&frames, None, (-50., -50.)),
        Some((1, false))
    );
}
