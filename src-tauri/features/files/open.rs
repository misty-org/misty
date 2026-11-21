//! Open, Open With and Show in Finder (or Explorer) for an item on the disk. Opening hands the
//! item to the app the system picks, and notes it for Recent. Open With offers the apps the
//! system says can open it (LaunchServices on macOS, the Shell's association handlers on Windows,
//! the desktop entries xdg-mime and gio name on Linux) and opens it only with one of those, so a
//! window can't start any program it names.
use std::path::Path;

use file_access::disk::check_disk;
use file_access::Access;
use serde::Serialize;
use tauri_plugin_opener::OpenerExt;

use super::listing::io_text;
use super::{asked_path, blocking, failed, person_window};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppChoice {
    pub name: String,
    pub path: String,
    pub is_default: bool,
}

/// An app's name as Finder shows it: its bundle's name without `.app`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn app_name(path: &Path) -> String {
    path.file_stem()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| super::display_name(path))
}

#[cfg(target_os = "macos")]
mod launch_services {
    use std::path::{Path, PathBuf};

    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSString, NSURL};

    fn url(path: &Path) -> objc2::rc::Retained<NSURL> {
        NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()))
    }

    pub(super) fn default_app(path: &Path) -> Option<PathBuf> {
        objc2::rc::autoreleasepool(|_| {
            let app = NSWorkspace::sharedWorkspace().URLForApplicationToOpenURL(&url(path))?;
            app.path().map(|path| PathBuf::from(path.to_string()))
        })
    }

    pub(super) fn apps(path: &Path) -> Vec<PathBuf> {
        objc2::rc::autoreleasepool(|_| {
            NSWorkspace::sharedWorkspace()
                .URLsForApplicationsToOpenURL(&url(path))
                .iter()
                .filter_map(|app| app.path().map(|path| PathBuf::from(path.to_string())))
                .collect()
        })
    }
}

/// The app that opens this item by default, where the system says cheaply (macOS).
pub(crate) fn default_app_name(path: &Path) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        launch_services::default_app(path).map(|app| app_name(&app))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        None
    }
}

/// The apps that can open this item, the default first. Only macOS lists them; elsewhere the list
/// is empty and Open uses the system's default.
fn apps_for(path: &Path) -> Vec<AppChoice> {
    #[cfg(target_os = "macos")]
    {
        let default = launch_services::default_app(path);
        let mut seen: Vec<std::path::PathBuf> = Vec::new();
        let mut choices: Vec<AppChoice> = default
            .iter()
            .chain(launch_services::apps(path).iter())
            .filter(|app| {
                let fresh = !seen.contains(app);
                if fresh {
                    seen.push((*app).clone());
                }
                fresh
            })
            .map(|app| AppChoice {
                name: app_name(app),
                path: app.display().to_string(),
                is_default: default.as_ref() == Some(app),
            })
            .collect();
        let first = usize::from(default.is_some()).min(choices.len());
        choices[first..]
            .sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        choices
    }
    #[cfg(windows)]
    {
        shell_handlers::apps(path)
            .into_iter()
            .map(|(name, id)| AppChoice { name, path: id, is_default: false })
            .collect()
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        desktop_entries::apps(path)
    }
}

fn readable(path: &Path) -> Result<(), String> {
    check_disk(path, Access::Read).map_err(|error| failed(path, io_text(&error)))
}

/// Opens each item with the app the system picks for it, and notes it for Recent.
#[tauri::command]
pub async fn files_open(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    paths: Vec<String>,
) -> Result<(), String> {
    person_window(&webview)?;
    let paths = paths
        .iter()
        .map(|path| asked_path(path))
        .collect::<Result<Vec<_>, _>>()?;
    blocking(move || {
        for path in &paths {
            readable(path)?;
            app.opener()
                .open_path(path.display().to_string(), None::<&str>)
                .map_err(|error| failed(path, error))?;
            super::starred::note_recent_path(&app, path);
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn files_apps_for(webview: tauri::Webview, path: String) -> Result<Vec<AppChoice>, String> {
    person_window(&webview)?;
    let path = asked_path(&path)?;
    blocking(move || {
        readable(&path)?;
        Ok(apps_for(&path))
    })
    .await
}

/// Opens the item with one of the apps `files_apps_for` lists for it, named by its path.
#[tauri::command]
pub async fn files_open_with(
    handle: tauri::AppHandle,
    webview: tauri::Webview,
    path: String,
    app: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let path = asked_path(&path)?;
    blocking(move || {
        readable(&path)?;
        if !apps_for(&path).iter().any(|choice| choice.path == app) {
            return Err(failed(&path, "That app can't open it."));
        }
        open_with(&path, &app)?;
        super::starred::note_recent_path(&handle, &path);
        Ok(())
    })
    .await
}

#[cfg(target_os = "macos")]
fn open_with(path: &Path, app: &str) -> Result<(), String> {
    let status = std::process::Command::new("/usr/bin/open")
        .arg("-a")
        .arg(app)
        .arg(path)
        .stdin(std::process::Stdio::null())
        .status()
        .map_err(|error| failed(path, error))?;
    if status.success() {
        Ok(())
    } else {
        Err(failed(path, format!("{} couldn't open it.", app_name(Path::new(app)))))
    }
}

#[cfg(windows)]
fn open_with(path: &Path, app: &str) -> Result<(), String> {
    shell_handlers::open(path, app).map_err(|error| failed(path, error))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_with(path: &Path, app: &str) -> Result<(), String> {
    desktop_entries::open(path, app).map_err(|error| failed(path, error))
}

/// Windows: the apps the Shell recommends for the item's extension (`SHAssocEnumHandlers`), each
/// named by its handler's own name, and opening through that handler, as Explorer's Open with does.
#[cfg(windows)]
mod shell_handlers {
    use std::path::Path;

    use windows::core::{HSTRING, PWSTR};
    use windows::Win32::System::Com::{
        CoInitializeEx, CoTaskMemFree, CoUninitialize, IDataObject, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        IAssocHandler, IShellItem, SHAssocEnumHandlers, SHCreateItemFromParsingName,
        ASSOC_FILTER_RECOMMENDED, BHID_DataObject,
    };

    /// COM for this thread, while it is held.
    struct Com(bool);

    impl Com {
        fn start() -> Self {
            // SAFETY: a blocking worker thread; the matching CoUninitialize runs on drop.
            Self(unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok())
        }
    }

    impl Drop for Com {
        fn drop(&mut self) {
            if self.0 {
                // SAFETY: matches the successful CoInitializeEx in `start`.
                unsafe { CoUninitialize() };
            }
        }
    }

    /// A string the Shell allocated, read and freed.
    fn take(text: windows::core::Result<PWSTR>) -> Option<String> {
        let text = text.ok()?;
        // SAFETY: the Shell hands back a NUL-terminated string from CoTaskMemAlloc.
        let owned = unsafe { text.to_string() }.ok();
        unsafe { CoTaskMemFree(Some(text.0 as *const core::ffi::c_void)) };
        owned
    }

    fn handlers(path: &Path) -> Vec<IAssocHandler> {
        let Some(extension) = path.extension() else {
            return Vec::new();
        };
        let extension = HSTRING::from(format!(".{}", extension.to_string_lossy()));
        // SAFETY: a valid, NUL-terminated extension.
        let Ok(list) = (unsafe { SHAssocEnumHandlers(&extension, ASSOC_FILTER_RECOMMENDED) }) else {
            return Vec::new();
        };
        let mut found = Vec::new();
        while found.len() < 64 {
            let mut slot = [None];
            let mut fetched = 0u32;
            // SAFETY: one slot, and a count to write how many were filled.
            let next = unsafe { list.Next(&mut slot, Some(&mut fetched)) };
            if next.is_err() || fetched == 0 {
                break;
            }
            if let Some(handler) = slot[0].take() {
                found.push(handler);
            }
        }
        found
    }

    /// Each app as its name and its handler's own name, which is how `open` finds it again.
    pub(super) fn apps(path: &Path) -> Vec<(String, String)> {
        let _com = Com::start();
        handlers(path)
            .iter()
            .filter_map(|handler| {
                // SAFETY: a live handler from the enumeration above.
                let name = take(unsafe { handler.GetUIName() })?;
                let id = take(unsafe { handler.GetName() })?;
                Some((name, id))
            })
            .collect()
    }

    pub(super) fn open(path: &Path, id: &str) -> Result<(), String> {
        let _com = Com::start();
        let handler = handlers(path)
            .into_iter()
            // SAFETY: a live handler from the enumeration.
            .find(|handler| take(unsafe { handler.GetName() }).as_deref() == Some(id))
            .ok_or("That app can't open it.")?;
        let parsed = HSTRING::from(path.to_string_lossy().as_ref());
        // SAFETY: a valid path string; no bind context.
        let item: IShellItem =
            unsafe { SHCreateItemFromParsingName(&parsed, None) }.map_err(|error| error.message())?;
        // SAFETY: a live item; BHID_DataObject asks for its data object.
        let data: IDataObject =
            unsafe { item.BindToHandler(None, &BHID_DataObject) }.map_err(|error| error.message())?;
        // SAFETY: a live handler and data object.
        unsafe { handler.Invoke(&data) }.map_err(|error| error.message())
    }
}

/// Linux: the item's type from `xdg-mime`, the apps registered for it from `gio mime` (or just the
/// default when gio isn't there), named by their desktop entries, and opening with `gio launch`.
#[cfg(all(unix, not(target_os = "macos")))]
mod desktop_entries {
    use std::{
        path::{Path, PathBuf},
        process::{Command, Stdio},
    };

    use file_access::disk::fs_disk;

    use super::AppChoice;

    fn output(command: &mut Command) -> Option<String> {
        let out = command.stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
    }

    fn mime_of(path: &Path) -> Option<String> {
        let mime = output(Command::new("xdg-mime").args(["query", "filetype"]).arg(path))?;
        let mime = mime.trim().to_owned();
        (!mime.is_empty()).then_some(mime)
    }

    /// Where desktop entries live, the person's own first.
    fn folders() -> Vec<PathBuf> {
        let mut folders = Vec::new();
        match std::env::var_os("XDG_DATA_HOME") {
            Some(home) if !home.is_empty() => folders.push(PathBuf::from(home)),
            _ => folders.extend(dirs::home_dir().map(|home| home.join(".local").join("share"))),
        }
        let shared = std::env::var("XDG_DATA_DIRS")
            .ok()
            .filter(|dirs| !dirs.is_empty())
            .unwrap_or_else(|| "/usr/local/share:/usr/share".into());
        folders.extend(shared.split(':').filter(|dir| !dir.is_empty()).map(PathBuf::from));
        folders.into_iter().map(|folder| folder.join("applications")).collect()
    }

    fn find(id: &str) -> Option<PathBuf> {
        if id.contains('/') || !id.ends_with(".desktop") {
            return None;
        }
        folders().into_iter().map(|folder| folder.join(id)).find(|file| fs_disk::is_file(file))
    }

    /// An entry's own name, unless it hides itself.
    fn name_of(file: &Path) -> Option<String> {
        let text = fs_disk::read_to_string(file).ok()?;
        let (mut inside, mut name) = (false, None);
        for line in text.lines().map(str::trim) {
            if line.starts_with('[') {
                inside = line == "[Desktop Entry]";
                continue;
            }
            if !inside {
                continue;
            }
            if line == "NoDisplay=true" || line == "Hidden=true" {
                return None;
            }
            if let Some(value) = line.strip_prefix("Name=") {
                name.get_or_insert_with(|| value.trim().to_owned());
            }
        }
        name
    }

    /// The desktop entry ids `gio mime` lists for a type, in its order, without repeats.
    fn registered(mime: &str) -> Vec<String> {
        let Some(text) = output(Command::new("gio").args(["mime", mime])) else {
            return Vec::new();
        };
        let mut ids: Vec<String> = Vec::new();
        for line in text.lines() {
            let id = line.trim();
            if line.starts_with(char::is_whitespace) && id.ends_with(".desktop") && !ids.iter().any(|seen| seen == id) {
                ids.push(id.to_owned());
            }
        }
        ids
    }

    pub(super) fn apps(path: &Path) -> Vec<AppChoice> {
        let Some(mime) = mime_of(path) else {
            return Vec::new();
        };
        let default = output(Command::new("xdg-mime").args(["query", "default", &mime]))
            .map(|id| id.trim().to_owned())
            .filter(|id| !id.is_empty());
        let mut ids = registered(&mime);
        if let Some(default) = &default {
            ids.retain(|id| id != default);
            ids.insert(0, default.clone());
        }
        ids.iter()
            .take(64)
            .filter_map(|id| {
                let file = find(id)?;
                Some(AppChoice {
                    name: name_of(&file)?,
                    path: file.display().to_string(),
                    is_default: default.as_deref() == Some(id.as_str()),
                })
            })
            .collect()
    }

    pub(super) fn open(path: &Path, app: &str) -> Result<(), String> {
        let entry = Path::new(app);
        let launched = Command::new("gio")
            .arg("launch")
            .arg(entry)
            .arg(path)
            .stdin(Stdio::null())
            .status();
        match launched {
            Ok(status) if status.success() => Ok(()),
            _ => {
                // Without gio, gtk-launch takes the entry's id.
                let id = entry.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
                let status = Command::new("gtk-launch")
                    .arg(&id)
                    .arg(path)
                    .stdin(Stdio::null())
                    .status()
                    .map_err(|_| "No app launcher (gio or gtk-launch) is installed.".to_string())?;
                status.success().then_some(()).ok_or_else(|| "That app couldn't open it.".to_string())
            }
        }
    }
}

/// Shows the item in Finder, or the system's file manager.
#[tauri::command]
pub async fn files_reveal(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    path: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let path = asked_path(&path)?;
    blocking(move || {
        readable(&path)?;
        app.opener()
            .reveal_item_in_dir(&path)
            .map_err(|error| failed(&path, error))
    })
    .await
}
