//! Trusted agent input for WebKitGTK pages: real GDK events built by Misty and handed to the
//! granted page's own widget with `gtk_widget_event`. They reach that view only: never Misty's
//! window, another tab, another app or the display server, and the person's pointer and keyboard
//! stay where they are. Typing goes through WebKit's InsertText editing command, as an input
//! method would commit it.
use std::{
    cell::Cell,
    collections::HashSet,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

use gtk::{gdk, glib, prelude::*};
use serde_json::{json, Value};
use tauri::Webview;
use webkit2gtk::WebViewExt;

/// Pages whose person-made input is ignored while an agent drives them.
fn locked_pages() -> &'static Mutex<HashSet<String>> {
    static LOCKED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    LOCKED.get_or_init(Mutex::default)
}

thread_local! {
    /// True on the GTK thread while Misty itself delivers an event, so the lock lets it through.
    static DELIVERING: Cell<bool> = const { Cell::new(false) };
}

const LOCK_HOOK: &str = "misty-agent-input-lock";

fn is_person_input(kind: gdk::EventType) -> bool {
    use gdk::EventType::*;
    matches!(
        kind,
        ButtonPress
            | DoubleButtonPress
            | TripleButtonPress
            | ButtonRelease
            | MotionNotify
            | KeyPress
            | KeyRelease
            | Scroll
            | TouchBegin
            | TouchUpdate
            | TouchEnd
            | TouchCancel
            | TouchpadSwipe
            | TouchpadPinch
    )
}

/// Ignores the person's own input on the page while an agent drives it. Misty's events pass.
pub(in crate::browser) fn set_locked(webview: &Webview, locked: bool) -> Result<(), String> {
    let label = webview.label().to_owned();
    {
        let mut pages = locked_pages()
            .lock()
            .map_err(|_| "Browser state is unavailable.")?;
        if locked {
            pages.insert(label.clone());
        } else {
            pages.remove(&label);
        }
    }
    if !locked {
        return Ok(());
    }
    webview
        .with_webview(move |platform| {
            let view = platform.inner();
            // SAFETY: the key only ever holds `bool`.
            if unsafe { view.data::<bool>(LOCK_HOOK) }.is_some() {
                return;
            }
            unsafe { view.set_data(LOCK_HOOK, true) };
            view.connect_event(move |_, event| {
                let held = !DELIVERING.with(Cell::get)
                    && is_person_input(event.event_type())
                    && locked_pages()
                        .lock()
                        .is_ok_and(|pages| pages.contains(&label));
                if held {
                    glib::Propagation::Stop
                } else {
                    glib::Propagation::Proceed
                }
            });
        })
        .map_err(|error| error.to_string())
}

/// A check that runs on the GTK thread right before each event, so an event cannot outlive
/// revoked ownership, a takeover or a navigation.
pub(in crate::browser) type Authorize = Arc<dyn Fn() -> Result<(), String> + Send + Sync>;

/// One synthesized event, in CSS pixels of the page's viewport.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Synth {
    Motion {
        x: f64,
        y: f64,
        held: Option<u32>,
    },
    Press {
        x: f64,
        y: f64,
        button: u32,
        double: bool,
    },
    Release {
        x: f64,
        y: f64,
        button: u32,
    },
    /// Smooth scroll by CSS pixels; positive y scrolls the content down.
    Scroll {
        x: f64,
        y: f64,
        dx: f64,
        dy: f64,
    },
    Key {
        keyval: u32,
        modifiers: u32,
        down: bool,
    },
}

/// WebKitGTK scrolls a smooth delta of 1.0 by one line step (40 CSS pixels).
const PIXELS_PER_LINE: f64 = 40.0;

fn event_time() -> u32 {
    (glib::monotonic_time() / 1000) as u32
}

/// Builds `synth` for `view` (whose GdkWindow it targets) and delivers it to that widget.
/// Runs on the GTK thread.
pub(crate) fn deliver(view: &webkit2gtk::WebView, synth: Synth) -> Result<(), String> {
    let window = view
        .window()
        .ok_or("The granted browser must be visible before native input.")?;
    let display = window.display();
    let seat = display
        .default_seat()
        .ok_or("No input seat is available.")?;
    let zoom = view.zoom_level().max(0.01);
    let (origin_x, origin_y) = {
        let (_, x, y) = window.origin();
        (f64::from(x), f64::from(y))
    };
    let time = event_time();
    let pointer_state = |held: Option<u32>| match held {
        Some(1) => gdk::ModifierType::BUTTON1_MASK.bits(),
        Some(3) => gdk::ModifierType::BUTTON3_MASK.bits(),
        _ => 0,
    };
    let mut event = match synth {
        Synth::Motion { .. } => gdk::Event::new(gdk::EventType::MotionNotify),
        Synth::Press { double: false, .. } => gdk::Event::new(gdk::EventType::ButtonPress),
        Synth::Press { double: true, .. } => gdk::Event::new(gdk::EventType::DoubleButtonPress),
        Synth::Release { .. } => gdk::Event::new(gdk::EventType::ButtonRelease),
        Synth::Scroll { .. } => gdk::Event::new(gdk::EventType::Scroll),
        Synth::Key { down: true, .. } => gdk::Event::new(gdk::EventType::KeyPress),
        Synth::Key { down: false, .. } => gdk::Event::new(gdk::EventType::KeyRelease),
    };
    let device = match synth {
        Synth::Key { .. } => seat.keyboard(),
        _ => seat.pointer(),
    };
    event.set_device(device.as_ref());
    let hardware_keycode = |keyval: u32| {
        gdk::Keymap::for_display(&display)
            .and_then(|keymap| {
                keymap
                    .entries_for_keyval(keyval)
                    .first()
                    .map(|key| key.keycode())
            })
            .unwrap_or(0) as u16
    };
    // SAFETY: `event` was made for exactly the variant written below; the window field takes
    // its own reference, which gdk_event_free releases.
    unsafe {
        use glib::translate::{ToGlibPtr, ToGlibPtrMut};
        let raw: *mut gdk::ffi::GdkEvent = event.to_glib_none_mut().0;
        (*raw).any.window = window.to_glib_full();
        (*raw).any.send_event = 0;
        match synth {
            Synth::Motion { x, y, held } => {
                let motion = &mut (*raw).motion;
                motion.time = time;
                motion.x = x * zoom;
                motion.y = y * zoom;
                motion.x_root = origin_x + motion.x;
                motion.y_root = origin_y + motion.y;
                motion.state = pointer_state(held);
                motion.is_hint = 0;
            }
            Synth::Press { x, y, button, .. } | Synth::Release { x, y, button } => {
                let press = &mut (*raw).button;
                press.time = time;
                press.x = x * zoom;
                press.y = y * zoom;
                press.x_root = origin_x + press.x;
                press.y_root = origin_y + press.y;
                press.button = button;
                press.state = if matches!(synth, Synth::Release { .. }) {
                    pointer_state(Some(button))
                } else {
                    0
                };
            }
            Synth::Scroll { x, y, dx, dy } => {
                let scroll = &mut (*raw).scroll;
                scroll.time = time;
                scroll.x = x * zoom;
                scroll.y = y * zoom;
                scroll.x_root = origin_x + scroll.x;
                scroll.y_root = origin_y + scroll.y;
                scroll.direction = gdk::ffi::GDK_SCROLL_SMOOTH;
                scroll.delta_x = dx / PIXELS_PER_LINE;
                scroll.delta_y = dy / PIXELS_PER_LINE;
                scroll.is_stop = 0;
            }
            Synth::Key {
                keyval, modifiers, ..
            } => {
                let key = &mut (*raw).key;
                key.time = time;
                key.state = modifiers;
                key.keyval = keyval;
                key.length = 0;
                key.string = std::ptr::null_mut();
                key.hardware_keycode = hardware_keycode(keyval);
                key.group = 0;
                key.is_modifier = 0;
            }
        }
    }
    DELIVERING.with(|delivering| delivering.set(true));
    let _ = view.event(&event);
    DELIVERING.with(|delivering| delivering.set(false));
    Ok(())
}

/// Commits text into the page's focused field, as an input method would.
pub(crate) fn insert_text(view: &webkit2gtk::WebView, text: &str) {
    DELIVERING.with(|delivering| delivering.set(true));
    view.execute_editing_command_with_argument("InsertText", text);
    DELIVERING.with(|delivering| delivering.set(false));
}

/// The keysym and the GDK modifier bits for a validated key action.
pub(crate) fn key_of(name: &str, modifiers: &Value) -> Option<(u32, u32)> {
    let keyval = match name {
        "Enter" => 0xff0d,
        "Escape" => 0xff1b,
        "Tab" => 0xff09,
        "Backspace" => 0xff08,
        "Delete" => 0xffff,
        "ArrowLeft" => 0xff51,
        "ArrowUp" => 0xff52,
        "ArrowRight" => 0xff53,
        "ArrowDown" => 0xff54,
        "Home" => 0xff50,
        "End" => 0xff57,
        "PageUp" => 0xff55,
        "PageDown" => 0xff56,
        "Space" => 0x20,
        // Printable ASCII keysyms are their code points.
        single if single.len() == 1 && single.as_bytes()[0].is_ascii_graphic() => {
            u32::from(single.as_bytes()[0])
        }
        _ => return None,
    };
    let mut bits = 0;
    for modifier in modifiers.as_array().into_iter().flatten() {
        bits |= match modifier.as_str() {
            Some("Shift") => gdk::ModifierType::SHIFT_MASK.bits(),
            Some("Control") => gdk::ModifierType::CONTROL_MASK.bits(),
            Some("Alt") => gdk::ModifierType::MOD1_MASK.bits(),
            Some("Meta") => gdk::ModifierType::SUPER_MASK.bits(),
            _ => 0,
        };
    }
    Some((keyval, bits))
}

/// The page's CSS viewport, `None` while its widget isn't on screen.
pub(crate) fn css_viewport(view: &webkit2gtk::WebView) -> Option<(f64, f64)> {
    if !view.is_mapped() || view.window().is_none() {
        return None;
    }
    let zoom = view.zoom_level().max(0.01);
    Some((
        f64::from(view.allocated_width()) / zoom,
        f64::from(view.allocated_height()) / zoom,
    ))
}

/// Runs `work` on the page's GTK thread after `authorize` passes, and waits for it.
async fn on_view<T: Send + 'static>(
    webview: &Webview,
    authorize: &Authorize,
    work: impl FnOnce(&webkit2gtk::WebView) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let authorize = authorize.clone();
    webview
        .with_webview(move |platform| {
            let result = authorize().and_then(|()| work(&platform.inner()));
            let _ = send.send(result);
        })
        .map_err(|error| error.to_string())?;
    receive
        .await
        .map_err(|_| "The page closed before its input landed.".to_owned())?
}

async fn send(webview: &Webview, authorize: &Authorize, events: Vec<Synth>) -> Result<(), String> {
    on_view(webview, authorize, move |view| {
        for synth in events {
            deliver(view, synth)?;
        }
        Ok(())
    })
    .await
}

/// The page's CSS viewport as WebKit lays it out now.
pub(in crate::browser) async fn viewport(webview: &Webview) -> Result<(f64, f64), String> {
    let allow: Authorize = Arc::new(|| Ok(()));
    on_view(webview, &allow, |view| {
        css_viewport(view)
            .ok_or_else(|| "The granted browser must be visible before native input.".into())
    })
    .await
}

/// Delivers one validated action. Returns the same receipt the other adapters do.
pub(in crate::browser) async fn act(
    webview: &Webview,
    authorize: Authorize,
    action: &Value,
    viewport: (f64, f64),
) -> Result<Value, String> {
    let point = |x: &str, y: &str| -> (f64, f64) {
        let fraction = |key: &str| action[key].as_f64().unwrap_or(0.0).clamp(0.0, 1.0);
        (
            (fraction(x) * viewport.0).min(viewport.0 - 1.0).max(0.0),
            (fraction(y) * viewport.1).min(viewport.1 - 1.0).max(0.0),
        )
    };
    match action["kind"].as_str().unwrap_or("") {
        "move" => {
            let (x, y) = point("x", "y");
            send(
                webview,
                &authorize,
                vec![Synth::Motion { x, y, held: None }],
            )
            .await?;
        }
        "click" => {
            let (x, y) = point("x", "y");
            let button = if action["button"] == "right" { 3 } else { 1 };
            let mut events = vec![Synth::Motion { x, y, held: None }];
            for click in 1..=action["clickCount"].as_u64().unwrap_or(1) {
                events.push(Synth::Press {
                    x,
                    y,
                    button,
                    double: false,
                });
                // GTK reports a second press in a row as a double press too.
                if click == 2 {
                    events.push(Synth::Press {
                        x,
                        y,
                        button,
                        double: true,
                    });
                }
                events.push(Synth::Release { x, y, button });
            }
            send(webview, &authorize, events).await?;
        }
        "drag" => {
            let (from_x, from_y) = point("fromX", "fromY");
            let (to_x, to_y) = point("toX", "toY");
            send(
                webview,
                &authorize,
                vec![
                    Synth::Motion {
                        x: from_x,
                        y: from_y,
                        held: None,
                    },
                    Synth::Press {
                        x: from_x,
                        y: from_y,
                        button: 1,
                        double: false,
                    },
                ],
            )
            .await?;
            for step in 1..=24 {
                let fraction = f64::from(step) / 24.0;
                let (x, y) = (
                    from_x + (to_x - from_x) * fraction,
                    from_y + (to_y - from_y) * fraction,
                );
                send(
                    webview,
                    &authorize,
                    vec![Synth::Motion {
                        x,
                        y,
                        held: Some(1),
                    }],
                )
                .await?;
                tokio::time::sleep(Duration::from_millis(12)).await;
            }
            send(
                webview,
                &authorize,
                vec![Synth::Release {
                    x: to_x,
                    y: to_y,
                    button: 1,
                }],
            )
            .await?;
        }
        "scroll" => {
            let (x, y) = point("x", "y");
            let dx = action["deltaX"].as_f64().unwrap_or(0.0);
            let dy = action["deltaY"].as_f64().unwrap_or(0.0);
            send(
                webview,
                &authorize,
                vec![
                    Synth::Motion { x, y, held: None },
                    Synth::Scroll { x, y, dx, dy },
                ],
            )
            .await?;
        }
        "type" => {
            let text = action["text"].as_str().unwrap_or_default().to_owned();
            on_view(webview, &authorize, move |view| {
                insert_text(view, &text);
                Ok(())
            })
            .await?;
        }
        "key" => {
            let (keyval, modifiers) = key_of(
                action["key"].as_str().unwrap_or_default(),
                &action["modifiers"],
            )
            .ok_or("Unsupported native browser key")?;
            send(
                webview,
                &authorize,
                vec![
                    Synth::Key {
                        keyval,
                        modifiers,
                        down: true,
                    },
                    Synth::Key {
                        keyval,
                        modifiers,
                        down: false,
                    },
                ],
            )
            .await?;
        }
        _ => return Err("Unsupported native browser action".into()),
    }
    Ok(json!({ "attempted": true, "verified": false, "driver": "native-webkitgtk" }))
}
