use super::*;
use std::cell::Cell;

#[test]
fn restores_only_when_nobody_else_wrote() {
    assert!(should_restore(41, 41));
    // Another app (or the person) copied something after Misty's write.
    assert!(!should_restore(41, 42));
}

/// A clipboard whose change count rises on every write, with an optional
/// writer that copies something while the paste is in flight.
struct Fake {
    contents: std::cell::RefCell<String>,
    count: Cell<u64>,
    pasted: Cell<Option<PasteKeys>>,
    racing_copy: Option<&'static str>,
    trusted: bool,
}

impl Fake {
    fn new(contents: &str) -> Self {
        Fake {
            contents: contents.to_string().into(),
            count: Cell::new(7),
            pasted: Cell::new(None),
            racing_copy: None,
            trusted: true,
        }
    }
    fn write(&self, text: &str) -> u64 {
        *self.contents.borrow_mut() = text.to_string();
        self.count.set(self.count.get() + 1);
        self.count.get()
    }
}

impl Desktop for Fake {
    type Saved = String;
    fn snapshot_clipboard(&self) -> String {
        self.contents.borrow().clone()
    }
    fn write_clipboard_text(&self, text: &str) -> Result<u64, String> {
        Ok(self.write(text))
    }
    fn clipboard_change_count(&self) -> u64 {
        self.count.get()
    }
    fn restore_clipboard(&self, saved: String) {
        self.write(&saved);
    }
    fn can_post_keys(&self) -> bool {
        self.trusted
    }
    fn request_post_keys(&self) {}
    fn held_modifiers(&self) -> Modifiers {
        Modifiers::default()
    }
    fn frontmost_app(&self) -> Option<String> {
        Some("com.apple.TextEdit".into())
    }
    fn post_paste(&self, keys: PasteKeys) -> Result<(), String> {
        self.pasted.set(Some(keys));
        if let Some(copy) = self.racing_copy {
            self.write(copy);
        }
        Ok(())
    }
    fn sleep(&self, _: Duration) {}
}

#[test]
fn pastes_then_puts_the_clipboard_back() {
    let fake = Fake::new("what I copied");
    assert_eq!(paste_with(&fake, "dictated"), Ok(Inserted::Pasted));
    assert!(fake.pasted.get().is_some());
    assert_eq!(*fake.contents.borrow(), "what I copied");
}

#[test]
fn a_copy_during_the_paste_wins_the_race() {
    let fake = Fake {
        racing_copy: Some("copied meanwhile"),
        ..Fake::new("old")
    };
    assert_eq!(paste_with(&fake, "dictated"), Ok(Inserted::Pasted));
    assert_eq!(*fake.contents.borrow(), "copied meanwhile");
}

#[test]
fn without_accessibility_the_text_waits_on_the_clipboard() {
    let fake = Fake {
        trusted: false,
        ..Fake::new("old")
    };
    assert_eq!(paste_with(&fake, "dictated"), Ok(Inserted::OnClipboard));
    assert_eq!(fake.pasted.get(), None);
    assert_eq!(*fake.contents.borrow(), "dictated");
}

#[test]
fn waits_for_held_modifiers_before_pasting() {
    let polls = Cell::new(0);
    let held = || {
        polls.set(polls.get() + 1);
        Modifiers {
            function: polls.get() < 4,
            ..Default::default()
        }
    };
    assert!(wait_for_release(held, Duration::from_secs(1), |_| {}));
    assert_eq!(polls.get(), 4);
}

#[test]
fn gives_up_when_keys_stay_down() {
    let held = || Modifiers {
        right_option: true,
        ..Default::default()
    };
    assert!(!wait_for_release(
        held,
        Duration::from_millis(30),
        std::thread::sleep
    ));
}

#[test]
fn terminals_get_a_terminal_paste_on_windows() {
    assert!(is_terminal("WindowsTerminal.exe"));
    assert!(is_terminal("com.googlecode.iterm2"));
    assert!(!is_terminal("notepad.exe"));
    if cfg!(windows) {
        assert_eq!(paste_keys(true), PasteKeys::ControlShiftV);
    }
    if cfg!(target_os = "macos") {
        assert_eq!(paste_keys(true), PasteKeys::CommandV);
    }
    if !cfg!(target_os = "macos") {
        assert_eq!(paste_keys(false), PasteKeys::ControlV);
    }
}
