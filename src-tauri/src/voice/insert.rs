//! Putting dictated text where the person is typing.
//!
//! In another app Misty borrows the clipboard: it saves what's there, puts the
//! text on it, sends a paste, and puts the saved contents back — unless the
//! clipboard changed in the meantime, in which case the newer contents win.
//! Paste waits until the person lets go of the dictation keys, so a held
//! Option or Fn never turns Cmd+V into another shortcut.
use crate::infra::global_hotkey::Modifiers;
use std::time::{Duration, Instant};

#[cfg(target_os = "macos")]
use super::insert_macos as platform;
#[cfg(windows)]
use super::insert_windows as platform;

/// How long Misty waits for held modifiers before giving up on pasting.
pub const RELEASE_TIMEOUT: Duration = Duration::from_millis(1500);
/// How long the pasted text stays on the clipboard before the saved contents
/// come back. Apps read the clipboard asynchronously after the keystroke.
pub const RESTORE_DELAY: Duration = Duration::from_millis(450);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PasteKeys {
    CommandV,
    ControlV,
    /// Windows terminals treat Ctrl+V as a literal control character.
    ControlShiftV,
}

pub fn paste_keys(terminal: bool) -> PasteKeys {
    if cfg!(target_os = "macos") {
        PasteKeys::CommandV
    } else if terminal {
        PasteKeys::ControlShiftV
    } else {
        PasteKeys::ControlV
    }
}

/// Terminals by macOS bundle id or Windows executable name.
pub fn is_terminal(app: &str) -> bool {
    const TERMINALS: &[&str] = &[
        "com.apple.terminal",
        "com.googlecode.iterm2",
        "dev.warp.warp-stable",
        "com.github.wez.wezterm",
        "org.alacritty",
        "net.kovidgoyal.kitty",
        "com.mitchellh.ghostty",
        "co.zeit.hyper",
        "windowsterminal.exe",
        "wt.exe",
        "openconsole.exe",
        "conhost.exe",
        "cmd.exe",
        "powershell.exe",
        "pwsh.exe",
        "mintty.exe",
        "alacritty.exe",
        "wezterm-gui.exe",
        "warp.exe",
    ];
    let app = app.to_ascii_lowercase();
    TERMINALS.iter().any(|t| app == *t)
}

/// Waits until none of the modifiers are held, polling `held`. Returns false
/// when they're still down at the timeout, so the caller can leave the text
/// on the clipboard instead of sending a mangled shortcut.
pub fn wait_for_release(
    held: impl Fn() -> Modifiers,
    timeout: Duration,
    sleep: impl Fn(Duration),
) -> bool {
    let start = Instant::now();
    loop {
        if !held().any() {
            return true;
        }
        if start.elapsed() >= timeout {
            return false;
        }
        sleep(Duration::from_millis(15));
    }
}

/// The saved clipboard goes back only if nobody wrote to the clipboard after
/// Misty did: `ours` is the change count right after Misty's write.
pub fn should_restore(ours: u64, now: u64) -> bool {
    ours == now
}

/// Where the text ended up.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Inserted {
    /// Pasted into another app; the clipboard was restored (or kept newer contents).
    Pasted,
    /// Accessibility isn't allowed yet: the text is on the clipboard to paste by hand.
    OnClipboard,
    /// The person kept holding keys; the text is on the clipboard.
    KeysHeld,
}

/// The operating system pieces paste needs, so the flow can be tested.
pub trait Desktop {
    type Saved;
    fn snapshot_clipboard(&self) -> Self::Saved;
    /// Writes text and returns the clipboard's change count after the write.
    fn write_clipboard_text(&self, text: &str) -> Result<u64, String>;
    fn clipboard_change_count(&self) -> u64;
    fn restore_clipboard(&self, saved: Self::Saved);
    fn can_post_keys(&self) -> bool;
    fn request_post_keys(&self);
    fn held_modifiers(&self) -> Modifiers;
    fn frontmost_app(&self) -> Option<String>;
    fn post_paste(&self, keys: PasteKeys) -> Result<(), String>;
    fn sleep(&self, duration: Duration);
}

/// Pastes `text` into the frontmost app through the clipboard.
pub fn paste_with<D: Desktop>(desktop: &D, text: &str) -> Result<Inserted, String> {
    let saved = desktop.snapshot_clipboard();
    let ours = desktop.write_clipboard_text(text)?;
    if !desktop.can_post_keys() {
        // macOS asks for Accessibility the first time; the text stays put.
        desktop.request_post_keys();
        return Ok(Inserted::OnClipboard);
    }
    if !wait_for_release(
        || desktop.held_modifiers(),
        RELEASE_TIMEOUT,
        |d| desktop.sleep(d),
    ) {
        return Ok(Inserted::KeysHeld);
    }
    let terminal = desktop.frontmost_app().is_some_and(|app| is_terminal(&app));
    desktop.post_paste(paste_keys(terminal))?;
    desktop.sleep(RESTORE_DELAY);
    if should_restore(ours, desktop.clipboard_change_count()) {
        desktop.restore_clipboard(saved);
    }
    Ok(Inserted::Pasted)
}

#[cfg(any(target_os = "macos", windows))]
pub fn paste_into_frontmost(text: &str) -> Result<Inserted, String> {
    paste_with(&platform::System, text)
}

/// Whether the frontmost app is Misty itself, which inserts without the clipboard.
#[cfg(any(target_os = "macos", windows))]
pub fn misty_is_frontmost() -> bool {
    platform::frontmost_is_self()
}

#[cfg(test)]
mod tests;
