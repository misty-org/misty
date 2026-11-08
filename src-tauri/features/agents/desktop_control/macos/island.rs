//! The control island: the in-app island's view outside Misty during desktop
//! control. Misty's island owns its state and actions; this panel shows them
//! and sends the person's presses back.
use std::cell::RefCell;

use objc2::{
    define_class, msg_send, rc::Retained, runtime::AnyObject, sel, MainThreadMarker, MainThreadOnly,
};
use objc2_app_kit::{
    NSAppearance, NSAppearanceCustomization, NSAppearanceNameDarkAqua, NSBackingStoreType,
    NSBezelStyle, NSButton, NSColor, NSControlSize, NSFont, NSFontWeightMedium, NSLineBreakMode,
    NSPanel, NSStatusWindowLevel, NSTextAlignment, NSTextField, NSView, NSWindowCollectionBehavior,
    NSWindowSharingType, NSWindowStyleMask,
};
use objc2_foundation::{NSCharacterSet, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString};
use serde_json::{json, Value};

use super::control;
use crate::agents::cursor::macos::support::main_display_height;

struct Island {
    status: Retained<NSTextField>,
    meta: Retained<NSTextField>,
    field: Retained<NSTextField>,
    send: Retained<NSButton>,
    queue: Retained<NSButton>,
    take: Retained<NSButton>,
    done: Retained<NSButton>,
}

#[derive(Default)]
struct Texts {
    status: Option<String>,
    meta: Option<String>,
    waiting: Option<String>,
    notify: Option<fn(Value)>,
}

thread_local! {
    static ISLAND: RefCell<Option<Island>> = const { RefCell::new(None) };
    static TEXTS: RefCell<Texts> = RefCell::new(Texts::default());
}

/// Forgets the island's text and sets where its presses go, for a new task.
pub(super) fn reset(notify: fn(Value)) {
    TEXTS.with(|texts| {
        *texts.borrow_mut() = Texts {
            notify: Some(notify),
            ..Texts::default()
        }
    });
}

/// What Misty's island shows; None falls back to the default text.
pub(super) fn set_text(status: Option<String>, meta: Option<String>, waiting: Option<String>) {
    TEXTS.with(|texts| {
        let mut texts = texts.borrow_mut();
        texts.status = status;
        texts.meta = meta;
        texts.waiting = waiting;
    });
}

fn send_action(action: &str, text: Option<&str>) {
    let Some(task) = control::task().filter(|task| !task.is_empty()) else {
        return;
    };
    let Some(notify) = TEXTS.with(|texts| texts.borrow().notify) else {
        return;
    };
    notify(json!({"taskId": task, "action": action, "text": text.unwrap_or("")}));
}

define_class!(
    // Key only when the person clicks into the field, never by being shown; the
    // app they work in stays active. Agent input never reaches it: Accessibility
    // refuses Misty's own process and agent keys go to the other app's process.
    #[unsafe(super(NSPanel))]
    #[thread_kind = MainThreadOnly]
    #[name = "MistyDesktopPanel"]
    struct DesktopPanel;

    unsafe impl NSObjectProtocol for DesktopPanel {}

    impl DesktopPanel {
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key(&self) -> bool {
            true
        }

        #[unsafe(method(canBecomeMainWindow))]
        fn can_become_main(&self) -> bool {
            false
        }

        #[unsafe(method(stopPressed:))]
        fn stop_pressed(&self, _sender: Option<&AnyObject>) {
            control::stop_control(Some("Desktop control stopped. You have control."));
        }

        #[unsafe(method(sendPressed:))]
        fn send_pressed(&self, _sender: Option<&AnyObject>) {
            self.submit("send");
        }

        #[unsafe(method(queuePressed:))]
        fn queue_pressed(&self, _sender: Option<&AnyObject>) {
            self.submit("queue");
        }

        #[unsafe(method(takeOverPressed:))]
        fn take_over_pressed(&self, _sender: Option<&AnyObject>) {
            send_action("takeover", None);
        }

        #[unsafe(method(donePressed:))]
        fn done_pressed(&self, _sender: Option<&AnyObject>) {
            send_action("done", None);
        }
    }
);

impl DesktopPanel {
    fn submit(&self, action: &str) {
        let Some(field) = ISLAND.with(|island| island.borrow().as_ref().map(|i| i.field.clone()))
        else {
            return;
        };
        let text = field
            .stringValue()
            .stringByTrimmingCharactersInSet(&NSCharacterSet::whitespaceAndNewlineCharacterSet())
            .to_string();
        if text.is_empty() {
            return;
        }
        field.setStringValue(&NSString::from_str(""));
        self.makeFirstResponder(None);
        send_action(action, Some(&text));
    }
}

fn frame(x: f64, y: f64, width: f64, height: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
}

fn label(mtm: MainThreadMarker, rect: NSRect, size: f64, color: &NSColor) -> Retained<NSTextField> {
    let label = NSTextField::labelWithString(&NSString::from_str(""), mtm);
    label.setFrame(rect);
    label.setTextColor(Some(color));
    label.setFont(Some(&NSFont::systemFontOfSize_weight(size, unsafe {
        NSFontWeightMedium
    })));
    label.setLineBreakMode(NSLineBreakMode::ByTruncatingTail);
    label
}

fn button(
    mtm: MainThreadMarker,
    panel: &DesktopPanel,
    title: &str,
    action: objc2::runtime::Sel,
    rect: NSRect,
) -> Retained<NSButton> {
    // SAFETY: the target is the panel, which implements the selector.
    let button = unsafe {
        NSButton::buttonWithTitle_target_action(
            &NSString::from_str(title),
            Some(panel.as_ref()),
            Some(action),
            mtm,
        )
    };
    button.setFrame(rect);
    button.setBezelStyle(NSBezelStyle::Push);
    button.setControlSize(NSControlSize::Regular);
    if let Some(content) = panel.contentView() {
        content.addSubview(&button);
    }
    button
}

/// Status, a field to steer or queue, Take over, Stop and Escape; Done while
/// the task waits for the person. Built once per control session.
pub(super) fn panel(mtm: MainThreadMarker, display: NSRect) -> Retained<NSPanel> {
    let (width, height) = (560.0, 116.0);
    let top = main_display_height();
    let rect = frame(
        display.origin.x + (display.size.width - width) / 2.0,
        top - (display.origin.y + display.size.height) + 24.0,
        width,
        height,
    );
    let panel: Retained<DesktopPanel> = unsafe {
        msg_send![
            DesktopPanel::alloc(mtm),
            initWithContentRect: rect,
            styleMask: NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel,
            backing: NSBackingStoreType::Buffered,
            defer: false
        ]
    };
    // SAFETY: the panel is only ordered out, never closed.
    unsafe { panel.setReleasedWhenClosed(false) };
    panel.setTitle(&NSString::from_str("Misty desktop control"));
    panel.setLevel(NSStatusWindowLevel);
    panel.setHidesOnDeactivate(false);
    panel.setBecomesKeyOnlyIfNeeded(true);
    panel.setSharingType(NSWindowSharingType::None);
    panel.setAppearance(
        NSAppearance::appearanceNamed(unsafe { NSAppearanceNameDarkAqua }).as_deref(),
    );
    panel.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary,
    );
    panel.setBackgroundColor(Some(&NSColor::clearColor()));
    panel.setOpaque(false);
    panel.setHasShadow(true);
    let Some(content) = panel.contentView() else {
        return Retained::into_super(panel);
    };
    content.setWantsLayer(true);
    if let Some(layer) = content.layer() {
        layer.setBackgroundColor(Some(&NSColor::colorWithWhite_alpha(0.08, 0.96).CGColor()));
        layer.setCornerRadius(16.0);
        layer.setBorderWidth(1.0);
        layer.setBorderColor(Some(&NSColor::colorWithWhite_alpha(1.0, 0.12).CGColor()));
    }
    let status = label(
        mtm,
        frame(16.0, 84.0, 392.0, 18.0),
        12.5,
        &NSColor::whiteColor(),
    );
    let meta = label(
        mtm,
        frame(412.0, 84.0, 132.0, 18.0),
        12.0,
        &NSColor::colorWithWhite_alpha(1.0, 0.6),
    );
    meta.setAlignment(NSTextAlignment::Right);
    content.addSubview(&status);
    content.addSubview(&meta);
    let field = NSTextField::textFieldWithString(&NSString::from_str(""), mtm);
    field.setFrame(frame(12.0, 47.0, 356.0, 28.0));
    field.setPlaceholderString(Some(&NSString::from_str(
        "Tell Misty what to change, or ask for something new",
    )));
    // SAFETY: the target is the panel, which implements the selector.
    unsafe {
        field.setTarget(Some(panel.as_ref()));
        field.setAction(Some(sel!(sendPressed:)));
    }
    content.addSubview(&field);
    let send = button(
        mtm,
        &panel,
        "Send",
        sel!(sendPressed:),
        frame(372.0, 44.0, 80.0, 34.0),
    );
    let queue = button(
        mtm,
        &panel,
        "New task",
        sel!(queuePressed:),
        frame(454.0, 44.0, 94.0, 34.0),
    );
    let take = button(
        mtm,
        &panel,
        "Take over",
        sel!(takeOverPressed:),
        frame(8.0, 6.0, 100.0, 34.0),
    );
    let escape = label(
        mtm,
        frame(318.0, 15.0, 140.0, 16.0),
        11.5,
        &NSColor::colorWithWhite_alpha(1.0, 0.55),
    );
    escape.setStringValue(&NSString::from_str("Esc stops"));
    escape.setAlignment(NSTextAlignment::Right);
    content.addSubview(&escape);
    let done = button(
        mtm,
        &panel,
        "Done",
        sel!(donePressed:),
        frame(380.0, 6.0, 80.0, 34.0),
    );
    let stop = button(
        mtm,
        &panel,
        "Stop",
        sel!(stopPressed:),
        frame(462.0, 6.0, 86.0, 34.0),
    );
    stop.setKeyEquivalent(&NSString::from_str(""));
    ISLAND.with(|island| {
        *island.borrow_mut() = Some(Island {
            status,
            meta,
            field,
            send,
            queue,
            take,
            done,
        })
    });
    let _: &NSView = &content;
    Retained::into_super(panel)
}

/// Working (field and buttons) or waiting for the person (Done).
pub(super) fn mode(waiting: bool) {
    let (status, meta, waiting_text) = TEXTS.with(|texts| {
        let texts = texts.borrow();
        (
            texts.status.clone(),
            texts.meta.clone(),
            texts.waiting.clone(),
        )
    });
    ISLAND.with(|island| {
        let island = island.borrow();
        let Some(island) = island.as_ref() else {
            return;
        };
        let non_empty = |text: Option<String>| text.filter(|text| !text.is_empty());
        let status_text = if waiting {
            non_empty(waiting_text).unwrap_or_else(|| {
                "Misty is waiting for you. Press Done when you're finished.".into()
            })
        } else {
            non_empty(status).unwrap_or_else(|| "Misty is working with its own cursor".into())
        };
        island
            .status
            .setStringValue(&NSString::from_str(&status_text));
        let meta_text = if waiting {
            String::new()
        } else {
            meta.unwrap_or_default()
        };
        island.meta.setStringValue(&NSString::from_str(&meta_text));
        for view in [&island.send, &island.queue, &island.take] {
            view.setHidden(waiting);
        }
        island.field.setHidden(waiting);
        island.done.setHidden(!waiting);
        if waiting {
            island.done.setKeyEquivalent(&NSString::from_str("\r"));
        }
    });
}
