//! First-use permissions: things Misty can do with the rest of the computer that stay off until the
//! person says yes. Answers live in `settings_state` in `misty.db`,
//! on this device, and never sync.
//!
//! [`ensure`] asks, so it's for a person's action in a window. Anything else, such as a background
//! job, uses [`is_on`], which refuses without asking.
mod downloads;
mod store;

use std::{
    collections::HashSet,
    sync::{LazyLock, Mutex},
};

use downloads::restore_downloads_grant;
pub use downloads::{
    downloads_granted, ensure_downloads_folder, ensure_downloads_folder_async,
    revoke_downloads_folder,
};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use file_access;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Permission {
    BrowserImport,
    ScreenCapture,
    DesktopControl,
    DictationTyping,
}

/// What a native prompt says. It has to say plainly what's being allowed.
pub(crate) struct Prompt {
    title: &'static str,
    message: &'static str,
}

impl Permission {
    pub const ALL: [Permission; 4] = [
        Permission::BrowserImport,
        Permission::ScreenCapture,
        Permission::DesktopControl,
        Permission::DictationTyping,
    ];

    /// Its name in `src-tauri/tauri-permissions/permissions/permissions.toml`.
    pub const fn id(self) -> &'static str {
        match self {
            Permission::BrowserImport => "permission-browser-import",
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

    /// Where its answer is kept in `settings_state`.
    pub(crate) const fn scope(self) -> &'static str {
        match self {
            Permission::BrowserImport => "permission:browser-import",
            Permission::ScreenCapture => "permission:screen-capture",
            Permission::DesktopControl => "permission:desktop-control",
            Permission::DictationTyping => "permission:dictation-typing",
        }
    }

    /// Its row in Settings.
    pub const fn label(self) -> &'static str {
        match self {
            Permission::BrowserImport => "Read your other browsers",
            Permission::ScreenCapture => "See your screen",
            Permission::DesktopControl => "Control other apps",
            Permission::DictationTyping => "Type dictation into other apps",
        }
    }

    const fn prompt(self) -> Prompt {
        match self {
            Permission::BrowserImport => Prompt {
                title: "Let Misty read your other browsers?",
                message: "Misty will read the bookmarks, history, settings and saved sign-ins of the other browsers on this computer, so you can choose what to bring over.",
            },
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

    /// Whether this one lets the file gate reach anything new.
    fn apply_to_gate(self, on: bool) {
        if self == Permission::BrowserImport {
            if on {
                if let Some(folders) = IMPORT_FOLDERS.get() {
                    file_access::allow_browser_import_folders(folders());
                }
            } else {
                file_access::revoke_browser_import_folders();
            }
        }
    }
}

/// The permissions a process is held to by its own OS profile. They're Misty's defaults, so the
/// person never gets asked about them. Listed so a test can compare this file with `permissions.toml`.
#[cfg(test)]
const PROCESS_PERMISSIONS: [&str; 3] = [
    "permission-agent-shell",
    "permission-document-worker",
    "permission-page-reader",
];

/// Whether it's on, without asking. This is the check for anything no person started.
pub fn is_on(app: &AppHandle, permission: Permission) -> bool {
    store::read(app, permission.scope())
}

/// True if it's on; otherwise asks and remembers the answer. A declined one asks again on the next
/// attempt, and attempts made while its prompt is up are refused rather than asking twice.
///
/// Waits for the answer, so an async caller should use [`ensure_async`]. The main thread can call
/// it: the dialog has no parent window, so the plugin shows it from a thread of its own.
pub fn ensure(app: &AppHandle, permission: Permission) -> bool {
    if is_on(app, permission) {
        return true;
    }
    let Some(_asking) = Asking::start(permission.scope()) else {
        return false;
    };
    let answer = ask(app, &permission.prompt());
    store::write(app, permission.scope(), answer);
    permission.apply_to_gate(answer);
    answer
}

pub async fn ensure_async(app: &AppHandle, permission: Permission) -> bool {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || ensure(&app, permission))
        .await
        .unwrap_or(false)
}

/// Reconnects what was allowed before to the file gate, when Misty starts.
pub fn restore(app: &AppHandle) {
    for permission in Permission::ALL {
        if is_on(app, permission) {
            permission.apply_to_gate(true);
        }
    }
    restore_downloads_grant(app);
}

/// Shows the prompt and waits. Anything but a clear yes is a no.
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

/// One prompt per thing being asked: a second attempt while it's up gets no prompt of its own.
pub(crate) struct Asking(&'static str);

impl Asking {
    pub(crate) fn start(scope: &'static str) -> Option<Self> {
        let mut asking = ASKING
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        // Not `then_some`: it would build a value whose drop takes this lock, even for a no.
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

/// The database the answers are kept in. The app manages one at launch.
pub struct Backing(pub database::store::Store);

static IMPORT_FOLDERS: std::sync::OnceLock<fn() -> Vec<file_access::ImportFolder>> =
    std::sync::OnceLock::new();

/// Names the folders other browsers keep their data in, for the file gate while importing is on.
pub fn provide_import_folders(folders: fn() -> Vec<file_access::ImportFolder>) {
    let _ = IMPORT_FOLDERS.set(folders);
}

/// Turns one permission on or off from Settings.
pub fn set(app: &AppHandle, permission: Permission, on: bool) {
    store::write(app, permission.scope(), on);
    permission.apply_to_gate(on);
}

/// Tests never reach the person's real data, whatever they exercise.
#[cfg(test)]
#[ctor::ctor]
fn isolate_tests() {
    file_access::paths::isolate_for_tests();
}
