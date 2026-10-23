use super::{
    browser_captions_script, browser_status_script, browser_viewport_script,
    BROWSER_VIEWPORT_SCRIPT,
};

#[test]
fn captions_run_in_every_frame_without_the_tab_token() {
    let captions = browser_captions_script();
    assert!(captions.starts_with("(() => {"));
    assert!(captions.contains("const mistyCaptions"));
    assert!(captions.contains("track.mode = 'hidden'"));
    assert!(captions.contains("topWindow.postMessage"));
    assert!(!captions.contains("shortcutToken"));
    assert!(!captions.contains("PLACEHOLDER"));
    // The top document reads frames' captions; YouTube is no longer read only there.
    assert!(BROWSER_VIEWPORT_SCRIPT.contains("window.__mistyFramedMedia"));
    assert!(!BROWSER_VIEWPORT_SCRIPT.contains("prefetchCaptions"));
}

#[test]
fn pointer_reporting_uses_no_page_dom_mutation_or_remote_desktop_ipc() {
    assert!(!BROWSER_VIEWPORT_SCRIPT.contains("misty-cursor:"));
    assert!(!BROWSER_VIEWPORT_SCRIPT.contains("document.createElement('a')"));
    assert!(!BROWSER_VIEWPORT_SCRIPT.contains("__TAURI_INTERNALS__"));
    assert!(!BROWSER_VIEWPORT_SCRIPT.contains("misty-pointer:"));
    assert!(BROWSER_VIEWPORT_SCRIPT.contains("sendToHost(shortcutToken)"));
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
    assert!(BROWSER_VIEWPORT_SCRIPT.contains("Period: 'Period'"));
    assert!(BROWSER_VIEWPORT_SCRIPT.contains("NumpadAdd: 'Plus'"));
    assert!(BROWSER_VIEWPORT_SCRIPT.contains("event.shiftKey && key !== 'Plus'"));
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
    assert!(!BROWSER_VIEWPORT_SCRIPT.contains("patchFocus"));
    assert!(!BROWSER_VIEWPORT_SCRIPT.contains("userInteracted"));
    assert!(!BROWSER_VIEWPORT_SCRIPT.contains("document.activeElement.blur()"));
    assert!(!BROWSER_VIEWPORT_SCRIPT.contains("report('default')"));
    assert!(!BROWSER_VIEWPORT_SCRIPT.contains("HTMLElement.prototype.click ="));
}
