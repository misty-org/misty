//! Misty's own file picker, asked for by native code where it would open the system's file dialog.
//! Native code asks the person's window for a pick and waits, as it would on that dialog; the
//! window opens Misty's picker and answers that one request. An answer counts only from the window
//! that was asked, only while the request waits, and only for places the person's own Files may
//! open (never Misty's data, keychains or system folders), so the window can't pick on its own.
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        LazyLock, Mutex,
    },
};

use serde::Serialize;
use tauri::{Emitter, Webview};
use tokio::sync::oneshot;

use super::listing::io_text;
use super::{asked_path, blocking, failed, gated, person_window};

pub const PICK_EVENT: &str = "misty://file-pick";

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pick {
    pub title: String,
    pub folders: bool,
    pub multiple: bool,
    pub accept: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start: Option<String>,
}

impl Pick {
    pub fn file(title: &str) -> Self {
        Self {
            title: title.to_owned(),
            ..Self::default()
        }
    }

    pub fn folder(title: &str) -> Self {
        Self {
            title: title.to_owned(),
            folders: true,
            ..Self::default()
        }
    }

    pub fn program(title: &str) -> Self {
        Self {
            title: title.to_owned(),
            folders: cfg!(target_os = "macos"),
            ..Self::default()
        }
    }

    pub fn many(mut self) -> Self {
        self.multiple = true;
        self
    }

    pub fn start(mut self, folder: Option<PathBuf>) -> Self {
        self.start = folder.map(|folder| folder.to_string_lossy().into_owned());
        self
    }

    pub fn accept(mut self, extensions: &[&str]) -> Self {
        self.accept = extensions.iter().map(|ext| format!(".{ext}")).collect();
        self
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Asked {
    id: u64,
    #[serde(flatten)]
    pick: Pick,
}

struct Waiting {
    window: String,
    folders: bool,
    multiple: bool,
    answer: oneshot::Sender<Vec<PathBuf>>,
}

static NEXT: AtomicU64 = AtomicU64::new(1);
static WAITING: LazyLock<Mutex<HashMap<u64, Waiting>>> = LazyLock::new(Mutex::default);

fn waiting() -> std::sync::MutexGuard<'static, HashMap<u64, Waiting>> {
    WAITING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Asks the person in `webview`'s window to pick, and waits for their answer: the picked paths,
/// or none when they cancel. A new pick in the same window cancels one still open there.
pub async fn pick(webview: &Webview, pick: Pick) -> Result<Vec<PathBuf>, String> {
    person_window(webview)?;
    let window = webview.label().to_owned();
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let (send, receive) = oneshot::channel();
    {
        let mut waiting = waiting();
        waiting.retain(|_, earlier| earlier.window != window);
        waiting.insert(
            id,
            Waiting {
                window: window.clone(),
                folders: pick.folders,
                multiple: pick.multiple,
                answer: send,
            },
        );
    }
    if let Err(error) = webview.emit_to(window.as_str(), PICK_EVENT, Asked { id, pick }) {
        waiting().remove(&id);
        return Err(error.to_string());
    }
    Ok(receive.await.unwrap_or_default())
}

/// One picked path, by `pick`: the place the person picked.
pub async fn pick_one(webview: &Webview, pick: Pick) -> Result<Option<PathBuf>, String> {
    Ok(self::pick(webview, pick).await?.into_iter().next())
}

#[tauri::command]
pub async fn files_pick_answer(
    webview: Webview,
    id: u64,
    paths: Vec<String>,
) -> Result<(), String> {
    person_window(&webview)?;
    let (folders, multiple) = {
        let waiting = waiting();
        let asked = waiting
            .get(&id)
            .filter(|asked| asked.window == webview.label())
            .ok_or("That picker has already closed.")?;
        (asked.folders, asked.multiple)
    };
    let picked = if paths.is_empty() {
        Vec::new()
    } else {
        let paths = paths
            .iter()
            .take(if multiple { usize::MAX } else { 1 })
            .map(|path| asked_path(path))
            .collect::<Result<Vec<_>, _>>()?;
        blocking(move || {
            for path in &paths {
                let meta = gated::stat(path).map_err(|error| failed(path, io_text(&error)))?;
                if meta.is_dir() != folders {
                    let wanted = if folders { "a folder" } else { "a file" };
                    return Err(failed(path, format!("choose {wanted}")));
                }
            }
            Ok(paths)
        })
        .await?
    };
    let asked = waiting()
        .remove(&id)
        .ok_or("That picker has already closed.")?;
    let _ = asked.answer.send(picked);
    Ok(())
}
