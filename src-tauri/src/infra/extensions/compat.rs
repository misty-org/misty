// SPDX-License-Identifier: MIT
//! The WebExtension compatibility layer lives in Kiri (kiri/src/extensions).
//! Misty's extension host answers its requests (native/macos/MistyExtensionCompat.m).
//!
//! WebView2 is Chromium, which gives extensions the APIs the layer stands in
//! for, so Windows packages run as published.
pub use kiri::extensions::DIRECTORY;
#[cfg(not(windows))]
pub use kiri::extensions::{added_permissions, apply, limitation};

#[cfg(windows)]
pub fn apply(_runtime: &std::path::Path) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
pub fn added_permissions(_permissions: &[String]) -> Vec<String> {
    Vec::new()
}

#[cfg(windows)]
pub fn limitation(_permission: &str) -> Option<&'static str> {
    None
}
