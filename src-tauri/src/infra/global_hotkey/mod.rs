//! System-wide hold-to-talk chords with key-down and key-up.
//!
//! One listen-only hook per process (a CGEventTap on macOS, a low-level
//! keyboard hook on Windows) serves every chord: Control+Option for the agent
//! at the cursor and the dictation key. Input is observed, never consumed.
use serde::{Deserialize, Serialize};
use std::sync::{
    mpsc::{self, Receiver, Sender},
    Arc, Mutex, OnceLock,
};

#[cfg(target_os = "macos")]
mod platform_macos;
#[cfg(target_os = "macos")]
use platform_macos as platform;
#[cfg(windows)]
mod platform_windows;
#[cfg(windows)]
use platform_windows as platform;

/// A modifier a chord can use. `Option` is Alt on Windows and `Command` is the
/// Windows key. The `Right*` keys match only the right-hand key; plain ones
/// match either side.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Key {
    Control,
    Option,
    Command,
    Shift,
    /// The Fn/Globe key (macOS only; Windows never reports it).
    Fn,
    RightControl,
    RightOption,
    RightCommand,
}

/// Which physical modifiers are down right now.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Modifiers {
    pub left_control: bool,
    pub right_control: bool,
    pub left_option: bool,
    pub right_option: bool,
    pub left_command: bool,
    pub right_command: bool,
    pub shift: bool,
    pub function: bool,
}

impl Modifiers {
    fn pressed(&self, key: Key) -> bool {
        match key {
            Key::Control => self.left_control || self.right_control,
            Key::Option => self.left_option || self.right_option,
            Key::Command => self.left_command || self.right_command,
            Key::Shift => self.shift,
            Key::Fn => self.function,
            Key::RightControl => self.right_control,
            Key::RightOption => self.right_option,
            Key::RightCommand => self.right_command,
        }
    }

    pub fn any(&self) -> bool {
        *self != Modifiers::default()
    }
}

/// Keys held together. Held means every key is down.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Chord(pub Vec<Key>);

impl Chord {
    /// Talk to the agent at your cursor.
    pub fn companion() -> Self {
        Chord(vec![Key::Control, Key::Option])
    }

    /// Dictation: Fn/Globe on macOS, Right Alt on Windows.
    pub fn dictation_default() -> Self {
        if cfg!(target_os = "macos") {
            Chord(vec![Key::Fn])
        } else {
            Chord(vec![Key::RightOption])
        }
    }

    /// Reads "Fn", "RightAlt", "Control+Option" and similar settings values.
    pub fn parse(value: &str) -> Option<Self> {
        let mut keys = Vec::new();
        for part in value.split('+') {
            let key = match part.trim().to_ascii_lowercase().as_str() {
                "control" | "ctrl" => Key::Control,
                "option" | "alt" => Key::Option,
                "command" | "cmd" | "win" | "super" => Key::Command,
                "shift" => Key::Shift,
                "fn" | "globe" => Key::Fn,
                "rightcontrol" | "rightctrl" => Key::RightControl,
                "rightoption" | "rightalt" => Key::RightOption,
                "rightcommand" | "rightcmd" => Key::RightCommand,
                _ => return None,
            };
            if !keys.contains(&key) {
                keys.push(key);
            }
        }
        (!keys.is_empty()).then_some(Chord(keys))
    }

    fn held(&self, modifiers: &Modifiers) -> bool {
        self.0.iter().all(|key| modifiers.pressed(*key))
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum HotkeyEvent {
    Down,
    Up,
    /// A non-modifier key went down (the companion uses it to notice typing).
    KeyboardActivity,
    Click(f64, f64),
    Error(String),
}

/// Turns modifier state into Down/Up transitions for each registered chord.
#[derive(Default)]
pub(crate) struct Tracker {
    entries: Vec<(u64, Chord, bool)>,
}

impl Tracker {
    pub fn set(&mut self, id: u64, chord: Chord) {
        match self.entries.iter_mut().find(|(entry, _, _)| *entry == id) {
            Some(entry) => *entry = (id, chord, false),
            None => self.entries.push((id, chord, false)),
        }
    }

    pub fn remove(&mut self, id: u64) {
        self.entries.retain(|(entry, _, _)| *entry != id);
    }

    pub fn update(&mut self, modifiers: &Modifiers) -> Vec<(u64, HotkeyEvent)> {
        let mut changes = Vec::new();
        for (id, chord, held) in &mut self.entries {
            let now = chord.held(modifiers);
            if now != *held {
                *held = now;
                changes.push((
                    *id,
                    if now {
                        HotkeyEvent::Down
                    } else {
                        HotkeyEvent::Up
                    },
                ));
            }
        }
        changes
    }
}

struct Hub {
    tracker: Tracker,
    subscribers: Vec<(u64, Sender<HotkeyEvent>)>,
    next: u64,
    started: bool,
}

fn hub() -> &'static Arc<Mutex<Hub>> {
    static HUB: OnceLock<Arc<Mutex<Hub>>> = OnceLock::new();
    HUB.get_or_init(|| {
        Arc::new(Mutex::new(Hub {
            tracker: Tracker::default(),
            subscribers: Vec::new(),
            next: 1,
            started: false,
        }))
    })
}

/// A registered chord. Dropping it unregisters the chord.
pub struct Subscription {
    id: u64,
    pub events: Receiver<HotkeyEvent>,
}

impl Subscription {}

impl Drop for Subscription {
    fn drop(&mut self) {
        if let Ok(mut hub) = hub().lock() {
            hub.tracker.remove(self.id);
            hub.subscribers.retain(|(id, _)| *id != self.id);
        }
    }
}

/// Registers a chord and starts the shared hook on first use. Keyboard
/// activity, clicks and hook errors reach every subscriber.
pub fn subscribe(chord: Chord) -> Subscription {
    let (tx, events) = mpsc::channel();
    let mut state = hub()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let id = state.next;
    state.next += 1;
    state.tracker.set(id, chord);
    state.subscribers.push((id, tx));
    if !state.started {
        state.started = true;
        #[cfg(any(target_os = "macos", windows))]
        std::thread::Builder::new()
            .name("misty-global-hotkey".into())
            .spawn(|| platform::run(dispatch))
            .ok();
    }
    Subscription { id, events }
}

/// Input from the platform hook.
pub(crate) enum Input {
    Modifiers(Modifiers),
    KeyboardActivity,
    Click(f64, f64),
    Error(String),
}

#[cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
fn dispatch(input: Input) {
    let Ok(mut state) = hub().lock() else { return };
    let broadcast = |state: &Hub, event: HotkeyEvent| {
        for (_, tx) in &state.subscribers {
            let _ = tx.send(event.clone());
        }
    };
    match input {
        Input::Modifiers(modifiers) => {
            for (id, event) in state.tracker.update(&modifiers) {
                if let Some((_, tx)) = state.subscribers.iter().find(|(entry, _)| *entry == id) {
                    let _ = tx.send(event);
                }
            }
        }
        Input::KeyboardActivity => broadcast(&state, HotkeyEvent::KeyboardActivity),
        Input::Click(x, y) => broadcast(&state, HotkeyEvent::Click(x, y)),
        Input::Error(message) => broadcast(&state, HotkeyEvent::Error(message)),
    }
}

/// The modifiers currently held, so paste can wait for the person to let go.
pub fn held_modifiers() -> Modifiers {
    #[cfg(any(target_os = "macos", windows))]
    return platform::current_modifiers();
    #[cfg(not(any(target_os = "macos", windows)))]
    Modifiers::default()
}

#[cfg(test)]
mod tests {
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
}
