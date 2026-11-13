//! What Misty reads from the X server through EWMH: where the pointer is and which window is in
//! front, with its frame, title and app. On a Wayland session this reaches XWayland only, so the
//! callers ask `super::wayland_session()` first.
use std::sync::{Mutex, OnceLock};

use x11rb::{
    connection::Connection,
    protocol::xproto::{Atom, AtomEnum, ConnectionExt, Window},
    rust_connection::RustConnection,
};

struct Server {
    connection: RustConnection,
    root: Window,
}

/// One connection for the process, opened on first use; `None` without an X server.
fn server() -> Option<&'static Mutex<Server>> {
    static SERVER: OnceLock<Option<Mutex<Server>>> = OnceLock::new();
    SERVER
        .get_or_init(|| {
            let (connection, screen) = x11rb::connect(None).ok()?;
            let root = connection.setup().roots.get(screen)?.root;
            Some(Mutex::new(Server { connection, root }))
        })
        .as_ref()
}

fn with<T>(work: impl FnOnce(&Server) -> Option<T>) -> Option<T> {
    let server = server()?.lock().ok()?;
    work(&server)
}

impl Server {
    fn atom(&self, name: &[u8]) -> Option<Atom> {
        Some(
            self.connection
                .intern_atom(false, name)
                .ok()?
                .reply()
                .ok()?
                .atom,
        )
    }

    fn property(
        &self,
        window: Window,
        name: &[u8],
        kind: impl Into<Atom>,
        length: u32,
    ) -> Option<Vec<u8>> {
        let property = self.atom(name)?;
        let reply = self
            .connection
            .get_property(false, window, property, kind, 0, length)
            .ok()?
            .reply()
            .ok()?;
        (reply.value_len > 0).then_some(reply.value)
    }

    fn cardinal(&self, window: Window, name: &[u8], kind: impl Into<Atom>) -> Option<u32> {
        let value = self.property(window, name, kind, 1)?;
        Some(u32::from_ne_bytes(value.get(..4)?.try_into().ok()?))
    }

    fn active(&self) -> Option<Window> {
        self.cardinal(self.root, b"_NET_ACTIVE_WINDOW", AtomEnum::WINDOW)
            .filter(|&window| window != 0)
    }

    fn title(&self, window: Window) -> String {
        let utf8 = self.atom(b"UTF8_STRING");
        utf8.and_then(|utf8| self.property(window, b"_NET_WM_NAME", utf8, 1024))
            .or_else(|| self.property(window, b"WM_NAME", AtomEnum::STRING, 1024))
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            .unwrap_or_default()
    }

    /// The class part of WM_CLASS ("instance\0Class\0"), which names the app.
    fn app(&self, window: Window) -> String {
        self.property(window, b"WM_CLASS", AtomEnum::STRING, 256)
            .map(|bytes| {
                let mut parts = bytes
                    .split(|&byte| byte == 0)
                    .filter(|part| !part.is_empty());
                let instance = parts.next().unwrap_or_default();
                let class = parts.next().unwrap_or(instance);
                String::from_utf8_lossy(class).into_owned()
            })
            .unwrap_or_default()
    }

    /// The window's frame on the root window, its decorations included.
    fn frame(&self, window: Window) -> Option<(f64, f64, f64, f64)> {
        let geometry = self.connection.get_geometry(window).ok()?.reply().ok()?;
        let origin = self
            .connection
            .translate_coordinates(window, self.root, 0, 0)
            .ok()?
            .reply()
            .ok()?;
        let extents = self
            .property(window, b"_NET_FRAME_EXTENTS", AtomEnum::CARDINAL, 4)
            .filter(|value| value.len() >= 16)
            .map(|value| {
                let side = |index: usize| {
                    f64::from(u32::from_ne_bytes(
                        value[index * 4..index * 4 + 4]
                            .try_into()
                            .unwrap_or_default(),
                    ))
                };
                (side(0), side(1), side(2), side(3))
            })
            .unwrap_or_default();
        Some((
            f64::from(origin.dst_x) - extents.0,
            f64::from(origin.dst_y) - extents.2,
            f64::from(geometry.width) + extents.0 + extents.1,
            f64::from(geometry.height) + extents.2 + extents.3,
        ))
    }
}

/// The pointer on the root window, in X pixels.
pub(crate) fn pointer() -> Option<(f64, f64)> {
    with(|server| {
        let reply = server
            .connection
            .query_pointer(server.root)
            .ok()?
            .reply()
            .ok()?;
        Some((f64::from(reply.root_x), f64::from(reply.root_y)))
    })
}

/// The window in front, as EWMH window managers report it.
#[derive(Clone, Debug)]
pub(crate) struct ActiveWindow {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub title: String,
    pub app: String,
}

pub(crate) fn active_window() -> Option<ActiveWindow> {
    with(|server| {
        let id = server.active()?;
        let (x, y, width, height) = server.frame(id)?;
        Some(ActiveWindow {
            id,
            x,
            y,
            width,
            height,
            title: server.title(id),
            app: server.app(id),
        })
    })
}

/// Whether the key with this keysym is held, read from the server's key map.
pub(crate) fn key_down(keysym: u32) -> bool {
    with(|server| {
        let setup = server.connection.setup();
        let (first, last) = (setup.min_keycode, setup.max_keycode);
        let mapping = server
            .connection
            .get_keyboard_mapping(first, last - first + 1)
            .ok()?
            .reply()
            .ok()?;
        let per = usize::from(mapping.keysyms_per_keycode.max(1));
        let codes: Vec<u8> = mapping
            .keysyms
            .chunks(per)
            .enumerate()
            .filter(|(_, symbols)| symbols.contains(&keysym))
            .map(|(index, _)| first + index as u8)
            .collect();
        let keys = server.connection.query_keymap().ok()?.reply().ok()?.keys;
        Some(codes.iter().any(|&code| {
            keys.get(usize::from(code / 8))
                .is_some_and(|byte| byte & (1 << (code % 8)) != 0)
        }))
    })
    .unwrap_or(false)
}
