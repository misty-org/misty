use super::browser_tracking_is_blocked;

#[test]
fn modal_blocks_browser_tracking_until_page_is_above_renderer_again() {
    assert!(browser_tracking_is_blocked(false, 0, 1));
    assert!(!browser_tracking_is_blocked(false, 1, 0));
    assert!(browser_tracking_is_blocked(true, 1, 0));
}
