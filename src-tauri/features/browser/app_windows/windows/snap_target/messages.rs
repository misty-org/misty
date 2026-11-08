//! The window procedures: hover, click and leave on the button, for the target
//! and for the main window.
use super::*;

pub(super) unsafe extern "system" fn on_target(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let main = GetParent(window);
    if message == WM_NCHITTEST {
        return HTMAXBUTTON as LRESULT;
    }
    match button_message(main, window, message, wparam) {
        Some(result) => result,
        None => DefWindowProcW(window, message, wparam, lparam),
    }
}

/// Hover and click on the button, for whichever window receives them. `None`
/// passes the message on to the system, which runs Snap Layouts from the hover.
unsafe fn button_message(
    main: HWND,
    receiver: HWND,
    message: u32,
    wparam: WPARAM,
) -> Option<LRESULT> {
    let on_button = wparam == HTMAXBUTTON as WPARAM;
    match message {
        WM_NCMOUSEMOVE => {
            if on_button {
                // Re-armed on every move: a leave the system never sent (the window
                // resized under the pointer) must not leave the hover stuck on.
                let mut track = TRACKMOUSEEVENT {
                    cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                    dwFlags: TME_LEAVE | TME_NONCLIENT,
                    hwndTrack: receiver,
                    dwHoverTime: 0,
                };
                TrackMouseEvent(&mut track);
                if set_flag(main, |target| {
                    !std::mem::replace(&mut target.hovering, true)
                }) {
                    emit(main, "misty://maximize-button-hover", true);
                }
            } else {
                leave(main);
            }
            None
        }
        WM_NCMOUSELEAVE => {
            leave(main);
            None
        }
        // The system would draw a classic caption button for these; the page
        // draws Misty's and acts on the click.
        WM_NCLBUTTONDOWN | WM_NCLBUTTONDBLCLK if on_button => {
            set_flag(main, |target| {
                target.pressed = true;
                true
            });
            Some(0)
        }
        WM_NCLBUTTONUP if on_button => {
            if set_flag(main, |target| std::mem::take(&mut target.pressed)) {
                emit(main, "misty://maximize-button-click", true);
            }
            // Maximizing moves the button; the next move over it starts a fresh hover.
            leave(main);
            Some(0)
        }
        _ => None,
    }
}

pub(super) unsafe extern "system" fn on_main(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    match message {
        WM_NCHITTEST if over_button(window, lparam) => HTMAXBUTTON as LRESULT,
        WM_NCDESTROY => {
            if let Ok(mut targets) = targets().lock() {
                targets.remove(&(window as isize));
            }
            RemoveWindowSubclass(window, Some(on_main), MAIN_SUBCLASS);
            DefSubclassProc(window, message, wparam, lparam)
        }
        _ => match button_message(window, window, message, wparam) {
            Some(result) => result,
            None => DefSubclassProc(window, message, wparam, lparam),
        },
    }
}

fn leave(main: HWND) {
    if set_flag(main, |target| {
        target.pressed = false;
        std::mem::take(&mut target.hovering)
    }) {
        emit(main, "misty://maximize-button-hover", false);
    }
}
