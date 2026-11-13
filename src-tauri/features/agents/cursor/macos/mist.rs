//! The control mist: a soft white fog inside the edges of whatever an agent
//! controls. One mist view for the display, a page and a window. Two inner
//! fogs: a bright one gray close to the edge and a wide darker-gray one that
//! still reads on white pages. Each is the shadow of a shape that lies entirely
//! outside the bounds, so only the shadow falls inward; the view clips to its
//! own rounded corners.
use std::cell::{Cell, OnceCell, RefCell};

use block2::RcBlock;
use objc2::{
    define_class, msg_send,
    rc::{Retained, Weak},
    runtime::AnyObject,
    DefinedClass, MainThreadMarker, MainThreadOnly, Message,
};
use objc2_app_kit::{
    NSAnimatablePropertyContainer, NSAnimationContext, NSAutoresizingMaskOptions, NSColor, NSView,
    NSWindowOrderingMode,
};
use objc2_core_foundation::CGAffineTransform;
use objc2_core_graphics::{CGMutablePath, CGPath};
use objc2_foundation::{NSNumber, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString, NSValue};
use objc2_quartz_core::{
    kCAFillRuleEvenOdd, kCAMediaTimingFunctionEaseInEaseOut, CABasicAnimation, CACornerMask,
    CALayer, CAMediaTiming, CAMediaTimingFunction, CAShapeLayer, CATransaction,
};

use super::support::reduce_motion;

pub(super) const ACTING_ALPHA: f64 = 1.0;
pub(super) const WAITING_ALPHA: f64 = 0.4;

thread_local! {
    static MISTS: RefCell<Vec<Weak<MistView>>> = const { RefCell::new(Vec::new()) };
    static WAITING: Cell<bool> = const { Cell::new(false) };
}

pub(super) fn waiting() -> bool {
    WAITING.with(Cell::get)
}

pub(super) fn waiting_alpha() -> f64 {
    if waiting() {
        WAITING_ALPHA
    } else {
        ACTING_ALPHA
    }
}

pub(super) struct MistIvars {
    near: OnceCell<Retained<CAShapeLayer>>,
    wide: OnceCell<Retained<CAShapeLayer>>,
    /// Set for a window or the display; a page mist follows its page's own corners.
    radius: Cell<Option<f64>>,
}

define_class!(
    #[unsafe(super(NSView))]
    #[thread_kind = MainThreadOnly]
    #[name = "MistyAgentMistView"]
    #[ivars = MistIvars]
    pub(super) struct MistView;

    unsafe impl NSObjectProtocol for MistView {}

    impl MistView {
        #[unsafe(method(hitTest:))]
        fn hit_test(&self, _point: NSPoint) -> *mut NSView {
            std::ptr::null_mut()
        }

        #[unsafe(method(isFlipped))]
        fn is_flipped(&self) -> bool {
            true
        }

        #[unsafe(method(setFrameSize:))]
        fn set_frame_size(&self, size: NSSize) {
            let _: () = unsafe { msg_send![super(self), setFrameSize: size] };
            self.fit();
        }

        // Core Animation drops a layer's animations when its view leaves a window, and a
        // docked window's mist is detached and attached again as the window opens and
        // docks. Starting over each time it joins a window keeps it from freezing at
        // one glow.
        #[unsafe(method(viewDidMoveToWindow))]
        fn view_did_move_to_window(&self) {
            let _: () = unsafe { msg_send![super(self), viewDidMoveToWindow] };
            if self.window().is_some() {
                self.breathe();
            }
        }
    }
);

fn fog_layer(white: f64, opacity: f32, blur: f64) -> Retained<CAShapeLayer> {
    let fog = CAShapeLayer::layer();
    let color = NSColor::colorWithWhite_alpha(white, 1.0).CGColor();
    fog.setFillRule(unsafe { kCAFillRuleEvenOdd });
    fog.setFillColor(Some(&color));
    fog.setShadowColor(Some(&color));
    fog.setShadowOpacity(opacity);
    fog.setShadowRadius(blur);
    fog.setShadowOffset(NSSize::new(0.0, 0.0));
    fog
}

fn number(value: f64) -> Retained<AnyObject> {
    Retained::into_super(Retained::into_super(Retained::into_super(
        NSNumber::new_f64(value),
    )))
    .into()
}

fn breathe(layer: &CALayer, key: &str, from: &AnyObject, to: &AnyObject, duration: f64) {
    let key = NSString::from_str(key);
    let animation = CABasicAnimation::animationWithKeyPath(Some(&key));
    // SAFETY: plain value setters on a fresh animation.
    unsafe {
        animation.setFromValue(Some(from));
        animation.setToValue(Some(to));
    }
    animation.setDuration(duration);
    animation.setAutoreverses(true);
    animation.setRepeatCount(f32::INFINITY);
    let timing =
        CAMediaTimingFunction::functionWithName(unsafe { kCAMediaTimingFunctionEaseInEaseOut });
    animation.setTimingFunction(Some(&timing));
    layer.addAnimation_forKey(&animation, Some(&key));
}

impl MistView {
    fn new(mtm: MainThreadMarker, frame: NSRect, radius: Option<f64>) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(MistIvars {
            near: OnceCell::new(),
            wide: OnceCell::new(),
            radius: Cell::new(radius),
        });
        let this: Retained<Self> = unsafe { msg_send![super(this), initWithFrame: frame] };
        this
    }

    fn layers(&self) -> Option<(&Retained<CAShapeLayer>, &Retained<CAShapeLayer>)> {
        Some((self.ivars().near.get()?, self.ivars().wide.get()?))
    }

    pub(super) fn set_radius(&self, radius: f64) {
        self.ivars().radius.set(Some(radius));
    }

    fn build(&self) {
        self.setWantsLayer(true);
        let Some(layer) = self.layer() else { return };
        layer.setMasksToBounds(true);
        let near = fog_layer(0.72, 0.6, 18.0);
        let wide = fog_layer(0.5, 0.26, 46.0);
        layer.addSublayer(&wide);
        layer.addSublayer(&near);
        let _ = self.ivars().near.set(near);
        let _ = self.ivars().wide.set(wide);
        let strong = Weak::from_retained(&self.retain());
        MISTS.with(|mists| mists.borrow_mut().push(strong));
        self.setAlphaValue(waiting_alpha());
        self.breathe();
    }

    /// Breathes and drifts while an agent acts; still under Reduce motion.
    fn breathe(&self) {
        let Some((near, wide)) = self.layers() else {
            return;
        };
        if reduce_motion() {
            near.removeAllAnimations();
            wide.removeAllAnimations();
            return;
        }
        // A clear pulse: the glow at the edge swells and fades, and the wide fog breathes with it.
        breathe(near, "shadowOpacity", &number(0.3), &number(1.0), 2.4);
        breathe(near, "shadowRadius", &number(14.0), &number(30.0), 2.4);
        breathe(wide, "shadowOpacity", &number(0.12), &number(0.42), 2.4);
        // SAFETY: plain value constructors.
        let (left, right) = unsafe {
            (
                NSValue::valueWithSize(NSSize::new(5.0, -3.0)),
                NSValue::valueWithSize(NSSize::new(-5.0, 3.0)),
            )
        };
        breathe(wide, "shadowOffset", &left, &right, 14.0);
    }

    pub(super) fn fit(&self) {
        let Some((near, wide)) = self.layers() else {
            return;
        };
        let Some(layer) = self.layer() else { return };
        // SAFETY: a plain property read.
        let superview_layer = unsafe { self.superview() }.and_then(|view| view.layer());
        let own_radius = self.ivars().radius.get();
        let radius = own_radius
            .or_else(|| superview_layer.as_ref().map(|layer| layer.cornerRadius()))
            .unwrap_or(0.0);
        let corners = if own_radius.is_some() {
            CACornerMask::LayerMinXMinYCorner
                | CACornerMask::LayerMaxXMinYCorner
                | CACornerMask::LayerMinXMaxYCorner
                | CACornerMask::LayerMaxXMaxYCorner
        } else {
            superview_layer
                .map(|layer| layer.maskedCorners())
                .unwrap_or(CACornerMask::empty())
        };
        let size = self.bounds().size;
        let bounds = NSRect::new(NSPoint::new(0.0, 0.0), size);
        CATransaction::begin();
        CATransaction::setDisableActions(true);
        layer.setCornerRadius(radius);
        layer.setMaskedCorners(corners);
        for fog in [near, wide] {
            // The frame around the bounds, wide enough that its blur never shows a seam.
            let inset = -fog.shadowRadius() * 4.0;
            let path = CGMutablePath::new();
            let outer = NSRect::new(
                NSPoint::new(inset, inset),
                NSSize::new(size.width - 2.0 * inset, size.height - 2.0 * inset),
            );
            let corner = radius.min(size.width.min(size.height) / 2.0);
            // Core Animation fills a shadow path by the nonzero rule, whatever the layer's fill rule:
            // the hole must wind against the frame, or the shadow covers the whole page in white.
            // Mirroring the rounded rect across its center line reverses its direction.
            let mirror = CGAffineTransform {
                a: -1.0,
                b: 0.0,
                c: 0.0,
                d: 1.0,
                tx: 2.0 * (bounds.origin.x + size.width / 2.0),
                ty: 0.0,
            };
            // SAFETY: the transform pointer is valid for the calls.
            unsafe {
                CGMutablePath::add_rect(Some(&path), std::ptr::null(), outer);
                CGMutablePath::add_rounded_rect(Some(&path), &mirror, bounds, corner, corner);
            }
            fog.setFrame(bounds);
            let path: &CGPath = &path;
            fog.setPath(Some(path));
            fog.setShadowPath(Some(path));
        }
        CATransaction::commit();
    }
}

/// A mist view filling `host`, above its other subviews.
pub(super) fn mist_in(
    mtm: MainThreadMarker,
    host: &NSView,
    radius: Option<f64>,
) -> Retained<MistView> {
    let mist = MistView::new(mtm, host.bounds(), radius);
    mist.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    mist.build();
    host.addSubview_positioned_relativeTo(&mist, NSWindowOrderingMode::Above, None);
    mist.fit();
    mist
}

/// The mist already inside `host`, if any.
pub(super) fn mist_of(host: &NSView) -> Option<Retained<MistView>> {
    host.subviews()
        .iter()
        .filter_map(|view| view.downcast::<MistView>().ok())
        .last()
}

/// While an agent waits for the person every mist thins instead of disappearing.
pub(super) fn set_waiting(is_waiting: bool) {
    WAITING.with(|waiting| waiting.set(is_waiting));
    let alpha = if is_waiting {
        WAITING_ALPHA
    } else {
        ACTING_ALPHA
    };
    let mists: Vec<Retained<MistView>> = MISTS.with(|mists| {
        let mut mists = mists.borrow_mut();
        mists.retain(|mist| mist.load().is_some());
        mists.iter().filter_map(Weak::load).collect()
    });
    let changes = RcBlock::new(move |context: std::ptr::NonNull<NSAnimationContext>| {
        // SAFETY: the context is live inside the animation group.
        unsafe { context.as_ref() }.setDuration(0.3);
        for mist in &mists {
            mist.animator().setAlphaValue(alpha);
        }
    });
    NSAnimationContext::runAnimationGroup(&changes);
}
