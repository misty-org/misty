mod disk;
mod downloads;
mod store;

use std::{
    collections::HashSet,
    sync::{LazyLock, Mutex},
};

pub use disk::{
    agent_delete_on, allow_agent_delete, allow_agent_delete_async, disk_granted, ensure_disk_grant,
    ensure_disk_grant_async, restore_disk_grant, revoke_disk_grant, stop_agent_delete,
};
use downloads::restore_downloads_grant;
pub use downloads::{
    downloads_granted, ensure_downloads_folder, ensure_downloads_folder_async,
    revoke_downloads_folder,
};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Permission {
    ScreenCapture,
    DesktopControl,
    DictationTyping,
}

pub(crate) struct Prompt {
    title: &'static str,
    message: &'static str,
}

impl Permission {
    pub const ALL: [Permission; 3] = [
        Permission::ScreenCapture,
        Permission::DesktopControl,
        Permission::DictationTyping,
    ];

    pub const fn id(self) -> &'static str {
        match self {
            Permission::ScreenCapture => "permission-screen-capture",
            Permission::DesktopControl => "permission-desktop-control",
            Permission::DictationTyping => "permission-dictation-typing",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|permission| permission.id() == id)
    }

    pub(crate) const fn scope(self) -> &'static str {
        match self {
            Permission::ScreenCapture => "permission:screen-capture",
            Permission::DesktopControl => "permission:desktop-control",
            Permission::DictationTyping => "permission:dictation-typing",
        }
    }

    pub const fn label(self) -> &'static str {
        match self {
            Permission::ScreenCapture => "See your screen",
            Permission::DesktopControl => "Control other apps",
            Permission::DictationTyping => "Type dictation into other apps",
        }
    }

    const fn prompt(self) -> Prompt {
        match self {
            Permission::ScreenCapture => Prompt {
                title: "Let Misty see your screen?",
                message: "Misty will take screenshots of your screen so the agent at your cursor can see what you're looking at.",
            },
            Permission::DesktopControl => Prompt {
                title: "Let Misty control other apps?",
                message: "Agents will be able to see your screen, click and type in other apps on this computer while a task runs. You can stop them at any time with Escape or Stop.",
            },
            Permission::DictationTyping => Prompt {
                title: "Let Misty type into other apps?",
                message: "Misty will paste what you dictate into the app you're using.",
            },
        }
    }
}

#[cfg(test)]
const PROCESS_PERMISSIONS: [&str; 4] = [
    "permission-agent-shell",
    "permission-document-worker",
    "permission-page-reader",
    "permission-speech-helper",
];

pub fn is_on(app: &AppHandle, permission: Permission) -> bool {
    store::read(app, permission.scope())
}

pub fn ensure(app: &AppHandle, permission: Permission) -> bool {
    if is_on(app, permission) {
        return true;
    }
    let Some(_asking) = Asking::start(permission.scope()) else {
        return false;
    };
    let answer = ask(app, &permission.prompt());
    store::write(app, permission.scope(), answer);
    answer
}

pub async fn ensure_async(app: &AppHandle, permission: Permission) -> bool {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || ensure(&app, permission))
        .await
        .unwrap_or(false)
}

pub fn restore(app: &AppHandle) {
    restore_downloads_grant(app);
    restore_disk_grant(app);
}

pub(crate) fn ask(app: &AppHandle, prompt: &Prompt) -> bool {
    let (send, receive) = std::sync::mpsc::channel();
    app.dialog()
        .message(prompt.message)
        .title(prompt.title)
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Allow".into(),
            "Not now".into(),
        ))
        .show(move |allowed| {
            let _ = send.send(allowed);
        });
    receive.recv().unwrap_or(false)
}

pub(crate) struct Asking(&'static str);

impl Asking {
    pub(crate) fn start(scope: &'static str) -> Option<Self> {
        let mut asking = ASKING
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if asking.insert(scope) {
            Some(Self(scope))
        } else {
            None
        }
    }
}

impl Drop for Asking {
    fn drop(&mut self) {
        ASKING
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(self.0);
    }
}

static ASKING: LazyLock<Mutex<HashSet<&'static str>>> = LazyLock::new(Mutex::default);

#[cfg(test)]
mod tests;

pub struct Backing(pub database::store::Store);

pub fn set(app: &AppHandle, permission: Permission, on: bool) {
    store::write(app, permission.scope(), on);
}

#[cfg(test)]
#[ctor::ctor]
fn isolate_tests() {
    file_access::paths::isolate_for_tests();
}
