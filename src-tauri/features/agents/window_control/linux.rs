//! Misty-window control on Linux, the counterpart of `windows.rs`: the whole Misty window is
//! drawn from what WebKit renders for each of its views, and each action goes to the view under
//! the point as real GDK events delivered to that view alone (browser/input/native_input/linux.rs),
//! so no global input is posted and the person's pointer and keyboard stay theirs. Typing and keys
//! go to the view Misty last pointed at.
use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD, Engine};
use gtk::prelude::*;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::browser::input::native_input::linux::{deliver, insert_text, Synth};

/// The longest edge of a window frame the agent sees, as on the other systems.
const MAX_EDGE: f64 = 2000.0;

/// The label of the webview Misty last pointed at.
static TARGET: Mutex<Option<String>> = Mutex::new(None);

fn main_window(app: &AppHandle) -> Result<tauri::Window, String> {
    crate::browser::app_windows::primary(app).ok_or_else(|| "Misty window closed".into())
}

/// Why control can't continue while another window is in front.
pub fn focus_reason() -> String {
    let name = if crate::agents::desktop_control::linux::wayland_session() {
        None
    } else {
        crate::agents::desktop_control::linux::x11::active_window()
            .map(|window| window.title)
            .filter(|title| !title.trim().is_empty())
    };
    format!(
        "Misty lost focus to {}. Bring Misty to the front, then resume.",
        name.as_deref().unwrap_or("another window")
    )
}

/// Runs `work` on the GTK thread and waits for it, from a worker or async task.
async fn on_main<T: Send + 'static>(
    app: &AppHandle,
    work: impl FnOnce(&AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = send.send(work(&handle));
    })
    .map_err(|e| e.to_string())?;
    receive
        .await
        .map_err(|_| "Misty's UI thread stopped".to_string())?
}

/// One of the window's views: its WebKit widget and its place in the window, in GTK units.
struct View {
    label: String,
    widget: webkit2gtk::WebView,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

/// The window's mapped views, pages first: they sit above the app's own view.
fn views(window: &tauri::Window) -> Vec<View> {
    let Ok(toplevel) = window.gtk_window() else {
        return Vec::new();
    };
    let mut views: Vec<View> = window
        .webviews()
        .into_iter()
        .filter_map(|view| {
            let (send, receive) = std::sync::mpsc::channel();
            // On the GTK thread already, so this runs at once.
            view.with_webview(move |platform| {
                let _ = send.send(OnMain(platform.inner()));
            })
            .ok()?;
            let OnMain(widget) = receive.try_recv().ok()?;
            if !widget.is_mapped() {
                return None;
            }
            let (x, y) = widget.translate_coordinates(&toplevel, 0, 0)?;
            Some(View {
                label: view.label().to_owned(),
                x,
                y,
                width: widget.allocated_width(),
                height: widget.allocated_height(),
                widget,
            })
        })
        .collect();
    views.sort_by_key(|view| crate::browser::app_windows::is_app_window(&view.label));
    views
}

/// The window's content size and its place on screen, in GTK units.
fn frame_of(window: &tauri::Window) -> Result<(i32, i32, i32, i32), String> {
    let toplevel = window.gtk_window().map_err(|e| e.to_string())?;
    let (x, y) = toplevel
        .window()
        .map(|gdk_window| {
            let (_, x, y) = gdk_window.origin();
            (x, y)
        })
        .unwrap_or_default();
    Ok((
        x,
        y,
        toplevel.allocated_width(),
        toplevel.allocated_height(),
    ))
}

/// One capture of the display under control, or of the Misty window.
pub async fn native_capture(app: &AppHandle, desktop: bool, task: String) -> Result<Value, String> {
    if !desktop {
        return capture(app).await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        crate::agents::desktop_control::linux::control::capture(&task)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Performs an action on the desktop under control, or in the Misty window.
pub async fn perform(app: &AppHandle, desktop: bool, input: Value) -> Result<Value, String> {
    if !desktop {
        return action(app, &input).await;
    }
    tauri::async_runtime::spawn_blocking(move || {
        crate::agents::desktop_control::linux::control::action(&input)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Captures the whole Misty window, every view drawn where it sits.
async fn capture(app: &AppHandle) -> Result<Value, String> {
    let (frame, shots) = on_main(app, |app| {
        let window = main_window(app)?;
        if !window.is_focused().unwrap_or(false)
            || !window.is_visible().unwrap_or(false)
            || window.is_minimized().unwrap_or(true)
        {
            return Err("Bring Misty to the front before starting control.".into());
        }
        let frame = frame_of(&window)?;
        let views = views(&window);
        let mut shots = Vec::new();
        for view in views.into_iter().rev() {
            let (send, receive) = tokio::sync::oneshot::channel();
            use webkit2gtk::WebViewExt;
            view.widget.snapshot(
                webkit2gtk::SnapshotRegion::Visible,
                webkit2gtk::SnapshotOptions::NONE,
                None::<&gtk::gio::Cancellable>,
                move |result| {
                    let _ = send.send(result.ok().map(SendSurface));
                },
            );
            shots.push((view.x, view.y, view.width, view.height, receive));
        }
        Ok((frame, shots))
    })
    .await?;
    // The snapshots finish on the GTK thread; draw them there, in stacking order.
    let mut surfaces = Vec::new();
    for (x, y, width, height, receive) in shots {
        if let Ok(Some(surface)) = receive.await {
            surfaces.push((x, y, width, height, surface));
        }
    }
    let (width, height, rgba) = on_main(app, move |_| compose(frame, surfaces)).await?;
    let image = image::RgbaImage::from_raw(width, height, rgba).ok_or("Window capture failed")?;
    let mut jpeg = std::io::Cursor::new(Vec::new());
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 85)
        .encode_image(&image::DynamicImage::ImageRgba8(image).to_rgb8())
        .map_err(|_| "Window capture failed".to_owned())?;
    Ok(json!({
        "image": {
            "dataUrl": format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg.into_inner())),
            "width": width,
            "height": height,
        },
        "frame": [frame.0, frame.1, frame.2, frame.3],
    }))
}

/// A GTK object passed from a closure that already runs on the GTK thread.
struct OnMain<T>(T);
// SAFETY: only created and used on the GTK thread; the channel never leaves it.
unsafe impl<T> Send for OnMain<T> {}

/// A cairo surface handed between GTK-thread closures; it is only ever touched there.
struct SendSurface(gtk::cairo::Surface);
// SAFETY: created, drawn and dropped on the GTK thread only; the async code merely carries it.
unsafe impl Send for SendSurface {}

fn compose(
    frame: (i32, i32, i32, i32),
    surfaces: Vec<(i32, i32, i32, i32, SendSurface)>,
) -> Result<(u32, u32, Vec<u8>), String> {
    use gtk::cairo::{Context, Format, ImageSurface};
    let (frame_width, frame_height) = (frame.2.max(1), frame.3.max(1));
    let scale = (MAX_EDGE / f64::from(frame_width.max(frame_height))).min(2.0);
    let width = ((f64::from(frame_width) * scale).round() as i32).max(1);
    let height = ((f64::from(frame_height) * scale).round() as i32).max(1);
    let mut canvas =
        ImageSurface::create(Format::ARgb32, width, height).map_err(|e| e.to_string())?;
    {
        let context = Context::new(&canvas).map_err(|e| e.to_string())?;
        context.set_source_rgb(0.0, 0.0, 0.0);
        context.paint().map_err(|e| e.to_string())?;
        for (x, y, view_width, view_height, SendSurface(surface)) in surfaces {
            let Ok(shot) = ImageSurface::try_from(surface) else {
                continue;
            };
            context.save().map_err(|e| e.to_string())?;
            context.scale(scale, scale);
            context.translate(f64::from(x), f64::from(y));
            // WebKit draws at the device scale; fit the shot to the view's place.
            context.scale(
                f64::from(view_width) / f64::from(shot.width().max(1)),
                f64::from(view_height) / f64::from(shot.height().max(1)),
            );
            context
                .set_source_surface(&shot, 0.0, 0.0)
                .map_err(|e| e.to_string())?;
            context.paint().map_err(|e| e.to_string())?;
            context.restore().map_err(|e| e.to_string())?;
        }
    }
    canvas.flush();
    let stride = canvas.stride() as usize;
    let data = canvas.data().map_err(|e| e.to_string())?;
    let (width, height) = (width as usize, height as usize);
    let mut rgba = Vec::with_capacity(width * height * 4);
    for row in 0..height {
        for pixel in data[row * stride..row * stride + width * 4].chunks_exact(4) {
            // Opaque, native-endian ARGB32.
            let word = u32::from_ne_bytes([pixel[0], pixel[1], pixel[2], pixel[3]]);
            rgba.extend_from_slice(&[(word >> 16) as u8, (word >> 8) as u8, word as u8, 255]);
        }
    }
    Ok((width as u32, height as u32, rgba))
}

/// The keysym and modifier bits for a workspace key.
fn key_of(key: &str) -> Option<(u32, u32)> {
    let control = gtk::gdk::ModifierType::CONTROL_MASK.bits();
    Some(match key {
        "Enter" => (0xff0d, 0),
        "Escape" => (0xff1b, 0),
        "Tab" => (0xff09, 0),
        "Backspace" => (0xff08, 0),
        "ArrowLeft" => (0xff51, 0),
        "ArrowRight" => (0xff53, 0),
        "ArrowUp" => (0xff52, 0),
        "ArrowDown" => (0xff54, 0),
        "SelectAll" => (u32::from(b'a'), control),
        "Undo" => (u32::from(b'z'), control),
        "AddressBar" => (u32::from(b'l'), control),
        "NewTab" => (u32::from(b't'), control),
        "Find" => (u32::from(b'f'), control),
        _ => return None,
    })
}

/// Performs one validated action in the Misty window.
async fn action(app: &AppHandle, input: &Value) -> Result<Value, String> {
    let input = input.clone();
    on_main(app, move |app| {
        let window = main_window(app)?;
        if !window.is_focused().unwrap_or(false) || window.is_minimized().unwrap_or(true) {
            return Err("Misty must be the active window. Resume when you are ready.".into());
        }
        let frame = frame_of(&window)?;
        let expected: Vec<i64> = input["frame"]
            .as_array()
            .map(|values| values.iter().filter_map(Value::as_i64).collect())
            .unwrap_or_default();
        if expected
            != [
                i64::from(frame.0),
                i64::from(frame.1),
                i64::from(frame.2),
                i64::from(frame.3),
            ]
        {
            return Err(
                "browser_snapshot_stale: the window moved or resized; inspect again".into(),
            );
        }
        let action = &input["action"];
        let views = views(&window);
        let target = |label: Option<String>| {
            let label = label.or_else(|| {
                crate::browser::app_windows::primary_webview(app)
                    .map(|view| view.label().to_owned())
            })?;
            views.iter().find(|view| view.label == label)
        };
        match action["kind"].as_str().unwrap_or("") {
            kind @ ("point" | "scroll") => {
                let fraction = |key: &str| action[key].as_f64().unwrap_or(0.0).clamp(0.0, 1.0);
                let (x, y) = (
                    fraction("x") * f64::from(frame.2),
                    fraction("y") * f64::from(frame.3),
                );
                let view = views
                    .iter()
                    .find(|view| {
                        x >= f64::from(view.x)
                            && y >= f64::from(view.y)
                            && x < f64::from(view.x + view.width)
                            && y < f64::from(view.y + view.height)
                    })
                    .ok_or("Only the Misty workspace can be controlled")?;
                use webkit2gtk::WebViewExt;
                let zoom = view.widget.zoom_level().max(0.01);
                let (css_x, css_y) = (
                    (x - f64::from(view.x)) / zoom,
                    (y - f64::from(view.y)) / zoom,
                );
                if let Ok(mut last) = TARGET.lock() {
                    *last = Some(view.label.clone());
                }
                let events = if kind == "point" {
                    vec![
                        Synth::Motion {
                            x: css_x,
                            y: css_y,
                            held: None,
                        },
                        Synth::Press {
                            x: css_x,
                            y: css_y,
                            button: 1,
                            double: false,
                        },
                        Synth::Release {
                            x: css_x,
                            y: css_y,
                            button: 1,
                        },
                    ]
                } else {
                    vec![
                        Synth::Motion {
                            x: css_x,
                            y: css_y,
                            held: None,
                        },
                        Synth::Scroll {
                            x: css_x,
                            y: css_y,
                            dx: action["deltaX"].as_f64().unwrap_or(0.0),
                            dy: action["deltaY"].as_f64().unwrap_or(0.0),
                        },
                    ]
                };
                for event in events {
                    deliver(&view.widget, event)?;
                }
            }
            "type" => {
                let last = TARGET.lock().ok().and_then(|last| last.clone());
                let view = target(last).ok_or("Click an editable field before typing")?;
                insert_text(&view.widget, action["text"].as_str().unwrap_or(""));
            }
            "key" => {
                let last = TARGET.lock().ok().and_then(|last| last.clone());
                let view = target(last).ok_or("Click into Misty before pressing keys")?;
                let (keyval, modifiers) = key_of(action["key"].as_str().unwrap_or(""))
                    .ok_or("Unsupported workspace key")?;
                deliver(
                    &view.widget,
                    Synth::Key {
                        keyval,
                        modifiers,
                        down: true,
                    },
                )?;
                deliver(
                    &view.widget,
                    Synth::Key {
                        keyval,
                        modifiers,
                        down: false,
                    },
                )?;
            }
            _ => return Err("Unsupported workspace action".into()),
        }
        Ok(json!({ "attempted": true, "verified": false }))
    })
    .await
}

/// Control of the Misty window ended or paused.
pub fn release() {
    if let Ok(mut target) = TARGET.lock() {
        *target = None;
    }
}
