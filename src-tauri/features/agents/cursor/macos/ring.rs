//! Misty's control mist: a soft white fog inside the edges of whatever an agent
//! controls, and a pulse where it acts. Drawings only; they never take input,
//! nothing is drawn outside the frame, and captures leave them out so the agent
//! sees the content underneath. Rects and points are global display
//! coordinates with a top-left origin.
use std::cell::RefCell;

use block2::RcBlock;
use objc2::{rc::Retained, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSAnimatablePropertyContainer, NSAnimationContext, NSBackingStoreType, NSColor, NSPanel,
    NSStatusWindowLevel, NSView, NSWindowCollectionBehavior, NSWindowSharingType,
    NSWindowStyleMask,
};
use objc2_foundation::{NSArray, NSNumber, NSPoint, NSRect, NSSize, NSString};
use objc2_quartz_core::{
    CAAnimation, CAAnimationGroup, CABasicAnimation, CALayer, CAMediaTiming, CAMediaTimingFunction,
};

use super::{
    mist::mist_in,
    support::{cocoa_rect, on_main_later, reduce_motion},
};

/// The title desktop capture looks for to leave the mist out of what an agent sees.
pub(crate) const RING_TITLE: &str = "Misty control ring";
const PULSE_SIZE: f64 = 44.0;

thread_local! {
    static FRAME_PANEL: RefCell<Option<Retained<NSPanel>>> = const { RefCell::new(None) };
    static PULSE_PANEL: RefCell<Option<Retained<NSPanel>>> = const { RefCell::new(None) };
}

/// Fades a container in; the mist view itself keeps its waiting alpha.
pub(super) fn fade_in<T: NSAnimatablePropertyContainer + AlphaTarget + objc2::Message>(
    target: &T,
    alpha: f64,
) {
    target.set_alpha(0.0);
    let animated = target.animator();
    let changes = RcBlock::new(move |context: std::ptr::NonNull<NSAnimationContext>| {
        // SAFETY: the context is live inside the animation group.
        unsafe { context.as_ref() }.setDuration(0.2);
        animated.set_alpha(alpha);
    });
    NSAnimationContext::runAnimationGroup(&changes);
}

/// Views and windows both fade by alpha.
pub(super) trait AlphaTarget {
    fn set_alpha(&self, alpha: f64);
}
impl AlphaTarget for NSView {
    fn set_alpha(&self, alpha: f64) {
        self.setAlphaValue(alpha);
    }
}
impl AlphaTarget for NSPanel {
    fn set_alpha(&self, alpha: f64) {
        self.setAlphaValue(alpha);
    }
}

/// A click-through borderless panel that holds a mist.
pub(super) fn ring_panel(mtm: MainThreadMarker, frame: NSRect) -> Retained<NSPanel> {
    let panel = NSPanel::initWithContentRect_styleMask_backing_defer(
        NSPanel::alloc(mtm),
        frame,
        NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel,
        NSBackingStoreType::Buffered,
        false,
    );
    // SAFETY: the panel is only ordered out, never closed.
    unsafe { panel.setReleasedWhenClosed(false) };
    panel.setTitle(&NSString::from_str(RING_TITLE));
    panel.setLevel(NSStatusWindowLevel);
    panel.setOpaque(false);
    panel.setBackgroundColor(Some(&NSColor::clearColor()));
    panel.setHasShadow(false);
    panel.setIgnoresMouseEvents(true);
    panel.setHidesOnDeactivate(false);
    panel.setSharingType(NSWindowSharingType::None);
    panel.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    let view = NSView::initWithFrame(
        NSView::alloc(mtm),
        NSRect::new(NSPoint::new(0.0, 0.0), frame.size),
    );
    view.setWantsLayer(true);
    panel.setContentView(Some(&view));
    panel
}

fn pulse_frame(x: f64, y: f64) -> NSRect {
    cocoa_rect(
        x - PULSE_SIZE / 2.0,
        y - PULSE_SIZE / 2.0,
        PULSE_SIZE,
        PULSE_SIZE,
    )
}

/// Made with the frame, before capture starts, so the stream can leave it out.
fn make_pulse_panel(mtm: MainThreadMarker, x: f64, y: f64) -> Retained<NSPanel> {
    let panel = ring_panel(mtm, pulse_frame(x, y));
    let ring = CALayer::layer();
    if let Some(layer) = panel.contentView().and_then(|view| view.layer()) {
        let bounds = layer.bounds();
        let inner = NSRect::new(
            NSPoint::new(bounds.origin.x + 4.0, bounds.origin.y + 4.0),
            NSSize::new(bounds.size.width - 8.0, bounds.size.height - 8.0),
        );
        ring.setFrame(inner);
        ring.setCornerRadius(inner.size.width / 2.0);
        ring.setBorderWidth(2.0);
        ring.setBorderColor(Some(&NSColor::colorWithWhite_alpha(1.0, 0.95).CGColor()));
        ring.setShadowColor(Some(&NSColor::colorWithWhite_alpha(0.07, 1.0).CGColor()));
        ring.setShadowOpacity(0.6);
        ring.setShadowRadius(1.5);
        ring.setShadowOffset(NSSize::new(0.0, 0.0));
        ring.setOpacity(0.0);
        layer.addSublayer(&ring);
    }
    panel.orderFrontRegardless();
    panel
}

/// The mist along the edges of the display Misty controls on the desktop.
pub(crate) fn show(x: f64, y: f64, width: f64, height: f64) {
    on_main_later(move |mtm| {
        let frame = cocoa_rect(x, y, width, height);
        let fresh = FRAME_PANEL.with(|panel| panel.borrow().is_none());
        if fresh {
            let panel = ring_panel(mtm, frame);
            if let Some(content) = panel.contentView() {
                mist_in(mtm, &content, Some(0.0));
            }
            FRAME_PANEL.with(|slot| *slot.borrow_mut() = Some(panel));
        }
        let panel = FRAME_PANEL.with(|slot| slot.borrow().clone());
        if let Some(panel) = &panel {
            panel.setFrame_display(frame, true);
            panel.orderFrontRegardless();
        }
        if PULSE_PANEL.with(|slot| slot.borrow().is_none()) {
            let pulse = make_pulse_panel(mtm, x + width / 2.0, y + height / 2.0);
            PULSE_PANEL.with(|slot| *slot.borrow_mut() = Some(pulse));
        }
        if let (true, Some(panel)) = (fresh, &panel) {
            fade_in(&**panel, 1.0);
        }
    });
}

/// A pulse where the agent acts.
pub(crate) fn pulse(x: f64, y: f64) {
    on_main_later(move |mtm| {
        if PULSE_PANEL.with(|slot| slot.borrow().is_none()) {
            let panel = make_pulse_panel(mtm, x, y);
            PULSE_PANEL.with(|slot| *slot.borrow_mut() = Some(panel));
        }
        let Some(panel) = PULSE_PANEL.with(|slot| slot.borrow().clone()) else {
            return;
        };
        panel.setFrame_display(pulse_frame(x, y), true);
        panel.orderFrontRegardless();
        let Some(ring) = panel
            .contentView()
            .and_then(|view| view.layer())
            .and_then(|layer| unsafe { layer.sublayers() })
            .and_then(|layers| layers.firstObject())
        else {
            return;
        };
        ring.removeAllAnimations();
        if reduce_motion() {
            ring.setOpacity(0.0);
            return;
        }
        let scale =
            CABasicAnimation::animationWithKeyPath(Some(&NSString::from_str("transform.scale")));
        let fade = CABasicAnimation::animationWithKeyPath(Some(&NSString::from_str("opacity")));
        let value = |number: f64| {
            Retained::into_super(Retained::into_super(Retained::into_super(
                NSNumber::new_f64(number),
            )))
        };
        // SAFETY: plain value setters on fresh animations.
        unsafe {
            scale.setFromValue(Some(&value(0.55)));
            scale.setToValue(Some(&value(1.2)));
            fade.setFromValue(Some(&value(1.0)));
            fade.setToValue(Some(&value(0.0)));
        }
        let group = CAAnimationGroup::animation();
        let animations: Retained<NSArray<CAAnimation>> = NSArray::from_retained_slice(&[
            Retained::into_super(Retained::into_super(scale)),
            Retained::into_super(Retained::into_super(fade)),
        ]);
        group.setAnimations(Some(&animations));
        group.setDuration(0.7);
        group.setTimingFunction(Some(&CAMediaTimingFunction::functionWithControlPoints(
            0.16, 1.0, 0.3, 1.0,
        )));
        ring.setOpacity(0.0);
        ring.addAnimation_forKey(&group, Some(&NSString::from_str("pulse")));
    });
}

/// Removes the display mist and the pulse.
pub(crate) fn hide() {
    on_main_later(|_| {
        if let Some(panel) = FRAME_PANEL.with(|slot| slot.borrow_mut().take()) {
            panel.orderOut(None);
        }
        if let Some(panel) = PULSE_PANEL.with(|slot| slot.borrow_mut().take()) {
            panel.orderOut(None);
        }
    });
}
