use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{Manager, Webview};

use crate::project::person_window;

const PICKER: &str = include_str!("page_picker.js");
const PICK_POLLS: u32 = 480;
const LARGEST_REPORT: usize = 64 * 1024;

pub(crate) fn is_local_page(url: &url::Url) -> bool {
    if url.scheme() != "http" || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    match url.host() {
        Some(url::Host::Domain(name)) => {
            let name = name.trim_end_matches('.').to_ascii_lowercase();
            name == "localhost" || name.ends_with(".localhost")
        }
        Some(url::Host::Ipv4(address)) => address.octets() == [127, 0, 0, 1],
        Some(url::Host::Ipv6(address)) => address == std::net::Ipv6Addr::LOCALHOST,
        None => false,
    }
}

fn local_page(caller: &Webview, app: &tauri::AppHandle, id: &str) -> Result<Webview, String> {
    person_window(caller)?;
    let valid = id.starts_with("agent-")
        && id.len() <= 96
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-');
    if !valid {
        return Err("That isn't a tab.".into());
    }
    let page = app
        .get_webview(&format!("misty-browser-{id}"))
        .ok_or("The tab isn't open.")?;
    if page.window().label() != caller.window().label() {
        return Err("That tab belongs to another window.".into());
    }
    let url = page.url().map_err(|error| error.to_string())?;
    if !is_local_page(&url) {
        return Err("Elements can be picked only from your own app on this computer.".into());
    }
    Ok(page)
}

async fn read(page: &Webview, script: &str) -> Result<Option<String>, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let send = Mutex::new(Some(send));
    page.eval_with_callback(script, move |value| {
        if let Some(send) = send.lock().ok().and_then(|mut send| send.take()) {
            let _ = send.send(value);
        }
    })
    .map_err(|error| error.to_string())?;
    Ok(tokio::time::timeout(Duration::from_secs(2), receive)
        .await
        .ok()
        .and_then(Result::ok))
}

#[cfg(target_os = "macos")]
async fn picture(page: &Webview, element: &Value) -> Option<String> {
    let number = |group: &str, name: &str| element.get(group)?.get(name)?.as_f64();
    let (x, y) = (number("rect", "x")?, number("rect", "y")?);
    let (right, bottom) = (
        (x + number("rect", "width")?).min(number("viewport", "width")?),
        (y + number("rect", "height")?).min(number("viewport", "height")?),
    );
    let (x, y) = (x.max(0.0), y.max(0.0));
    if right - x < 8.0 || bottom - y < 8.0 {
        return None;
    }
    crate::browser::pages::macos::capture_webview_region_sized(
        page.clone(),
        x,
        y,
        right - x,
        bottom - y,
        640.0,
    )
    .await
    .ok()?
    .get("dataUrl")?
    .as_str()
    .map(str::to_owned)
}

#[cfg(not(target_os = "macos"))]
async fn picture(_page: &Webview, _element: &Value) -> Option<String> {
    None
}

#[tauri::command]
pub async fn browser_page_watch(
    webview: Webview,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    local_page(&webview, &app, &id)?
        .eval(PICKER)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn browser_page_pick(
    webview: Webview,
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<Value>, String> {
    let page = local_page(&webview, &app, &id)?;
    page.eval(format!("{PICKER}\nwindow.__MISTY_PREVIEW__.start();"))
        .map_err(|error| error.to_string())?;
    let poll = "window.__MISTY_PREVIEW__ ? (window.__MISTY_PREVIEW_PICKED__ ?? null) : ''";
    for _ in 0..PICK_POLLS {
        tokio::time::sleep(Duration::from_millis(250)).await;
        if app.get_webview(page.label()).is_none() {
            return Ok(None);
        }
        let Some(value) = read(&page, poll).await? else {
            continue;
        };
        let Ok(Some(report)) = serde_json::from_str::<Option<String>>(&value) else {
            continue;
        };
        if report.is_empty() || report.len() > LARGEST_REPORT {
            return Ok(None);
        }
        let Ok(element) = serde_json::from_str::<Value>(&report) else {
            return Ok(None);
        };
        let image = picture(&page, &element).await;
        return Ok(Some(json!({ "element": element, "image": image })));
    }
    let _ = page.eval("window.__MISTY_PREVIEW__?.cancel();");
    Ok(None)
}

#[tauri::command]
pub async fn browser_page_cancel_pick(
    webview: Webview,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    local_page(&webview, &app, &id)?
        .eval("window.__MISTY_PREVIEW__?.cancel();")
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::is_local_page;

    fn local(address: &str) -> bool {
        is_local_page(&url::Url::parse(address).unwrap())
    }

    #[test]
    fn only_this_computers_own_pages_are_local() {
        for address in [
            "http://localhost:3000/",
            "http://localhost/",
            "http://127.0.0.1:4173/a/b?c=d",
            "http://[::1]:5173/",
            "http://app.localhost:8080/",
        ] {
            assert!(local(address), "{address}");
        }
        for address in [
            "https://localhost:3000/",
            "http://example.com/",
            "http://localhost.example.com/",
            "http://notlocalhost/",
            "http://127.0.0.2/",
            "http://192.168.1.4:3000/",
            "http://user:secret@localhost:3000/",
            "file:///etc/hosts",
        ] {
            assert!(!local(address), "{address}");
        }
    }
}
