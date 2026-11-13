//! Misty's own pointer for desktop tasks. It is a drawing above every app that
//! never takes input; actions reach apps through Accessibility and app-targeted
//! key events, so the person's pointer and keyboard focus stay theirs.
use std::cell::RefCell;

use block2::RcBlock;
use objc2::{define_class, msg_send, rc::Retained, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSAnimatablePropertyContainer, NSAnimationContext, NSBackingStoreType, NSBezierPath, NSColor,
    NSLineJoinStyle, NSPanel, NSStatusWindowLevel, NSView, NSWindowCollectionBehavior,
    NSWindowStyleMask,
};
use objc2_foundation::{NSObjectProtocol, NSPoint, NSRect, NSSize, NSString};
use objc2_quartz_core::CAMediaTimingFunction;

use super::{
    pointer_actions,
    support::{main_display_height, on_main, on_main_queued, reduce_motion},
};

define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[name = "MistyAgentPointerView"]
    struct PointerView;

    unsafe impl NSObjectProtocol for PointerView {}

    impl PointerView {
        #[unsafe(method(hitTest:))]
        fn hit_test(&self, _point: NSPoint) -> *mut NSView {
            std::ptr::null_mut()
        }

        #[unsafe(method(isFlipped))]
        fn is_flipped(&self) -> bool {
            true
        }

        #[unsafe(method(drawRect:))]
        fn draw_rect(&self, _rect: NSRect) {
            // The same arrow as the in-page agent cursor (browser/scripts/agent_cursor.js),
            // with its tip at this view's corner.
            draw_arrow(1.0);
        }
    }
);

/// The agent arrow with its tip at `(tip, tip)` of the current flipped view.
pub(crate) fn draw_arrow(tip: f64) {
    let path = NSBezierPath::bezierPath();
    path.moveToPoint(NSPoint::new(tip, tip));
    path.lineToPoint(NSPoint::new(tip + 20.0, tip + 15.0));
    path.lineToPoint(NSPoint::new(tip + 11.0, tip + 16.0));
    path.lineToPoint(NSPoint::new(tip + 7.0, tip + 24.0));
    path.closePath();
    path.setLineJoinStyle(NSLineJoinStyle::Round);
    path.setLineWidth(2.0);
    NSColor::colorWithSRGBRed_green_blue_alpha(
        0xa0 as f64 / 255.0,
        0xc4 as f64 / 255.0,
        0xd4 as f64 / 255.0,
        1.0,
    )
    .setFill();
    path.fill();
    NSColor::colorWithSRGBRed_green_blue_alpha(
        0x13 as f64 / 255.0,
        0x13 as f64 / 255.0,
        0x13 as f64 / 255.0,
        1.0,
    )
    .setStroke();
    path.stroke();
}

/// An arrow-shaped view that never takes input; the window-control cursor is one too.
pub(crate) fn arrow_view_frame() -> NSRect {
    NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(26.0, 30.0))
}

thread_local! {
    static PANEL: RefCell<Option<Retained<NSPanel>>> = const { RefCell::new(None) };
}

/// Global display coordinates (top-left origin) to the Cocoa frame whose corner,
/// where the arrow's tip is, sits one point past the target: Accessibility
/// hit-testing at the target never lands on the pointer itself.
fn pointer_frame(x: f64, y: f64) -> NSRect {
    NSRect::new(
        NSPoint::new(x + 1.0, main_display_height() - y - 1.0 - 30.0),
        NSSize::new(26.0, 30.0),
    )
}

fn make_panel(mtm: MainThreadMarker, x: f64, y: f64) -> Retained<NSPanel> {
    let panel = NSPanel::initWithContentRect_styleMask_backing_defer(
        NSPanel::alloc(mtm),
        pointer_frame(x, y),
        NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel,
        NSBackingStoreType::Buffered,
        false,
    );
    // SAFETY: the panel is only ordered out, never closed.
    unsafe { panel.setReleasedWhenClosed(false) };
    // Titled so desktop capture keeps it: every screenshot shows where Misty points.
    panel.setTitle(&NSString::from_str("Misty agent cursor"));
    panel.setLevel(NSStatusWindowLevel + 1);
    panel.setOpaque(false);
    panel.setBackgroundColor(Some(&NSColor::clearColor()));
    panel.setHasShadow(false);
    panel.setIgnoresMouseEvents(true);
    panel.setHidesOnDeactivate(false);
    panel.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    let view: Retained<PointerView> =
        unsafe { msg_send![PointerView::alloc(mtm), initWithFrame: arrow_view_frame()] };
    panel.setContentView(Some(&view));
    panel.orderFrontRegardless();
    panel
}

/// Moves Misty's pointer to a global display point, waiting for the main thread.
pub(crate) fn pointer_move(x: f64, y: f64) {
    on_main(move |mtm| {
        let Some(panel) = PANEL.with(|slot| slot.borrow().clone()) else {
            let panel = make_panel(mtm, x, y);
            PANEL.with(|slot| *slot.borrow_mut() = Some(panel));
            return;
        };
        let reduced = reduce_motion();
        panel.orderFrontRegardless();
        if reduced {
            panel.setFrame_display(pointer_frame(x, y), true);
            return;
        }
        let animated = panel.animator();
        let changes = RcBlock::new(move |context: std::ptr::NonNull<NSAnimationContext>| {
            // SAFETY: the context is live inside the animation group.
            let context = unsafe { context.as_ref() };
            context.setDuration(0.16);
            context.setTimingFunction(Some(&CAMediaTimingFunction::functionWithControlPoints(
                0.16, 1.0, 0.3, 1.0,
            )));
            animated.setFrame_display(pointer_frame(x, y), true);
        });
        NSAnimationContext::runAnimationGroup(&changes);
    });
}

/// Hides Misty's pointer and forgets the control it focused.
pub(crate) fn pointer_hide() {
    on_main_queued(|_| {
        if let Some(panel) = PANEL.with(|slot| slot.borrow_mut().take()) {
            panel.orderOut(None);
        }
        pointer_actions::forget_target();
    });
}
