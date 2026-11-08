//! The Accessibility check, the frontmost app, and the Command+V that pastes dictated text.

use objc2::rc::autoreleasepool;
use objc2_app_kit::NSWorkspace;
use objc2_application_services::{kAXTrustedCheckOptionPrompt, AXIsProcessTrustedWithOptions};
use objc2_core_foundation::{CFBoolean, CFDictionary, CFType};
use objc2_core_graphics::{
    CGEvent, CGEventFlags, CGEventSource, CGEventSourceStateID, CGEventTapLocation,
};

/// `kVK_ANSI_V`.
const KEY_V: u16 = 9;

/// Pasting into another app needs Accessibility; `prompt` shows the system prompt if it's missing.
pub(crate) fn accessibility_trusted(prompt: bool) -> bool {
    // SAFETY: the dictionary maps the documented prompt key to a CFBoolean.
    unsafe {
        let key: &CFType = kAXTrustedCheckOptionPrompt.as_ref();
        let value: &CFType = CFBoolean::new(prompt).as_ref();
        let options = CFDictionary::<CFType, CFType>::from_slices(&[key], &[value]);
        AXIsProcessTrustedWithOptions(Some(options.as_opaque()))
    }
}

pub(crate) fn frontmost_bundle_id() -> Option<String> {
    autoreleasepool(|_| {
        let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
        Some(app.bundleIdentifier()?.to_string())
    })
}

pub(crate) fn frontmost_is_self() -> bool {
    NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .is_some_and(|app| app.processIdentifier() as u32 == std::process::id())
}

pub(crate) fn post_command_v() -> bool {
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState);
    let down = CGEvent::new_keyboard_event(source.as_deref(), KEY_V, true);
    let up = CGEvent::new_keyboard_event(source.as_deref(), KEY_V, false);
    let (Some(down), Some(up)) = (down, up) else {
        return false;
    };
    // Only Command: the person's own modifiers were released before this.
    CGEvent::set_flags(Some(&down), CGEventFlags::MaskCommand);
    CGEvent::set_flags(Some(&up), CGEventFlags::MaskCommand);
    CGEvent::post(CGEventTapLocation::HIDEventTap, Some(&down));
    CGEvent::post(CGEventTapLocation::HIDEventTap, Some(&up));
    true
}
