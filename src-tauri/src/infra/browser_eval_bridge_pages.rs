//! Every open page and its picture, for the Odysseys benchmark's judge (debug
//! builds only; docs/plans/odysseys-campaign.md). The judge grades a run from a
//! screenshot of each step, so the benchmark captures the agent's own tabs as the
//! run goes, without showing them or touching the agent's grants.
use super::*;

const PAGE_PREFIX: &str = "misty-browser-";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Capture {
    label: String,
    #[serde(default)]
    max_dimension: Option<f64>,
}

/// Lists every open page: its webview label and current URL.
pub(super) async fn pages(
    AxumState(bridge): AxumState<Bridge>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if let Err(response) = request::<Value>(&bridge, &headers, &body) {
        return response;
    }
    let pages: Vec<Value> = bridge
        .app
        .webviews()
        .into_iter()
        .filter(|(label, _)| label.starts_with(PAGE_PREFIX))
        .map(|(label, view)| {
            let url = view.url().map(|url| url.to_string()).unwrap_or_default();
            json!({ "label": label, "url": url })
        })
        .collect();
    reply(Ok(json!({ "pages": pages })))
}

/// One page as an image, at most `maxDimension` pixels on its long side (default 1280).
pub(super) async fn capture(
    AxumState(bridge): AxumState<Bridge>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let body = match request::<Capture>(&bridge, &headers, &body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    if !body.label.starts_with(PAGE_PREFIX) {
        return reply(Err("Only pages can be captured.".into()));
    }
    let Some(view) = bridge.app.get_webview(&body.label) else {
        return reply(Err("The page is closed.".into()));
    };
    reply(capture_view(view, body.max_dimension.unwrap_or(1280.0)).await)
}

#[cfg(target_os = "macos")]
async fn capture_view(view: Webview, max_dimension: f64) -> Result<Value, String> {
    let scale = view.window().scale_factor().map_err(|e| e.to_string())?;
    let size = view
        .size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    crate::infra::browser_macos::capture_webview_region_sized(
        view,
        0.0,
        0.0,
        size.width,
        size.height,
        max_dimension.clamp(320.0, 2560.0),
    )
    .await
}

#[cfg(not(target_os = "macos"))]
async fn capture_view(_view: Webview, _max_dimension: f64) -> Result<Value, String> {
    Err("Page capture for the benchmark runs on macOS.".into())
}
