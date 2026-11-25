use super::{page_value, running};
use crate::browser::history_downloads::downloads::browser_download_directory;
use crate::browser::history_downloads::library::{download_finished, download_started};
use crate::browser::*;
use std::time::Duration;

const MAX_PAGE_TEXT: usize = 60_000;

const PAGE_TEXT_SCRIPT: &str = r#"(() => {
  const root = document.querySelector("article, main, [role=main]") || document.body;
  const text = root ? root.innerText : "";
  return JSON.stringify({ title: document.title || "", lang: document.documentElement.lang || "", text });
})()"#;

const PICTURE_IN_PICTURE_SCRIPT: &str = r#"(() => {
  const videos = Array.from(document.querySelectorAll("video"));
  const webkitActive = videos.find((v) => v.webkitPresentationMode === "picture-in-picture");
  if (document.pictureInPictureElement || webkitActive) {
    if (webkitActive) webkitActive.webkitSetPresentationMode("inline");
    else document.exitPictureInPicture().catch(() => {});
    return "exited";
  }
  const area = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height; };
  const playing = (v) => !v.paused && !v.ended && v.readyState > 2;
  const video = videos
    .filter((v) => v.readyState > 0 && !v.disablePictureInPicture)
    .sort((a, b) => Number(playing(b)) - Number(playing(a)) || area(b) - area(a))[0];
  if (!video) return "none";
  if (typeof video.webkitSupportsPresentationMode === "function" &&
      video.webkitSupportsPresentationMode("picture-in-picture")) {
    video.webkitSetPresentationMode("picture-in-picture");
    return "entered";
  }
  if (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === "function") {
    video.requestPictureInPicture().catch(() => {});
    return "entered";
  }
  return "unsupported";
})()"#;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebTabRequest {
    pub id: String,
}

#[tauri::command]
pub fn browser_webview_print(app: AppHandle, request: BrowserWebTabRequest) -> Result<(), String> {
    let webview = running(&app, &request.id)?;
    #[cfg(target_os = "macos")]
    return webview
        .with_webview(|platform_webview| unsafe {
            use objc2::runtime::{AnyObject, Sel};
            use objc2_foundation::NSRect;
            let view: &AnyObject = &*platform_webview.inner().cast();
            let info: *mut AnyObject =
                objc2::msg_send![objc2::class!(NSPrintInfo), sharedPrintInfo];
            let operation: *mut AnyObject =
                objc2::msg_send![view, printOperationWithPrintInfo: info];
            let Some(operation) = operation.as_ref() else {
                return;
            };
            let _: () = objc2::msg_send![operation, setShowsPrintPanel: true];
            let _: () = objc2::msg_send![operation, setShowsProgressPanel: true];
            let print_view: *mut AnyObject = objc2::msg_send![operation, view];
            let bounds: NSRect = objc2::msg_send![view, bounds];
            if let Some(print_view) = print_view.as_ref() {
                let _: () = objc2::msg_send![print_view, setFrame: bounds];
            }
            let window: *mut AnyObject = objc2::msg_send![view, window];
            let _: () = objc2::msg_send![
                operation,
                runOperationModalForWindow: window,
                delegate: std::ptr::null_mut::<AnyObject>(),
                didRunSelector: None::<Sel>,
                contextInfo: std::ptr::null_mut::<std::ffi::c_void>()
            ];
        })
        .map_err(|error| error.to_string());
    #[cfg(not(target_os = "macos"))]
    return webview
        .eval("window.print();")
        .map_err(|error| error.to_string());
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSavePageRequest {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub space_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSavedPage {
    pub file_name: String,
}

#[tauri::command]
pub async fn browser_webview_save_page(
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserSavePageRequest,
) -> Result<BrowserSavedPage, String> {
    let webview = running(&app, &request.id)?;
    let url = webview
        .url()
        .map_err(|error| error.to_string())?
        .to_string();
    let (directory, _) = browser_download_directory(&app, false, &request.space_id)
        .ok_or_else(|| "There's nowhere to save the page.".to_owned())?;
    file_access::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    let (contents, extension) = (web_archive(&webview).await?, "webarchive");
    #[cfg(not(target_os = "macos"))]
    let (contents, extension) = {
        let value = page_value(
            &webview,
            "document.documentElement.outerHTML".to_owned(),
            Duration::from_secs(10),
        )
        .await?;
        let html = serde_json::from_str::<Option<String>>(&value)
            .ok()
            .flatten()
            .ok_or_else(|| "The page couldn't be saved.".to_owned())?;
        (format!("<!DOCTYPE html>\n{html}").into_bytes(), "html")
    };
    let title = request.title.trim();
    let name = sanitize_download_name(&format!(
        "{}.{extension}",
        if title.is_empty() { "Page" } else { title }
    ));
    let path = reserve_download_path(&state, &directory, &name);
    let id = format!("download-{}", uuid::Uuid::new_v4());
    download_started(&id, &url, &path, &request.space_id);
    let written = file_access::fs::write(&path, &contents).map_err(|error| error.to_string());
    if let Ok(mut reserved) = state.reserved_downloads.lock() {
        reserved.remove(&path);
    }
    match written {
        Ok(()) => {
            file_access::quarantine::mark_from_internet(&path);
            download_finished(&id, &path.to_string_lossy(), true, None);
            Ok(BrowserSavedPage {
                file_name: path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or(name),
            })
        }
        Err(error) => {
            download_finished(&id, "", false, Some(&error));
            Err("The page couldn't be saved.".to_owned())
        }
    }
}

#[cfg(target_os = "macos")]
async fn web_archive(webview: &Webview) -> Result<Vec<u8>, String> {
    use block2::RcBlock;
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSData, NSError};
    let (sender, receiver) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();
    let sender = Mutex::new(Some(sender));
    webview
        .with_webview(move |platform_webview| unsafe {
            let view: &AnyObject = &*platform_webview.inner().cast();
            let handler = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
                let result = match data.as_ref() {
                    Some(data) if error.is_null() => Ok(data.to_vec()),
                    _ => Err("The page couldn't be saved.".to_owned()),
                };
                if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
                    let _ = sender.send(result);
                }
            });
            let _: () =
                objc2::msg_send![view, createWebArchiveDataWithCompletionHandler: &*handler];
        })
        .map_err(|error| error.to_string())?;
    tokio::time::timeout(Duration::from_secs(30), receiver)
        .await
        .map_err(|_| "Saving the page took too long.".to_owned())?
        .map_err(|_| "The page closed before it was saved.".to_owned())?
}

#[tauri::command]
pub fn browser_webview_inspect(app: AppHandle, request: BrowserWebTabRequest) -> Result<(), String> {
    let webview = running(&app, &request.id)?;
    #[cfg(target_os = "macos")]
    return webview
        .with_webview(|platform_webview| unsafe {
            use objc2::runtime::AnyObject;
            let view: &AnyObject = &*platform_webview.inner().cast();
            let inspectable: bool =
                objc2::msg_send![view, respondsToSelector: objc2::sel!(setInspectable:)];
            if inspectable {
                let _: () = objc2::msg_send![view, setInspectable: true];
            }
            let has_inspector: bool =
                objc2::msg_send![view, respondsToSelector: objc2::sel!(_inspector)];
            if !has_inspector {
                return;
            }
            let inspector: *mut AnyObject = objc2::msg_send![view, _inspector];
            if let Some(inspector) = inspector.as_ref() {
                let _: () = objc2::msg_send![inspector, show];
            }
        })
        .map_err(|error| error.to_string());
    #[cfg(windows)]
    return webview
        .with_webview(|platform| {
            let _ = unsafe {
                platform.controller().CoreWebView2().and_then(|core| {
                    core.Settings()?.SetAreDevToolsEnabled(true)?;
                    core.OpenDevToolsWindow()
                })
            };
        })
        .map_err(|error| error.to_string());
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = webview;
        Err("Web Inspector isn't available here yet.".into())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPictureInPicture {
    pub result: String,
}

#[tauri::command]
pub async fn browser_webview_picture_in_picture(
    app: AppHandle,
    request: BrowserWebTabRequest,
) -> Result<BrowserPictureInPicture, String> {
    let webview = running(&app, &request.id)?;
    let value = page_value(
        &webview,
        PICTURE_IN_PICTURE_SCRIPT.to_owned(),
        Duration::from_secs(5),
    )
    .await?;
    Ok(BrowserPictureInPicture {
        result: serde_json::from_str::<String>(&value).unwrap_or_else(|_| "none".to_owned()),
    })
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPageText {
    pub title: String,
    pub lang: String,
    pub text: String,
}

#[tauri::command]
pub async fn browser_webview_page_text(
    app: AppHandle,
    request: BrowserWebTabRequest,
) -> Result<BrowserPageText, String> {
    let webview = running(&app, &request.id)?;
    let value = page_value(&webview, PAGE_TEXT_SCRIPT.to_owned(), Duration::from_secs(10)).await?;
    let mut page = serde_json::from_str::<String>(&value)
        .ok()
        .and_then(|text| serde_json::from_str::<BrowserPageText>(&text).ok())
        .ok_or_else(|| "The page's text couldn't be read.".to_owned())?;
    page.text = page.text.trim().chars().take(MAX_PAGE_TEXT).collect();
    page.title = page.title.trim().chars().take(300).collect();
    page.lang = page.lang.trim().chars().take(35).collect();
    if page.text.is_empty() {
        return Err("This page has no text to read.".to_owned());
    }
    Ok(page)
}
