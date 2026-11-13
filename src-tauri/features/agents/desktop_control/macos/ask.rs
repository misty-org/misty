//! The confirmation before Misty first takes the desktop. It sits outside the
//! model's action surface: until the person accepts, nothing is captured.
use std::{cell::Cell, sync::mpsc};

use objc2::{
    define_class, msg_send, rc::Retained, runtime::AnyObject, sel, DefinedClass, MainThreadMarker,
    MainThreadOnly,
};
use objc2_app_kit::{
    NSBackingStoreType, NSButton, NSPanel, NSStatusWindowLevel, NSTextField,
    NSWindowCollectionBehavior, NSWindowStyleMask,
};
use objc2_foundation::{NSObjectProtocol, NSPoint, NSRect, NSSize, NSString};

pub(super) struct AskIvars {
    answered: Cell<bool>,
    accepted: Cell<bool>,
    answer: mpsc::Sender<()>,
}

define_class!(
    #[unsafe(super(NSPanel))]
    #[thread_kind = MainThreadOnly]
    #[name = "MistyDesktopAsk"]
    #[ivars = AskIvars]
    pub(super) struct AskPanel;

    unsafe impl NSObjectProtocol for AskPanel {}

    impl AskPanel {
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key(&self) -> bool {
            true
        }

        #[unsafe(method(allow:))]
        fn allow_action(&self, _sender: Option<&AnyObject>) {
            let ivars = self.ivars();
            if ivars.answered.replace(true) {
                return;
            }
            ivars.accepted.set(true);
            self.orderOut(None);
            let _ = ivars.answer.send(());
        }

        #[unsafe(method(decline:))]
        fn decline_action(&self, _sender: Option<&AnyObject>) {
            self.decline();
        }
    }
);

impl AskPanel {
    /// Answers no, once.
    pub(super) fn decline(&self) {
        let ivars = self.ivars();
        if ivars.answered.replace(true) {
            return;
        }
        self.orderOut(None);
        let _ = ivars.answer.send(());
    }

    pub(super) fn accepted(&self) -> bool {
        self.ivars().accepted.get()
    }
}

fn frame(x: f64, y: f64, width: f64, height: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
}

/// Shows the confirmation; the receiver gets a message once it is answered.
pub(super) fn show(mtm: MainThreadMarker) -> (Retained<AskPanel>, mpsc::Receiver<()>) {
    let (send, receive) = mpsc::channel();
    let this = AskPanel::alloc(mtm).set_ivars(AskIvars {
        answered: Cell::new(false),
        accepted: Cell::new(false),
        answer: send,
    });
    let panel: Retained<AskPanel> = unsafe {
        msg_send![
            super(this),
            initWithContentRect: frame(0.0, 0.0, 410.0, 156.0),
            styleMask: NSWindowStyleMask::Titled | NSWindowStyleMask::NonactivatingPanel,
            backing: NSBackingStoreType::Buffered,
            defer: false
        ]
    };
    // SAFETY: the panel is only ordered out, never closed.
    unsafe { panel.setReleasedWhenClosed(false) };
    panel.setTitle(&NSString::from_str("Allow desktop control?"));
    panel.setLevel(NSStatusWindowLevel);
    panel.setHidesOnDeactivate(false);
    panel.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary,
    );
    if let Some(content) = panel.contentView() {
        let label = NSTextField::wrappingLabelWithString(
            &NSString::from_str("Misty is ready to use your apps with its own cursor for this task. Your pointer and keyboard stay yours. Stop at any time with Escape or Stop."),
            mtm,
        );
        label.setFrame(frame(20.0, 65.0, 370.0, 70.0));
        content.addSubview(&label);
        // SAFETY: the target is the panel, which implements both selectors.
        let (cancel, allow) = unsafe {
            (
                NSButton::buttonWithTitle_target_action(
                    &NSString::from_str("Cancel"),
                    Some(panel.as_ref()),
                    Some(sel!(decline:)),
                    mtm,
                ),
                NSButton::buttonWithTitle_target_action(
                    &NSString::from_str("Allow control"),
                    Some(panel.as_ref()),
                    Some(sel!(allow:)),
                    mtm,
                ),
            )
        };
        cancel.setFrame(frame(190.0, 18.0, 90.0, 30.0));
        cancel.setKeyEquivalent(&NSString::from_str("\u{1b}"));
        content.addSubview(&cancel);
        allow.setFrame(frame(280.0, 18.0, 115.0, 30.0));
        content.addSubview(&allow);
    }
    panel.center();
    panel.makeKeyAndOrderFront(None);
    panel.orderFrontRegardless();
    (panel, receive)
}
