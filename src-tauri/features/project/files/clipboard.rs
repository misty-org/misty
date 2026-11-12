// The system clipboard's file lists, for the file tree's Copy and Paste: Copy puts the item there
// so Finder or Explorer pastes the real file, and Paste reads a copy made in another app back.
//
// Adapted from desktop-cc-gui's clipboard.rs (MIT, Copyright (c) 2026 zhukunpenglinyutong).

use std::path::PathBuf;

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFileSnapshot {
    pub paths: Vec<String>,
    /// The clipboard's change count, which tells a stale list from a newer copy made elsewhere.
    pub change_count: Option<u64>,
}

/// Reads the clipboard on the main thread, where AppKit wants it, and hands the answer back.
pub(super) async fn snapshot_on_main_thread(
    app: &tauri::AppHandle,
) -> Result<ClipboardFileSnapshot, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(platform::file_snapshot());
    })
    .map_err(|error| format!("Couldn't reach the main thread: {error}"))?;
    receiver
        .await
        .map_err(|_| "The clipboard read was dropped.".to_string())?
}

/// The clipboard's change count alone. Neither macOS's `changeCount` nor Windows'
/// `GetClipboardSequenceNumber` opens the clipboard, so this answers while another program holds
/// it open, which is when a snapshot fails: the tree's Paste can still tell that nothing newer
/// was copied since its own Copy.
pub(super) async fn change_count_on_main_thread(app: &tauri::AppHandle) -> Result<Option<u64>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(platform::change_count());
    })
    .map_err(|error| format!("Couldn't reach the main thread: {error}"))?;
    receiver
        .await
        .map_err(|_| "The clipboard read was dropped.".to_string())
}

/// Writes the files to the clipboard (when any still exists) and returns its change count either
/// way: reading the count doesn't open the clipboard, so it answers even while another program
/// holds it, and the tree's Paste compares it to tell whether its Copy is still the newest.
pub(super) async fn set_files_on_main_thread(
    app: &tauri::AppHandle,
    paths: Vec<PathBuf>,
) -> Result<Option<u64>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let existing = existing_paths(paths);
        if !existing.is_empty() {
            let _ = platform::set_file_paths(&existing);
        }
        let _ = sender.send(platform::change_count());
    })
    .map_err(|error| format!("Couldn't reach the main thread: {error}"))?;
    receiver
        .await
        .map_err(|_| "The clipboard write was dropped.".to_string())
}

/// Missing paths are dropped quietly; the answer must not say whether some path exists.
fn existing_paths(paths: Vec<PathBuf>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|path| !path.as_os_str().is_empty() && file_access::fs::exists(path))
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

/// The path list of a `DROPFILES` block: each path as UTF-16 and its NUL, then the empty name
/// that ends the list. Tree paths join children with `/`; the clipboard's readers (Explorer's
/// paste among them) get the system's own separators.
#[cfg(any(windows, test))]
fn hdrop_path_list(paths: &[String]) -> Vec<u16> {
    let mut names: Vec<u16> = Vec::new();
    for path in paths {
        names.extend(path.replace('/', "\\").encode_utf16());
        names.push(0);
    }
    names.push(0);
    names
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2::ClassType;
    use objc2_app_kit::{NSPasteboard, NSPasteboardWriting};
    use objc2_foundation::{NSArray, NSString, NSURL};

    type Writing = ProtocolObject<dyn NSPasteboardWriting>;

    pub(super) fn file_snapshot() -> Result<super::ClipboardFileSnapshot, String> {
        let pasteboard = NSPasteboard::generalPasteboard();
        Ok(super::ClipboardFileSnapshot {
            paths: read_file_urls(&pasteboard),
            change_count: generation(&pasteboard),
        })
    }

    pub(super) fn change_count() -> Option<u64> {
        generation(&NSPasteboard::generalPasteboard())
    }

    fn generation(pasteboard: &NSPasteboard) -> Option<u64> {
        u64::try_from(pasteboard.changeCount()).ok()
    }

    pub(super) fn set_file_paths(paths: &[String]) -> Result<(), String> {
        write_file_urls(&NSPasteboard::generalPasteboard(), paths)
    }

    /// Replaces the pasteboard's contents with file URLs, Finder's own flavour for a copied item.
    /// A plain-text path would paste as text in editors, so none is written beside them.
    pub(super) fn write_file_urls(
        pasteboard: &NSPasteboard,
        paths: &[String],
    ) -> Result<(), String> {
        pasteboard.clearContents();
        let objects: Vec<Retained<Writing>> = paths
            .iter()
            .map(|path| {
                let url = NSURL::fileURLWithPath(&NSString::from_str(path));
                ProtocolObject::from_retained(url)
            })
            .collect();
        if pasteboard.writeObjects(&NSArray::from_retained_slice(&objects)) {
            Ok(())
        } else {
            Err("The system refused the clipboard write.".to_string())
        }
    }

    /// The file URLs on the pasteboard as absolute paths. Web links sit on the same class and
    /// drop out, as do promised items with no path.
    pub(super) fn read_file_urls(pasteboard: &NSPasteboard) -> Vec<String> {
        let classes = NSArray::from_slice(&[NSURL::class()]);
        // SAFETY: `classes` holds Objective-C classes; `None` asks for the default options.
        let objects = unsafe { pasteboard.readObjectsForClasses_options(&classes, None) };
        let Some(objects) = objects else {
            return Vec::new();
        };
        let mut paths = Vec::new();
        for object in objects.iter() {
            let Some(url) = object.downcast_ref::<NSURL>() else {
                continue;
            };
            if !url.isFileURL() {
                continue;
            }
            let Some(path) = url.path() else { continue };
            let path = path.to_string();
            if !path.is_empty() {
                paths.push(path);
            }
        }
        paths
    }
}

#[cfg(windows)]
mod platform {
    use windows_sys::Win32::Foundation::{GlobalFree, POINT};
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber,
        IsClipboardFormatAvailable, OpenClipboard, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows_sys::Win32::UI::Shell::{DragQueryFileW, DROPFILES};

    /// `CF_HDROP`, the clipboard format of a copied file list.
    const CF_HDROP: u32 = 15;

    /// Another program (a clipboard manager, a remote desktop client) often holds the clipboard
    /// for a moment; asking again a few times over ~100 ms gets it in most cases. When it still
    /// can't be opened the caller falls back on the change count, which needs no open.
    unsafe fn open_clipboard() -> bool {
        for attempt in 0..5 {
            if OpenClipboard(std::ptr::null_mut()) != 0 {
                return true;
            }
            if attempt < 4 {
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
        }
        false
    }

    pub(super) fn file_snapshot() -> Result<super::ClipboardFileSnapshot, String> {
        // SAFETY: the clipboard is open for the shortest time and closed on every path.
        unsafe {
            if !open_clipboard() {
                return Err(format!(
                    "Another app is using the clipboard: {}",
                    std::io::Error::last_os_error()
                ));
            }
            let paths = read_hdrop();
            let change_count = change_count();
            CloseClipboard();
            Ok(super::ClipboardFileSnapshot {
                paths: paths?,
                change_count,
            })
        }
    }

    pub(super) fn change_count() -> Option<u64> {
        // SAFETY: a plain query that doesn't open the clipboard.
        let sequence = unsafe { GetClipboardSequenceNumber() };
        // Zero means this window station has no clipboard access.
        (sequence != 0).then(|| u64::from(sequence))
    }

    pub(super) fn set_file_paths(paths: &[String]) -> Result<(), String> {
        // SAFETY: every pointer comes from one GlobalAlloc block, handed to the system by
        // SetClipboardData or freed here.
        unsafe {
            let handle = alloc_hdrop(paths)?;
            if !open_clipboard() {
                GlobalFree(handle);
                return Err("Another app is using the clipboard.".into());
            }
            if EmptyClipboard() == 0 {
                CloseClipboard();
                GlobalFree(handle);
                return Err("Couldn't clear the clipboard.".into());
            }
            let written = SetClipboardData(CF_HDROP, handle);
            CloseClipboard();
            if written.is_null() {
                GlobalFree(handle);
                return Err("Couldn't set the clipboard.".into());
            }
            // From here the system owns the block; freeing it would corrupt the clipboard.
            Ok(())
        }
    }

    /// A moveable `DROPFILES` block: the header, then the paths as a double-NUL-ended UTF-16
    /// list, exactly what Explorer puts on the clipboard for a copied file.
    unsafe fn alloc_hdrop(paths: &[String]) -> Result<*mut core::ffi::c_void, String> {
        let payload = hdrop_bytes(paths);
        let handle = GlobalAlloc(GMEM_MOVEABLE, payload.len());
        if handle.is_null() {
            return Err("Couldn't make room for the clipboard.".into());
        }
        let base = GlobalLock(handle);
        if base.is_null() {
            GlobalFree(handle);
            return Err("Couldn't lock the clipboard's data.".into());
        }
        std::ptr::copy_nonoverlapping(payload.as_ptr(), base.cast::<u8>(), payload.len());
        GlobalUnlock(handle);
        Ok(handle)
    }

    pub(super) fn hdrop_bytes(paths: &[String]) -> Vec<u8> {
        let names = super::hdrop_path_list(paths);
        let header = DROPFILES {
            pFiles: std::mem::size_of::<DROPFILES>() as u32,
            pt: POINT { x: 0, y: 0 },
            fNC: 0,
            fWide: 1,
        };
        let mut payload = Vec::with_capacity(std::mem::size_of::<DROPFILES>() + names.len() * 2);
        // SAFETY: DROPFILES is plain data; reading it as bytes copies its initialized size.
        payload.extend_from_slice(unsafe {
            std::slice::from_raw_parts(
                (&header as *const DROPFILES).cast::<u8>(),
                std::mem::size_of::<DROPFILES>(),
            )
        });
        // SAFETY: every u16 in `names` is initialized.
        payload.extend_from_slice(unsafe {
            std::slice::from_raw_parts(names.as_ptr().cast::<u8>(), names.len() * 2)
        });
        payload
    }

    unsafe fn read_hdrop() -> Result<Vec<String>, String> {
        if IsClipboardFormatAvailable(CF_HDROP) == 0 {
            return Ok(Vec::new());
        }
        let handle = GetClipboardData(CF_HDROP);
        if handle.is_null() {
            return Err("Couldn't read the clipboard's file list.".into());
        }
        // `u32::MAX` asks for the number of files, not a name.
        let count = DragQueryFileW(handle, u32::MAX, std::ptr::null_mut(), 0);
        let mut paths = Vec::with_capacity(count as usize);
        for index in 0..count {
            let len = DragQueryFileW(handle, index, std::ptr::null_mut(), 0);
            if len == 0 {
                continue;
            }
            let mut buffer = vec![0u16; len as usize + 1];
            let written = DragQueryFileW(handle, index, buffer.as_mut_ptr(), buffer.len() as u32);
            buffer.truncate(written as usize);
            paths.push(String::from_utf16_lossy(&buffer));
        }
        Ok(paths)
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    /// Linux file lists would need the GTK or X11 selection stack, which Misty doesn't link; the
    /// tree's own copy still works there.
    pub(super) fn file_snapshot() -> Result<super::ClipboardFileSnapshot, String> {
        Ok(super::ClipboardFileSnapshot {
            paths: Vec::new(),
            change_count: None,
        })
    }

    pub(super) fn change_count() -> Option<u64> {
        None
    }

    pub(super) fn set_file_paths(_paths: &[String]) -> Result<(), String> {
        Err("This system has no file clipboard Misty can reach.".to_string())
    }
}

#[cfg(test)]
mod path_tests {
    #[test]
    fn hdrop_path_list_uses_windows_separators() {
        let wide = super::hdrop_path_list(&[
            r"C:\ws/src/notes with space.md".to_string(),
            r"D:\top.txt".to_string(),
        ]);
        let expected: Vec<u16> = "C:\\ws\\src\\notes with space.md\0D:\\top.txt\0\0"
            .encode_utf16()
            .collect();
        assert_eq!(wide, expected);
    }

    #[cfg(unix)]
    #[test]
    fn a_trailing_space_is_part_of_the_path() {
        let directory =
            std::env::temp_dir().join(format!("misty-clipboard-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let selected = directory.join("report ");
        std::fs::write(&selected, b"selected").unwrap();
        std::fs::write(directory.join("report"), b"other").unwrap();
        let kept = super::existing_paths(vec![selected.clone(), std::path::PathBuf::new()]);
        assert_eq!(kept, [selected.to_string_lossy()]);
        std::fs::remove_dir_all(directory).unwrap();
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::platform::{read_file_urls, write_file_urls};
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{NSPasteboard, NSPasteboardWriting};
    use objc2_foundation::{NSArray, NSString, NSURL};

    type Writing = ProtocolObject<dyn NSPasteboardWriting>;

    /// A private pasteboard keeps the test off the person's clipboard.
    fn test_pasteboard(file_paths: &[&str], web_url: Option<&str>) -> Retained<NSPasteboard> {
        let pasteboard = NSPasteboard::pasteboardWithUniqueName();
        pasteboard.clearContents();
        let mut objects: Vec<Retained<Writing>> = file_paths
            .iter()
            .map(|path| {
                ProtocolObject::from_retained(NSURL::fileURLWithPath(&NSString::from_str(path)))
            })
            .collect();
        if let Some(url) = web_url {
            let url = NSURL::URLWithString(&NSString::from_str(url)).expect("valid url");
            objects.push(ProtocolObject::from_retained(url));
        }
        pasteboard.writeObjects(&NSArray::from_retained_slice(&objects));
        pasteboard
    }

    #[test]
    fn writes_file_urls_that_read_back() {
        let pasteboard = NSPasteboard::pasteboardWithUniqueName();
        let paths = vec![
            "/tmp/notes with space.md".to_string(),
            "/tmp/pic.png".to_string(),
        ];
        write_file_urls(&pasteboard, &paths).expect("write file urls");
        assert_eq!(read_file_urls(&pasteboard), paths);
    }

    #[test]
    fn ignores_web_urls() {
        let pasteboard = test_pasteboard(&["/tmp/keep.txt"], Some("https://example.com/a"));
        assert_eq!(
            read_file_urls(&pasteboard),
            vec!["/tmp/keep.txt".to_string()]
        );
    }

    #[test]
    fn a_text_clipboard_has_no_files() {
        let pasteboard = NSPasteboard::pasteboardWithUniqueName();
        pasteboard.clearContents();
        let text = NSString::from_str("just text");
        pasteboard.writeObjects(&NSArray::from_retained_slice(&[
            ProtocolObject::from_retained(text),
        ]));
        assert!(read_file_urls(&pasteboard).is_empty());
    }
}
