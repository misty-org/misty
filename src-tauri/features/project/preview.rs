//! The preview panel's element picker: the person's own local app runs beside the chat as one of
//! Misty's native pages, and here Misty runs a small script in it that lets the person point at an
//! element and reports what it is. Only a preview page (`preview-…`) showing a local address is
//! ever scripted, and the script is Misty's own (`preview_picker.js`), never one a window sends.
//!
//! The idea follows OpenChamber's preview; none of its code is used.

use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{Manager, Webview};

use super::person_window;

const PICKER: &str = include_str!("preview_picker.js");
/// How long a pick waits for the person: two minutes, asked four times a second.
const PICK_POLLS: u32 = 480;
/// More than an element's details ever need (its HTML is cut at 4 KB in the page).
const LARGEST_REPORT: usize = 64 * 1024;

/// Whether `url` is a page on this computer: plain http on localhost, a `.localhost` name or a
/// loopback address. The preview shows the person's own dev server and nothing else.
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

/// The preview page `id` names, if it is open and showing a local address.
fn preview_page(caller: &Webview, app: &tauri::AppHandle, id: &str) -> Result<Webview, String> {
    person_window(caller)?;
    let valid = id.starts_with("preview-")
        && id.len() <= 96
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-');
    if !valid {
        return Err("That isn't a preview.".into());
    }
    let page = app
        .get_webview(&format!("misty-browser-{id}"))
        .ok_or("The preview isn't open.")?;
    if page.window().label() != caller.window().label() {
        return Err("That preview belongs to another window.".into());
    }
    let url = page.url().map_err(|error| error.to_string())?;
    if !is_local_page(&url) {
        return Err("The preview left your local app. Load its address again to pick.".into());
    }
    Ok(page)
}

/// Evaluates `script` in the page and returns its value as JSON text, or nothing after two seconds.
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

/// The picked element as a picture, when it is on screen and large enough to capture.
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

/// Whether something is listening at a local address, so the panel can say a dev server isn't
/// running instead of showing the web view's empty error page.
#[tauri::command]
pub async fn project_preview_reachable(webview: Webview, url: String) -> Result<bool, String> {
    person_window(&webview)?;
    let url = url::Url::parse(&url).map_err(|_| "That isn't an address.".to_string())?;
    if !is_local_page(&url) {
        return Err("The preview shows only your own app on this computer.".into());
    }
    let port = url.port_or_known_default().unwrap_or(80);
    // A `.localhost` name is this computer whether or not the resolver knows it.
    let addresses: Vec<std::net::SocketAddr> = match url.host() {
        Some(url::Host::Ipv4(address)) => vec![(address, port).into()],
        Some(url::Host::Ipv6(address)) => vec![(address, port).into()],
        _ => vec![
            (std::net::Ipv4Addr::LOCALHOST, port).into(),
            (std::net::Ipv6Addr::LOCALHOST, port).into(),
        ],
    };
    for address in addresses {
        let connect = tokio::net::TcpStream::connect(address);
        if let Ok(Ok(_)) = tokio::time::timeout(Duration::from_millis(1500), connect).await {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Starts keeping the preview page's errors, so a later pick can report them. Called after each
/// load; errors from before it are not seen.
#[tauri::command]
pub async fn project_preview_watch(
    webview: Webview,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    preview_page(&webview, &app, &id)?
        .eval(PICKER)
        .map_err(|error| error.to_string())
}

/// Lets the person pick an element in the preview page and returns what it is, with a picture of
/// it where one can be taken. Nothing when they press Escape, cancel, or leave it for two minutes.
#[tauri::command]
pub async fn project_preview_pick(
    webview: Webview,
    app: tauri::AppHandle,
    id: String,
) -> Result<Option<Value>, String> {
    let page = preview_page(&webview, &app, &id)?;
    page.eval(format!("{PICKER}\nwindow.__MISTY_PREVIEW__.start();"))
        .map_err(|error| error.to_string())?;
    // A page that reloads mid-pick loses the picker, which reads as a cancelled pick.
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

/// Ends a pick the person started and didn't finish.
#[tauri::command]
pub async fn project_preview_cancel_pick(
    webview: Webview,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    preview_page(&webview, &app, &id)?
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
