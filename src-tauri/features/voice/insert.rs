use crate::voice::hold_to_talk::Modifiers;
use std::time::{Duration, Instant};

#[cfg(target_os = "linux")]
use crate::voice::insert::linux as platform;
#[cfg(target_os = "macos")]
use crate::voice::insert::macos as platform;
#[cfg(windows)]
use crate::voice::insert::windows as platform;

pub const RELEASE_TIMEOUT: Duration = Duration::from_millis(1500);
pub const RESTORE_DELAY: Duration = Duration::from_millis(450);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PasteKeys {
    CommandV,
    ControlV,
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
        "gnome-terminal-server",
        "org.gnome.terminal",
        "org.gnome.console",
        "kgx",
        "konsole",
        "xterm",
        "uxterm",
        "urxvt",
        "kitty",
        "alacritty",
        "org.wezfurlong.wezterm",
        "foot",
        "tilix",
        "terminator",
        "xfce4-terminal",
        "mate-terminal",
        "lxterminal",
        "qterminal",
        "st-256color",
        "ghostty",
    ];
    let app = app.to_ascii_lowercase();
    TERMINALS.iter().any(|t| app == *t)
}

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

pub fn should_restore(ours: u64, now: u64) -> bool {
    ours == now
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Inserted {
    Pasted,
    OnClipboard,
    KeysHeld,
}

pub trait Desktop {
    type Saved;
    fn snapshot_clipboard(&self) -> Self::Saved;
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

pub fn paste_with<D: Desktop>(desktop: &D, text: &str) -> Result<Inserted, String> {
    let saved = desktop.snapshot_clipboard();
    let ours = desktop.write_clipboard_text(text)?;
    if !desktop.can_post_keys() {
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

#[cfg(target_os = "linux")]
pub fn paste_into_frontmost(text: &str) -> Result<Inserted, String> {
    paste_with(&platform::System::new(), text)
}

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub fn misty_is_frontmost() -> bool {
    platform::frontmost_is_self()
}

#[cfg(target_os = "linux")]
pub(crate) mod linux;
#[cfg(target_os = "macos")]
pub(crate) mod macos;
#[cfg(test)]
mod tests;
#[cfg(windows)]
pub(crate) mod windows;
