//! Docked agent windows (docs/design/agents-at-cursor/BRIEF.md, "Taking over
//! the app"). An agent's own window, or a tab detached from the person's window
//! into a host window, docks small in a corner while the agent keeps working in
//! it. The native dock (MistyAgentDock.m) keeps each docked window on screen at
//! the size its content was laid out for, inside Misty's window; this module routes the dock's presses
//! to the window that runs the task and moves detached tabs between windows.
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, Window};

mod host_view;
pub(super) use host_view::{fill_host, page_returned};

/// Host windows for detached tabs: `misty-dock-<uuid>`.
pub const HOST_PREFIX: &str = "misty-dock-";
/// Height of a host window's bar above its page.
const HOST_BAR: f64 = 44.0;
const EVENT: &str = "misty://agent-dock";

static APP: OnceLock<AppHandle> = OnceLock::new();

/// A detached tab: the window whose task works in it, and the tab's runtime id.
struct Host {
    owner: String,
    tab: String,
    name: String,
}

fn hosts() -> &'static Mutex<HashMap<String, Host>> {
    static HOSTS: OnceLock<Mutex<HashMap<String, Host>>> = OnceLock::new();
    HOSTS.get_or_init(Default::default)
}

#[cfg(target_os = "macos")]
extern "C" {
    fn misty_agent_dock_init(callback: extern "C" fn(*const std::ffi::c_char));
    fn misty_agent_dock_add(
        window: *mut std::ffi::c_void,
        id: *const std::ffi::c_char,
        name: *const std::ffi::c_char,
        parent: *mut std::ffi::c_void,
    ) -> bool;
    fn misty_agent_dock_open(id: *const std::ffi::c_char);
    fn misty_agent_dock_is_docked(id: *const std::ffi::c_char) -> bool;
    fn misty_agent_dock_forget(id: *const std::ffi::c_char);
    fn misty_agent_dock_status(
        id: *const std::ffi::c_char,
        status: *const std::ffi::c_char,
        waiting: bool,
    );
    fn misty_agent_dock_fill(view: *mut std::ffi::c_void, top: f64);
    fn misty_agent_dock_visibility() -> *mut std::ffi::c_char;
    fn misty_agent_dock_carousel(show: bool);
    fn misty_agent_dock_test_app(action: *const std::ffi::c_char);
    fn misty_agent_dock_page_returned(view: *mut std::ffi::c_void);
}

/// For the dock check: hide, unhide, minimize or unminimize Misty.
pub fn test_app(app: &AppHandle, action: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let action = action.to_owned();
        on_main(app, move |_| unsafe { misty_agent_dock_test_app(c_string(&action).as_ptr()) })?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, action);
    Ok(())
}

/// Fans the stack out into the carousel, or folds it (the dock check drives it).
pub fn carousel(app: &AppHandle, show: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    on_main(app, move |_| unsafe { misty_agent_dock_carousel(show) })?;
    #[cfg(not(target_os = "macos"))]
    let _ = (app, show);
    Ok(())
}

/// A press in the dock: the docked window hears it, and so does the window
/// running a detached tab's task.
#[cfg(target_os = "macos")]
extern "C" fn dock_event(value: *const std::ffi::c_char) {
    if value.is_null() {
        return;
    }
    let payload =
        unsafe { serde_json::from_slice::<Value>(std::ffi::CStr::from_ptr(value).to_bytes()) };
    let (Some(app), Ok(payload)) = (APP.get(), payload) else {
        return;
    };
    let id = payload["id"].as_str().unwrap_or_default().to_owned();
    let owner = hosts()
        .lock()
        .ok()
        .and_then(|hosts| hosts.get(&id).map(|host| host.owner.clone()));
    if !id.is_empty() {
        let _ = app.emit_to(id.as_str(), EVENT, payload.clone());
    }
    if let Some(owner) = owner {
        let _ = app.emit_to(owner.as_str(), EVENT, payload);
    }
}

fn ensure_init(app: &AppHandle) {
    if APP.set(app.clone()).is_ok() {
        #[cfg(target_os = "macos")]
        unsafe {
            misty_agent_dock_init(dock_event)
        };
    }
}

#[cfg(target_os = "macos")]
fn c_string(value: &str) -> std::ffi::CString {
    std::ffi::CString::new(value.replace('\0', "")).unwrap_or_default()
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn on_main(app: &AppHandle, work: impl FnOnce(&AppHandle) + Send + 'static) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || work(&handle))
        .map_err(|error| error.to_string())
}

/// Docks a window, or brings it to the front of the stack if it already is.
pub fn dock(app: &AppHandle, label: &str, name: &str) -> Result<(), String> {
    ensure_init(app);
    #[cfg(target_os = "macos")]
    {
        let (label, name) = (label.to_owned(), name.to_owned());
        on_main(app, move |app| {
            let Some(window) = app.get_window(&label) else {
                return;
            };
            let Ok(pointer) = window.ns_window() else {
                return;
            };
            // Docked windows live in Misty's window and move with it.
            let parent = app
                .get_window("main")
                .and_then(|main| main.ns_window().ok())
                .unwrap_or(std::ptr::null_mut());
            let (id, name) = (c_string(&label), c_string(&name));
            unsafe { misty_agent_dock_add(pointer, id.as_ptr(), name.as_ptr(), parent) };
        })?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (label, name);
    Ok(())
}

/// Opens a docked window at full size in front.
pub fn open(app: &AppHandle, label: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let label = label.to_owned();
        on_main(app, move |_| unsafe { misty_agent_dock_open(c_string(&label).as_ptr()) })?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, label);
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn is_docked(label: &str) -> bool {
    unsafe { misty_agent_dock_is_docked(c_string(label).as_ptr()) }
}

#[cfg(not(target_os = "macos"))]
pub fn is_docked(_label: &str) -> bool {
    false
}

/// The window is going away; the dock drops it and closes the gap.
pub fn forget(app: &AppHandle, label: &str) {
    #[cfg(target_os = "macos")]
    {
        let label = label.to_owned();
        let _ = on_main(app, move |_| unsafe { misty_agent_dock_forget(c_string(&label).as_ptr()) });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, label);
}

fn is_agent_window(label: &str) -> bool {
    label
        .strip_prefix("misty-agent-")
        .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
}

/// The window a caller may act on: itself, or a host whose task it runs.
fn target(caller: &Window, id: Option<String>) -> Result<String, String> {
    let own = caller.label().to_owned();
    match id {
        None => Ok(own),
        Some(id) if id == own => Ok(id),
        Some(id) => {
            let hosts = hosts().lock().map_err(|_| "agent_dock_unavailable")?;
            match hosts.get(&id) {
                Some(host) if host.owner == own => Ok(id),
                _ => Err("This agent window belongs to another window.".into()),
            }
        }
    }
}

/// Dock the calling agent window (its island's Dock button), or a host it owns.
#[tauri::command]
pub fn agent_dock_window(
    window: Window,
    app: AppHandle,
    id: Option<String>,
    name: Option<String>,
) -> Result<(), String> {
    let label = target(&window, id)?;
    if !is_agent_window(&label) && !label.starts_with(HOST_PREFIX) {
        return Err("Only agent windows can dock.".into());
    }
    let name = name
        .filter(|name| name.len() <= 320)
        .or_else(|| app.get_window(&label).and_then(|w| w.title().ok()))
        .unwrap_or_default();
    dock(&app, &label, &name)
}

/// Open a docked agent window at full size (from its owner's island).
#[tauri::command]
pub fn agent_dock_open(window: Window, app: AppHandle, id: Option<String>) -> Result<(), String> {
    open(&app, &target(&window, id)?)
}

/// What the dock shows for a window: the island's status line, and whether the
/// agent is waiting for the person.
#[tauri::command]
pub fn agent_dock_status(
    window: Window,
    app: AppHandle,
    id: Option<String>,
    status: String,
    waiting: bool,
) -> Result<(), String> {
    let label = target(&window, id)?;
    let status: String = status.chars().take(300).collect();
    if label.starts_with(HOST_PREFIX) {
        let _ = app.emit_to(
            label.as_str(),
            EVENT,
            json!({ "action": "status", "id": label, "status": status, "waiting": waiting }),
        );
    }
    #[cfg(target_os = "macos")]
    on_main(&app, move |_| unsafe {
        misty_agent_dock_status(
            c_string(&label).as_ptr(),
            c_string(&status).as_ptr(),
            waiting,
        )
    })?;
    #[cfg(not(target_os = "macos"))]
    let _ = (label, status, waiting);
    Ok(())
}

/// Whether macOS reports each docked window as visible, so WebKit keeps painting
/// it. For checking the dock, not for the interface.
#[tauri::command]
pub fn agent_dock_visibility() -> Result<Value, String> {
    visibility()
}

/// Each docked window's visibility and layout size, read on the main thread.
pub async fn visibility_now(app: &AppHandle) -> Result<Value, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    on_main(app, move |_| {
        let _ = send.send(visibility());
    })?;
    receive.await.map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
fn visibility() -> Result<Value, String> {
    unsafe {
        let pointer = misty_agent_dock_visibility();
        if pointer.is_null() {
            return Ok(json!([]));
        }
        let value = serde_json::from_slice(std::ffi::CStr::from_ptr(pointer).to_bytes())
            .map_err(|error| error.to_string());
        libc::free(pointer.cast());
        value
    }
}

#[cfg(not(target_os = "macos"))]
fn visibility() -> Result<Value, String> {
    Ok(json!([]))
}

pub(super) fn browser_label(tab: &str) -> Result<String, String> {
    let valid = !tab.is_empty()
        && tab.len() <= 96
        && tab
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    valid
        .then(|| format!("misty-browser-{tab}"))
        .ok_or_else(|| "Browser tab identifier is invalid.".to_owned())
}

/// Detach: the agent's tab leaves the person's window, live, for a window of
/// its own that docks in the corner. The task keeps running in the window that
/// started it, so its lease and grants are unchanged.
#[tauri::command]
pub async fn agent_tab_detach(
    window: Window,
    app: AppHandle,
    tab: String,
    title: String,
    name: String,
) -> Result<String, String> {
    if window.label() != "main" {
        return Err("Only tabs in the Misty window can be detached.".into());
    }
    detach(&app, &window, &tab, &title, &name)
}

/// Moves a browser tab out of `window` into a docked host window of its own.
pub fn detach(
    app: &AppHandle,
    window: &Window,
    tab: &str,
    title: &str,
    name: &str,
) -> Result<String, String> {
    let (app, tab) = (app.clone(), tab.to_owned());
    let webview = app
        .get_webview(&browser_label(&tab)?)
        .ok_or("This tab is no longer open.")?;
    if webview.window().label() != window.label() {
        return Err("This tab is already in its own window.".into());
    }
    let title: String = title.chars().take(200).collect();
    let name: String = name.chars().take(120).collect();
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let size = webview
        .size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    let label = format!("{HOST_PREFIX}{}", uuid::Uuid::new_v4());
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("agent_dock_host", "1")
        .append_pair("title", &title)
        .append_pair("agent", &name)
        .finish();
    let host = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::App(format!("index.html?{query}").into()),
    )
    .title(if name.is_empty() {
        title.clone()
    } else {
        format!("{title} · {name}")
    })
    .inner_size(size.width.max(640.0), size.height.max(420.0) + HOST_BAR)
    .min_inner_size(480.0, 360.0)
    .focused(false)
    // The agent works here while the person is in another window.
    .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
    .build()
    .map_err(|e| e.to_string())?;
    hosts().lock().map_err(|_| "agent_dock_unavailable")?.insert(
        label.clone(),
        Host {
            owner: window.label().to_owned(),
            tab: tab.clone(),
            name: name.clone(),
        },
    );
    let closing = (app.clone(), label.clone());
    host.on_window_event(move |event| match event {
        // Closing the agent's window brings its tab home; the task goes on.
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = attach(&closing.0, &closing.1);
        }
        tauri::WindowEvent::Destroyed => forget(&closing.0, &closing.1),
        _ => {}
    });
    let target = app.get_window(&label).ok_or("The agent window closed.")?;
    if let Err(error) = webview.reparent(&target) {
        if let Ok(mut hosts) = hosts().lock() {
            hosts.remove(&label);
        }
        let _ = target.destroy();
        return Err(error.to_string());
    }
    fill_host(&webview, HOST_BAR)?;
    dock(&app, &label, &name)?;
    Ok(label)
}

/// Bring a detached tab back into the window that runs its task.
#[tauri::command]
pub fn agent_tab_attach(window: Window, app: AppHandle, host: String) -> Result<(), String> {
    target(&window, Some(host.clone()))?;
    attach(&app, &host)
}

pub fn attach(app: &AppHandle, label: &str) -> Result<(), String> {
    let Some(host) = hosts()
        .lock()
        .map_err(|_| "agent_dock_unavailable")?
        .remove(label)
    else {
        return Ok(());
    };
    let webview = app.get_webview(&browser_label(&host.tab)?);
    if let (Some(webview), Some(owner)) = (webview, app.get_window(&host.owner)) {
        if webview.window().label() == label {
            webview.reparent(&owner).map_err(|e| e.to_string())?;
            page_returned(&webview);
            // The owner lays it out again where its tab is shown.
            let _ = webview.hide();
        }
    }
    forget(app, label);
    if let Some(window) = app.get_window(label) {
        let _ = window.destroy();
    }
    let _ = app.emit_to(
        host.owner.as_str(),
        EVENT,
        json!({ "action": "attached", "id": label, "tab": host.tab }),
    );
    Ok(())
}

/// A press in a host window's bar.
#[tauri::command]
pub fn agent_dock_host_action(window: Window, app: AppHandle, action: String) -> Result<(), String> {
    let label = window.label().to_owned();
    let (owner, name) = {
        let hosts = hosts().lock().map_err(|_| "agent_dock_unavailable")?;
        let host = hosts.get(&label).ok_or("This agent window has closed.")?;
        (host.owner.clone(), host.name.clone())
    };
    match action.as_str() {
        "dock" => dock(&app, &label, &name),
        "attach" => attach(&app, &label),
        "stop" => app
            .emit_to(owner.as_str(), EVENT, json!({ "action": "stop", "id": label }))
            .map_err(|e| e.to_string()),
        _ => Err("Unknown agent window action.".into()),
    }
}

/// Whether a browser webview sits in a dock host other than `caller`'s window.
/// The window it came from must not hide, move or resize it while it is away:
/// a hidden page stops painting.
pub fn hosted_elsewhere(caller: &str, webview_window: &str) -> bool {
    webview_window.starts_with(HOST_PREFIX) && webview_window != caller
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_agent_windows_and_hosts_dock() {
        assert!(is_agent_window(
            "misty-agent-01951d32-40ac-7000-8000-000000000001"
        ));
        assert!(!is_agent_window("misty-agent-host"));
        assert!(!is_agent_window("main"));
    }

    #[test]
    fn the_person_s_window_leaves_detached_tabs_alone() {
        assert!(hosted_elsewhere("main", "misty-dock-1"));
        assert!(!hosted_elsewhere("misty-dock-1", "misty-dock-1"));
        assert!(!hosted_elsewhere("main", "main"));
    }
}
