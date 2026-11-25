use crate::apps::{bundle, frames, manifest, site::SiteEntry};
use crate::browser::*;
use sha2::{Digest, Sha256};

#[cfg(target_os = "macos")]
mod adapter_world;
mod downloads;
mod navigation;
mod permissions;
use navigation::{refuse_outside, stays_in_app, stays_on_site};
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

enum Kind {
    Bundle,
    Site(Box<SiteEntry>),
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
    #[cfg(target_os = "macos")]
    adapter_world::forget(page.label());
    frames::forget(mount);
    kiri::channel::forget_host_channel(page.label());
    silence_page(page);
    unregister_browser_cursor_ownership(page)?;
    close_page(page)
}

pub(crate) fn send_shortcuts(page: &Webview, payload: &str) -> Result<(), String> {
    let Some(mount) = frames::mount_of(page.label()) else {
        return Ok(());
    };
    if !frames::is_site(mount) {
        return page
            .eval(format!("window.__MISTY_SET_SHORTCUTS__?.({payload});"))
            .map_err(|error| error.to_string());
    }
    #[cfg(target_os = "macos")]
    if frames::is_world(mount) {
        return adapter_world::send_shortcuts(page, payload);
    }
    Ok(())
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

async fn kind_of(app_id: &str, version: &str) -> Result<Kind, String> {
    if let Some(site) = crate::apps::site::site_entry(app_id).filter(|site| site.version == version)
    {
        if !site.runs_here() {
            return Err(format!("{} doesn't play on this computer.", site.name));
        }
        return Ok(Kind::Site(Box::new(site)));
    }
    let (id, release) = (app_id.to_owned(), version.to_owned());
    let installed =
        tauri::async_runtime::spawn_blocking(move || bundle::installed_manifest(&id, &release))
            .await
            .map_err(|error| error.to_string())??;
    match installed {
        Some(_) => Ok(Kind::Bundle),
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
    let kind = kind_of(&app_id, &version).await?;
    if matches!(kind, Kind::Bundle) {
        let (id, release) = (app_id.clone(), version.clone());
        let serves = tauri::async_runtime::spawn_blocking(move || {
            crate::apps::app_server::declared(&id, &release)
        })
        .await
        .unwrap_or(false);
        if serves {
            crate::apps::app_server::url(&app, &app_id).await?;
        }
    }
    let channel = match &kind {
        Kind::Bundle => true,
        Kind::Site(site) => site.has_space_features(),
    };
    if let Some(existing) = owned(&caller, &mount)? {
        if frames::runs(&mount, &app_id, &version)
            && frames::owner_of(&mount).as_deref() == Some(owner.as_str())
        {
            place(&app, &existing, &bounds)?;
            return Ok(AppPageOpened { channel });
        }
        close(&existing, &mount)?;
    }
    let adapter = match &kind {
        Kind::Site(site) => match &site.adapter {
            Some(file) => Some(crate::registry::files::script(file).await?),
            None => None,
        },
        Kind::Bundle => None,
    };
    let _lifecycle = crate::browser::profiles::browser_lifecycle().read().await;
    remember_main_macos_webview(&app, &owner)?;
    let label = frames::label_of(&mount)?;
    let store = apps_store();
    let world = matches!(&kind, Kind::Site(_)) && channel;
    let gate = match &kind {
        Kind::Site(site) => Some(frames::SiteGate {
            address: site
                .address()
                .as_ref()
                .and_then(frames::FrameOrigin::of)
                .ok_or("That website app has no address Misty can open.")?,
            adapter,
        }),
        Kind::Bundle => None,
    };
    let token = frames::register(&mount, &app_id, &version, &owner, world, gate)?;
    frames::set_space(
        &mount,
        space_id.filter(|space| !space.is_empty() && space.len() <= 200),
    );
    let shortcuts =
        serde_json::to_string(&crate::browser::input::shortcuts::current_shortcut_bindings(&state))
            .unwrap_or_else(|_| "[]".to_owned());
    let (first_url, site_address) = match &kind {
        Kind::Bundle => (bundle_url(&app_id, &version)?, None),
        Kind::Site(site) => {
            let address = site
                .address()
                .ok_or("That website app has no address Misty can open.")?;
            if cfg!(target_os = "macos") {
                (
                    Url::parse("about:blank").map_err(|error| error.to_string())?,
                    Some(address),
                )
            } else {
                (address, None)
            }
        }
    };
    let window_app = app.clone();
    let download_app = app.clone();
    let download_mount = mount.clone();
    let site_rules = match &kind {
        Kind::Site(site) => Some(site.as_ref().clone()),
        Kind::Bundle => None,
    };
    let window_rules = site_rules.clone();
    let window_label = label.clone();
    let navigation_id = app_id.clone();
    let window_id = app_id.clone();
    let navigation_app = app.clone();
    let navigation_mount = mount.clone();
    let window_mount = mount.clone();
    let load_mount = mount.clone();
    let reapplies_shortcuts = matches!(kind, Kind::Bundle);
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
        let stays = match &site_rules {
            Some(site) => stays_on_site(url, site),
            None => stays_in_app(url, &navigation_id),
        };
        if stays {
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
        if let Some(site) = &window_rules {
            if stays_on_site(&url, site) {
                if let Some(page) = window_app.get_webview(&window_label) {
                    let _ = page.navigate(url);
                    return NewWindowResponse::Deny;
                }
            }
        }
        refuse_outside(&window_app, &window_mount, &window_id, &url);
        NewWindowResponse::Deny
    })
    .on_download(move |_webview, event| downloads::handle(&download_app, &download_mount, event))
    .on_page_load(move |webview, payload| match payload.event() {
        tauri::webview::PageLoadEvent::Started => {
            frames::document_left(webview.app_handle(), &load_mount)
        }
        tauri::webview::PageLoadEvent::Finished if reapplies_shortcuts => {
            if let Some(state) = webview.app_handle().try_state::<BrowserSessionState>() {
                let _ = crate::browser::input::shortcuts::apply(&webview, &state);
            }
        }
        tauri::webview::PageLoadEvent::Finished => {}
    });
    let builder = match &kind {
        Kind::Bundle => builder.initialization_script(frames::relay_script(
            &token,
            &shortcuts,
            kiri::channel::sender_script(),
            false,
        )),
        Kind::Site(_) => builder,
    };
    let builder = match &kind {
        Kind::Site(_) => match native_macos_safari_user_agent() {
            Some(agent) => builder.user_agent(&agent),
            None => builder,
        },
        Kind::Bundle => builder,
    };
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
    if matches!(kind, Kind::Bundle) {
        crate::browser::kiri_link::host_messages::install(&page)?;
    }
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
    #[cfg(target_os = "macos")]
    if let (Kind::Site(_), Some(address)) = (&kind, site_address) {
        if world {
            adapter_world::install(
                &page,
                &frames::relay_script(&token, &shortcuts, adapter_world::SENDER, true),
            )?;
        }
        page.navigate(address).map_err(|error| error.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = site_address;
    place(&app, &page, &bounds)?;
    Ok(AppPageOpened { channel })
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
