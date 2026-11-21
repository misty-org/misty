//! Files' two answers: the disk grant (`grant:disk`), asked the first time Files opens, and
//! letting agents delete files (`permission:agent-delete`), off unless the person turns it on
//! through a warning. Both live in `settings_state` on this device and never sync, and only a
//! native prompt turns either on, so nothing in a page can.
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use super::{ask, store, Asking, Prompt};

const DISK: &str = "grant:disk";
const AGENT_DELETE: &str = "permission:agent-delete";

const DISK_PROMPT: Prompt = Prompt {
    title: "Let Files open the files on this computer?",
    message: "Files will show and change the files your user can reach, as Finder does. It never opens Misty's own data, your keychains or the system's folders. Agents you run can reach these files too, and they ask before changing anything.",
};

pub fn disk_granted(app: &AppHandle) -> bool {
    store::read(app, DISK)
}

/// True if the disk grant is on; otherwise asks. A no isn't saved, so the next time Files opens it
/// asks again. Waits for the answer: async callers use [`ensure_disk_grant_async`].
pub fn ensure_disk_grant(app: &AppHandle) -> bool {
    if disk_granted(app) {
        file_access::disk::allow_disk();
        return true;
    }
    let Some(_asking) = Asking::start(DISK) else {
        return false;
    };
    if !ask(app, &DISK_PROMPT) {
        return false;
    }
    store::write(app, DISK, true);
    file_access::disk::allow_disk();
    true
}

pub async fn ensure_disk_grant_async(app: &AppHandle) -> bool {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || ensure_disk_grant(&app))
        .await
        .unwrap_or(false)
}

/// Gives the file gate the disk again at startup, when it was granted before.
pub fn restore_disk_grant(app: &AppHandle) {
    if disk_granted(app) {
        file_access::disk::allow_disk();
    }
}

pub fn revoke_disk_grant(app: &AppHandle) {
    store::write(app, DISK, false);
    file_access::disk::revoke_disk();
}

/// Whether the person let agents delete files. Off unless they turned it on.
pub fn agent_delete_on(app: &AppHandle) -> bool {
    store::read(app, AGENT_DELETE)
}

/// Shows the warning and turns deleting on only if the person picks "Let agents delete". There
/// is no saved yes to skip it: every turn-on asks.
pub fn allow_agent_delete(app: &AppHandle) -> bool {
    let Some(_asking) = Asking::start(AGENT_DELETE) else {
        return false;
    };
    let (send, receive) = std::sync::mpsc::channel();
    app.dialog()
        .message(
            "Letting agents delete files puts your computer at serious risk. A deleted file can't be recovered, and Misty isn't responsible for anything that's lost. Agents will still ask before every delete.",
        )
        .title("Let agents delete files?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Let agents delete".into(),
            "Cancel".into(),
        ))
        .show(move |allowed| {
            let _ = send.send(allowed);
        });
    let allowed = receive.recv().unwrap_or(false);
    if allowed {
        store::write(app, AGENT_DELETE, true);
    }
    allowed
}

pub async fn allow_agent_delete_async(app: &AppHandle) -> bool {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || allow_agent_delete(&app))
        .await
        .unwrap_or(false)
}

/// Turning it off needs no prompt.
pub fn stop_agent_delete(app: &AppHandle) {
    store::write(app, AGENT_DELETE, false);
}
