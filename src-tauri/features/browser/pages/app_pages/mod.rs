use crate::apps::{bundle, frames, manifest};
use crate::browser::*;
use sha2::{Digest, Sha256};

mod downloads;
mod navigation;
mod permissions;
use navigation::{refuse_outside, stays_in_app};
pub use permissions::{
    __cmd__space_app_page_permission_answer, __cmd__space_apps_forget_permissions,
    __tauri_command_name_space_app_page_permission_answer,
    __tauri_command_name_space_apps_forget_permissions, space_app_page_permission_answer,
    space_apps_forget_permissions,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPageOpenRequest {
    pub mount: String,
    pub app_id: String,
    pub version: String,
    #[serde(default)]
    pub space_id: Option<String>,
    #[serde(flatten)]
    pub bounds: AppPageBounds,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPageBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub corner_radii: Option<[f64; 4]>,
    #[cfg(windows)]
    #[serde(default)]
    pub corner_color: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPagePlaceRequest {
    pub mount: String,
    #[serde(flatten)]
    pub bounds: AppPageBounds,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPageRequest {
    pub mount: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPageLowerRequest {
    pub mount: String,
    pub lowered: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPageOpened {
    pub channel: bool,
}

fn apps_store() -> Option<String> {
    let scope = crate::browser::app_windows::current_scope();
    let bytes = serde_json::to_vec(&("misty.apps-store.v1", scope)).ok()?;
    Some(hex::encode(Sha256::digest(bytes)))
}

fn bundle_url(app_id: &str, version: &str) -> Result<Url, String> {
    let address = if cfg!(windows) {
        format!("http://misty-app.{app_id}.localhost/{version}/")
    } else {
        format!("misty-app://{app_id}/{version}/")
    };
    Url::parse(&address).map_err(|_| "That app can't be opened.".to_owned())
}

fn owned(caller: &Webview, mount: &str) -> Result<Option<Webview>, String> {
    crate::project::person_window(caller)?;
    let label = frames::label_of(mount)?;
    let Some(page) = caller.app_handle().get_webview(&label) else {
        return Ok(None);
    };
    if page.window().label() != caller.window().label() {
        return Err("That app page isn't in this window.".into());
    }
    Ok(Some(page))
}

#[cfg(windows)]
fn hex_color(value: &str) -> Option<[u8; 3]> {
    let hex = value.strip_prefix('#')?;
    if hex.len() != 6 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let channel = |start: usize| u8::from_str_radix(&hex[start..start + 2], 16).ok();
    Some([channel(0)?, channel(2)?, channel(4)?])
}

fn place(app: &AppHandle, page: &Webview, bounds: &AppPageBounds) -> Result<(), String> {
    let (position, size) = logical_bounds(bounds.x, bounds.y, bounds.width, bounds.height);
    crate::browser::pages::macos::configure_page_view(page, false)?;
    set_webview_bounds_if_changed(app, page, position, size)?;
    #[cfg(target_os = "macos")]
    round_macos_webview_corners(page, bounds.corner_radii.unwrap_or_default())?;
    #[cfg(windows)]
    crate::browser::pages::windows::page_frame::set_corners(
        page,
        bounds.corner_radii.unwrap_or_default(),
        bounds.corner_color.as_deref().and_then(hex_color),
    )?;
    present_macos_webview(page)
}

fn restack(page: &Webview) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return position_macos_webview(page, false);
    #[cfg(windows)]
    return position_windows_webview(
        page,
        false,
        browser_child_should_be_below_renderer(renderer(page.window().label()).overlay),
    );
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = page;
        Ok(())
    }
}

fn park(page: &Webview) -> Result<(), String> {
    #[cfg(windows)]
    park_windows_webview(page)?;
    #[cfg(not(windows))]
    page.set_position(tauri::LogicalPosition::new(-32_000.0, -32_000.0))
        .map_err(|error| error.to_string())?;
    refresh_browser_cursor_ownership(page)
}

fn close(page: &Webview, mount: &str) -> Result<(), String> {
    permissions::forget_mount(mount);
    frames::forget(mount);
    kiri::channel::forget_host_channel(page.label());
    silence_page(page);
    unregister_browser_cursor_ownership(page)?;
    close_page(page)
}

pub(crate) fn send_shortcuts(page: &Webview, payload: &str) -> Result<(), String> {
    if frames::mount_of(page.label()).is_none() {
        return Ok(());
    }
    page.eval(format!("window.__MISTY_SET_SHORTCUTS__?.({payload});"))
        .map_err(|error| error.to_string())
}

pub(crate) fn close_if_app_page(page: &Webview) -> Option<Result<(), String>> {
    let label = page.label().to_owned();
    frames::mount_of(&label).map(|mount| close(page, mount))
}

pub(crate) fn close_app_pages(app: &AppHandle) -> Result<(), String> {
    for (label, page) in app.webviews() {
        if let Some(mount) = frames::mount_of(&label) {
            close(&page, mount)?;
        }
    }
    Ok(())
}

async fn installed_here(app_id: &str, version: &str) -> Result<(), String> {
    let (id, release) = (app_id.to_owned(), version.to_owned());
    let installed =
        tauri::async_runtime::spawn_blocking(move || bundle::installed_manifest(&id, &release))
            .await
            .map_err(|error| error.to_string())??;
    match installed {
        Some(_) => Ok(()),
        None => Err("This app isn't on this computer yet.".into()),
    }
}

#[tauri::command]
pub async fn space_app_page_open(
    caller: Webview,
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: AppPageOpenRequest,
) -> Result<AppPageOpened, String> {
    let AppPageOpenRequest {
        mount,
        app_id,
        version,
        space_id,
        bounds,
    } = request;
    if !manifest::valid_id(&app_id) || !manifest::valid_version(&version) {
        return Err("That app can't be opened.".into());
    }
    frames::remember_app(&app);
    let owner = caller.window().label().to_owned();
    installed_here(&app_id, &version).await?;
    let (id, release) = (app_id.clone(), version.clone());
    let serves = tauri::async_runtime::spawn_blocking(move || {
        crate::apps::app_server::declared(&id, &release)
    })
    .await
    .unwrap_or(false);
    if serves {
        crate::apps::app_server::url(&app, &app_id).await?;
    }
    if let Some(existing) = owned(&caller, &mount)? {
        if frames::runs(&mount, &app_id, &version)
            && frames::owner_of(&mount).as_deref() == Some(owner.as_str())
        {
            place(&app, &existing, &bounds)?;
            return Ok(AppPageOpened { channel: true });
        }
        close(&existing, &mount)?;
    }
    let _lifecycle = crate::browser::profiles::browser_lifecycle().read().await;
    remember_main_macos_webview(&app, &owner)?;
    let label = frames::label_of(&mount)?;
    let store = apps_store();
    let token = frames::register(&mount, &app_id, &version, &owner)?;
    frames::set_space(
        &mount,
        space_id.filter(|space| !space.is_empty() && space.len() <= 200),
    );
    let shortcuts =
        serde_json::to_string(&crate::browser::input::shortcuts::current_shortcut_bindings(&state))
            .unwrap_or_else(|_| "[]".to_owned());
    let first_url = bundle_url(&app_id, &version)?;
    let window_app = app.clone();
    let download_app = app.clone();
    let download_mount = mount.clone();
    let navigation_id = app_id.clone();
    let window_id = app_id.clone();
    let navigation_app = app.clone();
    let navigation_mount = mount.clone();
    let window_mount = mount.clone();
    let load_mount = mount.clone();
    let builder = with_store_data(
        WebviewBuilder::new(&label, WebviewUrl::CustomProtocol(first_url))
            .background_throttling(BackgroundThrottlingPolicy::Disabled),
        &app,
        store.as_deref(),
    )?
    .data_store_identifier(webkit_store_identifier(store.as_deref())?)
    .focused(false)
    .accept_first_mouse(true)
    .on_navigation(move |url| {
        if stays_in_app(url, &navigation_id) {
            return true;
        }
        #[cfg(target_os = "macos")]
        let page_itself = crate::browser::pages::macos::webkit_hooks::navigation_is_main_frame();
        #[cfg(not(target_os = "macos"))]
        let page_itself = true;
        if page_itself {
            refuse_outside(&navigation_app, &navigation_mount, &navigation_id, url);
        }
        false
    })
    .on_new_window(move |url, _features| {
        refuse_outside(&window_app, &window_mount, &window_id, &url);
        NewWindowResponse::Deny
    })
    .on_download(move |_webview, event| downloads::handle(&download_app, &download_mount, event))
    .on_page_load(move |webview, payload| match payload.event() {
        tauri::webview::PageLoadEvent::Started => {
            frames::document_left(webview.app_handle(), &load_mount)
        }
        tauri::webview::PageLoadEvent::Finished => {
            if let Some(state) = webview.app_handle().try_state::<BrowserSessionState>() {
                let _ = crate::browser::input::shortcuts::apply(&webview, &state);
            }
        }
    })
    .initialization_script(frames::relay_script(
        &token,
        &shortcuts,
        kiri::channel::sender_script(),
    ));
    #[cfg(windows)]
    let builder = builder.general_autofill_enabled(false);
    let (position, size) = logical_bounds(bounds.x, bounds.y, bounds.width, bounds.height);
    let created = {
        let _creating = super::creation_guard::Creating::enter();
        caller.window().add_child(builder, position, size)
    };
    let page = match created {
        Ok(page) => page,
        Err(error) => {
            frames::forget(&mount);
            return Err(error.to_string());
        }
    };
    crate::browser::kiri_link::host_messages::install(&page)?;
    permissions::install(&app, &page, &mount)?;
    crate::browser::page_media::install(&page)?;
    #[cfg(target_os = "macos")]
    crate::browser::history_downloads::downloads::macos::install(&page)?;
    #[cfg(windows)]
    crate::browser::pages::process_ended::watch_page_process(&page);
    #[cfg(windows)]
    crate::browser::app_windows::windows::focus::watch(&page);
    configure_browser_frame_rate(&page)?;
    apply_macos_webview_theme(&page)?;
    place(&app, &page, &bounds)?;
    Ok(AppPageOpened { channel: true })
}

#[tauri::command]
pub fn space_app_page_place(
    caller: Webview,
    app: AppHandle,
    request: AppPagePlaceRequest,
) -> Result<bool, String> {
    let Some(page) = owned(&caller, &request.mount)? else {
        return Ok(false);
    };
    place(&app, &page, &request.bounds)?;
    Ok(true)
}

#[tauri::command]
pub fn space_app_page_hide(caller: Webview, request: AppPageRequest) -> Result<(), String> {
    match owned(&caller, &request.mount)? {
        Some(page) => park(&page),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn space_app_page_lower(caller: Webview, request: AppPageLowerRequest) -> Result<(), String> {
    let Some(page) = owned(&caller, &request.mount)? else {
        return Ok(());
    };
    if frames::set_lowered(&request.mount, request.lowered) {
        restack(&page)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn space_app_page_snapshot(
    caller: Webview,
    request: AppPageRequest,
) -> Result<serde_json::Value, String> {
    let page = owned(&caller, &request.mount)?.ok_or("The app has closed.")?;
    #[cfg(target_os = "macos")]
    {
        let scale = page
            .window()
            .scale_factor()
            .map_err(|error| error.to_string())?;
        let size = page
            .size()
            .map_err(|error| error.to_string())?
            .to_logical::<f64>(scale);
        crate::browser::pages::macos::capture_webview_region_sized(
            page,
            0.0,
            0.0,
            size.width.floor(),
            size.height.floor(),
            1280.0,
        )
        .await
    }
    #[cfg(windows)]
    {
        crate::browser::pages::windows::capture::capture(page).await
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = page;
        Err("Misty can't picture an app here.".into())
    }
}

#[tauri::command]
pub fn space_app_page_close(caller: Webview, request: AppPageRequest) -> Result<(), String> {
    match owned(&caller, &request.mount)? {
        Some(page) => close(&page, &request.mount),
        None => {
            permissions::forget_mount(&request.mount);
            frames::forget(&request.mount);
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn space_apps_sign_out(caller: Webview, app: AppHandle) -> Result<(), String> {
    crate::project::person_window(&caller)?;
    close_app_pages(&app)?;
    crate::browser::agent_pages::page_tools::clear_all_store_data(&app, apps_store().as_deref())
        .await
}
