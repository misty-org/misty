//! Clicks and hover around a notice. The renderer draws notices, so pages sit beneath it while
//! one shows, but only the notice's own box belongs to the renderer: everywhere else over a page
//! the renderer stands aside and the page stays live.
use super::*;
use objc2::rc::Retained;
use objc2_foundation::NSPoint;

struct NoticeRegion {
    renderer: Retained<NSView>,
    /// Left, top, right and bottom of each notice, in the renderer's points from its top left.
    rects: Vec<[f64; 4]>,
    /// The renderer last saw the pointer, so it hasn't yet learned the pointer left.
    pointer_on_renderer: bool,
}

thread_local! {
    /// AppKit hit tests and delivers tracking events on the main thread, where these are set too.
    static NOTICE_REGIONS: RefCell<Vec<NoticeRegion>> = const { RefCell::new(Vec::new()) };
}

pub(super) fn rect_contains([left, top, right, bottom]: [f64; 4], x: f64, y: f64) -> bool {
    x >= left && y >= top && x < right && y < bottom
}

/// Replaces where a renderer's notices are; none hands every click back to the renderer.
pub(in crate::infra) unsafe fn set_notice_rects(renderer: &NSView, rects: Vec<[f64; 4]>) {
    NOTICE_REGIONS.with(|regions| {
        let mut regions = regions.borrow_mut();
        regions.retain(|region| !std::ptr::eq(&*region.renderer, renderer));
        if rects.is_empty() {
            return;
        }
        if let Some(renderer) = Retained::retain(std::ptr::from_ref(renderer).cast_mut()) {
            regions.push(NoticeRegion {
                renderer,
                rects,
                pointer_on_renderer: true,
            });
        }
    });
}

pub(super) unsafe fn install_notice_hit_test(renderer: &NSView) {
    let selector = objc2::sel!(hitTest:);
    let object = &*std::ptr::from_ref(renderer).cast::<AnyObject>();
    // This class or one above it already has it; installing again would call itself.
    if original_pointer_event_implementation(object, selector, None).is_some() {
        return;
    }
    let replacement: unsafe extern "C-unwind" fn(&NSView, Sel, NSPoint) -> *mut NSView =
        renderer_hit_test;
    install_method_override(
        AnyObject::class(object),
        selector,
        std::mem::transmute(replacement),
    );
}

/// `point` is in the superview's coordinates. Returning nothing lets AppKit try the view beneath.
unsafe extern "C-unwind" fn renderer_hit_test(
    this: &NSView,
    command: Sel,
    point: NSPoint,
) -> *mut NSView {
    let reaches_page = NOTICE_REGIONS.with(|regions| {
        let regions = regions.borrow();
        let Some(region) = regions
            .iter()
            .find(|region| std::ptr::eq(&*region.renderer, this))
        else {
            return false;
        };
        this.superview()
            .is_some_and(|parent| point_reaches_page(region, &parent, point))
    });
    if reaches_page {
        return std::ptr::null_mut();
    }
    let object = &*std::ptr::from_ref(this).cast::<AnyObject>();
    let Some((_, implementation)) = original_pointer_event_implementation(object, command, None)
    else {
        return std::ptr::null_mut();
    };
    let original: unsafe extern "C-unwind" fn(&NSView, Sel, NSPoint) -> *mut NSView =
        std::mem::transmute(implementation);
    original(this, command, point)
}

unsafe fn point_reaches_page(region: &NoticeRegion, parent: &NSView, point: NSPoint) -> bool {
    // WKWebView is flipped, so this is already measured from the top.
    let local = region.renderer.convertPoint_fromView(point, Some(parent));
    if region
        .rects
        .iter()
        .any(|rect| rect_contains(*rect, local.x, local.y))
    {
        return false;
    }
    let Ok(browser_views) = browser_webview_views().lock() else {
        return false;
    };
    browser_views.iter().any(|browser_pointer| {
        let browser: &NSView = &*(*browser_pointer as *const NSView);
        let frame = browser.frame();
        !browser.isHidden()
            && browser
                .superview()
                .is_some_and(|browser_parent| std::ptr::eq(&*browser_parent, parent))
            && rect_contains(
                [
                    frame.origin.x,
                    frame.origin.y,
                    frame.origin.x + frame.size.width,
                    frame.origin.y + frame.size.height,
                ],
                point.x,
                point.y,
            )
    })
}

unsafe fn with_event_region<T>(
    event: &NSEvent,
    use_region: impl FnOnce(&mut NoticeRegion, bool) -> T,
) -> Option<T> {
    let window: *mut AnyObject = objc2::msg_send![event, window];
    NOTICE_REGIONS.with(|regions| {
        let mut regions = regions.borrow_mut();
        let region = regions.iter_mut().find(|region| {
            region.renderer.window().is_some_and(|candidate| {
                std::ptr::eq(
                    &*candidate as *const _ as *const AnyObject,
                    window as *const AnyObject,
                )
            })
        })?;
        let parent = region.renderer.superview()?;
        let point = parent.convertPoint_fromView(event.locationInWindow(), None);
        let reaches_page = point_reaches_page(region, &parent, point);
        Some(use_region(region, reaches_page))
    })
}

/// A page beneath the renderer still gets hover and cursor events past the notices.
pub(super) unsafe fn notice_passes_event_to_page(event: &NSEvent) -> bool {
    with_event_region(event, |_, reaches_page| reaches_page).unwrap_or(false)
}

/// The renderer loses hover and cursor events past the notices, but gets the first one after the
/// pointer leaves it: without that, its hover state would stay on the notice it last touched.
pub(super) unsafe fn notice_hides_event_from_renderer(event: &NSEvent) -> bool {
    with_event_region(event, |region, reaches_page| {
        let was_on_renderer = std::mem::replace(&mut region.pointer_on_renderer, !reaches_page);
        if !was_on_renderer && !reaches_page {
            // The page owned the cursor while the pointer was over it (a page can even hide it).
            // The renderer believes its own cursor never changed, so it would leave the page's
            // in place everywhere: take it back.
            restore_arrow_cursor();
        }
        reaches_page && !was_on_renderer
    })
    .unwrap_or(false)
}

/// Puts the arrow back and shows the cursor; the renderer then sets its own on the next move.
pub(super) unsafe fn restore_arrow_cursor() {
    let arrow: *mut AnyObject = objc2::msg_send![objc2::class!(NSCursor), arrowCursor];
    let _: () = objc2::msg_send![arrow, set];
    let _: () = objc2::msg_send![objc2::class!(NSCursor), unhide];
}
