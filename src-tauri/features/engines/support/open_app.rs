// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// src-tauri/src/open_app.rs: only the path and editor helpers the engines use.

use std::path::PathBuf;
use std::process::Stdio;

/// Expand a leading `~` and reject empty paths.
pub(crate) fn expand_user_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is empty".to_string());
    }
    if trimmed == "~" {
        return dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string());
    }
    if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
        return Ok(home.join(rest));
    }
    Ok(PathBuf::from(trimmed))
}

/// Use the OS text-editor association rather than the transcript extension.
/// In particular, JSONL often has no association, and its open handler need
/// not be a text editor. The original file is passed without copying it.
#[cfg(target_os = "windows")]
pub(crate) fn open_in_default_text_editor(path: &std::path::Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::System::Registry::RegCloseKey;
    use windows::Win32::UI::Shell::{
        AssocQueryKeyW, ShellExecuteExW, SHELLEXECUTEINFOW,
        ASSOCF_NONE, ASSOCKEY_SHELLEXECCLASS,
        SEE_MASK_CLASSKEY, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC,
    };
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    // ShellExecute requires native separators even though Rust fs accepts '/'.
    let file: Vec<u16> = path.as_os_str().encode_wide()
        .map(|c| if c == u16::from(b'/') { u16::from(b'\\') } else { c })
        .chain(Some(0)).collect();
    // Shell extensions can use COM; initialize it only for this blocking
    // thread and balance successful initialization, including S_FALSE.
    let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    if initialized.is_err() && initialized != RPC_E_CHANGED_MODE {
        return Err(format!("Failed to initialize default text editor launcher: {initialized}"));
    }
    let result = (|| -> windows::core::Result<()> {
        // Query .txt with user settings, then pass the resulting key directly:
        // a class ending in .exe can otherwise be reinterpreted as exefile.
        let class = unsafe { AssocQueryKeyW(ASSOCF_NONE, ASSOCKEY_SHELLEXECCLASS, w!(".txt"), w!("open"))? };
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_CLASSKEY | SEE_MASK_FLAG_NO_UI | SEE_MASK_NOASYNC,
            lpVerb: w!("open"),
            lpFile: PCWSTR(file.as_ptr()),
            hkeyClass: class,
            nShow: SW_SHOWNORMAL.0,
            ..Default::default()
        };
        let launched = unsafe { ShellExecuteExW(&mut info) };
        let _ = unsafe { RegCloseKey(class) };
        launched
    })();
    if initialized.is_ok() { unsafe { CoUninitialize() }; }
    result.map_err(|e| format!("Failed to open default text editor: {e}"))
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn open_in_default_text_editor(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("/usr/bin/open");
        command.arg("-t");
        command
    };
    #[cfg(not(target_os = "macos"))]
    let mut command = {
        let output = std::process::Command::new("xdg-mime")
            .args(["query", "default", "text/plain"]).stdin(Stdio::null()).output()
            .map_err(|e| format!("Failed to find default text editor: {e}"))?;
        if !output.status.success() {
            return Err(format!("Failed to find default text editor: {}", String::from_utf8_lossy(&output.stderr).trim()));
        }
        let desktop = std::str::from_utf8(&output.stdout)
            .map_err(|e| format!("Invalid default text editor association: {e}"))?.trim();
        if desktop.is_empty() { return Err("No default text editor is configured for text/plain".into()); }
        let mut command = std::process::Command::new("gtk-launch");
        command.arg(desktop);
        command
    };
    // Editors inherit launcher handles; pipes would hold this request and its
    // session lease until the external editor closes instead of launch exit.
    let status = command.arg(path).stdin(Stdio::null())
        .stdout(Stdio::null()).stderr(Stdio::null()).status()
        .map_err(|e| format!("Failed to open default text editor: {e}"))?;
    if status.success() { return Ok(()); }
    Err(format!("Failed to open default text editor ({status})"))
}
