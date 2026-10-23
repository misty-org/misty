use super::insert::{Desktop, PasteKeys};
use crate::infra::global_hotkey::{held_modifiers, Modifiers};
use std::time::Duration;
use windows_sys::Win32::{
    Foundation::{CloseHandle, GlobalFree, HANDLE, HWND},
    System::{
        DataExchange::*,
        Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE},
        Threading::{
            GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
            PROCESS_QUERY_LIMITED_INFORMATION,
        },
    },
    UI::{
        Input::KeyboardAndMouse::*,
        WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
    },
};

const CF_UNICODETEXT: u32 = 13;
// Formats whose handles are GDI objects rather than global memory; Windows
// synthesizes them from the memory formats we do keep (CF_DIB, CF_TEXT…).
const NOT_MEMORY: &[u32] = &[2, 3, 9, 14, 0x80];

/// Every global-memory clipboard format, copied.
pub struct Saved(Vec<(u32, Vec<u8>)>);

struct Open;
impl Open {
    fn new() -> Option<Self> {
        for _ in 0..10 {
            if unsafe { OpenClipboard(std::ptr::null_mut()) } != 0 {
                return Some(Open);
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        None
    }
}
impl Drop for Open {
    fn drop(&mut self) {
        unsafe { CloseClipboard() };
    }
}

unsafe fn copy_global(handle: HANDLE) -> Option<Vec<u8>> {
    let size = GlobalSize(handle);
    let pointer = GlobalLock(handle) as *const u8;
    if pointer.is_null() {
        return None;
    }
    let bytes = std::slice::from_raw_parts(pointer, size).to_vec();
    GlobalUnlock(handle);
    Some(bytes)
}

unsafe fn set_bytes(format: u32, bytes: &[u8]) -> bool {
    let memory = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1));
    if memory.is_null() {
        return false;
    }
    let pointer = GlobalLock(memory) as *mut u8;
    if pointer.is_null() {
        GlobalFree(memory);
        return false;
    }
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer, bytes.len());
    GlobalUnlock(memory);
    if SetClipboardData(format, memory).is_null() {
        GlobalFree(memory);
        return false;
    }
    true
}

pub struct System;

impl Desktop for System {
    type Saved = Saved;

    fn snapshot_clipboard(&self) -> Saved {
        let mut formats = Vec::new();
        if let Some(_open) = Open::new() {
            let mut format = 0;
            loop {
                format = unsafe { EnumClipboardFormats(format) };
                if format == 0 {
                    break;
                }
                if NOT_MEMORY.contains(&format) {
                    continue;
                }
                let handle = unsafe { GetClipboardData(format) };
                if let Some(bytes) = (!handle.is_null())
                    .then(|| unsafe { copy_global(handle) })
                    .flatten()
                {
                    formats.push((format, bytes));
                }
            }
        }
        Saved(formats)
    }

    fn write_clipboard_text(&self, text: &str) -> Result<u64, String> {
        let _open = Open::new().ok_or("The clipboard is busy.")?;
        let wide: Vec<u8> = text
            .encode_utf16()
            .chain([0])
            .flat_map(u16::to_le_bytes)
            .collect();
        unsafe {
            EmptyClipboard();
            if !set_bytes(CF_UNICODETEXT, &wide) {
                return Err("The clipboard couldn't be written.".into());
            }
        }
        drop(_open);
        Ok(self.clipboard_change_count())
    }

    fn clipboard_change_count(&self) -> u64 {
        unsafe { GetClipboardSequenceNumber() as u64 }
    }

    fn restore_clipboard(&self, saved: Saved) {
        if let Some(_open) = Open::new() {
            unsafe {
                EmptyClipboard();
                for (format, bytes) in &saved.0 {
                    set_bytes(*format, bytes);
                }
            }
        }
    }

    fn can_post_keys(&self) -> bool {
        true
    }

    fn request_post_keys(&self) {}

    fn held_modifiers(&self) -> Modifiers {
        held_modifiers()
    }

    fn frontmost_app(&self) -> Option<String> {
        let path = foreground_image()?;
        Some(path.rsplit(['\\', '/']).next().unwrap_or(&path).to_string())
    }

    fn post_paste(&self, keys: PasteKeys) -> Result<(), String> {
        let mut held: Vec<u16> = vec![VK_CONTROL];
        if keys == PasteKeys::ControlShiftV {
            held.push(VK_SHIFT);
        }
        let key = |vk: u16, up: bool| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let mut inputs: Vec<INPUT> = held.iter().map(|vk| key(*vk, false)).collect();
        inputs.push(key(0x56, false)); // V
        inputs.push(key(0x56, true));
        inputs.extend(held.iter().rev().map(|vk| key(*vk, true)));
        let sent = unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            )
        };
        (sent as usize == inputs.len())
            .then_some(())
            .ok_or_else(|| "Paste couldn't be sent.".into())
    }

    fn sleep(&self, duration: Duration) {
        std::thread::sleep(duration)
    }
}

fn foreground_pid() -> Option<u32> {
    let window: HWND = unsafe { GetForegroundWindow() };
    if window.is_null() {
        return None;
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(window, &mut pid) };
    (pid != 0).then_some(pid)
}

fn foreground_image() -> Option<String> {
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, foreground_pid()?) };
    if process.is_null() {
        return None;
    }
    let mut buffer = [0u16; 1024];
    let mut length = buffer.len() as u32;
    let ok = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            buffer.as_mut_ptr(),
            &mut length,
        )
    };
    unsafe { CloseHandle(process) };
    (ok != 0).then(|| String::from_utf16_lossy(&buffer[..length as usize]))
}

pub fn frontmost_is_self() -> bool {
    foreground_pid() == Some(unsafe { GetCurrentProcessId() })
}
