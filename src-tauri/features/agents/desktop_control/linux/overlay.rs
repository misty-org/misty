//! Misty's overlay windows on Linux (the cursor companion's displays and the computer-use cursor):
//! transparent, never focused, click-through and above every other window.
//!
//! - X11 (and XWayland): an override-redirect window, which the window manager neither frames
//!   nor stacks, raised again on every show, with an empty input shape so clicks pass through.
//! - Wayland: a wlr-layer-shell surface on the overlay layer, through gtk-layer-shell when the
//!   library is installed and the compositor offers the protocol (KDE, Sway, Hyprland and other
//!   wlroots compositors). GNOME has no such protocol for apps; there the overlay is an ordinary
//!   undecorated, unfocusable, click-through window, which the compositor places and stacks.
//!
//! Every function here runs on the GTK thread.
use std::{ffi::c_void, sync::OnceLock};

use gtk::{gdk, glib::translate::ToGlibPtr, prelude::*};

/// Whether the person's session is Wayland, whatever backend Misty's own windows use: global
/// input and capture go through the compositor there.
pub(crate) fn wayland_session() -> bool {
    std::env::var("XDG_SESSION_TYPE").is_ok_and(|kind| kind.eq_ignore_ascii_case("wayland"))
        || std::env::var_os("WAYLAND_DISPLAY").is_some()
}

fn on_wayland(display: &gdk::Display) -> bool {
    display.type_().name().contains("Wayland")
}

/// gtk-layer-shell's entry points, loaded at run time so Misty starts without it.
struct LayerShell {
    _library: libloading::Library,
    is_supported: Option<unsafe extern "C" fn() -> i32>,
    init_for_window: unsafe extern "C" fn(*mut c_void),
    is_layer_window: unsafe extern "C" fn(*mut c_void) -> i32,
    set_layer: unsafe extern "C" fn(*mut c_void, i32),
    set_anchor: unsafe extern "C" fn(*mut c_void, i32, i32),
    set_margin: unsafe extern "C" fn(*mut c_void, i32, i32),
    set_exclusive_zone: unsafe extern "C" fn(*mut c_void, i32),
    set_keyboard_mode: Option<unsafe extern "C" fn(*mut c_void, i32)>,
    set_keyboard_interactivity: Option<unsafe extern "C" fn(*mut c_void, i32)>,
    set_monitor: unsafe extern "C" fn(*mut c_void, *mut c_void),
    set_namespace: unsafe extern "C" fn(*mut c_void, *const std::ffi::c_char),
}

// SAFETY: the functions are only called on the GTK thread; the table itself is immutable.
unsafe impl Send for LayerShell {}
unsafe impl Sync for LayerShell {}

const LIBRARY: &str = "libgtk-layer-shell.so.0";
const LAYER_OVERLAY: i32 = 3;
const EDGE_LEFT: i32 = 0;
const EDGE_RIGHT: i32 = 1;
const EDGE_TOP: i32 = 2;
const EDGE_BOTTOM: i32 = 3;
const KEYBOARD_NONE: i32 = 0;

fn layer_shell() -> Option<&'static LayerShell> {
    static SHELL: OnceLock<Option<LayerShell>> = OnceLock::new();
    SHELL
        .get_or_init(|| {
            // SAFETY: loading a GTK3 library into a GTK3 process; symbols are typed to its C API.
            unsafe {
                // From 0.9 the library has to be in the process before libwayland-client, which
                // a library opened now can't be; it works only when the session preloads it.
                let preloaded = libloading::os::unix::Library::open(
                    Some(LIBRARY),
                    libloading::os::unix::RTLD_NOW | 0x4, /* RTLD_NOLOAD */
                )
                .is_ok();
                let library = libloading::Library::new(LIBRARY).ok()?;
                let version = |name: &[u8]| {
                    library
                        .get::<unsafe extern "C" fn() -> u32>(name)
                        .ok()
                        .map(|get| get())
                };
                let (major, minor) = (
                    version(b"gtk_layer_get_major_version\0").unwrap_or(0),
                    version(b"gtk_layer_get_minor_version\0").unwrap_or(0),
                );
                if (major, minor) >= (0, 9) && !preloaded {
                    eprintln!("[overlay] gtk-layer-shell {major}.{minor} must be preloaded (LD_PRELOAD={LIBRARY}) to keep overlays above windows on Wayland");
                    return None;
                }
                macro_rules! symbol {
                    ($name:literal) => {{
                        let symbol = library.get(concat!($name, "\0").as_bytes()).ok()?;
                        *symbol
                    }};
                }
                macro_rules! optional {
                    ($name:literal) => {{
                        library
                            .get(concat!($name, "\0").as_bytes())
                            .ok()
                            .map(|symbol| *symbol)
                    }};
                }
                let is_supported = optional!("gtk_layer_is_supported");
                let init_for_window = symbol!("gtk_layer_init_for_window");
                let is_layer_window = symbol!("gtk_layer_is_layer_window");
                let set_layer = symbol!("gtk_layer_set_layer");
                let set_anchor = symbol!("gtk_layer_set_anchor");
                let set_margin = symbol!("gtk_layer_set_margin");
                let set_exclusive_zone = symbol!("gtk_layer_set_exclusive_zone");
                let set_keyboard_mode = optional!("gtk_layer_set_keyboard_mode");
                let set_keyboard_interactivity = optional!("gtk_layer_set_keyboard_interactivity");
                let set_monitor = symbol!("gtk_layer_set_monitor");
                let set_namespace = symbol!("gtk_layer_set_namespace");
                Some(LayerShell {
                    _library: library,
                    is_supported,
                    init_for_window,
                    is_layer_window,
                    set_layer,
                    set_anchor,
                    set_margin,
                    set_exclusive_zone,
                    set_keyboard_mode,
                    set_keyboard_interactivity,
                    set_monitor,
                    set_namespace,
                })
            }
        })
        .as_ref()
        .filter(|shell| {
            // SAFETY: a plain query.
            shell.is_supported.is_none_or(|supported| unsafe { supported() } != 0)
        })
}

fn raw(window: &gtk::ApplicationWindow) -> *mut c_void {
    let pointer: *mut gtk::ffi::GtkWindow = window.upcast_ref::<gtk::Window>().to_glib_none().0;
    pointer.cast()
}

fn layered(window: &gtk::ApplicationWindow) -> Option<&'static LayerShell> {
    let shell = layer_shell()?;
    // SAFETY: a live GtkWindow on the GTK thread.
    (unsafe { (shell.is_layer_window)(raw(window)) } != 0).then_some(shell)
}

/// Marks a window already made an overlay.
const PREPARED: &str = "misty-overlay";

/// Makes `window` an overlay, once; later calls do nothing. Call it while the window is hidden.
pub(crate) fn prepare(window: &tauri::WebviewWindow) -> Result<(), String> {
    let gtk_window = window.gtk_window().map_err(|error| error.to_string())?;
    // SAFETY: the key only ever holds `bool`.
    if unsafe { gtk_window.data::<bool>(PREPARED) }.is_some() {
        return Ok(());
    }
    unsafe { gtk_window.set_data(PREPARED, true) };
    gtk_window.set_accept_focus(false);
    gtk_window.set_focus_on_map(false);
    gtk_window.set_skip_taskbar_hint(true);
    gtk_window.set_skip_pager_hint(true);
    gtk_window.set_keep_above(true);
    gtk_window.set_decorated(false);
    gtk_window.set_type_hint(gdk::WindowTypeHint::Notification);
    let display = gtk::prelude::WidgetExt::display(&gtk_window);
    if on_wayland(&display) {
        if let Some(shell) = layer_shell() {
            // A layer surface has to be set up before GTK makes the window's Wayland surface.
            if gtk_window.is_realized() {
                gtk_window.hide();
                gtk_window.unrealize();
            }
            let window = raw(&gtk_window);
            // SAFETY: calls into gtk-layer-shell with a live, unrealized GtkWindow.
            unsafe {
                (shell.init_for_window)(window);
                (shell.set_namespace)(window, c"misty-overlay".as_ptr());
                (shell.set_layer)(window, LAYER_OVERLAY);
                (shell.set_exclusive_zone)(window, -1);
                if let Some(mode) = shell.set_keyboard_mode {
                    mode(window, KEYBOARD_NONE);
                } else if let Some(interactive) = shell.set_keyboard_interactivity {
                    interactive(window, 0);
                }
            }
        }
    }
    gtk_window.realize();
    let gdk_window = gtk_window
        .window()
        .ok_or("The overlay has no native window.")?;
    if !on_wayland(&display) {
        // Unmanaged: no frame, no focus, no taskbar entry, and stacked by Misty itself.
        gdk_window.set_override_redirect(true);
    }
    pass_clicks_through(&gtk_window);
    Ok(())
}

/// An empty input shape: every click lands on what is under the overlay.
fn pass_clicks_through(window: &gtk::ApplicationWindow) {
    if let Some(gdk_window) = window.window() {
        let empty = gtk::cairo::Region::create();
        gdk_window.input_shape_combine_region(&empty, 0, 0);
    }
}

/// The GDK monitor holding a point in logical coordinates.
fn monitor_at(display: &gdk::Display, x: i32, y: i32) -> Option<gdk::Monitor> {
    display
        .monitor_at_point(x, y)
        .or_else(|| display.primary_monitor())
}

/// Places the overlay over a rectangle in GTK's logical coordinates.
pub(crate) fn place(window: &tauri::WebviewWindow, x: f64, y: f64, width: f64, height: f64) {
    let Ok(gtk_window) = window.gtk_window() else {
        return;
    };
    let (x, y) = (x.round() as i32, y.round() as i32);
    let (width, height) = (
        (width.round() as i32).max(1),
        (height.round() as i32).max(1),
    );
    if let Some(shell) = layered(&gtk_window) {
        let display = gtk::prelude::WidgetExt::display(&gtk_window);
        let Some(monitor) = monitor_at(&display, x, y) else {
            return;
        };
        let area = monitor.geometry();
        let target = raw(&gtk_window);
        let monitor: *mut gdk::ffi::GdkMonitor = monitor.to_glib_none().0;
        // SAFETY: calls into gtk-layer-shell with a live layer window on the GTK thread.
        unsafe {
            (shell.set_monitor)(target, monitor.cast());
            (shell.set_anchor)(target, EDGE_LEFT, 1);
            (shell.set_anchor)(target, EDGE_TOP, 1);
            (shell.set_anchor)(target, EDGE_RIGHT, 0);
            (shell.set_anchor)(target, EDGE_BOTTOM, 0);
            (shell.set_margin)(target, EDGE_LEFT, x - area.x());
            (shell.set_margin)(target, EDGE_TOP, y - area.y());
        }
        gtk_window.resize(width, height);
        return;
    }
    gtk_window.resize(width, height);
    gtk_window.move_(x, y);
    if let Some(gdk_window) = gtk_window.window() {
        gdk_window.move_resize(x, y, width, height);
    }
}

/// Moves the overlay's top-left corner, keeping its size.
pub(crate) fn move_to(window: &tauri::WebviewWindow, x: f64, y: f64) {
    let Ok(gtk_window) = window.gtk_window() else {
        return;
    };
    let (width, height) = gtk_window.size();
    place(window, x, y, f64::from(width), f64::from(height));
}

/// Shows the overlay above every other window without taking focus.
pub(crate) fn show(window: &tauri::WebviewWindow) {
    let Ok(gtk_window) = window.gtk_window() else {
        let _ = window.show();
        return;
    };
    gtk_window.show_all();
    // A mapped window can get a fresh input region; keep it click-through.
    pass_clicks_through(&gtk_window);
    if let Some(gdk_window) = gtk_window.window() {
        gdk_window.raise();
    }
}

/// GTK's scale for the display: X and Wayland report physical pixels, GTK places in logical ones.
pub(crate) fn scale(window: &tauri::WebviewWindow) -> f64 {
    window
        .gtk_window()
        .ok()
        .map(|gtk_window| f64::from(gtk_window.scale_factor().max(1)))
        .unwrap_or(1.0)
}
