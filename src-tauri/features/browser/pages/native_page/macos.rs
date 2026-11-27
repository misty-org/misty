use serde_json::Value;
use tauri::Webview;
use tokio::sync::oneshot::Receiver;

use super::reply;

type Started<T> = Result<Receiver<Result<T, String>>, String>;

fn on_view<T: Send + 'static>(
    view: &Webview,
    work: impl FnOnce(&objc2_web_kit::WKWebView, Box<dyn FnOnce(Result<T, String>) + Send>) + Send + 'static,
) -> Started<T> {
    let (done, receiver) = reply::<T>();
    view.with_webview(move |platform| {
        // SAFETY: `inner` is the page's live WKWebView, and this runs on the main thread.
        let view = unsafe { &*platform.inner().cast::<objc2_web_kit::WKWebView>() };
        work(view, Box::new(done));
    })
    .map_err(|error| error.to_string())?;
    Ok(receiver)
}

pub(super) fn capture(view: &Webview, region: [f64; 4], image_width: f64, lossless: bool) -> Started<Value> {
    on_view(view, move |view, done| {
        let Some(mtm) = objc2::MainThreadMarker::new() else {
            return done(Err("Misty couldn't reach the page.".into()));
        };
        let [x, y, width, height] = region;
        misty_page_runtime::macos::capture(
            mtm,
            view,
            misty_page_runtime::macos::Region { x, y, width, height },
            image_width,
            lossless,
            done,
        );
    })
}

pub(super) fn cookies(view: &Webview, request: Value) -> Started<Value> {
    on_view(view, move |view, done| misty_page_runtime::macos::cookies(view, request, done))
}

pub(super) fn emulate(view: &Webview, request: Value) -> Started<Value> {
    on_view(view, move |view, done| done(misty_page_runtime::macos::emulate(view, &request)))
}

pub(super) fn pdf(view: &Webview) -> Started<Vec<u8>> {
    on_view(view, move |view, done| misty_page_runtime::macos::pdf(view, done))
}

pub(super) fn set_zoom(view: &Webview, zoom: f64) -> Result<(), String> {
    view.with_webview(move |platform| {
        // SAFETY: `inner` is the page's live WKWebView, and this runs on the main thread.
        let view = unsafe { &*platform.inner().cast::<objc2_web_kit::WKWebView>() };
        misty_page_runtime::macos::set_scale(view, zoom);
    })
    .map_err(|error| error.to_string())
}

fn listen() {
    static LISTENING: std::sync::Once = std::sync::Once::new();
    LISTENING.call_once(|| misty_page_runtime::macos::dialogs::on_held(|_| super::dialog_held()));
}

pub(super) fn hold_dialogs(view: &Webview, on: bool) -> Started<()> {
    listen();
    on_view(view, move |view, done| {
        misty_page_runtime::macos::dialogs::install(view);
        misty_page_runtime::macos::dialogs::hold(view, on);
        done(Ok(()));
    })
}

pub(super) fn held_dialog(view: &Webview) -> Started<Option<Value>> {
    on_view(view, |view, done| done(Ok(misty_page_runtime::macos::dialogs::held(view))))
}

pub(super) fn answer_dialog(view: &Webview, accept: bool, text: Option<String>) -> Started<Option<Value>> {
    on_view(view, move |view, done| {
        done(Ok(misty_page_runtime::macos::dialogs::answer(view, accept, text.as_deref())))
    })
}
