use super::*;

pub fn relay_script(token: &str, shortcuts: &str, sender: &str, world: bool) -> String {
    RELAY
        .replace(
            "__MISTY_APP_TOKEN__",
            &serde_json::to_string(token).unwrap_or_else(|_| "\"\"".to_owned()),
        )
        .replace("__MISTY_APP_SHORTCUTS__", shortcuts)
        .replace(
            "__MISTY_APP_BYTES__",
            &serde_json::to_string(BYTES_PATH).unwrap_or_default(),
        )
        .replace(
            "__MISTY_APP_TOKEN_HEADER__",
            &serde_json::to_string(TOKEN_HEADER).unwrap_or_default(),
        )
        .replace(
            "__MISTY_APP_LIMIT__",
            &(if world {
                MAX_WORLD_BYTES
            } else {
                MAX_FRAME_BYTES
            })
            .to_string(),
        )
        .replace("__MISTY_APP_WORLD__", if world { "true" } else { "false" })
        .replace("__KIRI_HOST_SENDER__", sender)
}

fn owned_page(webview: &Webview, mount: &str) -> Result<Webview, String> {
    person_window(webview)?;
    let label = label_of(mount)?;
    if owner_of(mount).as_deref() != Some(webview.window().label()) {
        return Err("That app page isn't in this window.".into());
    }
    webview
        .app_handle()
        .get_webview(&label)
        .ok_or_else(|| "The app has closed.".to_owned())
}

#[tauri::command]
pub async fn space_app_page_post(
    webview: Webview,
    mount: String,
    body: String,
) -> Result<(), String> {
    let page = owned_page(&webview, &mount)?;
    serde_json::from_str::<Value>(&body)
        .map_err(|_| "That isn't a message for the app.".to_owned())?;
    if is_site(&mount) {
        let here = page.url().ok().as_ref().and_then(FrameOrigin::of);
        if here.is_none() || here != site_address(&mount) {
            return Err("The app isn't on its own page.".into());
        }
    }
    if is_world(&mount) {
        return post_to_world(page, body).await;
    }
    let argument = if body.len() > MAX_FRAME_BYTES {
        let reference = new_reference();
        put_bytes(&mount, None, &reference, body.into_bytes())?;
        format!("{{\"json\":\"{reference}\"}}")
    } else {
        body
    };
    page.eval(format!(
        "window.__mistyAppRelay&&window.__mistyAppRelay({argument});"
    ))
    .map_err(|error| error.to_string())
}

#[cfg(any(target_os = "macos", windows))]
async fn post_to_world(page: Webview, body: String) -> Result<(), String> {
    crate::browser::pages::content_world::evaluate_in_content_world(
        page,
        ADAPTER_WORLD,
        format!("window.__mistyAppRelay&&window.__mistyAppRelay({body});return \"\";"),
    )
    .await
    .map(|_| ())
}

#[cfg(not(any(target_os = "macos", windows)))]
async fn post_to_world(_page: Webview, _body: String) -> Result<(), String> {
    Err("Website apps get no Space features here.".into())
}

#[tauri::command]
pub fn space_app_page_put_bytes(
    webview: Webview,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned)
            .ok_or_else(|| "That transfer is missing its name.".to_owned())
    };
    let mount = header("x-misty-mount")?;
    let reference = header("x-misty-ref")?;
    owned_page(&webview, &mount)?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("That transfer has no bytes.".into());
    };
    put_bytes(&mount, None, &reference, bytes.clone())
}

#[tauri::command]
pub fn space_app_page_take_bytes(
    webview: Webview,
    mount: String,
    reference: String,
) -> Result<tauri::ipc::Response, String> {
    owned_page(&webview, &mount)?;
    take_bytes(&mount, None, &reference)
        .map(tauri::ipc::Response::new)
        .ok_or_else(|| "Those bytes never arrived.".to_owned())
}
