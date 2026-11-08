use super::{browser_tracking_is_blocked, rect_contains};

#[test]
fn a_notice_owns_only_its_own_box() {
    let notice = [100.0, 200.0, 300.0, 260.0];
    assert!(rect_contains(notice, 100.0, 200.0));
    assert!(rect_contains(notice, 299.0, 259.0));
    assert!(!rect_contains(notice, 99.0, 230.0));
    assert!(!rect_contains(notice, 300.0, 230.0));
    assert!(!rect_contains(notice, 150.0, 260.0));
}

#[test]
fn modal_blocks_browser_tracking_until_page_is_above_renderer_again() {
    assert!(browser_tracking_is_blocked(false, 0, 1));
    assert!(!browser_tracking_is_blocked(false, 1, 0));
    assert!(browser_tracking_is_blocked(true, 1, 0));
}
