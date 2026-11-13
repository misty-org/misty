use super::*;

fn mods(f: impl FnOnce(&mut Modifiers)) -> Modifiers {
    let mut m = Modifiers::default();
    f(&mut m);
    m
}

#[test]
fn chords_report_down_once_and_up_on_release() {
    let mut tracker = Tracker::default();
    tracker.set(1, Chord::companion());
    tracker.set(2, Chord(vec![Key::Fn]));
    assert!(tracker.update(&mods(|m| m.left_control = true)).is_empty());
    assert_eq!(
        tracker.update(&mods(|m| {
            m.left_control = true;
            m.right_option = true
        })),
        vec![(1, HotkeyEvent::Down)]
    );
    assert!(tracker
        .update(&mods(|m| {
            m.left_control = true;
            m.right_option = true
        }))
        .is_empty());
    assert_eq!(
        tracker.update(&mods(|m| m.function = true)),
        vec![(1, HotkeyEvent::Up), (2, HotkeyEvent::Down)]
    );
    assert_eq!(
        tracker.update(&Modifiers::default()),
        vec![(2, HotkeyEvent::Up)]
    );
}

#[test]
fn right_keys_match_only_the_right_side() {
    let mut tracker = Tracker::default();
    tracker.set(1, Chord(vec![Key::RightOption]));
    assert!(tracker.update(&mods(|m| m.left_option = true)).is_empty());
    assert_eq!(
        tracker.update(&mods(|m| m.right_option = true)),
        vec![(1, HotkeyEvent::Down)]
    );
}

#[test]
fn changing_a_chord_resets_it() {
    let mut tracker = Tracker::default();
    tracker.set(1, Chord(vec![Key::Fn]));
    tracker.update(&mods(|m| m.function = true));
    tracker.set(1, Chord(vec![Key::RightCommand]));
    assert!(tracker.update(&mods(|m| m.function = true)).is_empty());
    tracker.remove(1);
    assert!(tracker.update(&mods(|m| m.right_command = true)).is_empty());
}

#[test]
fn parses_settings_values() {
    assert_eq!(Chord::parse("Fn"), Some(Chord(vec![Key::Fn])));
    assert_eq!(
        Chord::parse("RightAlt"),
        Some(Chord(vec![Key::RightOption]))
    );
    assert_eq!(Chord::parse("Control + Option"), Some(Chord::companion()));
    assert_eq!(Chord::parse("ctrl+ctrl"), Some(Chord(vec![Key::Control])));
    assert_eq!(Chord::parse("Hyper"), None);
    assert_eq!(Chord::parse(""), None);
}
