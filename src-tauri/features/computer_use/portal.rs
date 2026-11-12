//! Computer use on a Wayland session. Wayland gives no app the global pointer or keyboard, so
//! input goes through the XDG desktop RemoteDesktop portal, in one session per Misty run that
//! the person approves in the compositor's own prompt. The session also selects the displays
//! as ScreenCast streams, which is what lets the portal place the pointer at a point; the
//! frames themselves come from xcap's capture, which uses the Screenshot portal there.
//! The person ends the session at any time from the compositor's sharing indicator.
use std::sync::{Mutex, MutexGuard};

use ashpd::desktop::{
    remote_desktop::{Axis, DeviceType, KeyState, RemoteDesktop, SelectDevicesOptions},
    screencast::{CursorMode, Screencast, SelectSourcesOptions, SourceType},
    PersistMode, Session,
};
use enigo::Key;

struct Area {
    node: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

struct Remote {
    proxy: RemoteDesktop,
    session: Session<RemoteDesktop>,
    displays: Vec<Area>,
}

static REMOTE: Mutex<Option<Remote>> = Mutex::new(None);
/// Lets the compositor skip its prompt while Misty runs, once the person allowed it.
static RESTORE: Mutex<Option<String>> = Mutex::new(None);

fn block<T>(work: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(work)
}

fn refused(error: impl std::fmt::Display) -> String {
    format!("The person didn't allow remote control in the system prompt, or the desktop portal isn't available ({error}). Ask them to allow it and try again.")
}

async fn start() -> Result<Remote, String> {
    let proxy = RemoteDesktop::new().await.map_err(refused)?;
    let screencast = Screencast::new().await.map_err(refused)?;
    let session = proxy
        .create_session(Default::default())
        .await
        .map_err(refused)?;
    let token = RESTORE.lock().ok().and_then(|token| token.clone());
    proxy
        .select_devices(
            &session,
            SelectDevicesOptions::default()
                .set_devices(DeviceType::Keyboard | DeviceType::Pointer)
                .set_persist_mode(PersistMode::Application)
                .set_restore_token(token.as_deref()),
        )
        .await
        .map_err(refused)?;
    screencast
        .select_sources(
            &session,
            SelectSourcesOptions::default()
                .set_cursor_mode(CursorMode::Hidden)
                .set_sources(ashpd::enumflags2::BitFlags::from(SourceType::Monitor))
                .set_multiple(true),
        )
        .await
        .map_err(refused)?;
    let selected = proxy
        .start(&session, None, Default::default())
        .await
        .map_err(refused)?
        .response()
        .map_err(refused)?;
    if !selected.devices().contains(DeviceType::Pointer) {
        return Err("The person didn't share the pointer in the system prompt.".into());
    }
    if let (Some(token), Ok(mut saved)) = (selected.restore_token(), RESTORE.lock()) {
        *saved = Some(token.to_owned());
    }
    let displays = selected
        .streams()
        .iter()
        .map(|stream| {
            let (x, y) = stream.position().unwrap_or((0, 0));
            let (width, height) = stream.size().unwrap_or((0, 0));
            Area {
                node: stream.pipe_wire_node_id(),
                x: f64::from(x),
                y: f64::from(y),
                width: f64::from(width),
                height: f64::from(height),
            }
        })
        .collect();
    Ok(Remote {
        proxy,
        session,
        displays,
    })
}

fn remote() -> Result<MutexGuard<'static, Option<Remote>>, String> {
    let mut remote = REMOTE
        .lock()
        .map_err(|_| "Remote control is unavailable.".to_owned())?;
    if remote.is_none() {
        *remote = Some(block(start())?);
    }
    Ok(remote)
}

/// Runs one portal call; a session the person ended is started again once, with a new prompt.
fn with<T>(
    call: impl Fn(&Remote) -> Result<T, ashpd::Error>,
) -> Result<T, String> {
    for attempt in 0..2 {
        let mut guard = remote()?;
        let Some(session) = guard.as_ref() else {
            continue;
        };
        match call(session) {
            Ok(value) => return Ok(value),
            Err(error) => {
                *guard = None;
                if attempt == 1 {
                    return Err(format!("Remote control stopped: {error}"));
                }
            }
        }
    }
    Err("Remote control stopped.".into())
}

/// Ends the portal session, as when computer use ends for every run.
pub(crate) fn end() {
    if let Some(remote) = REMOTE.lock().ok().and_then(|mut remote| remote.take()) {
        let _ = block(remote.session.close());
    }
}

/// Moves the pointer to a point in the compositor's logical coordinates.
pub(crate) fn move_to(x: f64, y: f64) -> Result<(), String> {
    with(|remote| {
        let area = remote
            .displays
            .iter()
            .find(|area| {
                x >= area.x && y >= area.y && x < area.x + area.width && y < area.y + area.height
            })
            .or(remote.displays.first());
        let Some(area) = area else {
            return block(remote.proxy.notify_pointer_motion(
                &remote.session,
                x,
                y,
                Default::default(),
            ));
        };
        block(remote.proxy.notify_pointer_motion_absolute(
            &remote.session,
            area.node,
            (x - area.x).max(0.0),
            (y - area.y).max(0.0),
            Default::default(),
        ))
    })
}

/// Linux input event codes for the buttons.
const BUTTON_LEFT: i32 = 0x110;
const BUTTON_RIGHT: i32 = 0x111;
const BUTTON_MIDDLE: i32 = 0x112;

pub(crate) fn button(button: enigo::Button, pressed: bool) -> Result<(), String> {
    let code = match button {
        enigo::Button::Right => BUTTON_RIGHT,
        enigo::Button::Middle => BUTTON_MIDDLE,
        _ => BUTTON_LEFT,
    };
    let state = if pressed {
        KeyState::Pressed
    } else {
        KeyState::Released
    };
    with(|remote| {
        block(
            remote
                .proxy
                .notify_pointer_button(&remote.session, code, state, Default::default()),
        )
    })
}

/// Scrolls by wheel steps; positive y scrolls the content down, positive x to the right.
pub(crate) fn scroll(steps_x: i32, steps_y: i32) -> Result<(), String> {
    with(|remote| {
        if steps_y != 0 {
            block(remote.proxy.notify_pointer_axis_discrete(
                &remote.session,
                Axis::Vertical,
                steps_y,
                Default::default(),
            ))?;
        }
        if steps_x != 0 {
            block(remote.proxy.notify_pointer_axis_discrete(
                &remote.session,
                Axis::Horizontal,
                steps_x,
                Default::default(),
            ))?;
        }
        Ok(())
    })
}

/// The X keysym for a key, which the compositor maps through the person's keyboard layout.
pub(crate) fn keysym(key: Key) -> Option<i32> {
    let symbol = match key {
        Key::Return => 0xff0d,
        Key::Tab => 0xff09,
        Key::Escape => 0xff1b,
        Key::Backspace => 0xff08,
        Key::Delete => 0xffff,
        Key::Space => 0x20,
        Key::UpArrow => 0xff52,
        Key::DownArrow => 0xff54,
        Key::LeftArrow => 0xff51,
        Key::RightArrow => 0xff53,
        Key::Home => 0xff50,
        Key::End => 0xff57,
        Key::PageUp => 0xff55,
        Key::PageDown => 0xff56,
        Key::CapsLock => 0xffe5,
        Key::Meta => 0xffeb,
        Key::Control => 0xffe3,
        Key::Alt => 0xffe9,
        Key::Shift => 0xffe1,
        Key::F1 => 0xffbe,
        Key::F2 => 0xffbf,
        Key::F3 => 0xffc0,
        Key::F4 => 0xffc1,
        Key::F5 => 0xffc2,
        Key::F6 => 0xffc3,
        Key::F7 => 0xffc4,
        Key::F8 => 0xffc5,
        Key::F9 => 0xffc6,
        Key::F10 => 0xffc7,
        Key::F11 => 0xffc8,
        Key::F12 => 0xffc9,
        Key::Unicode(character) => return Some(char_keysym(character)),
        _ => return None,
    };
    Some(symbol)
}

/// Latin-1 keysyms are their code points; the rest use the Unicode keysym range.
fn char_keysym(character: char) -> i32 {
    match character {
        '\n' | '\r' => 0xff0d,
        '\t' => 0xff09,
        ' '..='~' | '\u{a0}'..='\u{ff}' => character as i32,
        other => 0x0100_0000 | other as i32,
    }
}

pub(crate) fn key(key: Key, pressed: bool) -> Result<(), String> {
    let symbol = keysym(key).ok_or("That key can't be pressed on this desktop.")?;
    let state = if pressed {
        KeyState::Pressed
    } else {
        KeyState::Released
    };
    with(|remote| {
        block(
            remote
                .proxy
                .notify_keyboard_keysym(&remote.session, symbol, state, Default::default()),
        )
    })
}

pub(crate) fn text(text: &str) -> Result<(), String> {
    for character in text.chars() {
        let symbol = char_keysym(character);
        with(|remote| {
            block(remote.proxy.notify_keyboard_keysym(
                &remote.session,
                symbol,
                KeyState::Pressed,
                Default::default(),
            ))?;
            block(remote.proxy.notify_keyboard_keysym(
                &remote.session,
                symbol,
                KeyState::Released,
                Default::default(),
            ))
        })?;
    }
    Ok(())
}
