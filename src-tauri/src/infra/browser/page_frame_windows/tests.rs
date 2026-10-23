use super::*;
use windows_sys::Win32::{
    Foundation::POINT,
    Graphics::Gdi::PtInRegion,
    UI::WindowsAndMessaging::{WindowFromPoint, WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE},
};

#[test]
fn caps_cover_only_what_lies_outside_the_arc() {
    // The outer corner pixel is wholly outside, the arc's center wholly inside.
    assert_eq!(arc_coverage(12, 0, 0), 0.0);
    assert_eq!(arc_coverage(12, 11, 11), 1.0);
    // A pixel on the arc is partly covered, which is what the cap smooths.
    let edge = arc_coverage(12, 3, 3);
    assert!(edge > 0.0 && edge < 1.0, "{edge}");
    // Every corner maps its own outer pixel to the top-left outer pixel.
    assert_eq!(top_left_pixel(0, 12, 0, 0), (0, 0));
    assert_eq!(top_left_pixel(1, 12, 11, 0), (0, 0));
    assert_eq!(top_left_pixel(2, 12, 11, 11), (0, 0));
    assert_eq!(top_left_pixel(3, 12, 0, 11), (0, 0));
}

#[test]
fn corners_cut_only_outside_their_arcs() {
    // SAFETY: regions created and deleted here.
    unsafe {
        assert!(rounded_region(200, 100, [0; 4]).is_null());
        let region = rounded_region(200, 100, [20, 0, 10, 0]);
        assert_eq!(PtInRegion(region, 0, 0), 0, "top-left corner is cut");
        assert_ne!(PtInRegion(region, 20, 20), 0, "inside the arc stays");
        assert_ne!(PtInRegion(region, 199, 0), 0, "a square corner stays");
        assert_eq!(PtInRegion(region, 199, 99), 0, "bottom-right corner is cut");
        assert_ne!(PtInRegion(region, 100, 50), 0);
        DeleteObject(region);
    }
}

#[test]
fn the_dim_lets_clicks_through_to_the_page() {
    let class: Vec<u16> = "STATIC".encode_utf16().chain([0]).collect();
    // SAFETY: windows created, used and destroyed on this thread.
    unsafe {
        // Topmost, so nothing else on the desktop lies over the point.
        let top = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_NOACTIVATE,
            class.as_ptr(),
            std::ptr::null(),
            WS_POPUP | WS_VISIBLE,
            40,
            40,
            300,
            200,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null(),
        );
        // SS_NOTIFY: a static control otherwise lets clicks through itself.
        const SS_NOTIFY: u32 = 0x100;
        let page = CreateWindowExW(
            0,
            class.as_ptr(),
            std::ptr::null(),
            WS_CHILD | WS_VISIBLE | SS_NOTIFY,
            0,
            0,
            300,
            200,
            top,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null(),
        );
        let overlay = create_overlay(top).unwrap();
        SetLayeredWindowAttributes(overlay, 0, 128, LWA_ALPHA);
        SetWindowPos(overlay, HWND_TOP, 0, 0, 300, 200, SWP_NOACTIVATE);
        ShowWindow(overlay, SW_SHOWNA);
        let hit = WindowFromPoint(POINT { x: 140, y: 120 });
        DestroyWindow(top);
        assert_ne!(hit, overlay, "the dim must not take the click");
        assert_eq!(hit, page);
    }
}
