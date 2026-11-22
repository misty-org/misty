//! System-wide hold-to-talk chords with key-down and key-up.
//!
//! One listen-only hook per process (a CGEventTap on macOS, a low-level
//! keyboard hook on Windows, the X server's key state on Linux) serves every chord: Control+Option for the agent
//! at the cursor and the dictation key. Input is observed, never consumed.
use serde::{Deserialize, Serialize};
use std::sync::{
    mpsc::{self, Receiver, Sender},
    Arc, Mutex, OnceLock,
};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos as platform;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
use windows as platform;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
use linux as platform;

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
    Click(f64, f64),
    /// Control tapped twice on its own, quickly (opens Tutor's text box). Shortcuts like
    /// Control+C or Control and a click never count. macOS and Windows only.
    DoubleTap,
    /// Escape pressed anywhere (macOS only): what Tutor shows at the cursor, such as its tour,
    /// gives way. The key still reaches the app in front.
    Escape,
    Error(String),
}

/// Two taps of Control on its own, each short, close together. A third tap starts a new pair.
#[derive(Default)]
pub(crate) struct DoubleTap {
    /// When Control went down alone, and whether nothing else has happened since.
    down: Option<(std::time::Instant, bool)>,
    /// When the last clean tap ended, if it was the first of a pair.
    last: Option<std::time::Instant>,
}

impl DoubleTap {
    const TAP: std::time::Duration = std::time::Duration::from_millis(300);
    const BETWEEN: std::time::Duration = std::time::Duration::from_millis(450);

    /// A modifier change; true when it completes a double tap.
    pub fn modifiers(&mut self, modifiers: &Modifiers, now: std::time::Instant) -> bool {
        let control = modifiers.left_control || modifiers.right_control;
        let others = modifiers.left_option
            || modifiers.right_option
            || modifiers.left_command
            || modifiers.right_command
            || modifiers.shift
            || modifiers.function;
        if control && !others {
            if self.down.is_none() {
                self.down = Some((now, true));
            }
            return false;
        }
        if others {
            self.interrupt();
            return false;
        }
        // Everything is up.
        let Some((since, clean)) = self.down.take() else {
            return false;
        };
        if !clean || now.duration_since(since) > Self::TAP {
            self.last = None;
            return false;
        }
        match self.last.take() {
            // The pair is complete; the next tap starts another.
            Some(previous) if now.duration_since(previous) <= Self::BETWEEN => true,
            _ => {
                self.last = Some(now);
                false
            }
        }
    }

    /// Any other key, a click or a scroll: no tap is under way.
    pub fn interrupt(&mut self) {
        if let Some((_, clean)) = self.down.as_mut() {
            *clean = false;
        }
        self.last = None;
    }
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
    taps: DoubleTap,
    subscribers: Vec<(u64, Sender<HotkeyEvent>)>,
    next: u64,
    started: bool,
}

fn hub() -> &'static Arc<Mutex<Hub>> {
    static HUB: OnceLock<Arc<Mutex<Hub>>> = OnceLock::new();
    HUB.get_or_init(|| {
        Arc::new(Mutex::new(Hub {
            tracker: Tracker::default(),
            taps: DoubleTap::default(),
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

/// Registers a chord and starts the shared hook on first use. Clicks and hook
/// errors reach every subscriber.
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
        #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
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
    Click(f64, f64),
    /// Any key that isn't a modifier: breaks a double tap, and counts toward typing.
    #[cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
    Key,
    /// Escape: like any other key, and Tutor's tour gives way.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Escape,
    /// A scroll: only breaks a double tap.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Scroll,
    Error(String),
}

#[cfg_attr(
    not(any(target_os = "macos", windows, target_os = "linux")),
    allow(dead_code)
)]
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
            // Linux's hook sees only modifiers, so it can't tell Control+C from a tap.
            if cfg!(any(target_os = "macos", windows)) {
                if state.taps.modifiers(&modifiers, std::time::Instant::now()) {
                    broadcast(&state, HotkeyEvent::DoubleTap);
                }
            }
        }
        Input::Key => {
            state.taps.interrupt();
            typing::key();
        }
        Input::Escape => {
            state.taps.interrupt();
            typing::key();
            broadcast(&state, HotkeyEvent::Escape);
        }
        Input::Scroll => state.taps.interrupt(),
        Input::Click(x, y) => {
            state.taps.interrupt();
            broadcast(&state, HotkeyEvent::Click(x, y))
        }
        Input::Error(message) => broadcast(&state, HotkeyEvent::Error(message)),
    }
}

/// Whether the person is typing now: several keys in quick succession, seen by the same hook.
/// Only the timing is kept, never which keys. Tutor's Misty steps out of the way while it holds.
pub fn typing() -> bool {
    typing::now()
}

mod typing {
    use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
    use std::sync::OnceLock;
    use std::time::Instant;

    /// Keys closer together than this are one run of typing.
    const RUN_MS: u64 = 700;
    /// How many keys in a run before it counts as typing, so a shortcut doesn't.
    const KEYS: u32 = 3;

    static START: OnceLock<Instant> = OnceLock::new();
    static LAST: AtomicU64 = AtomicU64::new(0);
    static RUN: AtomicU32 = AtomicU32::new(0);

    fn now_ms() -> u64 {
        // Starts at 1, so a key at the first instant still reads as one.
        START.get_or_init(Instant::now).elapsed().as_millis() as u64 + 1
    }

    pub(super) fn key() {
        let now = now_ms();
        let last = LAST.swap(now, Ordering::SeqCst);
        if last != 0 && now - last <= RUN_MS {
            RUN.fetch_add(1, Ordering::SeqCst);
        } else {
            RUN.store(1, Ordering::SeqCst);
        }
    }

    pub(super) fn now() -> bool {
        let last = LAST.load(Ordering::SeqCst);
        last != 0 && now_ms().saturating_sub(last) <= RUN_MS && RUN.load(Ordering::SeqCst) >= KEYS
    }
}

/// The modifiers currently held, so paste can wait for the person to let go.
pub fn held_modifiers() -> Modifiers {
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    return platform::current_modifiers();
    #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
    Modifiers::default()
}

#[cfg(test)]
mod tests;
