use crate::voice::hold_to_talk::{held_modifiers, Modifiers};
use crate::voice::insert::{Desktop, PasteKeys};
use crate::voice::macos::{keys, pasteboard};
use std::time::Duration;

/// A copy of every pasteboard item; released if never restored.
pub type Saved = pasteboard::Snapshot;

pub struct System;

impl Desktop for System {
    type Saved = Saved;

    fn snapshot_clipboard(&self) -> Saved {
        pasteboard::snapshot()
    }

    fn write_clipboard_text(&self, text: &str) -> Result<u64, String> {
        Ok(pasteboard::write_text(&text.replace('\0', "")) as u64)
    }

    fn clipboard_change_count(&self) -> u64 {
        pasteboard::change_count() as u64
    }

    fn restore_clipboard(&self, saved: Saved) {
        pasteboard::restore(saved)
    }

    fn can_post_keys(&self) -> bool {
        keys::accessibility_trusted(false)
    }

    fn request_post_keys(&self) {
        // Shows the system prompt once; the next dictation pastes directly.
        keys::accessibility_trusted(true);
    }

    fn held_modifiers(&self) -> Modifiers {
        held_modifiers()
    }

    fn frontmost_app(&self) -> Option<String> {
        keys::frontmost_bundle_id()
    }

    fn post_paste(&self, _: PasteKeys) -> Result<(), String> {
        keys::post_command_v()
            .then_some(())
            .ok_or_else(|| "Paste couldn't be sent.".into())
    }

    fn sleep(&self, duration: Duration) {
        std::thread::sleep(duration)
    }
}

pub fn frontmost_is_self() -> bool {
    keys::frontmost_is_self()
}
