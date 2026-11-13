use super::{
    browser_status_script, browser_viewport_script, in_window, BrowserPointerNavigation,
    BROWSER_VIEWPORT_SCRIPT,
};
use tauri::LogicalPosition;

/// The viewport script with its window-drag part, before the runtime placeholders are filled.
fn viewport() -> String {
    BROWSER_VIEWPORT_SCRIPT.replace(
        "__MISTY_WINDOW_DRAG_PLACEHOLDER__",
        include_str!("window_drag.js"),
    )
}

#[test]
fn pointer_reporting_uses_no_page_dom_mutation_or_remote_desktop_ipc() {
    assert!(!viewport().contains("misty-cursor:"));
    assert!(!viewport().contains("document.createElement('a')"));
    assert!(!viewport().contains("__TAURI_INTERNALS__"));
    assert!(!viewport().contains("misty-pointer:"));
    assert!(viewport().contains("sendToHost(shortcutToken)"));
}

#[test]
fn host_messages_ride_the_kiri_channel_and_never_navigate() {
    let viewport = browser_viewport_script("token", true, &[]);
    let status = browser_status_script("token");
    for script in [&viewport, &status] {
        assert!(script.contains(kiri::channel::sender_script()));
        assert!(!script.contains("__KIRI_HOST_SENDER_PLACEHOLDER__"));
    }
    assert!(!viewport.contains("misty-focus:"));
    assert!(!viewport.contains("location.href ="));
    assert!(!status.contains("location.href ="));
    assert!(!status.contains("misty-status:"));
    assert!(!status.contains("__MISTY_STATUS_TOKEN_PLACEHOLDER__"));
    assert!(status.contains("const statusToken = \"token\""));
}

#[test]
fn shortcut_token_is_embedded_as_json_without_becoming_a_window_global() {
    let script = browser_viewport_script("secret-token", false, &[]);
    assert!(script.contains("const shortcutToken = \"secret-token\""));
    assert!(script.contains("let pointerTrackingEnabled = false"));
    assert!(script.contains("if (!pointerTrackingEnabled || !event?.isTrusted) return"));
    assert!(script.contains("if (!event.isTrusted) return"));
    assert!(!script.contains("__MISTY_SHORTCUT_TOKEN_PLACEHOLDER__"));
    assert!(!script.contains("__MISTY_POINTER_TRACKING_PLACEHOLDER__"));
    assert!(!script.contains("__MISTY_COMPANION_TOKEN_PLACEHOLDER__"));
    assert!(!script.contains("window.__MISTY_SHORTCUT_TOKEN"));
    assert!(!script.contains("__MISTY_NATIVE_HOST_PLACEHOLDER__"));
}

#[test]
fn forwarded_shortcuts_use_the_renderer_canonical_key_names() {
    assert!(viewport().contains("Period: 'Period'"));
    assert!(viewport().contains("NumpadAdd: 'Plus'"));
    assert!(viewport().contains("event.shiftKey && key !== 'Plus'"));
}

#[test]
fn link_click_interception_opens_modifier_and_middle_clicks_in_new_window() {
    let script = browser_viewport_script("token", false, &[]);
    assert!(script.contains("const handleLinkClick"));
    assert!(script.contains("window.open(resolved, '_blank')"));
    assert!(script.contains("event.button === 1"));
    assert!(script.contains("event.metaKey || event.ctrlKey"));
}

#[test]
fn pointer_tracking_can_be_enabled_for_an_active_companion() {
    let script = browser_viewport_script("token", true, &[]);
    assert!(script.contains("let pointerTrackingEnabled = true"));
    assert!(script.contains("window.__MISTY_SET_POINTER_TRACKING__"));
    assert!(script.contains("if (!pointerTrackingEnabled) return"));
}

#[test]
fn embedded_pages_keep_their_native_focus_behavior() {
    assert!(!viewport().contains("patchFocus"));
    assert!(!viewport().contains("userInteracted"));
    assert!(!viewport().contains("document.activeElement.blur()"));
    assert!(!viewport().contains("report('default')"));
    assert!(!viewport().contains("HTMLElement.prototype.click ="));
}

#[test]
fn a_pointer_in_a_page_is_reported_where_the_page_sits_in_its_window() {
    let pointer = BrowserPointerNavigation {
        x: 12.5,
        y: 4.0,
        inside: true,
    };
    assert_eq!(
        in_window(LogicalPosition::new(240.0, 48.0), &pointer),
        (252.5, 52.0)
    );
}
