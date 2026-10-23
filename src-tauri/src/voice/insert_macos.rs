use super::insert::{Desktop, PasteKeys};
use crate::infra::global_hotkey::{held_modifiers, Modifiers};
use std::ffi::{c_char, c_void, CStr, CString};
use std::time::Duration;

extern "C" {
    fn misty_pasteboard_snapshot() -> *mut c_void;
    fn misty_pasteboard_restore(snapshot: *mut c_void);
    fn misty_pasteboard_discard(snapshot: *mut c_void);
    fn misty_pasteboard_write_text(text: *const c_char) -> i64;
    fn misty_pasteboard_change_count() -> i64;
    fn misty_accessibility_trusted(prompt: bool) -> bool;
    fn misty_frontmost_bundle_id() -> *mut c_char;
    fn misty_frontmost_is_self() -> bool;
    fn misty_post_command_v() -> bool;
}

/// A retained copy of every pasteboard item; released if never restored.
pub struct Saved(*mut c_void);

impl Drop for Saved {
    fn drop(&mut self) {
        // SAFETY: the pointer came from misty_pasteboard_snapshot and is
        // released exactly once, here or by restore (which nulls it).
        unsafe { misty_pasteboard_discard(self.0) }
    }
}

pub struct System;

impl Desktop for System {
    type Saved = Saved;

    fn snapshot_clipboard(&self) -> Saved {
        Saved(unsafe { misty_pasteboard_snapshot() })
    }

    fn write_clipboard_text(&self, text: &str) -> Result<u64, String> {
        let text = CString::new(text.replace('\0', "")).map_err(|e| e.to_string())?;
        Ok(unsafe { misty_pasteboard_write_text(text.as_ptr()) } as u64)
    }

    fn clipboard_change_count(&self) -> u64 {
        unsafe { misty_pasteboard_change_count() as u64 }
    }

    fn restore_clipboard(&self, mut saved: Saved) {
        let pointer = std::mem::replace(&mut saved.0, std::ptr::null_mut());
        unsafe { misty_pasteboard_restore(pointer) }
    }

    fn can_post_keys(&self) -> bool {
        unsafe { misty_accessibility_trusted(false) }
    }

    fn request_post_keys(&self) {
        // Shows the system prompt once; the next dictation pastes directly.
        unsafe { misty_accessibility_trusted(true) };
    }

    fn held_modifiers(&self) -> Modifiers {
        held_modifiers()
    }

    fn frontmost_app(&self) -> Option<String> {
        unsafe {
            let raw = misty_frontmost_bundle_id();
            if raw.is_null() {
                return None;
            }
            let value = CStr::from_ptr(raw).to_string_lossy().into_owned();
            libc::free(raw.cast());
            Some(value)
        }
    }

    fn post_paste(&self, _: PasteKeys) -> Result<(), String> {
        unsafe { misty_post_command_v() }
            .then_some(())
            .ok_or_else(|| "Paste couldn't be sent.".into())
    }

    fn sleep(&self, duration: Duration) {
        std::thread::sleep(duration)
    }
}

pub fn frontmost_is_self() -> bool {
    unsafe { misty_frontmost_is_self() }
}
