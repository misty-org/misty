//! What dictation needs from the X server on Linux: which keys are held, where the pointer is, which
//! window is in front, and a paste keystroke. On Wayland this reaches XWayland, so it sees and
//! types into X11 apps only.
use crate::voice::hold_to_talk::Modifiers;
use x11rb::{
    connection::Connection as _,
    protocol::{
        xproto::{self, AtomEnum, ConnectionExt as _, Keycode, Window},
        xtest::ConnectionExt as _,
    },
    rust_connection::RustConnection,
};

const XK_SHIFT_L: u32 = 0xffe1;
const XK_SHIFT_R: u32 = 0xffe2;
const XK_CONTROL_L: u32 = 0xffe3;
const XK_CONTROL_R: u32 = 0xffe4;
const XK_META_L: u32 = 0xffe7;
const XK_META_R: u32 = 0xffe8;
const XK_ALT_L: u32 = 0xffe9;
const XK_ALT_R: u32 = 0xffea;
const XK_SUPER_L: u32 = 0xffeb;
const XK_SUPER_R: u32 = 0xffec;
/// AltGr, which most layouts put on the right Alt key.
const XK_ISO_LEVEL3_SHIFT: u32 = 0xfe03;
const XK_V: u32 = 0x0076;

/// One connection to the display, with its keyboard map.
pub(crate) struct Display {
    connection: RustConnection,
    root: Window,
    /// Every keycode with the keysyms it carries.
    keys: Vec<(Keycode, Vec<u32>)>,
}

impl Display {
    pub(crate) fn open() -> Option<Self> {
        let (connection, screen) = x11rb::connect(None).ok()?;
        let setup = connection.setup();
        let root = setup.roots.get(screen)?.root;
        let (first, last) = (setup.min_keycode, setup.max_keycode);
        let mapping = connection
            .get_keyboard_mapping(first, last - first + 1)
            .ok()?
            .reply()
            .ok()?;
        let per = usize::from(mapping.keysyms_per_keycode.max(1));
        let keys = mapping
            .keysyms
            .chunks(per)
            .enumerate()
            .map(|(offset, syms)| (first + offset as u8, syms.to_vec()))
            .collect();
        Some(Self {
            connection,
            root,
            keys,
        })
    }

    /// The keycodes that carry any of `keysyms`.
    fn codes(&self, keysyms: &[u32]) -> Vec<Keycode> {
        self.keys
            .iter()
            .filter(|(_, syms)| syms.iter().any(|sym| keysyms.contains(sym)))
            .map(|(code, _)| *code)
            .collect()
    }

    pub(crate) fn modifier_codes(&self) -> ModifierCodes {
        ModifierCodes {
            left_control: self.codes(&[XK_CONTROL_L]),
            right_control: self.codes(&[XK_CONTROL_R]),
            left_option: self.codes(&[XK_ALT_L, XK_META_L]),
            right_option: self.codes(&[XK_ALT_R, XK_META_R, XK_ISO_LEVEL3_SHIFT]),
            left_command: self.codes(&[XK_SUPER_L]),
            right_command: self.codes(&[XK_SUPER_R]),
            shift: self.codes(&[XK_SHIFT_L, XK_SHIFT_R]),
        }
    }

    /// The held modifiers, from the server's view of the whole keyboard. Nothing is grabbed.
    pub(crate) fn modifiers(&self, codes: &ModifierCodes) -> Option<Modifiers> {
        let keymap = self.connection.query_keymap().ok()?.reply().ok()?.keys;
        let down = |list: &[Keycode]| {
            list.iter()
                .any(|code| keymap[usize::from(*code / 8)] & (1 << (*code % 8)) != 0)
        };
        Some(Modifiers {
            left_control: down(&codes.left_control),
            right_control: down(&codes.right_control),
            left_option: down(&codes.left_option),
            right_option: down(&codes.right_option),
            left_command: down(&codes.left_command),
            right_command: down(&codes.right_command),
            shift: down(&codes.shift),
            function: false,
        })
    }

    /// The pointer, in screen pixels.
    pub(crate) fn pointer(&self) -> Option<(i32, i32)> {
        self.pointer_and_button().map(|(x, y, _)| (x, y))
    }

    /// The pointer, and whether the primary button is down.
    pub(crate) fn pointer_and_button(&self) -> Option<(i32, i32, bool)> {
        let reply = self
            .connection
            .query_pointer(self.root)
            .ok()?
            .reply()
            .ok()?;
        Some((
            i32::from(reply.root_x),
            i32::from(reply.root_y),
            reply.mask.contains(xproto::KeyButMask::BUTTON1),
        ))
    }

    fn atom(&self, name: &[u8]) -> Option<u32> {
        Some(
            self.connection
                .intern_atom(false, name)
                .ok()?
                .reply()
                .ok()?
                .atom,
        )
    }

    fn property32(&self, window: Window, name: &[u8], kind: impl Into<u32>) -> Option<u32> {
        let atom = self.atom(name)?;
        let reply = self
            .connection
            .get_property(false, window, atom, kind, 0, 1)
            .ok()?
            .reply()
            .ok()?;
        let value = reply.value32()?.next();
        value
    }

    fn active_window(&self) -> Option<Window> {
        self.property32(self.root, b"_NET_ACTIVE_WINDOW", AtomEnum::WINDOW)
            .filter(|window| *window != 0)
    }

    /// The process that owns the window in front, as the window manager reports it.
    pub(crate) fn active_pid(&self) -> Option<u32> {
        self.property32(self.active_window()?, b"_NET_WM_PID", AtomEnum::CARDINAL)
    }

    /// The front window's class (`org.gnome.Terminal`, `kitty`, …), lower-cased.
    pub(crate) fn active_class(&self) -> Option<String> {
        let reply = self
            .connection
            .get_property(
                false,
                self.active_window()?,
                AtomEnum::WM_CLASS,
                AtomEnum::STRING,
                0,
                256,
            )
            .ok()?
            .reply()
            .ok()?;
        // "instance\0class\0": the class is the second name.
        let names: Vec<&[u8]> = reply.value.split(|byte| *byte == 0).collect();
        let class = names.get(1).or(names.first())?;
        let class = String::from_utf8_lossy(class).trim().to_ascii_lowercase();
        (!class.is_empty()).then_some(class)
    }

    /// Presses Control (and Shift when `shift`) with V through XTEST.
    pub(crate) fn paste(&self, shift: bool) -> Result<(), String> {
        let first = |sym: u32| self.codes(&[sym]).first().copied();
        let failed = || "Paste couldn't be sent.".to_owned();
        let control = first(XK_CONTROL_L).ok_or_else(failed)?;
        let v = first(XK_V).ok_or_else(failed)?;
        let mut held = vec![control];
        if shift {
            held.push(first(XK_SHIFT_L).ok_or_else(failed)?);
        }
        let send = |kind: u8, code: Keycode| {
            self.connection
                .xtest_fake_input(kind, code, x11rb::CURRENT_TIME, self.root, 0, 0, 0)
                .map(|_| ())
                .map_err(|_| failed())
        };
        for code in &held {
            send(xproto::KEY_PRESS_EVENT, *code)?;
        }
        send(xproto::KEY_PRESS_EVENT, v)?;
        send(xproto::KEY_RELEASE_EVENT, v)?;
        for code in held.iter().rev() {
            send(xproto::KEY_RELEASE_EVENT, *code)?;
        }
        self.connection.flush().map_err(|_| failed())
    }
}

/// The keycodes behind each modifier on this keyboard.
pub(crate) struct ModifierCodes {
    left_control: Vec<Keycode>,
    right_control: Vec<Keycode>,
    left_option: Vec<Keycode>,
    right_option: Vec<Keycode>,
    left_command: Vec<Keycode>,
    right_command: Vec<Keycode>,
    shift: Vec<Keycode>,
}

/// The held modifiers right now, or none when there is no X display.
pub(crate) fn current_modifiers() -> Modifiers {
    Display::open()
        .and_then(|display| display.modifiers(&display.modifier_codes()))
        .unwrap_or_default()
}
