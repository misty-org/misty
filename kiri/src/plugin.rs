//! The Tauri adapter: one command, `plugin:kiri|call`. The embedder's
//! capability grants only `kiri:default` to website webviews, so this is the
//! single native entry point a page can reach.

use crate::{Kiri, KiriError, Request};
use serde_json::Value;
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime, State, Webview,
};

/// `create` runs once at plugin setup, so the host can hold the app handle.
pub fn init<R, F>(create: F) -> TauriPlugin<R>
where
    R: Runtime,
    F: FnOnce(&AppHandle<R>) -> Kiri + Send + 'static,
{
    Builder::new("kiri")
        .invoke_handler(tauri::generate_handler![call])
        .setup(move |app, _api| {
            app.manage(create(app));
            Ok(())
        })
        .build()
}

#[tauri::command]
async fn call<R: Runtime>(
    webview: Webview<R>,
    kiri: State<'_, Kiri>,
    request: Request,
) -> Result<Value, KiriError> {
    let page_url = webview
        .url()
        .map_err(|_| KiriError::security("The page has no committed URL."))?;
    kiri.dispatch(webview.label(), &page_url, request).await
}
