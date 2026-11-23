use tauri::{AppHandle, Webview};

use super::progress::Op;

const WORKERS: usize = 3;

static SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(WORKERS);

pub(crate) async fn run<T: Send + 'static>(
    app: &AppHandle,
    webview: &Webview,
    op_id: &str,
    label: &'static str,
    work: impl FnOnce(&mut Op) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let mut op = Op::start(app, webview.label(), op_id, label, 0);
    let _slot = SLOTS
        .acquire()
        .await
        .map_err(|_| "Files has stopped taking work.".to_owned())?;
    tokio::task::spawn_blocking(move || work(&mut op))
        .await
        .map_err(|error| error.to_string())?
}

pub(crate) fn new_op_id() -> String {
    format!("files-{}", uuid::Uuid::new_v4())
}
