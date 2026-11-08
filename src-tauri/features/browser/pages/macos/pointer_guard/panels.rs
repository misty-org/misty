//! Hover and cursor events around the live subtitles panel. It's a view above the window's pages and
//! renderer, but tracking callbacks ignore what's on top, so without this the page beneath keeps
//! setting its cursor while the panel sets its own, and the cursor jitters between them. The pointer
//! belongs to the panel while it's over the panel, and to nobody else.
use super::*;

struct Panel {
    /// Held so it can be asked about safely after it closes; a panel with no parent is let go.
    view: Retained<NSView>,
    /// The view and the objects WebKit gets its hover callbacks through.
    owners: HashSet<usize>,
    pointer_inside: bool,
}

thread_local! {
    /// AppKit delivers tracking events on the main thread, where panels are registered too.
    static PANELS: RefCell<Vec<Panel>> = const { RefCell::new(Vec::new()) };
}

pub(super) enum PointerAtPanel {
    /// The event is the panel's own, and the pointer is over it: it should have it.
    OwnInside,
    /// The event is the panel's own but the pointer is elsewhere, as when the panel has keyboard
    /// focus and AppKit sends it every move.
    OwnOutside,
    /// The pointer is over a panel, and the event is someone else's.
    Covered,
    Elsewhere,
}

unsafe fn collect_owners(view: &NSView, owners: &mut HashSet<usize>) {
    for area in view.trackingAreas().iter() {
        let Some(owner) = area.owner() else {
            continue;
        };
        owners.insert(&*owner as *const AnyObject as usize);
        install_pointer_event_overrides(AnyObject::class(&*owner));
    }
    for child in view.subviews().iter() {
        collect_owners(&child, owners);
    }
}

/// Safe to repeat: WebKit adds tracking owners as it goes.
pub(crate) unsafe fn keep_pointer_on_panel(view: &NSView) {
    let pointer = view as *const NSView as usize;
    let mut owners = HashSet::from([pointer]);
    install_pointer_event_overrides(AnyObject::class(
        &*std::ptr::from_ref(view).cast::<AnyObject>(),
    ));
    collect_owners(view, &mut owners);
    PANELS.with(|panels| {
        let mut panels = panels.borrow_mut();
        if let Some(panel) = panels
            .iter_mut()
            .find(|panel| std::ptr::eq(&*panel.view, view))
        {
            panel.owners = owners;
        } else if let Some(view) = Retained::retain(std::ptr::from_ref(view).cast_mut()) {
            panels.push(Panel {
                view,
                owners,
                pointer_inside: false,
            });
        }
    });
}

/// Over the panel, in this event's window, and the panel isn't under the renderer for a menu. Past a
/// notice the renderer stands aside, so the panel is as reachable there as a page is.
unsafe fn panel_holds_event(panel: &NSView, event: &NSEvent) -> bool {
    let window: *mut AnyObject = objc2::msg_send![event, window];
    let in_window = panel.window().is_some_and(|candidate| {
        std::ptr::eq(
            &*candidate as *const _ as *const AnyObject,
            window as *const AnyObject,
        )
    });
    if !in_window || panel.isHidden() {
        return false;
    }
    let Some(parent) = panel.superview() else {
        return false;
    };
    let point = parent.convertPoint_fromView(event.locationInWindow(), None);
    let frame = panel.frame();
    let inside = rect_contains(
        [
            frame.origin.x,
            frame.origin.y,
            frame.origin.x + frame.size.width,
            frame.origin.y + frame.size.height,
        ],
        point.x,
        point.y,
    );
    if !inside {
        return false;
    }
    let above_renderer =
        page_and_renderer_order(panel).is_none_or(|(panel_index, main)| panel_index > main);
    above_renderer || notice_passes_event_to_page(event)
}

pub(super) unsafe fn pointer_at_panel(this: usize, event: &NSEvent) -> PointerAtPanel {
    PANELS.with(|panels| {
        let mut panels = panels.borrow_mut();
        panels.retain(|panel| panel.view.superview().is_some());
        let mut covered = false;
        let mut own = None;
        for panel in panels.iter_mut() {
            let holds = panel_holds_event(&panel.view, event);
            // Crossing the edge, each side's cursor would stay on the other: the page's on the
            // panel, which it can even hide, and the panel's hand on the page. Neither knows the
            // other changed it, so put the arrow back; whoever has the pointer sets its own next.
            if holds != panel.pointer_inside {
                restore_arrow_cursor();
            }
            panel.pointer_inside = holds;
            covered |= holds;
            if panel.owners.contains(&this) {
                own = Some(holds);
            }
        }
        match own {
            Some(true) => PointerAtPanel::OwnInside,
            Some(false) => PointerAtPanel::OwnOutside,
            None if covered => PointerAtPanel::Covered,
            None => PointerAtPanel::Elsewhere,
        }
    })
}
