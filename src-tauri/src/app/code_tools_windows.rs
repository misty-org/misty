//! Toolchains installed for everyone (under Program Files) can only be
//! shared with the code sandbox by an administrator. The first command that
//! needs them asks once, in Misty's own words, and then has Windows run one
//! `icacls` call per folder, elevated, that lets the sandbox read and run
//! those folders and nothing else. "Not now" holds until Misty restarts.
use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

use misty_agent_code::CodeService;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::platform::windows::{wide, with_com};

static DECLINED: AtomicBool = AtomicBool::new(false);

/// Asks, when needed, to share administrator-owned toolchains with the
/// sandbox. Commands run either way; without them, those tools are missing.
pub async fn ensure_tools_shared(app: &tauri::AppHandle, code: &CodeService) {
    if DECLINED.load(Ordering::Acquire) {
        return;
    }
    let folders = code.tools_needing_approval();
    if folders.is_empty() {
        return;
    }
    let listed: Vec<String> = folders
        .iter()
        .map(|folder| format!("• {}", folder.display()))
        .collect();
    let message = format!(
        "Agent commands run in a sandbox that can't see programs installed for everyone on this computer. \
         Windows will ask for administrator approval to let the sandbox read and run these folders, and nothing else:\n\n{}",
        listed.join("\n")
    );
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(message)
        .title("Let agent commands use your installed tools?")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Allow".into(),
            "Not now".into(),
        ))
        .show(move |allowed| {
            let _ = send.send(allowed);
        });
    if !receive.await.unwrap_or(false) {
        DECLINED.store(true, Ordering::Release);
        return;
    }
    let commands: Vec<(PathBuf, Vec<String>)> = folders
        .into_iter()
        .filter_map(|folder| {
            let arguments = misty_agent_code::sandbox::approval_arguments(&folder).ok()?;
            Some((folder, arguments))
        })
        .collect();
    let shared = tauri::async_runtime::spawn_blocking(move || run_elevated(&commands))
        .await
        .unwrap_or(false);
    if !shared {
        // Declined at the Windows prompt, or it failed: don't ask again now.
        DECLINED.store(true, Ordering::Release);
    }
}

/// Runs `icacls` once, elevated, for every folder, and waits. Folder paths
/// are quoted; a path that cmd would read as more than a path is skipped.
fn run_elevated(commands: &[(PathBuf, Vec<String>)]) -> bool {
    let unsafe_path = |path: &Path| {
        path.to_string_lossy()
            .chars()
            .any(|c| matches!(c, '"' | '&' | '|' | '<' | '>' | '^' | '%' | '!') || c.is_control())
    };
    let icacls = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join(r"System32\icacls.exe");
    let steps: Vec<String> = commands
        .iter()
        .filter(|(folder, _)| !unsafe_path(folder))
        .map(|(_, arguments)| {
            let quoted: Vec<String> = arguments
                .iter()
                .map(|argument| format!("\"{argument}\""))
                .collect();
            format!("\"{}\" {}", icacls.display(), quoted.join(" "))
        })
        .collect();
    if steps.is_empty() {
        return false;
    }
    // One elevation for every folder; `&&` stops at the first failure.
    let parameters = format!("/d /s /c \"{}\"", steps.join(" && "));
    with_com(|| elevate(Path::new("cmd.exe"), &parameters))
}

/// Starts `program` with the "runas" verb (the Windows administrator prompt)
/// and waits for it; true when it ran and exited 0.
fn elevate(program: &Path, parameters: &str) -> bool {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE},
        UI::{
            Shell::{
                ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
            },
            WindowsAndMessaging::SW_HIDE,
        },
    };
    let verb = wide("runas");
    let file = wide(program);
    let parameters = wide(parameters);
    // SAFETY: zeroed input structure, then the fields it needs.
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.lpParameters = parameters.as_ptr();
    info.nShow = SW_HIDE;
    // SAFETY: every string outlives the call; the process handle is closed below.
    if unsafe { ShellExecuteExW(&mut info) } == 0 || info.hProcess.is_null() {
        return false;
    }
    let mut code = 1u32;
    // SAFETY: a live process handle, closed once.
    unsafe {
        WaitForSingleObject(info.hProcess, INFINITE);
        GetExitCodeProcess(info.hProcess, &mut code);
        CloseHandle(info.hProcess);
    }
    code == 0
}
