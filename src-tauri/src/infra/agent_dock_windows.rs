//! The agent dock on Windows, the counterpart of `MistyAgentDock.m`
//! (docs/design/agents-at-cursor/BRIEF.md, "Taking over the app").
//!
//! A docked agent window keeps the size its page was laid out for and keeps
//! painting: it moves just off the desktop and out of the taskbar, and a live
//! DWM thumbnail of it shows in the dock stack, a small window owned by
//! Misty's window that sits in its bottom-right corner and follows it. The
//! stack's page draws each card's caption and Stop around the thumbnail.
//! Opening a card puts the window back where it was.
use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use windows_sys::Win32::{
    Foundation::RECT,
    Graphics::Dwm::{
        DwmRegisterThumbnail, DwmUnregisterThumbnail, DwmUpdateThumbnailProperties,
        DWM_THUMBNAIL_PROPERTIES, DWM_TNP_RECTDESTINATION, DWM_TNP_SOURCECLIENTAREAONLY,
        DWM_TNP_VISIBLE,
    },
    UI::WindowsAndMessaging::{
        GetSystemMetrics, SetWindowLongPtrW, GWLP_HWNDPARENT, SM_XVIRTUALSCREEN,
    },
};

pub const STACK: &str = "misty-dock-stack";
/// A card's thumbnail width and the room for its caption, in CSS pixels.
const CARD_WIDTH: f64 = 240.0;
const CAPTION: f64 = 46.0;
const GAP: f64 = 10.0;
const MARGIN: f64 = 16.0;
/// Cards the stack shows at once; the carousel shows them all.
const STACKED: usize = 3;

struct Entry {
    id: String,
    name: String,
    status: String,
    waiting: bool,
    /// Where the window was, to put it back: physical position and size.
    restore: (i32, i32, u32, u32),
    thumbnail: isize,
}

#[derive(Default)]
struct Dock {
    /// Front of the stack first.
    entries: Vec<Entry>,
    carousel: bool,
    following: bool,
}

static DOCK: Mutex<Dock> = Mutex::new(Dock {
    entries: Vec::new(),
    carousel: false,
    following: false,
});

fn with<T>(work: impl FnOnce(&mut Dock) -> T) -> T {
    work(&mut DOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner()))
}

fn hwnd(window: &WebviewWindow) -> Option<isize> {
    window.hwnd().ok().map(|handle| handle.0 as isize)
}

fn stack(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(STACK) {
        return Ok(window);
    }
    let window = WebviewWindowBuilder::new(app, STACK, WebviewUrl::App("desktop.html".into()))
        .title("Misty agents")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;
    // Owned by Misty's window: above it, minimized and closed with it.
    if let (Some(stack), Some(main)) = (
        hwnd(&window),
        crate::infra::space_windows::primary(app).and_then(|main| main.hwnd().ok().map(|handle| handle.0 as isize)),
    ) {
        // SAFETY: both are live windows of this process.
        unsafe { SetWindowLongPtrW(stack as _, GWLP_HWNDPARENT, main) };
    }
    Ok(window)
}

/// Keeps the stack in Misty's window corner as it moves and resizes.
fn follow_main(app: &AppHandle) {
    if with(|dock| std::mem::replace(&mut dock.following, true)) {
        return;
    }
    let Some(main) = crate::infra::space_windows::primary(app) else {
        return;
    };
    let app = app.clone();
    main.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::Moved(_)
                | tauri::WindowEvent::Resized(_)
                | tauri::WindowEvent::ScaleFactorChanged { .. }
        ) {
            layout(&app);
        }
    });
}

/// Docks a window, or brings it to the front of the stack if it already is.
pub fn add(app: &AppHandle, label: &str, name: &str) -> Result<(), String> {
    let window = app
        .get_webview_window(label)
        .ok_or("The agent window closed.")?;
    let already = with(|dock| {
        let index = dock.entries.iter().position(|entry| entry.id == label)?;
        let entry = dock.entries.remove(index);
        dock.entries.insert(0, entry);
        Some(())
    });
    if already.is_none() {
        let position = window.outer_position().map_err(|e| e.to_string())?;
        let size = window.outer_size().map_err(|e| e.to_string())?;
        // Just off the desktop, still painting at its laid-out size.
        // SAFETY: plain metrics queries.
        let left = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) - size.width as i32 - 64 };
        let _ = window.set_skip_taskbar(true);
        let _ = window.set_position(tauri::PhysicalPosition::new(left, position.y));
        let _ = window.show();
        with(|dock| {
            dock.entries.insert(
                0,
                Entry {
                    id: label.to_owned(),
                    name: name.to_owned(),
                    status: String::new(),
                    waiting: false,
                    restore: (position.x, position.y, size.width, size.height),
                    thumbnail: 0,
                },
            )
        });
    }
    follow_main(app);
    layout(app);
    super::agent_dock::route(app, json!({ "action": "docked", "id": label }));
    Ok(())
}

/// Puts a docked window back where it was, in front.
pub fn open(app: &AppHandle, label: &str) {
    let Some(entry) = remove(label) else {
        return;
    };
    if let Some(window) = app.get_webview_window(label) {
        let (x, y, width, height) = entry.restore;
        let _ = window.set_size(tauri::PhysicalSize::new(width, height));
        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        let _ = window.set_skip_taskbar(false);
        let _ = window.show();
        let _ = window.set_focus();
    }
    layout(app);
    super::agent_dock::route(app, json!({ "action": "opened", "id": label }));
}

fn remove(label: &str) -> Option<Entry> {
    let entry = with(|dock| {
        let index = dock.entries.iter().position(|entry| entry.id == label)?;
        Some(dock.entries.remove(index))
    })?;
    if entry.thumbnail != 0 {
        // SAFETY: a thumbnail this module registered.
        unsafe { DwmUnregisterThumbnail(entry.thumbnail) };
    }
    Some(entry)
}

pub fn is_docked(label: &str) -> bool {
    with(|dock| dock.entries.iter().any(|entry| entry.id == label))
}

/// The window is going away; the dock drops it and closes the gap.
pub fn forget(app: &AppHandle, label: &str) {
    if remove(label).is_some() {
        layout(app);
    }
}

pub fn status(app: &AppHandle, label: &str, status: &str, waiting: bool) {
    let changed = with(|dock| {
        dock.entries
            .iter_mut()
            .find(|entry| entry.id == label)
            .map(|entry| {
                entry.status = status.to_owned();
                entry.waiting = waiting;
            })
    });
    if changed.is_some() {
        layout(app);
    }
}

/// Fans the stack out across Misty's window, or folds it back.
pub fn carousel(app: &AppHandle, show: bool) {
    with(|dock| dock.carousel = show);
    layout(app);
}

/// Each docked window's visibility and layout size, for checking the dock.
pub fn visibility(app: &AppHandle) -> Value {
    let ids: Vec<String> = with(|dock| dock.entries.iter().map(|entry| entry.id.clone()).collect());
    Value::Array(
        ids.into_iter()
            .filter_map(|id| {
                let window = app.get_webview_window(&id)?;
                let size = window.inner_size().ok()?;
                Some(json!({
                    "id": id,
                    "visible": window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(true),
                    "width": size.width,
                    "height": size.height,
                }))
            })
            .collect(),
    )
}

/// Places the stack in Misty's window and every card's thumbnail in it, and
/// tells the stack's page where the cards are.
fn layout(app: &AppHandle) {
    let Some(main) = crate::infra::space_windows::primary(app) else {
        return;
    };
    let Ok(stack) = stack(app) else {
        return;
    };
    let (Ok(origin), Ok(area), Ok(scale)) = (
        main.inner_position(),
        main.inner_size(),
        main.scale_factor(),
    ) else {
        return;
    };
    let stack_hwnd = hwnd(&stack).unwrap_or(0);
    let carousel = with(|dock| dock.carousel);
    let mut cards = Vec::new();
    let (mut width, mut height) = (0.0f64, 0.0f64);
    with(|dock| {
        let shown = if carousel {
            dock.entries.len()
        } else {
            dock.entries.len().min(STACKED)
        };
        for (index, entry) in dock.entries.iter_mut().enumerate() {
            let visible = index < shown;
            let aspect =
                (f64::from(entry.restore.3) / f64::from(entry.restore.2.max(1))).clamp(0.4, 1.2);
            let (card_width, thumb_height) = (CARD_WIDTH, (CARD_WIDTH * aspect).round());
            // The carousel lines cards up side by side; the stack piles them.
            let (x, y) = if carousel {
                (index as f64 * (card_width + GAP), 0.0)
            } else {
                (0.0, index as f64 * (thumb_height + CAPTION + GAP))
            };
            if visible {
                width = width.max(x + card_width);
                height = height.max(y + thumb_height + CAPTION);
            }
            sync_thumbnail(
                app,
                entry,
                stack_hwnd,
                visible,
                (x, y, card_width, thumb_height),
                scale,
            );
            if visible {
                cards.push(json!({
                    "id": entry.id, "name": entry.name, "status": entry.status, "waiting": entry.waiting,
                    "x": x, "y": y, "width": card_width, "height": thumb_height,
                }));
            }
        }
    });
    if cards.is_empty() {
        let _ = stack.hide();
        return;
    }
    let (physical_width, physical_height) = (
        (width * scale).round() as i32,
        (height * scale).round() as i32,
    );
    let margin = (MARGIN * scale).round() as i32;
    let x = if carousel {
        origin.x + (area.width as i32 - physical_width) / 2
    } else {
        origin.x + area.width as i32 - physical_width - margin
    };
    let _ = stack.set_size(tauri::PhysicalSize::new(
        physical_width.max(1) as u32,
        physical_height.max(1) as u32,
    ));
    let _ = stack.set_position(tauri::PhysicalPosition::new(
        x,
        origin.y + area.height as i32 - physical_height - margin,
    ));
    let _ = stack.show();
    let _ = stack.emit_to(
        STACK,
        "misty://dock-stack",
        json!({ "cards": cards, "carousel": carousel }),
    );
}

fn sync_thumbnail(
    app: &AppHandle,
    entry: &mut Entry,
    stack: isize,
    visible: bool,
    rect: (f64, f64, f64, f64),
    scale: f64,
) {
    if entry.thumbnail == 0 && visible && stack != 0 {
        let Some(source) = app.get_webview_window(&entry.id).as_ref().and_then(hwnd) else {
            return;
        };
        let mut handle = 0isize;
        // SAFETY: two live windows of this process; the handle is freed on remove.
        if unsafe { DwmRegisterThumbnail(stack as _, source as _, &mut handle) } >= 0 {
            entry.thumbnail = handle;
        }
    }
    if entry.thumbnail == 0 {
        return;
    }
    let physical = |value: f64| (value * scale).round() as i32;
    let properties = DWM_THUMBNAIL_PROPERTIES {
        dwFlags: DWM_TNP_RECTDESTINATION | DWM_TNP_VISIBLE | DWM_TNP_SOURCECLIENTAREAONLY,
        rcDestination: RECT {
            left: physical(rect.0),
            top: physical(rect.1),
            right: physical(rect.0 + rect.2),
            bottom: physical(rect.1 + rect.3),
        },
        rcSource: RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        },
        opacity: 255,
        fVisible: i32::from(visible),
        fSourceClientAreaOnly: 1,
    };
    // SAFETY: a thumbnail this module registered and a filled-in structure.
    unsafe { DwmUpdateThumbnailProperties(entry.thumbnail, &properties) };
}

/// A press on a card in the stack: open the window, or stop its task.
#[tauri::command]
pub fn agent_dock_card(
    webview: tauri::Webview,
    app: AppHandle,
    action: String,
    id: String,
) -> Result<(), String> {
    if webview.label() != STACK {
        return Err("Only the dock stack can press here.".into());
    }
    if !is_docked(&id) {
        return Err("That agent window is no longer docked.".into());
    }
    match action.as_str() {
        "open" => {
            open(&app, &id);
            Ok(())
        }
        "stop" => {
            super::agent_dock::route(&app, json!({ "action": "stop", "id": id }));
            Ok(())
        }
        "carousel" => {
            let showing = with(|dock| dock.carousel);
            carousel(&app, !showing);
            Ok(())
        }
        _ => Err("Unknown dock action.".into()),
    }
}
