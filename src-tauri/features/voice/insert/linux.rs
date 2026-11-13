//! Paste on Linux: the clipboard through arboard and Control+V through XTEST, so it reaches X11
//! apps (and XWayland ones on Wayland). X11 has no clipboard change count, so the text itself
//! stands in for one: the saved contents come back only while Misty's text is still there.
use crate::voice::hold_to_talk::{held_modifiers, Modifiers};
use crate::voice::insert::{Desktop, PasteKeys};
use crate::voice::linux::Display;
use std::{
    hash::{DefaultHasher, Hash, Hasher},
    sync::Mutex,
    time::Duration,
};

/// What was on the clipboard before Misty pasted.
pub enum Saved {
    Text(String),
    Image(arboard::ImageData<'static>),
    Nothing,
}

pub struct System {
    /// The clipboard stays open while a paste runs, since on X11 the contents live as long as the
    /// process that put them there serves them.
    clipboard: Mutex<Option<arboard::Clipboard>>,
}

impl System {
    pub fn new() -> Self {
        Self {
            clipboard: Mutex::new(arboard::Clipboard::new().ok()),
        }
    }

    fn with<T>(&self, run: impl FnOnce(&mut arboard::Clipboard) -> T) -> Option<T> {
        let mut guard = self.clipboard.lock().ok()?;
        guard.as_mut().map(run)
    }
}

fn fingerprint(text: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    // Zero means "unknown", so a real fingerprint never is.
    hasher.finish() | 1
}

impl Desktop for System {
    type Saved = Saved;

    fn snapshot_clipboard(&self) -> Saved {
        self.with(|clipboard| {
            if let Ok(text) = clipboard.get_text() {
                return Saved::Text(text);
            }
            match clipboard.get_image() {
                Ok(image) => Saved::Image(image.to_owned_img()),
                Err(_) => Saved::Nothing,
            }
        })
        .unwrap_or(Saved::Nothing)
    }

    fn write_clipboard_text(&self, text: &str) -> Result<u64, String> {
        self.with(|clipboard| clipboard.set_text(text.to_owned()))
            .ok_or("The clipboard isn't available.")?
            .map_err(|_| "The clipboard couldn't be written.".to_owned())?;
        Ok(fingerprint(text))
    }

    fn clipboard_change_count(&self) -> u64 {
        self.with(|clipboard| clipboard.get_text().ok())
            .flatten()
            .map(|text| fingerprint(&text))
            .unwrap_or(0)
    }

    fn restore_clipboard(&self, saved: Saved) {
        self.with(|clipboard| {
            let _ = match saved {
                Saved::Text(text) => clipboard.set_text(text),
                Saved::Image(image) => clipboard.set_image(image),
                Saved::Nothing => clipboard.clear(),
            };
        });
    }

    fn can_post_keys(&self) -> bool {
        Display::open().is_some()
    }

    fn request_post_keys(&self) {}

    fn held_modifiers(&self) -> Modifiers {
        held_modifiers()
    }

    fn frontmost_app(&self) -> Option<String> {
        Display::open()?.active_class()
    }

    fn post_paste(&self, keys: PasteKeys) -> Result<(), String> {
        let display = Display::open().ok_or("Paste needs an X11 display.")?;
        display.paste(keys == PasteKeys::ControlShiftV)
    }

    fn sleep(&self, duration: Duration) {
        std::thread::sleep(duration)
    }
}

pub fn frontmost_is_self() -> bool {
    Display::open()
        .and_then(|display| display.active_pid())
        .is_some_and(|pid| pid == std::process::id())
}
