// SPDX-License-Identifier: MIT
//! The WebExtension compatibility layer lives in Kiri (kiri/src/extensions).
//! Misty's extension host answers its requests (native/macos/MistyExtensionCompat.m).
pub use kiri::extensions::{added_permissions, apply, limitation, DIRECTORY};
