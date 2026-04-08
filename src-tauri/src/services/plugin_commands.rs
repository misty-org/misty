use std::{
    collections::BTreeMap,
    ffi::{c_char, c_float, c_int, c_void, CStr},
    fs,
    path::{Component, Path, PathBuf},
    process::Command,
    ptr,
    time::{SystemTime, UNIX_EPOCH},
};

use libloading::Library;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{ApiError, ApiResult};
use crate::services::environment::AppEnvironmentService;
use crate::services::system_dependencies::resolve_executable;

const REMOVED_EXTENSION_IDS: &[&str] = &["git", "preview-panel", "preview_panel", "vault"];

#[derive(Debug, Clone)]
pub struct PluginCommandService {
    roots: Vec<PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommandsSnapshot {
    pub roots: Vec<String>,
    pub commands: Vec<PluginCommandEntry>,
    pub panels: Vec<PluginPanelEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDiagnosticsSnapshot {
    pub roots: Vec<String>,
    pub plugins: Vec<PluginDiagnosticsEntry>,
    pub removed_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDiagnosticsEntry {
    pub plugin_id: String,
    pub plugin_name: String,
    pub plugin_dir: String,
    pub installed: bool,
    pub enabled: bool,
    pub runtime_status: String,
    pub commands: Vec<PluginCommandEntry>,
    pub panels: Vec<PluginPanelEntry>,
    pub missing_dependencies: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunPluginCommandRequest {
    pub command_id: String,
    #[serde(default)]
    pub selected_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommandRunResult {
    pub command_id: String,
    pub plugin_id: String,
    pub plugin_name: String,
    pub label: String,
    pub handled: bool,
    pub target_route: String,
    pub message: String,
    pub notifications: Vec<PluginPanelNotification>,
    pub runtime_status: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommandEntry {
    pub id: String,
    pub label: String,
    pub hint: String,
    pub plugin_id: String,
    pub plugin_name: String,
    pub default_shortcut: String,
    pub source: String,
    pub action_kind: String,
    pub launcher_open_mode: String,
    pub requires_selected_file: bool,
    pub plugin_dir: String,
    pub manifest_path: String,
    pub library_path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginPanelEntry {
    pub id: String,
    pub title: String,
    pub plugin_id: String,
    pub plugin_name: String,
    pub window_type: String,
    pub default_width: f32,
    pub default_height: f32,
    pub plugin_dir: String,
    pub manifest_path: String,
    pub library_path: String,
    pub web_entry: String,
    pub launcher_views: Vec<String>,
}

#[derive(Debug, Clone)]
struct PluginMetadata {
    id: String,
    name: String,
    description: String,
    enabled: bool,
    installed: bool,
    launcher_enabled: bool,
    launcher_open_mode: String,
    launcher_views: Vec<String>,
    requires_selected_file: bool,
    plugin_dir: String,
    manifest_path: String,
    library_path: String,
}

type MistyPluginAbiVersionFn = unsafe extern "C" fn() -> u32;
type MistyPluginRegisterFn = unsafe extern "C" fn(*const MistyPluginContext) -> c_int;
type MistyCommandInvokeFn = unsafe extern "C" fn(*const MistyInvokeContext, *mut c_void);
type MistyPanelRenderFn = unsafe extern "C" fn(*const MistyRenderContext, *mut c_void);

const MISTY_PLUGIN_ABI_VERSION: u32 = 4;

#[repr(C)]
struct MistyViewCapabilities {
    tabs: c_int,
    split: c_int,
}

#[repr(C)]
struct MistyHostApi {
    version: u32,
    open_panel: unsafe extern "C" fn(*mut c_void, *const c_char) -> c_int,
    close_panel: unsafe extern "C" fn(*mut c_void, *const c_char) -> c_int,
    is_panel_open: unsafe extern "C" fn(*mut c_void, *const c_char) -> c_int,
    invoke_command: unsafe extern "C" fn(*mut c_void, *const c_char) -> c_int,
    copy_current_view_id: unsafe extern "C" fn(*mut c_void, *mut c_char, usize) -> c_int,
    notify: unsafe extern "C" fn(*mut c_void, c_int, *const c_char, *const c_char),
    create_texture: unsafe extern "C" fn(*mut c_void, c_int, c_int, *const u8) -> u32,
    destroy_texture: unsafe extern "C" fn(*mut c_void, u32),
    copy_selected_file_path: unsafe extern "C" fn(*mut c_void, *mut c_char, usize) -> c_int,
    set_preview_scene: unsafe extern "C" fn(*mut c_void, *const c_char),
    get_view_capabilities:
        unsafe extern "C" fn(*mut c_void, *const c_char, *mut MistyViewCapabilities) -> c_int,
    open_panel_in_view:
        unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char, c_int) -> c_int,
    get_theme_color: unsafe extern "C" fn(*mut c_void, *const c_char, *mut c_float) -> c_int,
    set_theme_color: unsafe extern "C" fn(*mut c_void, *const c_char, *const c_float) -> c_int,
    apply_theme_preset: unsafe extern "C" fn(*mut c_void, *const c_char) -> c_int,
}

#[repr(C)]
struct MistyRegistryApi {
    version: u32,
    register_command: unsafe extern "C" fn(*mut c_void, *const MistyCommandReg) -> c_int,
    register_panel: unsafe extern "C" fn(*mut c_void, *const MistyPanelReg) -> c_int,
}

#[repr(C)]
struct MistyInvokeContext {
    version: u32,
    host_handle: *mut c_void,
    host_api: *const MistyHostApi,
}

#[repr(C)]
struct MistyRenderContext {
    version: u32,
    host_handle: *mut c_void,
    host_api: *const MistyHostApi,
    ui_handle: *mut c_void,
    ui_api: *const MistyUiApi,
}

#[repr(C)]
struct MistyUiApi {
    version: u32,
    text: unsafe extern "C" fn(*mut c_void, *const c_char),
    text_wrapped: unsafe extern "C" fn(*mut c_void, *const c_char),
    button: unsafe extern "C" fn(*mut c_void, *const c_char, c_float, c_float) -> c_int,
    same_line: unsafe extern "C" fn(*mut c_void),
    separator: unsafe extern "C" fn(*mut c_void),
    spacing: unsafe extern "C" fn(*mut c_void),
    image: unsafe extern "C" fn(*mut c_void, u32, c_float, c_float),
    get_content_region_avail: unsafe extern "C" fn(*mut c_void, *mut c_float, *mut c_float),
    begin_child: unsafe extern "C" fn(*mut c_void, *const c_char, c_float, c_float, c_int) -> c_int,
    end_child: unsafe extern "C" fn(*mut c_void),
    input_text: unsafe extern "C" fn(*mut c_void, *const c_char, *mut c_char, usize) -> c_int,
}

#[repr(C)]
struct MistyCommandReg {
    version: u32,
    id: *const c_char,
    title: *const c_char,
    default_shortcut: *const c_char,
    invoke: Option<MistyCommandInvokeFn>,
    user_data: *mut c_void,
}

#[repr(C)]
struct MistyPanelReg {
    version: u32,
    id: *const c_char,
    title: *const c_char,
    default_open: c_int,
    window_type: c_int,
    default_width: c_float,
    default_height: c_float,
    render: Option<MistyPanelRenderFn>,
    user_data: *mut c_void,
}

#[repr(C)]
struct MistyPluginContext {
    version: u32,
    host_handle: *mut c_void,
    host_api: *const MistyHostApi,
    registry_handle: *mut c_void,
    registry_api: *const MistyRegistryApi,
}

#[derive(Default)]
struct NativePluginRegistry {
    commands: Vec<NativePluginCommand>,
    panels: Vec<NativePluginPanel>,
}

struct NativePluginCommand {
    id: String,
    title: String,
    default_shortcut: String,
    invoke: Option<MistyCommandInvokeFn>,
    user_data: *mut c_void,
}

struct NativePluginPanel {
    id: String,
    title: String,
    window_type: c_int,
    default_width: c_float,
    default_height: c_float,
    render: Option<MistyPanelRenderFn>,
    user_data: *mut c_void,
}

#[derive(Default)]
struct NativePluginHostState {
    selected_paths: Vec<String>,
    opened_panel_id: Option<String>,
    opened_panel_mode: c_int,
    notifications: Vec<NativePluginNotification>,
    registry: *const NativePluginRegistry,
    invoke_depth: usize,
}

struct NativePluginNotification {
    level: c_int,
    title: String,
    message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderPluginPanelRequest {
    pub panel_id: String,
    #[serde(default)]
    pub plugin_id: String,
    #[serde(default)]
    pub selected_paths: Vec<String>,
    #[serde(default)]
    pub clicked_button: String,
    #[serde(default)]
    pub inputs: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginPanelRenderResult {
    pub panel_id: String,
    pub plugin_id: String,
    pub plugin_name: String,
    pub title: String,
    pub elements: Vec<PluginPanelElement>,
    pub notifications: Vec<PluginPanelNotification>,
    pub message: String,
    pub runtime_status: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginPanelElement {
    pub kind: String,
    pub id: String,
    pub text: String,
    pub width: f32,
    pub height: f32,
    pub border: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginPanelNotification {
    pub level: String,
    pub title: String,
    pub message: String,
}

#[derive(Default)]
struct NativePluginUiState {
    elements: Vec<PluginPanelElement>,
    clicked_button: String,
    inputs: BTreeMap<String, String>,
    child_depth: usize,
}

static HOST_API: MistyHostApi = MistyHostApi {
    version: MISTY_PLUGIN_ABI_VERSION,
    open_panel: host_open_panel,
    close_panel: host_close_panel,
    is_panel_open: host_is_panel_open,
    invoke_command: host_invoke_command,
    copy_current_view_id: host_copy_current_view_id,
    notify: host_notify,
    create_texture: host_create_texture,
    destroy_texture: host_destroy_texture,
    copy_selected_file_path: host_copy_selected_file_path,
    set_preview_scene: host_set_preview_scene,
    get_view_capabilities: host_get_view_capabilities,
    open_panel_in_view: host_open_panel_in_view,
    get_theme_color: host_get_theme_color,
    set_theme_color: host_set_theme_color,
    apply_theme_preset: host_apply_theme_preset,
};

static REGISTRY_API: MistyRegistryApi = MistyRegistryApi {
    version: MISTY_PLUGIN_ABI_VERSION,
    register_command: registry_register_command,
    register_panel: registry_register_panel,
};

static UI_API: MistyUiApi = MistyUiApi {
    version: MISTY_PLUGIN_ABI_VERSION,
    text: ui_text,
    text_wrapped: ui_text_wrapped,
    button: ui_button,
    same_line: ui_same_line,
    separator: ui_separator,
    spacing: ui_spacing,
    image: ui_image,
    get_content_region_avail: ui_get_content_region_avail,
    begin_child: ui_begin_child,
    end_child: ui_end_child,
    input_text: ui_input_text,
};

impl PluginCommandService {
    pub fn new(environment: AppEnvironmentService) -> Self {
        Self {
            roots: vec![
                environment.plugins_private_dir(),
                environment.plugins_public_dir(),
            ],
        }
    }

    pub async fn snapshot(&self) -> ApiResult<PluginCommandsSnapshot> {
        let roots = self.roots.clone();
        tokio::task::spawn_blocking(move || snapshot_plugin_commands(roots))
            .await
            .map_err(|err| ApiError::Message(format!("Extension command worker failed: {err}")))?
    }

    pub async fn run_command(
        &self,
        request: RunPluginCommandRequest,
    ) -> ApiResult<PluginCommandRunResult> {
        let roots = self.roots.clone();
        tokio::task::spawn_blocking(move || run_plugin_command(roots, request))
            .await
            .map_err(|err| ApiError::Message(format!("Extension command worker failed: {err}")))?
    }

    pub async fn render_panel(
        &self,
        request: RenderPluginPanelRequest,
    ) -> ApiResult<PluginPanelRenderResult> {
        let roots = self.roots.clone();
        tokio::task::spawn_blocking(move || render_plugin_panel(roots, request))
            .await
            .map_err(|err| ApiError::Message(format!("Extension panel worker failed: {err}")))?
    }

    pub async fn diagnostics(&self) -> ApiResult<PluginDiagnosticsSnapshot> {
        let roots = self.roots.clone();
        tokio::task::spawn_blocking(move || plugin_diagnostics_snapshot(roots))
            .await
            .map_err(|err| {
                ApiError::Message(format!("Extension diagnostics worker failed: {err}"))
            })?
    }
}

fn render_plugin_panel(
    roots: Vec<PathBuf>,
    request: RenderPluginPanelRequest,
) -> ApiResult<PluginPanelRenderResult> {
    let panel_id = request.panel_id.trim();
    if panel_id.is_empty() {
        return Err(ApiError::Message(
            "Extension panel id is required.".to_owned(),
        ));
    }
    let snapshot = snapshot_plugin_commands(roots)?;
    let panel = snapshot
        .panels
        .into_iter()
        .find(|panel| panel_matches_render_request(panel, panel_id, request.plugin_id.trim()))
        .ok_or_else(|| ApiError::Message(format!("Extension panel {panel_id} was not found.")))?;
    Ok(render_result_for_panel(panel, request))
}

fn panel_matches_render_request(panel: &PluginPanelEntry, panel_id: &str, plugin_id: &str) -> bool {
    panel.id == panel_id && (plugin_id.is_empty() || panel.plugin_id == plugin_id)
}

fn render_result_for_panel(
    panel: PluginPanelEntry,
    request: RenderPluginPanelRequest,
) -> PluginPanelRenderResult {
    if built_in_plugin_id(&panel.plugin_id).is_some() {
        return render_builtin_plugin_panel(panel, request);
    }

    if panel.library_path.is_empty() {
        return panel_render_failure(
            panel,
            "No runtime library was advertised for this platform.".to_owned(),
            "native_runtime_unavailable",
        );
    }

    let (library, registry) = match load_native_plugin(&panel.library_path) {
        Ok(loaded) => loaded,
        Err(error) => return panel_render_failure(panel, error, "native_load_failed"),
    };
    let Some(native_panel) = registry
        .panels
        .iter()
        .find(|registered| registered.id == panel.id)
    else {
        drop(library);
        return panel_render_failure(
            panel,
            "The native extension did not register this panel for the current platform.".to_owned(),
            "native_panel_missing",
        );
    };
    let Some(render) = native_panel.render else {
        drop(library);
        return panel_render_failure(
            panel,
            "The native extension panel does not expose a render callback.".to_owned(),
            "native_render_missing",
        );
    };

    let mut host_state = NativePluginHostState {
        selected_paths: request.selected_paths,
        registry: &registry,
        ..NativePluginHostState::default()
    };
    let mut ui_state = NativePluginUiState {
        clicked_button: request.clicked_button,
        inputs: request.inputs,
        ..NativePluginUiState::default()
    };
    let context = MistyRenderContext {
        version: MISTY_PLUGIN_ABI_VERSION,
        host_handle: (&mut host_state as *mut NativePluginHostState).cast::<c_void>(),
        host_api: &HOST_API,
        ui_handle: (&mut ui_state as *mut NativePluginUiState).cast::<c_void>(),
        ui_api: &UI_API,
    };
    unsafe {
        render(&context, native_panel.user_data);
    }
    let notifications = plugin_panel_notifications(host_state.notifications);
    let message = notifications
        .last()
        .map(|notification| {
            if notification.message.is_empty() {
                notification.title.clone()
            } else if notification.title.is_empty() {
                notification.message.clone()
            } else {
                format!("{} - {}", notification.title, notification.message)
            }
        })
        .unwrap_or_else(|| format!("Rendered {}.", panel.title));
    drop(library);

    PluginPanelRenderResult {
        panel_id: panel.id,
        plugin_id: panel.plugin_id,
        plugin_name: panel.plugin_name,
        title: panel.title,
        elements: ui_state.elements,
        notifications,
        message,
        runtime_status: "native_rendered".to_owned(),
    }
}

fn panel_render_failure(
    panel: PluginPanelEntry,
    message: String,
    runtime_status: &str,
) -> PluginPanelRenderResult {
    PluginPanelRenderResult {
        panel_id: panel.id,
        plugin_id: panel.plugin_id,
        plugin_name: panel.plugin_name,
        title: panel.title,
        elements: Vec::new(),
        notifications: Vec::new(),
        message,
        runtime_status: runtime_status.to_owned(),
    }
}

fn run_plugin_command(
    roots: Vec<PathBuf>,
    request: RunPluginCommandRequest,
) -> ApiResult<PluginCommandRunResult> {
    let command_id = request.command_id.trim();
    if command_id.is_empty() {
        return Err(ApiError::Message(
            "Extension command id is required.".to_owned(),
        ));
    }
    let snapshot = snapshot_plugin_commands(roots)?;
    let command = snapshot
        .commands
        .into_iter()
        .find(|command| command.id == command_id)
        .ok_or_else(|| {
            ApiError::Message(format!("Extension command {command_id} was not found."))
        })?;
    Ok(run_result_for_command(command, request.selected_paths))
}

fn run_result_for_command(
    command: PluginCommandEntry,
    selected_paths: Vec<String>,
) -> PluginCommandRunResult {
    if command.requires_selected_file && selected_paths.is_empty() {
        return PluginCommandRunResult {
            command_id: command.id,
            plugin_id: command.plugin_id.clone(),
            plugin_name: command.plugin_name,
            label: command.label,
            handled: false,
            target_route: String::new(),
            message: "This command requires a selected file.".to_owned(),
            notifications: Vec::new(),
            runtime_status: "missing_selection".to_owned(),
        };
    }

    let opens_launcher =
        command.source == "launcher" || command.action_kind == "open" || is_open_action(&command);
    if opens_launcher {
        let selected_path = selected_paths
            .first()
            .map(String::as_str)
            .filter(|path| !path.trim().is_empty());
        return PluginCommandRunResult {
            command_id: command.id,
            plugin_id: command.plugin_id.clone(),
            plugin_name: command.plugin_name.clone(),
            label: command.label,
            handled: true,
            target_route: plugin_popup_route(&command.plugin_id, selected_path),
            message: format!(
                "Opened {}{}.",
                command.plugin_name,
                if command.launcher_open_mode.is_empty() {
                    String::new()
                } else {
                    format!(" ({})", command.launcher_open_mode)
                }
            ),
            notifications: Vec::new(),
            runtime_status: "opened".to_owned(),
        };
    }

    if command.source == "builtin" {
        return run_builtin_plugin_command(command, selected_paths);
    }

    if !command.library_path.is_empty() {
        return run_native_plugin_command(command, selected_paths);
    }

    PluginCommandRunResult {
        command_id: command.id,
        plugin_id: command.plugin_id.clone(),
        plugin_name: command.plugin_name,
        label: command.label,
        handled: false,
        target_route: String::new(),
        message: "No runtime library was advertised for this platform.".to_owned(),
        notifications: Vec::new(),
        runtime_status: "native_runtime_unavailable".to_owned(),
    }
}

fn is_open_action(command: &PluginCommandEntry) -> bool {
    command.source == "action"
        && command
            .label
            .rsplit_once(':')
            .map(|(_, action)| action.trim().eq_ignore_ascii_case("open"))
            .unwrap_or_else(|| command.label.trim().eq_ignore_ascii_case("open"))
}

fn run_native_plugin_command(
    command: PluginCommandEntry,
    selected_paths: Vec<String>,
) -> PluginCommandRunResult {
    let (library, registry) = match load_native_plugin(&command.library_path) {
        Ok(loaded) => loaded,
        Err(error) => {
            return native_plugin_failure(command, error, "native_load_failed");
        }
    };
    let Some(native_command) = registry
        .commands
        .iter()
        .find(|registered| registered.id == command.id)
    else {
        drop(library);
        return native_plugin_failure(
            command,
            "The native extension did not register this command for the current platform."
                .to_owned(),
            "native_command_missing",
        );
    };
    let Some(invoke) = native_command.invoke else {
        drop(library);
        return native_plugin_failure(
            command,
            "The native extension command does not expose an invoke callback.".to_owned(),
            "native_invoke_missing",
        );
    };

    let mut host_state = NativePluginHostState {
        selected_paths,
        registry: &registry,
        ..NativePluginHostState::default()
    };
    let context = MistyInvokeContext {
        version: MISTY_PLUGIN_ABI_VERSION,
        host_handle: (&mut host_state as *mut NativePluginHostState).cast::<c_void>(),
        host_api: &HOST_API,
    };
    unsafe {
        invoke(&context, native_command.user_data);
    }

    let notifications = plugin_panel_notifications(host_state.notifications);
    let notification_message = notifications
        .last()
        .map(|notification| {
            let severity = match notification.level.as_str() {
                "success" => "Success",
                "error" => "Error",
                _ => "Info",
            };
            if notification.title.is_empty() {
                format!("{severity}: {}", notification.message)
            } else if notification.message.is_empty() {
                format!("{severity}: {}", notification.title)
            } else {
                format!(
                    "{severity}: {} - {}",
                    notification.title, notification.message
                )
            }
        })
        .filter(|message| !message.trim().is_empty());
    let opened_panel = host_state
        .opened_panel_id
        .as_deref()
        .filter(|panel| !panel.is_empty());
    let selected_path = host_state
        .selected_paths
        .first()
        .map(String::as_str)
        .filter(|path| !path.trim().is_empty());
    let target_route = opened_panel
        .map(|_| plugin_popup_route(&command.plugin_id, selected_path))
        .unwrap_or_default();
    let message = notification_message.unwrap_or_else(|| {
        if let Some(panel) = opened_panel {
            format!("Opened {} ({panel}).", command.plugin_name)
        } else {
            format!("Ran {}.", command.label)
        }
    });
    drop(library);

    PluginCommandRunResult {
        command_id: command.id,
        plugin_id: command.plugin_id,
        plugin_name: command.plugin_name,
        label: command.label,
        handled: true,
        target_route,
        message,
        notifications,
        runtime_status: if host_state.opened_panel_mode == 2 {
            "native_opened_split".to_owned()
        } else {
            "native_executed".to_owned()
        },
    }
}

fn native_plugin_failure(
    command: PluginCommandEntry,
    message: String,
    runtime_status: &str,
) -> PluginCommandRunResult {
    PluginCommandRunResult {
        command_id: command.id,
        plugin_id: command.plugin_id.clone(),
        plugin_name: command.plugin_name,
        label: command.label,
        handled: false,
        target_route: String::new(),
        message,
        notifications: Vec::new(),
        runtime_status: runtime_status.to_owned(),
    }
}

fn snapshot_plugin_commands(roots: Vec<PathBuf>) -> ApiResult<PluginCommandsSnapshot> {
    purge_removed_extension_dirs(&roots)?;
    let mut commands = BTreeMap::<String, PluginCommandEntry>::new();
    let mut panels = BTreeMap::<String, PluginPanelEntry>::new();
    for root in &roots {
        if !root.is_dir() {
            continue;
        }
        let entries = fs::read_dir(root).map_err(|err| {
            ApiError::Message(format!(
                "Failed to read extension root {}: {err}",
                root.display()
            ))
        })?;
        for entry in entries.flatten() {
            let plugin_dir = entry.path();
            if !plugin_dir.is_dir() {
                continue;
            }
            let discovered = plugin_entries_for_plugin_dir(&plugin_dir)?;
            for command in discovered.commands {
                commands.entry(command.id.clone()).or_insert(command);
            }
            for panel in discovered.panels {
                panels.entry(plugin_panel_key(&panel)).or_insert(panel);
            }
        }
    }

    Ok(PluginCommandsSnapshot {
        roots: roots
            .iter()
            .map(|root| root.display().to_string())
            .collect(),
        commands: commands.into_values().collect(),
        panels: panels.into_values().collect(),
    })
}

struct PluginEntries {
    commands: Vec<PluginCommandEntry>,
    panels: Vec<PluginPanelEntry>,
}

fn plugin_entries_for_plugin_dir(plugin_dir: &Path) -> ApiResult<PluginEntries> {
    let detail = read_json(plugin_dir.join("plugin.json"))
        .or_else(|| read_json(plugin_dir.join("detail.json")));
    let manifest = read_json(plugin_dir.join("manifest.json"));
    let metadata = plugin_metadata(plugin_dir, detail.as_ref(), manifest.as_ref());
    if removed_extension_id(&metadata.id) {
        return Ok(PluginEntries {
            commands: Vec::new(),
            panels: Vec::new(),
        });
    }
    if !metadata.enabled || !metadata.installed {
        return Ok(PluginEntries {
            commands: Vec::new(),
            panels: Vec::new(),
        });
    }

    let mut commands = Vec::new();
    let mut panels = Vec::new();
    if let Some(detail) = detail.as_ref() {
        commands.extend(static_commands_from_json(detail, &metadata, "detail"));
        commands.extend(action_commands_from_json(detail, &metadata));
        panels.extend(static_panels_from_json(detail, &metadata));
    }
    if let Some(manifest) = manifest.as_ref() {
        commands.extend(static_commands_from_json(manifest, &metadata, "manifest"));
        panels.extend(static_panels_from_json(manifest, &metadata));
        if let Some(plugin) = manifest.get("plugin") {
            commands.extend(static_commands_from_json(plugin, &metadata, "manifest"));
            panels.extend(static_panels_from_json(plugin, &metadata));
        }
    }
    if !panels.iter().any(|panel| !panel.web_entry.is_empty()) {
        commands.extend(built_in_commands_for_plugin(&metadata));
        panels.extend(built_in_panels_for_plugin(&metadata));
    }
    if !metadata.library_path.is_empty() {
        if let Ok((library, native_entries)) = load_native_plugin(&metadata.library_path) {
            commands.extend(
                native_entries
                    .commands
                    .iter()
                    .map(|command| PluginCommandEntry {
                        id: command.id.clone(),
                        label: command.title.clone(),
                        hint: if metadata.description.is_empty() {
                            format!("Run {} from {}", command.title, metadata.name)
                        } else {
                            metadata.description.clone()
                        },
                        plugin_id: metadata.id.clone(),
                        plugin_name: metadata.name.clone(),
                        default_shortcut: command.default_shortcut.clone(),
                        source: "native".to_owned(),
                        action_kind: "invoke".to_owned(),
                        launcher_open_mode: metadata.launcher_open_mode.clone(),
                        requires_selected_file: metadata.requires_selected_file,
                        plugin_dir: metadata.plugin_dir.clone(),
                        manifest_path: metadata.manifest_path.clone(),
                        library_path: metadata.library_path.clone(),
                    }),
            );
            panels.extend(native_entries.panels.iter().map(|panel| {
                PluginPanelEntry {
                    id: panel.id.clone(),
                    title: panel.title.clone(),
                    plugin_id: metadata.id.clone(),
                    plugin_name: metadata.name.clone(),
                    window_type: match panel.window_type {
                        1 => "external",
                        _ => "panel",
                    }
                    .to_owned(),
                    default_width: panel.default_width,
                    default_height: panel.default_height,
                    plugin_dir: metadata.plugin_dir.clone(),
                    manifest_path: metadata.manifest_path.clone(),
                    library_path: metadata.library_path.clone(),
                    web_entry: String::new(),
                    launcher_views: metadata.launcher_views.clone(),
                }
            }));
            drop(library);
        }
    }
    if metadata.launcher_enabled
        && !commands
            .iter()
            .any(|command| command.id == launcher_command_id(&metadata.id))
    {
        commands.push(PluginCommandEntry {
            id: launcher_command_id(&metadata.id),
            label: format!("Open {}", metadata.name),
            hint: if metadata.description.is_empty() {
                "Open extension from the launcher".to_owned()
            } else {
                metadata.description.clone()
            },
            plugin_id: metadata.id.clone(),
            plugin_name: metadata.name.clone(),
            default_shortcut: String::new(),
            source: "launcher".to_owned(),
            action_kind: "open".to_owned(),
            launcher_open_mode: metadata.launcher_open_mode.clone(),
            requires_selected_file: metadata.requires_selected_file,
            plugin_dir: metadata.plugin_dir.clone(),
            manifest_path: metadata.manifest_path.clone(),
            library_path: metadata.library_path.clone(),
        });
    }
    Ok(PluginEntries { commands, panels })
}

fn plugin_diagnostics_snapshot(roots: Vec<PathBuf>) -> ApiResult<PluginDiagnosticsSnapshot> {
    purge_removed_extension_dirs(&roots)?;
    let mut plugins = Vec::new();
    for root in &roots {
        if !root.is_dir() {
            continue;
        }
        let entries = fs::read_dir(root).map_err(|err| {
            ApiError::Message(format!(
                "Failed to read extension root {}: {err}",
                root.display()
            ))
        })?;
        for entry in entries.flatten() {
            let plugin_dir = entry.path();
            if !plugin_dir.is_dir() {
                continue;
            }
            let detail = read_json(plugin_dir.join("plugin.json"))
                .or_else(|| read_json(plugin_dir.join("detail.json")));
            let manifest = read_json(plugin_dir.join("manifest.json"));
            let metadata = plugin_metadata(&plugin_dir, detail.as_ref(), manifest.as_ref());
            if removed_extension_id(&metadata.id) {
                continue;
            }
            let mut errors = Vec::new();
            let entries = match plugin_entries_for_plugin_dir(&plugin_dir) {
                Ok(entries) => entries,
                Err(error) => {
                    errors.push(error.to_string());
                    PluginEntries {
                        commands: Vec::new(),
                        panels: Vec::new(),
                    }
                }
            };
            let runtime_status = if !metadata.enabled {
                "disabled".to_owned()
            } else if built_in_plugin_id(&metadata.id).is_some() {
                "builtin_injected".to_owned()
            } else if metadata.library_path.is_empty() {
                "static_only".to_owned()
            } else {
                match load_native_plugin(&metadata.library_path) {
                    Ok(_) => "native_loaded".to_owned(),
                    Err(error) => {
                        errors.push(error);
                        "native_load_failed".to_owned()
                    }
                }
            };
            plugins.push(PluginDiagnosticsEntry {
                plugin_id: metadata.id.clone(),
                plugin_name: metadata.name.clone(),
                plugin_dir: metadata.plugin_dir,
                installed: metadata.installed,
                enabled: metadata.enabled,
                runtime_status,
                commands: entries.commands,
                panels: entries.panels,
                missing_dependencies: missing_dependencies_for_plugin(&metadata.id),
                errors,
            });
        }
    }
    plugins.sort_by(|left, right| {
        left.plugin_name
            .to_lowercase()
            .cmp(&right.plugin_name.to_lowercase())
    });
    Ok(PluginDiagnosticsSnapshot {
        roots: roots
            .iter()
            .map(|root| root.display().to_string())
            .collect(),
        plugins,
        removed_ids: REMOVED_EXTENSION_IDS
            .iter()
            .map(|id| (*id).to_owned())
            .collect(),
    })
}

fn plugin_metadata(
    plugin_dir: &Path,
    detail: Option<&Value>,
    manifest: Option<&Value>,
) -> PluginMetadata {
    let fallback_id = plugin_dir
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("plugin")
        .to_owned();
    let id = plugin_metadata_field(detail, manifest, "id").unwrap_or(fallback_id);
    let name = plugin_metadata_field(detail, manifest, "name").unwrap_or_else(|| id.clone());
    let description = plugin_metadata_field(detail, manifest, "overview")
        .or_else(|| plugin_metadata_field(detail, manifest, "description"))
        .unwrap_or_default();
    let status = plugin_metadata_field(detail, manifest, "status")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let enabled = manifest
        .and_then(|value| value.get("enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let launcher_enabled = launcher_field(detail, manifest, "show_in_launcher")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let launcher_views = launcher_field(detail, manifest, "views")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .filter(|views| !views.is_empty())
        .unwrap_or_else(|| vec!["Extensions".to_owned(), "Dock".to_owned()]);
    let launcher_open_mode = launcher_field(detail, manifest, "open_mode")
        .and_then(Value::as_str)
        .unwrap_or("tab")
        .trim()
        .to_owned();
    let requires_selected_file = launcher_field(detail, manifest, "requires_selected_file")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let manifest_path = plugin_dir.join("manifest.json");
    let library_path = manifest
        .and_then(|manifest| current_platform_library_path(plugin_dir, manifest))
        .map(|path| path.display().to_string())
        .unwrap_or_default();

    PluginMetadata {
        id,
        name,
        description,
        enabled,
        installed: status.is_empty() || status == "installed" || status == "enabled",
        launcher_enabled,
        launcher_open_mode,
        launcher_views,
        requires_selected_file,
        plugin_dir: plugin_dir.display().to_string(),
        manifest_path: if manifest_path.is_file() {
            manifest_path.display().to_string()
        } else {
            String::new()
        },
        library_path,
    }
}

fn plugin_metadata_field(
    detail: Option<&Value>,
    manifest: Option<&Value>,
    key: &str,
) -> Option<String> {
    string_field(detail, key)
        .or_else(|| string_field(manifest, key))
        .or_else(|| {
            manifest
                .and_then(|value| value.get("plugin"))
                .and_then(|plugin| string_field(Some(plugin), key))
        })
}

fn launcher_field<'a>(
    detail: Option<&'a Value>,
    manifest: Option<&'a Value>,
    key: &str,
) -> Option<&'a Value> {
    detail
        .and_then(|value| value.get("launcher"))
        .and_then(|launcher| launcher.get(key))
        .or_else(|| {
            manifest
                .and_then(|value| value.get("launcher"))
                .and_then(|launcher| launcher.get(key))
        })
        .or_else(|| {
            manifest
                .and_then(|value| value.get("plugin"))
                .and_then(|plugin| plugin.get("launcher"))
                .and_then(|launcher| launcher.get(key))
        })
}

fn static_commands_from_json(
    value: &Value,
    plugin: &PluginMetadata,
    source: &str,
) -> Vec<PluginCommandEntry> {
    let Some(commands) = value.get("commands").and_then(Value::as_array) else {
        return Vec::new();
    };
    commands
        .iter()
        .filter_map(|command| static_command_from_json(command, plugin, source))
        .collect()
}

fn static_command_from_json(
    command: &Value,
    plugin: &PluginMetadata,
    source: &str,
) -> Option<PluginCommandEntry> {
    let id = string_field(Some(command), "id")
        .or_else(|| string_field(Some(command), "command_id"))
        .or_else(|| string_field(Some(command), "commandId"))?;
    let label = string_field(Some(command), "title")
        .or_else(|| string_field(Some(command), "label"))
        .or_else(|| string_field(Some(command), "name"))
        .unwrap_or_else(|| id.clone());
    let hint = string_field(Some(command), "hint")
        .or_else(|| string_field(Some(command), "description"))
        .unwrap_or_else(|| format!("Run {} from {}", label, plugin.name));
    let default_shortcut = string_field(Some(command), "default_shortcut")
        .or_else(|| string_field(Some(command), "defaultShortcut"))
        .or_else(|| string_field(Some(command), "shortcut"))
        .unwrap_or_default();

    if id.trim().is_empty() || label.trim().is_empty() {
        return None;
    }

    Some(PluginCommandEntry {
        id: id.trim().to_owned(),
        label: label.trim().to_owned(),
        hint: hint.trim().to_owned(),
        plugin_id: plugin.id.clone(),
        plugin_name: plugin.name.clone(),
        default_shortcut: default_shortcut.trim().to_owned(),
        source: source.to_owned(),
        action_kind: String::new(),
        launcher_open_mode: plugin.launcher_open_mode.clone(),
        requires_selected_file: command_requires_selected_file(
            command,
            plugin.requires_selected_file,
        ),
        plugin_dir: plugin.plugin_dir.clone(),
        manifest_path: plugin.manifest_path.clone(),
        library_path: plugin.library_path.clone(),
    })
}

fn action_commands_from_json(value: &Value, plugin: &PluginMetadata) -> Vec<PluginCommandEntry> {
    let Some(actions) = value.get("actions").and_then(Value::as_array) else {
        return Vec::new();
    };
    actions
        .iter()
        .filter_map(|action| action_command_from_json(action, plugin))
        .collect()
}

fn action_command_from_json(action: &Value, plugin: &PluginMetadata) -> Option<PluginCommandEntry> {
    let label = string_field(Some(action), "label")?;
    let kind = string_field(Some(action), "kind").unwrap_or_else(|| "primary".to_owned());
    let action_id =
        string_field(Some(action), "id").unwrap_or_else(|| action_id_for(&label, &kind));
    if label.trim().is_empty() || action_id.trim().is_empty() {
        return None;
    }
    Some(PluginCommandEntry {
        id: format!("plugin.{}.action.{}", plugin.id, action_id.trim()),
        label: format!("{}: {}", plugin.name, label.trim()),
        hint: plugin.description.clone(),
        plugin_id: plugin.id.clone(),
        plugin_name: plugin.name.clone(),
        default_shortcut: String::new(),
        source: "action".to_owned(),
        action_kind: kind.trim().to_owned(),
        launcher_open_mode: plugin.launcher_open_mode.clone(),
        requires_selected_file: command_requires_selected_file(
            action,
            plugin.requires_selected_file,
        ),
        plugin_dir: plugin.plugin_dir.clone(),
        manifest_path: plugin.manifest_path.clone(),
        library_path: plugin.library_path.clone(),
    })
}

fn action_id_for(label: &str, kind: &str) -> String {
    let slug = label
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>()
        .split('_')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("_");
    if slug.is_empty() {
        kind.to_ascii_lowercase()
    } else {
        slug
    }
}

fn built_in_plugin_id(plugin_id: &str) -> Option<&'static str> {
    match plugin_id
        .trim()
        .to_ascii_lowercase()
        .replace('-', "_")
        .as_str()
    {
        "quick_convert" => Some("quick_convert"),
        "themes" => Some("themes"),
        _ => None,
    }
}

fn built_in_commands_for_plugin(plugin: &PluginMetadata) -> Vec<PluginCommandEntry> {
    let Some(plugin_id) = built_in_plugin_id(&plugin.id) else {
        return Vec::new();
    };
    let commands = match plugin_id {
        "quick_convert" => vec![
            (
                "convert_mp4",
                "Convert selected to MP4",
                "convert_mp4",
                true,
            ),
            (
                "convert_mp3",
                "Convert selected to MP3",
                "convert_mp3",
                true,
            ),
            (
                "convert_png",
                "Convert selected to PNG",
                "convert_png",
                true,
            ),
        ],
        "themes" => vec![
            ("apply_dark", "Apply Dark preset", "apply_dark", false),
            ("apply_light", "Apply Light preset", "apply_light", false),
            (
                "apply_graphite",
                "Apply Graphite preset",
                "apply_graphite",
                false,
            ),
            ("apply_aurora", "Apply Aurora preset", "apply_aurora", false),
            ("apply_copper", "Apply Copper preset", "apply_copper", false),
        ],
        _ => Vec::new(),
    };
    commands
        .into_iter()
        .map(
            |(id, label, action_kind, requires_selected_file)| PluginCommandEntry {
                id: format!("plugin.{}.builtin.{id}", plugin.id),
                label: format!("{}: {label}", plugin.name),
                hint: built_in_command_hint(plugin_id, action_kind),
                plugin_id: plugin.id.clone(),
                plugin_name: plugin.name.clone(),
                default_shortcut: String::new(),
                source: "builtin".to_owned(),
                action_kind: action_kind.to_owned(),
                launcher_open_mode: plugin.launcher_open_mode.clone(),
                requires_selected_file,
                plugin_dir: plugin.plugin_dir.clone(),
                manifest_path: plugin.manifest_path.clone(),
                library_path: plugin.library_path.clone(),
            },
        )
        .collect()
}

fn built_in_command_hint(plugin_id: &str, action_kind: &str) -> String {
    match (plugin_id, action_kind) {
        ("quick_convert", _) => "Convert the selected media file through system FFmpeg.".to_owned(),
        ("themes", _) => "Apply and persist a Misty theme preset.".to_owned(),
        _ => "Run built-in extension action.".to_owned(),
    }
}

fn built_in_panels_for_plugin(plugin: &PluginMetadata) -> Vec<PluginPanelEntry> {
    let Some(plugin_id) = built_in_plugin_id(&plugin.id) else {
        return Vec::new();
    };
    vec![PluginPanelEntry {
        id: format!("{}.builtin", plugin.id),
        title: match plugin_id {
            "quick_convert" => "Quick Convert",
            "themes" => "Themes",
            _ => &plugin.name,
        }
        .to_owned(),
        plugin_id: plugin.id.clone(),
        plugin_name: plugin.name.clone(),
        window_type: "panel".to_owned(),
        default_width: 420.0,
        default_height: 520.0,
        plugin_dir: plugin.plugin_dir.clone(),
        manifest_path: plugin.manifest_path.clone(),
        library_path: plugin.library_path.clone(),
        web_entry: String::new(),
        launcher_views: plugin.launcher_views.clone(),
    }]
}

fn run_builtin_plugin_command(
    command: PluginCommandEntry,
    selected_paths: Vec<String>,
) -> PluginCommandRunResult {
    let result = match built_in_plugin_id(&command.plugin_id) {
        Some("quick_convert") => run_builtin_quick_convert(&command, &selected_paths),
        Some("themes") => run_builtin_themes(&command),
        _ => Err((
            "unknown_builtin",
            "Unknown built-in extension action.".to_owned(),
        )),
    };
    match result {
        Ok(message) => {
            builtin_command_result(command, true, message, "builtin_executed", "success")
        }
        Err((status, message)) => builtin_command_result(command, false, message, status, "error"),
    }
}

fn builtin_command_result(
    command: PluginCommandEntry,
    handled: bool,
    message: String,
    runtime_status: &str,
    level: &str,
) -> PluginCommandRunResult {
    PluginCommandRunResult {
        command_id: command.id,
        plugin_id: command.plugin_id.clone(),
        plugin_name: command.plugin_name,
        label: command.label,
        handled,
        target_route: String::new(),
        notifications: vec![PluginPanelNotification {
            level: level.to_owned(),
            title: "Extension action".to_owned(),
            message: message.clone(),
        }],
        message,
        runtime_status: runtime_status.to_owned(),
    }
}

fn run_builtin_quick_convert(
    command: &PluginCommandEntry,
    selected_paths: &[String],
) -> Result<String, (&'static str, String)> {
    run_builtin_quick_convert_action(&command.action_kind, selected_paths)
}

fn run_builtin_quick_convert_action(
    action_kind: &str,
    selected_paths: &[String],
) -> Result<String, (&'static str, String)> {
    require_command("ffmpeg", "Quick Convert")?;
    let source = selected_file_path(selected_paths, "Quick Convert")?;
    let extension = match action_kind {
        "convert_mp3" => "mp3",
        "convert_png" => "png",
        _ => "mp4",
    };
    let output = output_with_extension(&source, extension);
    let mut process = Command::new("ffmpeg");
    process.arg("-y").arg("-i").arg(&source);
    if extension == "mp3" {
        process.args(["-vn", "-codec:a", "libmp3lame"]);
    }
    process.arg(&output);
    run_system_command(process, "ffmpeg")?;
    Ok(format!(
        "Converted {} to {}.",
        source.display(),
        output.display()
    ))
}

fn run_builtin_themes(command: &PluginCommandEntry) -> Result<String, (&'static str, String)> {
    run_builtin_theme_action(&command.plugin_dir, &command.action_kind)
}

fn run_builtin_theme_action(
    plugin_dir: &str,
    action_kind: &str,
) -> Result<String, (&'static str, String)> {
    let preset = match action_kind {
        "apply_light" => "light",
        "apply_graphite" => "graphite",
        "apply_aurora" => "aurora",
        "apply_copper" => "copper",
        _ => "dark",
    };
    let tokens = match preset {
        "light" => serde_json::json!({
            "preset": "light",
            "tokens": {
                "background": "#f7f7f4",
                "foreground": "#181818",
                "accent": "#2563eb"
            },
            "updatedAtMs": now_ms_for_plugin()
        }),
        "graphite" => serde_json::json!({
            "preset": "graphite",
            "tokens": {
                "background": "#08090a",
                "surface": "#111315",
                "foreground": "#f3f5f7",
                "accent": "#8bd3dd",
                "syntax.keyword": "#ff9ab5",
                "syntax.string": "#9fe6b8",
                "syntax.function": "#9bd1ff"
            },
            "updatedAtMs": now_ms_for_plugin()
        }),
        "aurora" => serde_json::json!({
            "preset": "aurora",
            "tokens": {
                "background": "#071011",
                "surface": "#0d1b1d",
                "foreground": "#effdfb",
                "accent": "#69d2c8",
                "syntax.keyword": "#ff91c0",
                "syntax.string": "#a6e98f",
                "syntax.function": "#8fd7ff"
            },
            "updatedAtMs": now_ms_for_plugin()
        }),
        "copper" => serde_json::json!({
            "preset": "copper",
            "tokens": {
                "background": "#120f0d",
                "surface": "#1d1713",
                "foreground": "#fff4e8",
                "accent": "#e49f6a",
                "syntax.keyword": "#ff9fb4",
                "syntax.string": "#a6df90",
                "syntax.function": "#a9d4ff"
            },
            "updatedAtMs": now_ms_for_plugin()
        }),
        _ => serde_json::json!({
            "preset": "dark",
            "tokens": {
                "background": "#151515",
                "foreground": "#eeeeee",
                "accent": "#7da2b4",
                "syntax.keyword": "#f472b6",
                "syntax.string": "#86efac",
                "syntax.function": "#93c5fd"
            },
            "updatedAtMs": now_ms_for_plugin()
        }),
    };
    let path = Path::new(plugin_dir).join("theme-tokens.json");
    write_pretty_json(&path, &tokens)?;
    Ok(format!("Applied and persisted the {preset} theme preset."))
}

fn run_builtin_theme_custom_accent(
    plugin_dir: &str,
    accent: &str,
) -> Result<String, (&'static str, String)> {
    let accent = accent.trim();
    if !valid_hex_color(accent) {
        return Err((
            "invalid_color",
            "Accent must be a hex color like #7da2b4.".to_owned(),
        ));
    }
    let tokens = serde_json::json!({
        "preset": "custom",
        "tokens": {
            "accent": accent
        },
        "updatedAtMs": now_ms_for_plugin()
    });
    let path = Path::new(plugin_dir).join("theme-tokens.json");
    write_pretty_json(&path, &tokens)?;
    Ok(format!("Saved custom accent token {accent}."))
}

fn render_builtin_plugin_panel(
    panel: PluginPanelEntry,
    request: RenderPluginPanelRequest,
) -> PluginPanelRenderResult {
    let plugin_id = built_in_plugin_id(&panel.plugin_id).unwrap_or_default();
    let action_result = execute_builtin_panel_action(&panel, &request);
    let elements = match plugin_id {
        "quick_convert" => quick_convert_panel_elements(&request),
        "themes" => themes_panel_elements(&request),
        _ => Vec::new(),
    };
    let notifications = action_result
        .as_ref()
        .map(|result| {
            vec![PluginPanelNotification {
                level: if result.handled { "success" } else { "error" }.to_owned(),
                title: panel.title.clone(),
                message: result.message.clone(),
            }]
        })
        .unwrap_or_default();
    let message = action_result
        .map(|result| result.message)
        .unwrap_or_else(|| "Rendered built-in extension panel.".to_owned());
    PluginPanelRenderResult {
        panel_id: panel.id,
        plugin_id: panel.plugin_id,
        plugin_name: panel.plugin_name,
        title: panel.title,
        elements,
        notifications,
        message,
        runtime_status: "native_rendered".to_owned(),
    }
}

struct BuiltinPanelActionResult {
    handled: bool,
    message: String,
}

fn execute_builtin_panel_action(
    panel: &PluginPanelEntry,
    request: &RenderPluginPanelRequest,
) -> Option<BuiltinPanelActionResult> {
    let action = request.clicked_button.trim();
    if action.is_empty() {
        return None;
    }
    let plugin_id = built_in_plugin_id(&panel.plugin_id)?;
    let result = match plugin_id {
        "quick_convert" => run_builtin_quick_convert_action(action, &request.selected_paths),
        "themes" if action == "save_accent" => {
            let accent = request
                .inputs
                .get("accent")
                .map(String::as_str)
                .unwrap_or_default();
            run_builtin_theme_custom_accent(&panel.plugin_dir, accent)
        }
        "themes" => run_builtin_theme_action(&panel.plugin_dir, action),
        _ => Err((
            "unknown_builtin",
            "Unknown built-in extension action.".to_owned(),
        )),
    };
    Some(match result {
        Ok(message) => BuiltinPanelActionResult {
            handled: true,
            message,
        },
        Err((_status, message)) => BuiltinPanelActionResult {
            handled: false,
            message,
        },
    })
}

fn quick_convert_panel_elements(request: &RenderPluginPanelRequest) -> Vec<PluginPanelElement> {
    let selected = request
        .selected_paths
        .first()
        .map(String::as_str)
        .filter(|path| !path.trim().is_empty())
        .unwrap_or("No file selected in Files.");
    vec![
        panel_text("Quick Convert"),
        panel_text("Convert the selected local image, audio, or video file through system FFmpeg."),
        panel_text(&format!("Selection: {selected}")),
        panel_text(&dependency_line("ffmpeg")),
        panel_separator(),
        panel_button("convert_mp4", "Convert to MP4"),
        panel_button("convert_mp3", "Convert to MP3"),
        panel_button("convert_png", "Convert to PNG"),
    ]
}

fn themes_panel_elements(request: &RenderPluginPanelRequest) -> Vec<PluginPanelElement> {
    let accent = request
        .inputs
        .get("accent")
        .map(String::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("#7da2b4");
    vec![
        panel_text("Themes"),
        panel_text("Apply presets or persist an edited accent token for Misty's appearance layer."),
        panel_separator(),
        panel_button("apply_dark", "Apply Dark"),
        panel_button("apply_light", "Apply Light"),
        panel_button("apply_graphite", "Graphite"),
        panel_button("apply_aurora", "Aurora"),
        panel_button("apply_copper", "Copper"),
        panel_input("accent", accent),
        panel_button("save_accent", "Save Accent"),
    ]
}

fn panel_text(text: &str) -> PluginPanelElement {
    PluginPanelElement {
        kind: "textWrapped".to_owned(),
        id: String::new(),
        text: text.to_owned(),
        width: 0.0,
        height: 0.0,
        border: false,
    }
}

fn panel_input(id: &str, text: &str) -> PluginPanelElement {
    PluginPanelElement {
        kind: "inputText".to_owned(),
        id: id.to_owned(),
        text: text.to_owned(),
        width: 320.0,
        height: 0.0,
        border: false,
    }
}

fn panel_button(id: &str, text: &str) -> PluginPanelElement {
    PluginPanelElement {
        kind: "button".to_owned(),
        id: id.to_owned(),
        text: text.to_owned(),
        width: 0.0,
        height: 0.0,
        border: false,
    }
}

fn panel_separator() -> PluginPanelElement {
    PluginPanelElement {
        kind: "separator".to_owned(),
        id: String::new(),
        text: String::new(),
        width: 0.0,
        height: 0.0,
        border: false,
    }
}

fn dependency_line(command: &str) -> String {
    if command_exists(command) {
        format!("Dependency available: {command}")
    } else {
        format!("Missing dependency: install {command} and restart Misty.")
    }
}

fn require_command(command: &'static str, plugin_name: &str) -> Result<(), (&'static str, String)> {
    if command_exists(command) {
        Ok(())
    } else {
        Err((
            "missing_dependency",
            format!("{plugin_name} requires {command}. Install {command} and restart Misty."),
        ))
    }
}

fn selected_file_path(
    selected_paths: &[String],
    plugin_name: &str,
) -> Result<PathBuf, (&'static str, String)> {
    let Some(path) = selected_paths
        .iter()
        .map(|path| path.trim())
        .find(|path| !path.is_empty())
    else {
        return Err((
            "missing_selection",
            format!("{plugin_name} requires a selected local file."),
        ));
    };
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err((
            "invalid_selection",
            format!("{} is not a local file.", path.display()),
        ));
    }
    Ok(path)
}

fn valid_hex_color(value: &str) -> bool {
    let Some(hex) = value.strip_prefix('#') else {
        return false;
    };
    matches!(hex.len(), 3 | 6 | 8) && hex.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn output_with_extension(source: &Path, extension: &str) -> PathBuf {
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("converted");
    source.with_file_name(format!("{stem}.misty-converted.{extension}"))
}

fn run_system_command(mut command: Command, tool_name: &str) -> Result<(), (&'static str, String)> {
    let output = command.output().map_err(|error| {
        (
            "process_failed",
            format!("{tool_name} could not be started: {error}"),
        )
    })?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err((
            "process_failed",
            format!("{tool_name} failed: {}", stderr.trim()),
        ))
    }
}

fn write_pretty_json(path: &Path, value: &Value) -> Result<(), (&'static str, String)> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            (
                "io_error",
                format!("Could not create {}: {error}", parent.display()),
            )
        })?;
    }
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| {
        (
            "json_error",
            format!("Could not encode extension data: {error}"),
        )
    })?;
    fs::write(path, bytes).map_err(|error| {
        (
            "io_error",
            format!("Could not write {}: {error}", path.display()),
        )
    })
}

fn now_ms_for_plugin() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn command_requires_selected_file(command: &Value, fallback: bool) -> bool {
    bool_field(command, "requires_selected_file")
        .or_else(|| bool_field(command, "requiresSelectedFile"))
        .unwrap_or(fallback)
}

fn static_panels_from_json(value: &Value, plugin: &PluginMetadata) -> Vec<PluginPanelEntry> {
    let Some(panels) = value.get("panels").and_then(Value::as_array) else {
        return Vec::new();
    };
    panels
        .iter()
        .filter_map(|panel| static_panel_from_json(panel, plugin))
        .collect()
}

fn static_panel_from_json(panel: &Value, plugin: &PluginMetadata) -> Option<PluginPanelEntry> {
    let id = string_field(Some(panel), "id")
        .or_else(|| string_field(Some(panel), "panel_id"))
        .or_else(|| string_field(Some(panel), "panelId"))?;
    let title = string_field(Some(panel), "title")
        .or_else(|| string_field(Some(panel), "label"))
        .or_else(|| string_field(Some(panel), "name"))
        .unwrap_or_else(|| plugin.name.clone());
    if id.trim().is_empty() || title.trim().is_empty() {
        return None;
    }
    Some(PluginPanelEntry {
        id: id.trim().to_owned(),
        title: title.trim().to_owned(),
        plugin_id: plugin.id.clone(),
        plugin_name: plugin.name.clone(),
        window_type: string_field(Some(panel), "window_type")
            .or_else(|| string_field(Some(panel), "windowType"))
            .unwrap_or_else(|| "panel".to_owned()),
        default_width: number_field(panel, "default_width")
            .or_else(|| number_field(panel, "defaultWidth"))
            .unwrap_or(480.0),
        default_height: number_field(panel, "default_height")
            .or_else(|| number_field(panel, "defaultHeight"))
            .unwrap_or(360.0),
        plugin_dir: plugin.plugin_dir.clone(),
        manifest_path: plugin.manifest_path.clone(),
        library_path: plugin.library_path.clone(),
        web_entry: web_panel_entry(panel, plugin),
        launcher_views: panel_launcher_views(panel)
            .unwrap_or_else(|| plugin.launcher_views.clone()),
    })
}

fn web_panel_entry(panel: &Value, plugin: &PluginMetadata) -> String {
    let Some(raw) = string_field(Some(panel), "entry") else {
        return String::new();
    };
    let (relative, query) = raw
        .split_once('?')
        .map(|(path, query)| (path, Some(query)))
        .unwrap_or((raw.as_str(), None));
    let relative = Path::new(relative);
    if !relative_plugin_library_path_is_safe(relative) {
        return String::new();
    }
    let path = Path::new(&plugin.plugin_dir).join(relative);
    let mut result = path.display().to_string();
    if let Some(query) = query.filter(|value| !value.is_empty()) {
        result.push('?');
        result.push_str(query);
    }
    result
}

fn panel_launcher_views(panel: &Value) -> Option<Vec<String>> {
    panel
        .get("launcher")
        .and_then(|launcher| launcher.get("views"))
        .or_else(|| panel.get("views"))
        .and_then(trimmed_string_array)
}

fn load_native_plugin(library_path: &str) -> Result<(Library, NativePluginRegistry), String> {
    let library = unsafe { Library::new(library_path) }
        .map_err(|error| format!("Could not load extension library {library_path}: {error}"))?;
    let abi = unsafe {
        let abi: libloading::Symbol<'_, MistyPluginAbiVersionFn> = library
            .get(b"misty_plugin_abi_version")
            .map_err(|error| format!("Extension ABI symbol is missing: {error}"))?;
        abi()
    };
    if abi != MISTY_PLUGIN_ABI_VERSION {
        return Err(format!(
            "Extension ABI version {abi} is not supported by this Misty build."
        ));
    }

    let mut registry = NativePluginRegistry::default();
    let mut host_state = NativePluginHostState::default();
    let context = MistyPluginContext {
        version: MISTY_PLUGIN_ABI_VERSION,
        host_handle: (&mut host_state as *mut NativePluginHostState).cast::<c_void>(),
        host_api: &HOST_API,
        registry_handle: (&mut registry as *mut NativePluginRegistry).cast::<c_void>(),
        registry_api: &REGISTRY_API,
    };
    let registered = unsafe {
        let register: libloading::Symbol<'_, MistyPluginRegisterFn> = library
            .get(b"misty_plugin_register")
            .map_err(|error| format!("Extension register symbol is missing: {error}"))?;
        register(&context)
    };
    if registered == 0 {
        return Err("Extension registration failed.".to_owned());
    }
    Ok((library, registry))
}

fn current_platform_library_path(plugin_dir: &Path, manifest: &Value) -> Option<PathBuf> {
    if !manifest_platforms_match_current_host(manifest) {
        return None;
    }
    let plugin = manifest.get("plugin")?;
    if plugin.get("abi_version").and_then(Value::as_u64)? != u64::from(MISTY_PLUGIN_ABI_VERSION) {
        return None;
    }
    let variant = select_current_platform_variant(plugin.get("variants")?.as_array()?)?;
    let library = variant
        .get("library")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|path| !path.is_empty())?;
    let library_path = Path::new(library);
    if !relative_plugin_library_path_is_safe(library_path) {
        return None;
    }
    let candidate = plugin_dir.join(library_path);
    candidate.is_file().then_some(candidate)
}

fn manifest_platforms_match_current_host(manifest: &Value) -> bool {
    let Some(platforms) = manifest.get("platforms").and_then(Value::as_array) else {
        return true;
    };
    if platforms.is_empty() {
        return true;
    }
    let host_os = current_host_os();
    platforms
        .iter()
        .filter_map(Value::as_str)
        .any(|platform| platform.trim().eq_ignore_ascii_case(host_os))
}

fn select_current_platform_variant<'a>(variants: &'a [Value]) -> Option<&'a Value> {
    let host_os = current_host_os();
    let host_arches = current_host_arch_aliases();
    let host_runtime = current_host_runtime();
    let mut runtime_agnostic = None;
    for variant in variants {
        let os_matches = variant
            .get("os")
            .and_then(Value::as_str)
            .is_some_and(|os| os.trim() == host_os);
        let arch_matches = variant
            .get("arch")
            .and_then(Value::as_str)
            .is_some_and(|arch| {
                host_arches
                    .iter()
                    .any(|candidate| arch.trim() == *candidate)
            });
        if !os_matches || !arch_matches {
            continue;
        }
        let runtime = variant
            .get("runtime")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default();
        if runtime.is_empty() {
            runtime_agnostic.get_or_insert(variant);
        } else if runtime == host_runtime {
            return Some(variant);
        }
    }
    runtime_agnostic
}

fn current_host_os() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        "linux" => "linux",
        _ => std::env::consts::OS,
    }
}

fn current_host_arch_aliases() -> Vec<&'static str> {
    match std::env::consts::ARCH {
        "aarch64" => vec!["arm64", "aarch64"],
        "x86_64" => vec!["x86_64", "x64"],
        other => vec![other],
    }
}

fn current_host_runtime() -> &'static str {
    match std::env::consts::OS {
        "windows" => "msvc",
        "macos" => "libc++",
        "linux" => "libstdc++",
        _ => "unknown",
    }
}

fn relative_plugin_library_path_is_safe(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

fn launcher_command_id(plugin_id: &str) -> String {
    format!("plugin.{plugin_id}.open")
}

fn plugin_panel_key(panel: &PluginPanelEntry) -> String {
    format!("{}::{}", panel.plugin_id, panel.id)
}

fn route_encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        let ch = byte as char;
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '~') {
            encoded.push(ch);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn plugin_popup_route(plugin_id: &str, selected_path: Option<&str>) -> String {
    let mut route = format!("/files?extension={}", route_encode(plugin_id));
    if let Some(selected_path) = selected_path.filter(|path| !path.trim().is_empty()) {
        route.push_str("&selected=");
        route.push_str(&route_encode(selected_path));
    }
    route
}

fn removed_extension_id(plugin_id: &str) -> bool {
    REMOVED_EXTENSION_IDS
        .iter()
        .any(|removed| plugin_id.trim().eq_ignore_ascii_case(removed))
}

fn purge_removed_extension_dirs(roots: &[PathBuf]) -> ApiResult<()> {
    for root in roots {
        if !root.is_dir() {
            continue;
        }
        let entries = fs::read_dir(root).map_err(|err| {
            ApiError::Message(format!(
                "Failed to read extension root {}: {err}",
                root.display()
            ))
        })?;
        for entry in entries.flatten() {
            let plugin_dir = entry.path();
            if !plugin_dir.is_dir() {
                continue;
            }
            let dir_id = plugin_dir
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            let detail = read_json(plugin_dir.join("plugin.json"))
                .or_else(|| read_json(plugin_dir.join("detail.json")));
            let manifest = read_json(plugin_dir.join("manifest.json"));
            let metadata = plugin_metadata(&plugin_dir, detail.as_ref(), manifest.as_ref());
            if removed_extension_id(dir_id) || removed_extension_id(&metadata.id) {
                fs::remove_dir_all(&plugin_dir).map_err(|err| {
                    ApiError::Message(format!(
                        "Failed to remove retired extension {}: {err}",
                        plugin_dir.display()
                    ))
                })?;
            }
        }
    }
    Ok(())
}

fn missing_dependencies_for_plugin(plugin_id: &str) -> Vec<String> {
    let mut dependencies = Vec::new();
    match plugin_id {
        "quick_convert" => {
            if !command_exists("ffmpeg") {
                dependencies.push("ffmpeg".to_owned());
            }
        }
        _ => {}
    }
    dependencies
}

fn command_exists(command: &str) -> bool {
    resolve_executable(command, None).is_some()
}

fn string_field(value: Option<&Value>, key: &str) -> Option<String> {
    value?
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn number_field(value: &Value, key: &str) -> Option<f32> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .map(|number| number as f32)
}

fn bool_field(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(Value::as_bool)
}

fn trimmed_string_array(value: &Value) -> Option<Vec<String>> {
    let values = value
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    (!values.is_empty()).then_some(values)
}

fn read_json(path: PathBuf) -> Option<Value> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

unsafe extern "C" fn registry_register_command(
    handle: *mut c_void,
    command: *const MistyCommandReg,
) -> c_int {
    if handle.is_null() || command.is_null() {
        return 0;
    }
    let registry = &mut *(handle.cast::<NativePluginRegistry>());
    let command = &*command;
    let Some(id) = c_string(command.id) else {
        return 0;
    };
    if id.is_empty() {
        return 0;
    }
    registry.commands.push(NativePluginCommand {
        id,
        title: c_string(command.title).unwrap_or_else(|| "Extension Command".to_owned()),
        default_shortcut: c_string(command.default_shortcut).unwrap_or_default(),
        invoke: command.invoke,
        user_data: command.user_data,
    });
    1
}

unsafe extern "C" fn registry_register_panel(
    handle: *mut c_void,
    panel: *const MistyPanelReg,
) -> c_int {
    if handle.is_null() || panel.is_null() {
        return 0;
    }
    let registry = &mut *(handle.cast::<NativePluginRegistry>());
    let panel = &*panel;
    let Some(id) = c_string(panel.id) else {
        return 0;
    };
    if id.is_empty() {
        return 0;
    }
    registry.panels.push(NativePluginPanel {
        id,
        title: c_string(panel.title).unwrap_or_else(|| "Extension Panel".to_owned()),
        window_type: panel.window_type,
        default_width: panel.default_width,
        default_height: panel.default_height,
        render: panel.render,
        user_data: panel.user_data,
    });
    1
}

unsafe extern "C" fn host_open_panel(handle: *mut c_void, id: *const c_char) -> c_int {
    let Some(state) = native_host_state(handle) else {
        return 0;
    };
    let Some(id) = c_string(id) else {
        return 0;
    };
    state.opened_panel_id = Some(id);
    state.opened_panel_mode = 1;
    1
}

unsafe extern "C" fn host_close_panel(handle: *mut c_void, id: *const c_char) -> c_int {
    let Some(state) = native_host_state(handle) else {
        return 0;
    };
    let Some(id) = c_string(id) else {
        return 0;
    };
    if state.opened_panel_id.as_deref() == Some(id.as_str()) {
        state.opened_panel_id = None;
        state.opened_panel_mode = 0;
    }
    1
}

unsafe extern "C" fn host_is_panel_open(handle: *mut c_void, id: *const c_char) -> c_int {
    let Some(state) = native_host_state(handle) else {
        return 0;
    };
    let Some(id) = c_string(id) else {
        return 0;
    };
    i32::from(state.opened_panel_id.as_deref() == Some(id.as_str()))
}

unsafe extern "C" fn host_invoke_command(handle: *mut c_void, id: *const c_char) -> c_int {
    let Some(state) = native_host_state(handle) else {
        return 0;
    };
    let Some(id) = c_string(id) else {
        return 0;
    };
    if id.trim().is_empty() || state.registry.is_null() || state.invoke_depth >= 8 {
        return 0;
    }
    let registry = &*state.registry;
    let Some(command) = registry.commands.iter().find(|command| command.id == id) else {
        return 0;
    };
    let Some(invoke) = command.invoke else {
        return 0;
    };

    state.invoke_depth += 1;
    let context = MistyInvokeContext {
        version: MISTY_PLUGIN_ABI_VERSION,
        host_handle: handle,
        host_api: &HOST_API,
    };
    invoke(&context, command.user_data);
    state.invoke_depth = state.invoke_depth.saturating_sub(1);
    1
}

unsafe extern "C" fn host_copy_current_view_id(
    _handle: *mut c_void,
    buffer: *mut c_char,
    size: usize,
) -> c_int {
    copy_str_to_c_buffer("files", buffer, size)
}

unsafe extern "C" fn host_notify(
    handle: *mut c_void,
    level: c_int,
    title: *const c_char,
    message: *const c_char,
) {
    let Some(state) = native_host_state(handle) else {
        return;
    };
    state.notifications.push(NativePluginNotification {
        level,
        title: c_string(title).unwrap_or_default(),
        message: c_string(message).unwrap_or_default(),
    });
}

unsafe extern "C" fn host_create_texture(
    _handle: *mut c_void,
    _width: c_int,
    _height: c_int,
    _rgba_pixels: *const u8,
) -> u32 {
    0
}

unsafe extern "C" fn host_destroy_texture(_handle: *mut c_void, _texture_id: u32) {}

unsafe extern "C" fn host_copy_selected_file_path(
    handle: *mut c_void,
    buffer: *mut c_char,
    size: usize,
) -> c_int {
    let Some(state) = native_host_state(handle) else {
        return 0;
    };
    let Some(selected) = state.selected_paths.first() else {
        return 0;
    };
    copy_str_to_c_buffer(selected, buffer, size)
}

unsafe extern "C" fn host_set_preview_scene(_handle: *mut c_void, _scene_id: *const c_char) {}

unsafe extern "C" fn host_get_view_capabilities(
    _handle: *mut c_void,
    _view_id: *const c_char,
    out_caps: *mut MistyViewCapabilities,
) -> c_int {
    if out_caps.is_null() {
        return 0;
    }
    (*out_caps).tabs = 1;
    (*out_caps).split = 1;
    1
}

unsafe extern "C" fn host_open_panel_in_view(
    handle: *mut c_void,
    panel_id: *const c_char,
    _view_id: *const c_char,
    open_mode: c_int,
) -> c_int {
    let Some(state) = native_host_state(handle) else {
        return 0;
    };
    let Some(panel_id) = c_string(panel_id) else {
        return 0;
    };
    state.opened_panel_id = Some(panel_id);
    state.opened_panel_mode = open_mode;
    1
}

unsafe extern "C" fn host_get_theme_color(
    _handle: *mut c_void,
    _token_name: *const c_char,
    out_rgba4: *mut c_float,
) -> c_int {
    if out_rgba4.is_null() {
        return 0;
    }
    let color = [0.08, 0.09, 0.10, 1.0];
    ptr::copy_nonoverlapping(color.as_ptr(), out_rgba4, color.len());
    1
}

unsafe extern "C" fn host_set_theme_color(
    _handle: *mut c_void,
    _token_name: *const c_char,
    _rgba4: *const c_float,
) -> c_int {
    1
}

unsafe extern "C" fn host_apply_theme_preset(
    _handle: *mut c_void,
    _preset_name: *const c_char,
) -> c_int {
    1
}

unsafe extern "C" fn ui_text(handle: *mut c_void, text: *const c_char) {
    push_ui_element(handle, "text", text, 0.0, 0.0, false);
}

unsafe extern "C" fn ui_text_wrapped(handle: *mut c_void, text: *const c_char) {
    push_ui_element(handle, "textWrapped", text, 0.0, 0.0, false);
}

unsafe extern "C" fn ui_button(
    handle: *mut c_void,
    label: *const c_char,
    width: c_float,
    height: c_float,
) -> c_int {
    let Some(ui) = native_ui_state(handle) else {
        return 0;
    };
    let raw_label = c_string(label).unwrap_or_default();
    let visible_label = visible_imgui_label(&raw_label);
    ui.elements.push(PluginPanelElement {
        kind: "button".to_owned(),
        id: raw_label.clone(),
        text: visible_label.clone(),
        width,
        height,
        border: false,
    });
    i32::from(
        !ui.clicked_button.is_empty()
            && (ui.clicked_button == raw_label || ui.clicked_button == visible_label),
    )
}

unsafe extern "C" fn ui_same_line(handle: *mut c_void) {
    let Some(ui) = native_ui_state(handle) else {
        return;
    };
    ui.elements.push(PluginPanelElement {
        kind: "sameLine".to_owned(),
        id: String::new(),
        text: String::new(),
        width: 0.0,
        height: 0.0,
        border: false,
    });
}

unsafe extern "C" fn ui_separator(handle: *mut c_void) {
    let Some(ui) = native_ui_state(handle) else {
        return;
    };
    ui.elements.push(PluginPanelElement {
        kind: "separator".to_owned(),
        id: String::new(),
        text: String::new(),
        width: 0.0,
        height: 0.0,
        border: false,
    });
}

unsafe extern "C" fn ui_spacing(handle: *mut c_void) {
    let Some(ui) = native_ui_state(handle) else {
        return;
    };
    ui.elements.push(PluginPanelElement {
        kind: "spacing".to_owned(),
        id: String::new(),
        text: String::new(),
        width: 0.0,
        height: 0.0,
        border: false,
    });
}

unsafe extern "C" fn ui_image(
    handle: *mut c_void,
    texture_id: u32,
    width: c_float,
    height: c_float,
) {
    let Some(ui) = native_ui_state(handle) else {
        return;
    };
    ui.elements.push(PluginPanelElement {
        kind: "image".to_owned(),
        id: texture_id.to_string(),
        text: String::new(),
        width,
        height,
        border: false,
    });
}

unsafe extern "C" fn ui_get_content_region_avail(
    _handle: *mut c_void,
    width: *mut c_float,
    height: *mut c_float,
) {
    if !width.is_null() {
        *width = 520.0;
    }
    if !height.is_null() {
        *height = 420.0;
    }
}

unsafe extern "C" fn ui_begin_child(
    handle: *mut c_void,
    id: *const c_char,
    width: c_float,
    height: c_float,
    border: c_int,
) -> c_int {
    let Some(ui) = native_ui_state(handle) else {
        return 0;
    };
    ui.child_depth += 1;
    let id = c_string(id).unwrap_or_else(|| format!("child-{}", ui.child_depth));
    ui.elements.push(PluginPanelElement {
        kind: "beginChild".to_owned(),
        id,
        text: String::new(),
        width,
        height,
        border: border != 0,
    });
    1
}

unsafe extern "C" fn ui_end_child(handle: *mut c_void) {
    let Some(ui) = native_ui_state(handle) else {
        return;
    };
    ui.child_depth = ui.child_depth.saturating_sub(1);
    ui.elements.push(PluginPanelElement {
        kind: "endChild".to_owned(),
        id: String::new(),
        text: String::new(),
        width: 0.0,
        height: 0.0,
        border: false,
    });
}

unsafe extern "C" fn ui_input_text(
    handle: *mut c_void,
    label: *const c_char,
    buffer: *mut c_char,
    size: usize,
) -> c_int {
    let Some(ui) = native_ui_state(handle) else {
        return 0;
    };
    let raw_label = c_string(label).unwrap_or_default();
    let visible_label = visible_imgui_label(&raw_label);
    let original = if buffer.is_null() {
        String::new()
    } else {
        c_string(buffer).unwrap_or_default()
    };
    let next_value = ui
        .inputs
        .get(&raw_label)
        .or_else(|| ui.inputs.get(&visible_label))
        .cloned()
        .unwrap_or(original.clone());
    if next_value != original && !buffer.is_null() {
        let _ = copy_str_to_c_buffer(&next_value, buffer, size);
    }
    ui.elements.push(PluginPanelElement {
        kind: "inputText".to_owned(),
        id: raw_label,
        text: next_value.clone(),
        width: 0.0,
        height: 0.0,
        border: false,
    });
    i32::from(next_value != original)
}

unsafe fn native_host_state<'a>(handle: *mut c_void) -> Option<&'a mut NativePluginHostState> {
    if handle.is_null() {
        None
    } else {
        Some(&mut *(handle.cast::<NativePluginHostState>()))
    }
}

unsafe fn native_ui_state<'a>(handle: *mut c_void) -> Option<&'a mut NativePluginUiState> {
    if handle.is_null() {
        None
    } else {
        Some(&mut *(handle.cast::<NativePluginUiState>()))
    }
}

unsafe fn push_ui_element(
    handle: *mut c_void,
    kind: &str,
    text: *const c_char,
    width: f32,
    height: f32,
    border: bool,
) {
    let Some(ui) = native_ui_state(handle) else {
        return;
    };
    let text = c_string(text).unwrap_or_default();
    ui.elements.push(PluginPanelElement {
        kind: kind.to_owned(),
        id: String::new(),
        text,
        width,
        height,
        border,
    });
}

unsafe fn c_string(value: *const c_char) -> Option<String> {
    if value.is_null() {
        return None;
    }
    CStr::from_ptr(value).to_str().ok().map(ToOwned::to_owned)
}

fn visible_imgui_label(label: &str) -> String {
    label.split("##").next().unwrap_or(label).trim().to_owned()
}

fn plugin_panel_notifications(
    notifications: Vec<NativePluginNotification>,
) -> Vec<PluginPanelNotification> {
    notifications
        .into_iter()
        .map(|notification| PluginPanelNotification {
            level: match notification.level {
                1 => "success",
                2 => "error",
                _ => "info",
            }
            .to_owned(),
            title: notification.title,
            message: notification.message,
        })
        .collect()
}

unsafe fn copy_str_to_c_buffer(value: &str, buffer: *mut c_char, size: usize) -> c_int {
    if buffer.is_null() || size == 0 {
        return 0;
    }
    let bytes = value.as_bytes();
    let len = bytes.len().min(size.saturating_sub(1));
    ptr::copy_nonoverlapping(bytes.as_ptr(), buffer.cast::<u8>(), len);
    *buffer.add(len) = 0;
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_launcher_command_from_installed_plugin_detail() {
        let detail = serde_json::json!({
            "id": "themes",
            "name": "Themes",
            "status": "installed",
            "overview": "Customize Misty themes.",
            "launcher": { "show_in_launcher": true }
        });
        let metadata = plugin_metadata(Path::new("/tmp/themes"), Some(&detail), None);
        let entries = entries_for_values(&metadata, Some(&detail), None);
        let commands = entries.commands;

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].id, "plugin.themes.open");
        assert_eq!(commands[0].label, "Open Themes");
        assert_eq!(commands[0].source, "launcher");
    }

    #[test]
    fn derives_launcher_command_from_manifest_launcher_metadata() {
        let manifest = serde_json::json!({
            "id": "themes",
            "name": "Themes",
            "enabled": true,
            "launcher": {
                "show_in_launcher": true,
                "open_mode": "split",
                "requires_selected_file": true,
                "views": ["Dock", "Settings"]
            }
        });
        let metadata = plugin_metadata(Path::new("/tmp/themes"), None, Some(&manifest));
        let entries = entries_for_values(&metadata, None, Some(&manifest));
        let commands = entries.commands;

        assert!(metadata.launcher_enabled);
        assert_eq!(metadata.launcher_open_mode, "split");
        assert!(metadata.requires_selected_file);
        assert_eq!(metadata.launcher_views, vec!["Dock", "Settings"]);
        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].id, "plugin.themes.open");
        assert_eq!(commands[0].source, "launcher");
        assert_eq!(commands[0].launcher_open_mode, "split");
        assert!(commands[0].requires_selected_file);
    }

    #[test]
    fn derives_launcher_command_from_nested_manifest_plugin_metadata() {
        let manifest = serde_json::json!({
            "enabled": true,
            "plugin": {
                "id": "nested_manifest",
                "name": "Nested Manifest",
                "overview": "Nested launcher metadata.",
                "launcher": {
                    "show_in_launcher": true,
                    "open_mode": "tab"
                }
            }
        });
        let metadata = plugin_metadata(Path::new("/tmp/nested"), None, Some(&manifest));
        let entries = entries_for_values(&metadata, None, Some(&manifest));

        assert_eq!(metadata.id, "nested_manifest");
        assert_eq!(metadata.name, "Nested Manifest");
        assert_eq!(metadata.description, "Nested launcher metadata.");
        assert!(metadata.launcher_enabled);
        assert_eq!(entries.commands.len(), 1);
        assert_eq!(entries.commands[0].id, "plugin.nested_manifest.open");
        assert_eq!(entries.commands[0].plugin_name, "Nested Manifest");
    }

    #[test]
    fn reads_static_manifest_commands() {
        let manifest = serde_json::json!({
            "id": "sample",
            "name": "Sample",
            "enabled": true,
            "commands": [
                {
                    "id": "sample.convert",
                    "title": "Convert Selection",
                    "description": "Convert selected files.",
                    "default_shortcut": "Cmd+Shift+C"
                }
            ]
        });
        let metadata = plugin_metadata(Path::new("/tmp/sample"), None, Some(&manifest));
        let entries = entries_for_values(&metadata, None, Some(&manifest));
        let commands = entries.commands;

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].id, "sample.convert");
        assert_eq!(commands[0].label, "Convert Selection");
        assert_eq!(commands[0].default_shortcut, "Cmd+Shift+C");
        assert_eq!(commands[0].source, "manifest");
    }

    #[test]
    fn static_command_selection_requirement_can_override_plugin_default() {
        let detail = serde_json::json!({
            "id": "sample",
            "name": "Sample",
            "status": "installed",
            "launcher": {
                "show_in_launcher": true,
                "requires_selected_file": true
            },
            "commands": [
                {
                    "id": "sample.inspect",
                    "title": "Inspect Selection",
                    "requires_selected_file": true
                },
                {
                    "id": "sample.settings",
                    "title": "Open Settings",
                    "requiresSelectedFile": false
                }
            ]
        });
        let metadata = plugin_metadata(Path::new("/tmp/sample"), Some(&detail), None);
        let entries = entries_for_values(&metadata, Some(&detail), None);

        let inspect = entries
            .commands
            .iter()
            .find(|command| command.id == "sample.inspect")
            .expect("inspect command");
        let settings = entries
            .commands
            .iter()
            .find(|command| command.id == "sample.settings")
            .expect("settings command");

        assert!(inspect.requires_selected_file);
        assert!(!settings.requires_selected_file);
    }

    #[test]
    fn skips_disabled_or_uninstalled_plugins() {
        let detail = serde_json::json!({
            "id": "candidate",
            "name": "Candidate",
            "status": "uninstalled",
            "launcher": { "show_in_launcher": true }
        });
        let manifest = serde_json::json!({ "enabled": false });
        let metadata = plugin_metadata(Path::new("/tmp/candidate"), Some(&detail), Some(&manifest));

        assert!(!metadata.enabled);
        assert!(!metadata.installed);
    }

    #[test]
    fn reads_plugin_actions_as_commands() {
        let detail = serde_json::json!({
            "id": "quick_convert",
            "name": "Quick Convert",
            "status": "installed",
            "overview": "Convert selected media.",
            "actions": [{ "label": "Open", "kind": "primary", "requires_selected_file": true }]
        });
        let manifest = serde_json::json!({
            "enabled": true,
            "plugin": {
                "variants": [{
                    "os": "macos",
                    "arch": "arm64",
                    "library": "variants/macos-arm64/quick_convert.dylib"
                }]
            }
        });
        let metadata = plugin_metadata(
            Path::new("/tmp/quick_convert"),
            Some(&detail),
            Some(&manifest),
        );
        let entries = entries_for_values(&metadata, Some(&detail), Some(&manifest));
        let commands = entries.commands;

        let action = commands
            .iter()
            .find(|command| command.source == "action")
            .expect("plugin action command");
        assert_eq!(action.id, "plugin.quick_convert.action.open");
        assert_eq!(action.action_kind, "primary");
        assert!(action.requires_selected_file);
        assert!(
            action
                .library_path
                .ends_with("variants/macos-arm64/quick_convert.dylib")
                || action.library_path.is_empty()
        );
    }

    #[test]
    fn reads_static_panels_for_dock_launcher() {
        let detail = serde_json::json!({
            "id": "themes",
            "name": "Themes",
            "status": "installed",
            "launcher": {
                "show_in_launcher": true,
                "views": ["Dock", "Settings"]
            },
            "panels": [{
                "id": "themes.main",
                "title": "Theme Editor",
                "window_type": "panel",
                "default_width": 520,
                "default_height": 420
            }]
        });
        let metadata = plugin_metadata(Path::new("/tmp/themes"), Some(&detail), None);
        let entries = entries_for_values(&metadata, Some(&detail), None);

        assert_eq!(entries.panels.len(), 1);
        assert_eq!(entries.panels[0].id, "themes.main");
        assert_eq!(entries.panels[0].title, "Theme Editor");
        assert_eq!(entries.panels[0].launcher_views, vec!["Dock", "Settings"]);
        assert_eq!(entries.panels[0].default_width, 520.0);
    }

    #[test]
    fn static_panel_views_override_plugin_launcher_views() {
        let detail = serde_json::json!({
            "id": "themes",
            "name": "Themes",
            "status": "installed",
            "launcher": {
                "show_in_launcher": true,
                "views": ["Extensions", "Dock"]
            },
            "panels": [
                {
                    "id": "themes.dock",
                    "title": "Dock Tools",
                    "launcher": { "views": ["Dock"] }
                },
                {
                    "id": "themes.settings",
                    "title": "Settings Tools",
                    "views": ["Settings"]
                },
                {
                    "id": "themes.default",
                    "title": "Default Tools"
                }
            ]
        });
        let metadata = plugin_metadata(Path::new("/tmp/themes"), Some(&detail), None);
        let entries = entries_for_values(&metadata, Some(&detail), None);

        assert_eq!(entries.panels.len(), 3);
        assert_eq!(entries.panels[0].launcher_views, vec!["Dock"]);
        assert_eq!(entries.panels[1].launcher_views, vec!["Settings"]);
        assert_eq!(entries.panels[2].launcher_views, vec!["Extensions", "Dock"]);
    }

    #[test]
    fn snapshot_and_render_keep_plugin_local_panel_ids_distinct() {
        let root = unique_test_plugin_dir("panel-id-collision-root");
        let alpha = root.join("alpha");
        let beta = root.join("beta");
        fs::create_dir_all(&alpha).expect("alpha plugin dir");
        fs::create_dir_all(&beta).expect("beta plugin dir");
        fs::write(
            alpha.join("plugin.json"),
            serde_json::json!({
                "id": "alpha",
                "name": "Alpha",
                "status": "installed",
                "launcher": { "show_in_launcher": true },
                "panels": [{ "id": "main", "title": "Alpha Main" }]
            })
            .to_string(),
        )
        .expect("alpha plugin json");
        fs::write(
            beta.join("plugin.json"),
            serde_json::json!({
                "id": "beta",
                "name": "Beta",
                "status": "installed",
                "launcher": { "show_in_launcher": true },
                "panels": [{ "id": "main", "title": "Beta Main" }]
            })
            .to_string(),
        )
        .expect("beta plugin json");

        let snapshot = snapshot_plugin_commands(vec![root.clone()]).expect("snapshot");
        let mut panel_titles = snapshot
            .panels
            .iter()
            .map(|panel| panel.title.as_str())
            .collect::<Vec<_>>();
        panel_titles.sort_unstable();
        assert_eq!(panel_titles, vec!["Alpha Main", "Beta Main"]);

        let render_result = render_plugin_panel(
            vec![root.clone()],
            RenderPluginPanelRequest {
                panel_id: "main".to_owned(),
                plugin_id: "beta".to_owned(),
                selected_paths: Vec::new(),
                clicked_button: String::new(),
                inputs: BTreeMap::new(),
            },
        )
        .expect("render result");
        assert_eq!(render_result.plugin_id, "beta");
        assert_eq!(render_result.title, "Beta Main");
        assert_eq!(render_result.runtime_status, "native_runtime_unavailable");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn built_in_extension_panel_renders_even_with_native_library_path() {
        for (plugin_id, title, expected_element) in [
            ("quick_convert", "Quick Convert", "convert_mp4"),
            ("themes", "Themes", "save_accent"),
        ] {
            let panel = PluginPanelEntry {
                id: format!("{plugin_id}.panel"),
                title: title.to_owned(),
                plugin_id: plugin_id.to_owned(),
                plugin_name: title.to_owned(),
                window_type: "panel".to_owned(),
                default_width: 420.0,
                default_height: 520.0,
                plugin_dir: format!("/tmp/{plugin_id}"),
                manifest_path: format!("/tmp/{plugin_id}/manifest.json"),
                library_path: format!("/tmp/{plugin_id}/variants/macos-arm64/{plugin_id}.dylib"),
                web_entry: String::new(),
                launcher_views: vec!["Dock".to_owned()],
            };

            let rendered = render_result_for_panel(
                panel,
                RenderPluginPanelRequest {
                    panel_id: format!("{plugin_id}.panel"),
                    plugin_id: plugin_id.to_owned(),
                    selected_paths: Vec::new(),
                    clicked_button: String::new(),
                    inputs: BTreeMap::new(),
                },
            );

            assert_eq!(rendered.runtime_status, "native_rendered");
            assert_eq!(rendered.panel_id, format!("{plugin_id}.panel"));
            assert!(rendered
                .elements
                .iter()
                .any(|element| element.id == expected_element));
        }
    }

    #[test]
    fn built_in_theme_panel_action_persists_custom_accent() {
        let root = unique_test_plugin_dir("theme-panel-action-root");
        let panel = PluginPanelEntry {
            id: "themes.panel".to_owned(),
            title: "Themes".to_owned(),
            plugin_id: "themes".to_owned(),
            plugin_name: "Themes".to_owned(),
            window_type: "panel".to_owned(),
            default_width: 420.0,
            default_height: 520.0,
            plugin_dir: root.display().to_string(),
            manifest_path: String::new(),
            library_path: String::new(),
            web_entry: String::new(),
            launcher_views: vec!["Dock".to_owned()],
        };
        let mut inputs = BTreeMap::new();
        inputs.insert("accent".to_owned(), "#123abc".to_owned());

        let rendered = render_result_for_panel(
            panel,
            RenderPluginPanelRequest {
                panel_id: "themes.panel".to_owned(),
                plugin_id: "themes".to_owned(),
                selected_paths: Vec::new(),
                clicked_button: "save_accent".to_owned(),
                inputs,
            },
        );

        assert_eq!(rendered.runtime_status, "native_rendered");
        assert_eq!(rendered.notifications[0].level, "success");
        let tokens = fs::read_to_string(root.join("theme-tokens.json")).expect("tokens");
        assert!(tokens.contains("#123abc"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn diagnostics_report_current_extensions_as_builtin_injected() {
        let root = unique_test_plugin_dir("builtin-diagnostics-root");
        let themes = root.join("themes");
        fs::create_dir_all(themes.join("variants/current")).expect("themes plugin dir");
        fs::write(
            themes.join("variants/current/themes.dylib"),
            b"not-a-real-library",
        )
        .expect("native placeholder");
        fs::write(
            themes.join("plugin.json"),
            serde_json::json!({
                "id": "themes",
                "name": "Themes",
                "status": "installed",
                "launcher": { "show_in_launcher": true }
            })
            .to_string(),
        )
        .expect("themes plugin json");
        fs::write(
            themes.join("manifest.json"),
            serde_json::json!({
                "enabled": true,
                "plugin": {
                    "abi_version": MISTY_PLUGIN_ABI_VERSION,
                    "variants": [{
                        "os": current_host_os(),
                        "arch": current_host_arch_aliases()[0],
                        "library": "variants/current/themes.dylib"
                    }]
                }
            })
            .to_string(),
        )
        .expect("themes manifest");

        let diagnostics = plugin_diagnostics_snapshot(vec![root.clone()]).expect("diagnostics");
        let themes = diagnostics
            .plugins
            .iter()
            .find(|plugin| plugin.plugin_id == "themes")
            .expect("themes diagnostics");

        assert_eq!(themes.runtime_status, "builtin_injected");
        assert!(themes.errors.is_empty());
        assert!(!themes.panels.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn installed_current_extensions_surface_injected_panels_commands_and_diagnostics() {
        let root = unique_test_plugin_dir("current-extension-root");
        for (plugin_id, plugin_name, views) in [
            ("quick_convert", "Quick Convert", vec!["Files"]),
            ("themes", "Themes", vec!["Settings", "Extensions", "Dock"]),
        ] {
            write_installed_builtin_extension(&root, plugin_id, plugin_name, &views);
        }

        let snapshot = snapshot_plugin_commands(vec![root.clone()]).expect("snapshot");
        for plugin_id in ["quick_convert", "themes"] {
            assert!(
                snapshot
                    .panels
                    .iter()
                    .any(|panel| panel.plugin_id == plugin_id
                        && panel.id == format!("{plugin_id}.builtin")),
                "{plugin_id} injected panel missing"
            );
            assert!(
                snapshot
                    .commands
                    .iter()
                    .any(|command| command.plugin_id == plugin_id && command.source == "builtin"),
                "{plugin_id} builtin command missing"
            );
            assert!(
                snapshot
                    .commands
                    .iter()
                    .any(|command| command.plugin_id == plugin_id && command.source == "launcher"),
                "{plugin_id} launcher command missing"
            );
        }

        let diagnostics = plugin_diagnostics_snapshot(vec![root.clone()]).expect("diagnostics");
        for plugin_id in ["quick_convert", "themes"] {
            let plugin = diagnostics
                .plugins
                .iter()
                .find(|plugin| plugin.plugin_id == plugin_id)
                .unwrap_or_else(|| panic!("{plugin_id} diagnostics missing"));
            assert_eq!(plugin.runtime_status, "builtin_injected");
            assert!(plugin.errors.is_empty(), "{plugin_id} reported errors");
            assert!(
                plugin
                    .panels
                    .iter()
                    .any(|panel| panel.id == format!("{plugin_id}.builtin")),
                "{plugin_id} diagnostics panel missing"
            );
            assert!(
                plugin
                    .commands
                    .iter()
                    .any(|command| command.source == "builtin"),
                "{plugin_id} diagnostics command missing"
            );
        }

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn installed_web_panel_resolves_inside_plugin_and_suppresses_builtin_panel() {
        let root = unique_test_plugin_dir("web-extension-root");
        let plugin = root.join("quick_convert");
        fs::create_dir_all(plugin.join("web")).expect("web dir");
        fs::write(plugin.join("web/index.html"), "<!doctype html>").expect("web entry");
        fs::write(
            plugin.join("plugin.json"),
            serde_json::json!({
                "id": "quick_convert", "name": "Quick Convert", "status": "installed"
            })
            .to_string(),
        )
        .expect("plugin detail");
        fs::write(plugin.join("manifest.json"), serde_json::json!({
            "id": "quick_convert", "enabled": true,
            "launcher": { "show_in_launcher": true },
            "panels": [{ "id": "quick-convert.panel", "title": "Quick Convert", "entry": "web/index.html?plugin=quick_convert" }]
        }).to_string()).expect("manifest");

        let snapshot = snapshot_plugin_commands(vec![root.clone()]).expect("snapshot");
        let panel = snapshot
            .panels
            .iter()
            .find(|panel| panel.plugin_id == "quick_convert")
            .expect("web panel");
        assert!(panel
            .web_entry
            .ends_with("web/index.html?plugin=quick_convert"));
        assert!(snapshot
            .panels
            .iter()
            .all(|panel| panel.id != "quick_convert.builtin"));
        assert!(snapshot
            .commands
            .iter()
            .all(|command| command.source != "builtin"));
        assert!(snapshot
            .commands
            .iter()
            .any(|command| command.source == "launcher"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn removed_extensions_do_not_surface_in_commands_panels_or_diagnostics() {
        let root = unique_test_plugin_dir("removed-extension-root");
        let git = root.join("git");
        let preview_panel = root.join("preview_panel");
        let vault = root.join("vault");
        let ytdlp = root.join("ytdlp");
        let themes = root.join("themes");
        fs::create_dir_all(&git).expect("git plugin dir");
        fs::create_dir_all(&preview_panel).expect("preview panel plugin dir");
        fs::create_dir_all(&vault).expect("vault plugin dir");
        fs::create_dir_all(&ytdlp).expect("ytdlp plugin dir");
        fs::create_dir_all(&themes).expect("themes plugin dir");
        fs::write(
            git.join("plugin.json"),
            serde_json::json!({
                "id": "git",
                "name": "Git",
                "status": "installed",
                "launcher": { "show_in_launcher": true },
                "panels": [{ "id": "main", "title": "Git Main" }],
                "commands": [{ "id": "git.status", "title": "Git Status" }]
            })
            .to_string(),
        )
        .expect("git plugin json");
        fs::write(
            preview_panel.join("plugin.json"),
            serde_json::json!({
                "id": "preview-panel",
                "name": "Preview Panel",
                "status": "installed",
                "launcher": { "show_in_launcher": true },
                "panels": [{ "id": "main", "title": "Preview Main" }]
            })
            .to_string(),
        )
        .expect("preview panel plugin json");
        fs::write(
            themes.join("plugin.json"),
            serde_json::json!({
                "id": "themes",
                "name": "Themes",
                "status": "installed",
                "launcher": { "show_in_launcher": true },
                "panels": [{ "id": "main", "title": "Themes Main" }]
            })
            .to_string(),
        )
        .expect("themes plugin json");
        fs::write(
            vault.join("plugin.json"),
            serde_json::json!({
                "id": "vault",
                "name": "Vault",
                "status": "installed",
                "launcher": { "show_in_launcher": true },
                "panels": [{ "id": "main", "title": "Vault Main" }]
            })
            .to_string(),
        )
        .expect("vault plugin json");
        fs::write(
            ytdlp.join("plugin.json"),
            serde_json::json!({
                "id": "ytdlp",
                "name": "yt-dlp",
                "status": "installed",
                "launcher": { "show_in_launcher": true },
                "panels": [{ "id": "main", "title": "yt-dlp Main" }]
            })
            .to_string(),
        )
        .expect("ytdlp plugin json");

        let snapshot = snapshot_plugin_commands(vec![root.clone()]).expect("snapshot");
        assert!(!git.exists());
        assert!(!preview_panel.exists());
        assert!(!vault.exists());
        assert!(ytdlp.exists());
        assert!(themes.exists());
        for plugin_id in ["git", "preview-panel", "vault"] {
            assert!(snapshot
                .commands
                .iter()
                .all(|command| command.plugin_id != plugin_id));
            assert!(snapshot
                .panels
                .iter()
                .all(|panel| panel.plugin_id != plugin_id));
        }
        assert!(snapshot
            .commands
            .iter()
            .any(|command| command.plugin_id == "themes"));

        let diagnostics = plugin_diagnostics_snapshot(vec![root.clone()]).expect("diagnostics");
        for plugin_id in ["git", "preview-panel", "vault"] {
            assert!(diagnostics
                .plugins
                .iter()
                .all(|plugin| plugin.plugin_id != plugin_id));
        }
        assert!(diagnostics
            .plugins
            .iter()
            .any(|plugin| plugin.plugin_id == "themes"));
        assert!(snapshot
            .panels
            .iter()
            .any(|panel| panel.plugin_id == "ytdlp"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn run_launcher_command_returns_dock_route() {
        let command = PluginCommandEntry {
            id: "plugin.theme tools.open".to_owned(),
            label: "Open Theme Tools".to_owned(),
            hint: String::new(),
            plugin_id: "theme tools".to_owned(),
            plugin_name: "Theme Tools".to_owned(),
            default_shortcut: String::new(),
            source: "launcher".to_owned(),
            action_kind: "open".to_owned(),
            launcher_open_mode: "tab".to_owned(),
            requires_selected_file: false,
            plugin_dir: "/tmp/theme-tools".to_owned(),
            manifest_path: String::new(),
            library_path: String::new(),
        };

        let result = run_result_for_command(command, Vec::new());

        assert!(result.handled);
        assert_eq!(result.target_route, "/files?extension=theme%20tools");
        assert_eq!(result.runtime_status, "opened");
    }

    #[test]
    fn run_launcher_command_preserves_selected_path_in_dock_route() {
        let command = PluginCommandEntry {
            id: "plugin.theme tools.open".to_owned(),
            label: "Open Theme Tools".to_owned(),
            hint: String::new(),
            plugin_id: "theme tools".to_owned(),
            plugin_name: "Theme Tools".to_owned(),
            default_shortcut: String::new(),
            source: "launcher".to_owned(),
            action_kind: "open".to_owned(),
            launcher_open_mode: "tab".to_owned(),
            requires_selected_file: true,
            plugin_dir: "/tmp/theme-tools".to_owned(),
            manifest_path: String::new(),
            library_path: String::new(),
        };

        let result = run_result_for_command(command, vec!["/tmp/My File.mov".to_owned()]);

        assert!(result.handled);
        assert_eq!(
            result.target_route,
            "/files?extension=theme%20tools&selected=%2Ftmp%2FMy%20File.mov"
        );
        assert_eq!(result.runtime_status, "opened");
    }

    #[test]
    fn run_launcher_command_reports_missing_selection_before_opening() {
        let command = PluginCommandEntry {
            id: "plugin.theme-tools.open".to_owned(),
            label: "Open Theme Tools".to_owned(),
            hint: String::new(),
            plugin_id: "theme-tools".to_owned(),
            plugin_name: "Theme Tools".to_owned(),
            default_shortcut: String::new(),
            source: "launcher".to_owned(),
            action_kind: "open".to_owned(),
            launcher_open_mode: "tab".to_owned(),
            requires_selected_file: true,
            plugin_dir: "/tmp/theme-tools".to_owned(),
            manifest_path: String::new(),
            library_path: String::new(),
        };

        let result = run_result_for_command(command, Vec::new());

        assert!(!result.handled);
        assert_eq!(result.target_route, "");
        assert_eq!(result.runtime_status, "missing_selection");
    }

    #[test]
    fn run_native_action_reports_missing_selection() {
        let command = PluginCommandEntry {
            id: "plugin.convert.action.primary".to_owned(),
            label: "Convert Selection".to_owned(),
            hint: String::new(),
            plugin_id: "convert".to_owned(),
            plugin_name: "Convert".to_owned(),
            default_shortcut: String::new(),
            source: "action".to_owned(),
            action_kind: "primary".to_owned(),
            launcher_open_mode: "tab".to_owned(),
            requires_selected_file: true,
            plugin_dir: "/tmp/convert".to_owned(),
            manifest_path: "/tmp/convert/manifest.json".to_owned(),
            library_path: "/tmp/convert/convert.dylib".to_owned(),
        };

        let result = run_result_for_command(command, Vec::new());

        assert!(!result.handled);
        assert_eq!(result.target_route, "");
        assert_eq!(result.runtime_status, "missing_selection");
        assert!(result.message.contains("requires a selected file"));
    }

    #[test]
    fn built_in_extension_commands_are_added_for_surviving_plugins() {
        let detail = serde_json::json!({
            "id": "quick_convert",
            "name": "Quick Convert",
            "status": "installed"
        });
        let metadata = plugin_metadata(Path::new("/tmp/quick_convert"), Some(&detail), None);
        let commands = built_in_commands_for_plugin(&metadata);
        assert!(commands
            .iter()
            .any(|command| command.action_kind == "convert_mp4"));
        assert!(commands.iter().all(|command| command.source == "builtin"));
        assert!(built_in_panels_for_plugin(&metadata)
            .iter()
            .any(|panel| panel.id == "quick_convert.builtin"));
    }

    #[test]
    fn built_in_theme_command_persists_theme_tokens() {
        let plugin_dir = unique_test_plugin_dir("themes-builtin");
        fs::create_dir_all(&plugin_dir).unwrap();
        let command = PluginCommandEntry {
            id: "plugin.themes.builtin.apply_dark".to_owned(),
            label: "Themes: Apply Dark preset".to_owned(),
            hint: String::new(),
            plugin_id: "themes".to_owned(),
            plugin_name: "Themes".to_owned(),
            default_shortcut: String::new(),
            source: "builtin".to_owned(),
            action_kind: "apply_dark".to_owned(),
            launcher_open_mode: "tab".to_owned(),
            requires_selected_file: false,
            plugin_dir: plugin_dir.display().to_string(),
            manifest_path: String::new(),
            library_path: String::new(),
        };

        let result = run_result_for_command(command, Vec::new());

        assert!(result.handled);
        assert_eq!(result.runtime_status, "builtin_executed");
        let tokens = fs::read_to_string(plugin_dir.join("theme-tokens.json")).unwrap();
        assert!(tokens.contains("\"preset\": \"dark\""));
    }

    #[test]
    fn built_in_quick_convert_reports_missing_ffmpeg_before_running() {
        let command = PluginCommandEntry {
            id: "plugin.quick_convert.builtin.convert_mp4".to_owned(),
            label: "Quick Convert: Convert selected to MP4".to_owned(),
            hint: String::new(),
            plugin_id: "quick_convert".to_owned(),
            plugin_name: "Quick Convert".to_owned(),
            default_shortcut: String::new(),
            source: "builtin".to_owned(),
            action_kind: "convert_mp4".to_owned(),
            launcher_open_mode: "split".to_owned(),
            requires_selected_file: true,
            plugin_dir: "/tmp/quick_convert".to_owned(),
            manifest_path: String::new(),
            library_path: String::new(),
        };
        let old_path = std::env::var_os("PATH");
        std::env::set_var("PATH", "");
        let result = run_result_for_command(command, vec!["/tmp/demo.mov".to_owned()]);
        if let Some(old_path) = old_path {
            std::env::set_var("PATH", old_path);
        } else {
            std::env::remove_var("PATH");
        }
        assert!(!result.handled);
        assert_eq!(result.runtime_status, "missing_dependency");
        assert!(result.message.contains("ffmpeg"));
    }

    #[test]
    fn run_open_action_returns_dock_route() {
        let command = PluginCommandEntry {
            id: "plugin.convert.action.open".to_owned(),
            label: "Convert: Open".to_owned(),
            hint: String::new(),
            plugin_id: "convert".to_owned(),
            plugin_name: "Convert".to_owned(),
            default_shortcut: String::new(),
            source: "action".to_owned(),
            action_kind: "primary".to_owned(),
            launcher_open_mode: "split".to_owned(),
            requires_selected_file: false,
            plugin_dir: "/tmp/convert".to_owned(),
            manifest_path: "/tmp/convert/manifest.json".to_owned(),
            library_path: "/tmp/convert/convert.dylib".to_owned(),
        };

        let result = run_result_for_command(command, Vec::new());

        assert!(result.handled);
        assert_eq!(result.target_route, "/files?extension=convert");
        assert_eq!(result.runtime_status, "opened");
    }

    #[test]
    fn run_native_action_with_selection_reports_load_failure_for_missing_library() {
        let command = PluginCommandEntry {
            id: "plugin.convert.action.primary".to_owned(),
            label: "Convert Selection".to_owned(),
            hint: String::new(),
            plugin_id: "convert".to_owned(),
            plugin_name: "Convert".to_owned(),
            default_shortcut: String::new(),
            source: "action".to_owned(),
            action_kind: "primary".to_owned(),
            launcher_open_mode: "tab".to_owned(),
            requires_selected_file: true,
            plugin_dir: "/tmp/convert".to_owned(),
            manifest_path: "/tmp/convert/manifest.json".to_owned(),
            library_path: "/tmp/convert/convert.dylib".to_owned(),
        };

        let result = run_result_for_command(command, vec!["/tmp/input.mov".to_owned()]);

        assert!(!result.handled);
        assert!(result.target_route.is_empty());
        assert_eq!(result.runtime_status, "native_load_failed");
        assert!(result.message.contains("Could not load extension library"));
    }

    #[test]
    fn resolves_current_platform_library_only_when_file_exists_inside_plugin_dir() {
        let plugin_dir = unique_test_plugin_dir("native-library-ok");
        let library_rel = Path::new("variants")
            .join("native")
            .join(native_library_file_name());
        let library_path = plugin_dir.join(&library_rel);
        std::fs::create_dir_all(library_path.parent().unwrap()).unwrap();
        std::fs::write(&library_path, b"placeholder library").unwrap();
        let manifest = current_platform_native_manifest(library_rel.to_string_lossy().as_ref());

        let resolved = current_platform_library_path(&plugin_dir, &manifest).expect("library path");

        assert_eq!(resolved, library_path);
        let _ = std::fs::remove_dir_all(plugin_dir);
    }

    #[test]
    fn rejects_absolute_native_library_path() {
        let plugin_dir = unique_test_plugin_dir("native-library-absolute");
        let manifest = current_platform_native_manifest("/tmp/evil.dylib");

        assert!(current_platform_library_path(&plugin_dir, &manifest).is_none());
        let _ = std::fs::remove_dir_all(plugin_dir);
    }

    #[test]
    fn rejects_native_library_path_that_escapes_plugin_dir() {
        let plugin_dir = unique_test_plugin_dir("native-library-escape");
        let manifest = current_platform_native_manifest("../evil.dylib");

        assert!(current_platform_library_path(&plugin_dir, &manifest).is_none());
        let _ = std::fs::remove_dir_all(plugin_dir);
    }

    #[test]
    fn rejects_missing_native_library_file() {
        let plugin_dir = unique_test_plugin_dir("native-library-missing");
        let manifest = current_platform_native_manifest("variants/native/missing.dylib");

        assert!(current_platform_library_path(&plugin_dir, &manifest).is_none());
        let _ = std::fs::remove_dir_all(plugin_dir);
    }

    #[test]
    fn rejects_native_library_with_mismatched_manifest_abi() {
        let plugin_dir = unique_test_plugin_dir("native-library-abi");
        let mut manifest = current_platform_native_manifest("variants/native/plugin.dylib");
        manifest["plugin"]["abi_version"] = serde_json::json!(MISTY_PLUGIN_ABI_VERSION + 1);

        assert!(current_platform_library_path(&plugin_dir, &manifest).is_none());
        let _ = std::fs::remove_dir_all(plugin_dir);
    }

    #[test]
    fn host_invoke_command_runs_registered_native_command() {
        unsafe extern "C" fn nested_command(
            ctx: *const MistyInvokeContext,
            _user_data: *mut c_void,
        ) {
            let ctx = &*ctx;
            let title = std::ffi::CString::new("Nested").unwrap();
            let message = std::ffi::CString::new("Command ran").unwrap();
            ((*ctx.host_api).notify)(ctx.host_handle, 1, title.as_ptr(), message.as_ptr());
        }

        let registry = NativePluginRegistry {
            commands: vec![NativePluginCommand {
                id: "nested.command".to_owned(),
                title: "Nested Command".to_owned(),
                default_shortcut: String::new(),
                invoke: Some(nested_command),
                user_data: std::ptr::null_mut(),
            }],
            panels: Vec::new(),
        };
        let mut host_state = NativePluginHostState {
            registry: &registry,
            ..NativePluginHostState::default()
        };
        let command_id = std::ffi::CString::new("nested.command").unwrap();

        let handled = unsafe {
            host_invoke_command(
                (&mut host_state as *mut NativePluginHostState).cast::<c_void>(),
                command_id.as_ptr(),
            )
        };

        assert_eq!(handled, 1);
        assert_eq!(host_state.notifications.len(), 1);
        assert_eq!(host_state.notifications[0].title, "Nested");
        assert_eq!(host_state.notifications[0].message, "Command ran");
    }

    #[test]
    fn host_panel_open_close_updates_open_state() {
        let mut host_state = NativePluginHostState::default();
        let panel_id = std::ffi::CString::new("panel.main").unwrap();
        let handle = (&mut host_state as *mut NativePluginHostState).cast::<c_void>();

        let opened = unsafe { host_open_panel(handle, panel_id.as_ptr()) };
        let is_open = unsafe { host_is_panel_open(handle, panel_id.as_ptr()) };
        let closed = unsafe { host_close_panel(handle, panel_id.as_ptr()) };
        let is_still_open = unsafe { host_is_panel_open(handle, panel_id.as_ptr()) };

        assert_eq!(opened, 1);
        assert_eq!(is_open, 1);
        assert_eq!(closed, 1);
        assert_eq!(is_still_open, 0);
    }

    fn entries_for_values(
        metadata: &PluginMetadata,
        detail: Option<&Value>,
        manifest: Option<&Value>,
    ) -> PluginEntries {
        let mut commands = Vec::new();
        let mut panels = Vec::new();
        if metadata.enabled && metadata.installed {
            if let Some(detail) = detail {
                commands.extend(static_commands_from_json(detail, metadata, "detail"));
                commands.extend(action_commands_from_json(detail, metadata));
                panels.extend(static_panels_from_json(detail, metadata));
            }
            if let Some(manifest) = manifest {
                commands.extend(static_commands_from_json(manifest, metadata, "manifest"));
                panels.extend(static_panels_from_json(manifest, metadata));
            }
            if metadata.launcher_enabled
                && !commands
                    .iter()
                    .any(|command| command.id == launcher_command_id(&metadata.id))
            {
                commands.push(PluginCommandEntry {
                    id: launcher_command_id(&metadata.id),
                    label: format!("Open {}", metadata.name),
                    hint: metadata.description.clone(),
                    plugin_id: metadata.id.clone(),
                    plugin_name: metadata.name.clone(),
                    default_shortcut: String::new(),
                    source: "launcher".to_owned(),
                    action_kind: "open".to_owned(),
                    launcher_open_mode: metadata.launcher_open_mode.clone(),
                    requires_selected_file: metadata.requires_selected_file,
                    plugin_dir: metadata.plugin_dir.clone(),
                    manifest_path: metadata.manifest_path.clone(),
                    library_path: metadata.library_path.clone(),
                });
            }
        }
        PluginEntries { commands, panels }
    }

    fn current_platform_native_manifest(library: &str) -> Value {
        serde_json::json!({
            "id": "native",
            "name": "Native",
            "schema_version": 2,
            "platforms": [current_host_os()],
            "enabled": true,
            "plugin": {
                "abi_version": MISTY_PLUGIN_ABI_VERSION,
                "variants": [{
                    "os": current_host_os(),
                    "arch": current_host_arch_aliases()[0],
                    "library": library
                }]
            }
        })
    }

    fn native_library_file_name() -> &'static str {
        if cfg!(target_os = "windows") {
            "plugin.dll"
        } else if cfg!(target_os = "macos") {
            "plugin.dylib"
        } else {
            "plugin.so"
        }
    }

    fn unique_test_plugin_dir(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "misty-plugin-commands-{label}-{}",
            uuid::Uuid::new_v4()
        ))
    }

    fn write_installed_builtin_extension(
        root: &Path,
        plugin_id: &str,
        plugin_name: &str,
        views: &[&str],
    ) {
        let plugin_dir = root.join(plugin_id);
        let native_dir = plugin_dir.join("variants/current");
        fs::create_dir_all(&native_dir).expect("plugin native dir");
        fs::write(
            native_dir.join(format!("{plugin_id}.dylib")),
            b"not-a-real-library",
        )
        .expect("native placeholder");
        fs::write(
            plugin_dir.join("plugin.json"),
            serde_json::json!({
                "id": plugin_id,
                "name": plugin_name,
                "status": "installed",
                "overview": format!("{plugin_name} test extension."),
                "launcher": {
                    "show_in_launcher": true,
                    "views": views,
                    "open_mode": "tab"
                }
            })
            .to_string(),
        )
        .expect("plugin detail json");
        fs::write(
            plugin_dir.join("manifest.json"),
            serde_json::json!({
                "enabled": true,
                "plugin": {
                    "abi_version": MISTY_PLUGIN_ABI_VERSION,
                    "variants": [{
                        "os": current_host_os(),
                        "arch": current_host_arch_aliases()[0],
                        "library": format!("variants/current/{plugin_id}.dylib")
                    }]
                }
            })
            .to_string(),
        )
        .expect("plugin manifest json");
    }
}
