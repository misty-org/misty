// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! The apps on the fixed list, and opening a folder in one.

use super::*;

/// An app on the fixed list: its id, the name `open -a` knows it by on macOS, its bundle ids
/// (to find its icon and whether it's installed), and the command-line programs elsewhere.
pub(super) struct Preset {
    pub(super) id: &'static str,
    pub(super) mac_app: &'static str,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(super) bundle_ids: &'static [&'static str],
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    pub(super) programs: &'static [&'static str],
}

pub(super) const PRESETS: &[Preset] = &[
    Preset {
        id: "vscode",
        mac_app: "Visual Studio Code",
        bundle_ids: &["com.microsoft.VSCode", "com.microsoft.VSCodeInsiders"],
        programs: &["code", "code-insiders"],
    },
    Preset {
        id: "cursor",
        mac_app: "Cursor",
        bundle_ids: &["com.todesktop.230313mzl4w4u92"],
        programs: &["cursor"],
    },
    Preset {
        id: "idea",
        mac_app: "IntelliJ IDEA",
        bundle_ids: &["com.jetbrains.intellij", "com.jetbrains.intellij.ce"],
        programs: &["idea", "idea64"],
    },
    Preset {
        id: "webstorm",
        mac_app: "WebStorm",
        bundle_ids: &["com.jetbrains.WebStorm"],
        programs: &["webstorm", "webstorm64"],
    },
    Preset {
        id: "zed",
        mac_app: "Zed",
        bundle_ids: &["dev.zed.Zed"],
        programs: &["zed"],
    },
    Preset {
        id: "sublime",
        mac_app: "Sublime Text",
        bundle_ids: &["com.sublimetext.4", "com.sublimetext.3"],
        programs: &["subl"],
    },
    Preset {
        id: "xcode",
        mac_app: "Xcode",
        bundle_ids: &["com.apple.dt.Xcode"],
        programs: &[],
    },
    Preset {
        id: "finder",
        mac_app: "Finder",
        bundle_ids: &["com.apple.finder"],
        programs: &[],
    },
];

pub(super) fn preset(id: &str) -> Option<&'static Preset> {
    PRESETS.iter().find(|preset| preset.id == id)
}
// ---------------------------------------------------------------------------
// Fixed-list apps
// ---------------------------------------------------------------------------

/// Where an app's bundle is installed, by its bundle ids.
#[cfg(target_os = "macos")]
pub(super) fn bundle_path(preset: &Preset) -> Option<PathBuf> {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::NSString;
    let workspace = NSWorkspace::sharedWorkspace();
    preset.bundle_ids.iter().find_map(|id| {
        workspace
            .URLForApplicationWithBundleIdentifier(&NSString::from_str(id))?
            .to_file_path()
    })
}

/// IntelliJ's own command-line launcher inside its bundle. JetBrains' CLI checks the projects
/// already open, where a Launch Services "open document" can start a second copy of one.
#[cfg(target_os = "macos")]
pub(super) fn jetbrains_launcher(preset: &Preset) -> Option<PathBuf> {
    let name = match preset.id {
        "idea" => "idea",
        "webstorm" => "webstorm",
        _ => return None,
    };
    let mut bundles = vec![PathBuf::from(format!(
        "/Applications/{}.app",
        preset.mac_app
    ))];
    if let Some(home) = dirs::home_dir() {
        bundles.push(home.join(format!("Applications/{}.app", preset.mac_app)));
    }
    bundles.extend(bundle_path(preset));
    bundles
        .iter()
        .map(|bundle| bundle.join("Contents/MacOS").join(name))
        .find(|launcher| file_access::fs::is_file(launcher))
}

#[cfg(target_os = "macos")]
pub(super) fn macos_open_command(
    app: &str,
    launcher: Option<&Path>,
    path: &Path,
    args: &[String],
) -> tokio::process::Command {
    if let Some(launcher) = launcher {
        let mut command = tokio::process::Command::new(launcher);
        command.args(args).arg(path);
        return command;
    }
    let mut command = tokio::process::Command::new("/usr/bin/open");
    command.arg("-a").arg(app).arg(path);
    if !args.is_empty() {
        command.arg("--args").args(args);
    }
    command
}

/// Starts a JetBrains launcher. With the IDE already open it hands the request on and exits;
/// on a cold start it becomes the IDE and lives on, so only an early failure counts.
#[cfg(target_os = "macos")]
pub(super) async fn start_launcher(mut command: tokio::process::Command) -> Result<(), String> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("The IDE could not be started: {error}"))?;
    match tokio::time::timeout(std::time::Duration::from_secs(2), child.wait()).await {
        Ok(Ok(status)) if !status.success() => Err(format!(
            "The IDE could not be started ({}).",
            format_exit_detail(status.code())
        )),
        Ok(Err(error)) => Err(format!("The IDE could not be started: {error}")),
        Ok(Ok(_)) | Err(_) => Ok(()),
    }
}

/// The command-line programs to try for an app off macOS, first match wins, including the
/// usual Windows install folders for VS Code and Cursor.
#[cfg(not(target_os = "macos"))]
pub(super) fn program_candidates(preset: &Preset) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = preset
        .programs
        .iter()
        .filter_map(|name| crate::engines::resolve::find_program(name))
        .collect();
    #[cfg(windows)]
    {
        let installs: &[(&str, &str)] = match preset.id {
            "vscode" => &[
                ("LOCALAPPDATA", "Programs\\Microsoft VS Code\\Code.exe"),
                ("PROGRAMFILES", "Microsoft VS Code\\Code.exe"),
                ("PROGRAMFILES(X86)", "Microsoft VS Code\\Code.exe"),
            ],
            "cursor" => &[
                ("LOCALAPPDATA", "Programs\\Cursor\\Cursor.exe"),
                ("PROGRAMFILES", "Cursor\\Cursor.exe"),
            ],
            _ => &[],
        };
        for (env, rel) in installs {
            if let Some(base) = std::env::var_os(env) {
                let path = PathBuf::from(base).join(rel);
                if file_access::fs::is_file(&path) {
                    found.push(path);
                }
            }
        }
    }
    found
}

pub(super) async fn open_with_preset(preset: &Preset, path: &Path) -> Result<(), String> {
    if preset.id == "finder" {
        return reveal(path).await;
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(launcher) = jetbrains_launcher(preset) {
            return start_launcher(macos_open_command(
                preset.mac_app,
                Some(&launcher),
                path,
                &[],
            ))
            .await;
        }
        let output = macos_open_command(preset.mac_app, None, path, &[])
            .stdin(Stdio::null())
            .output()
            .await
            .map_err(|error| format!("{} could not be opened: {error}", preset.mac_app))?;
        if output.status.success() {
            return Ok(());
        }
        Err(format!(
            "{} could not be opened ({}): {}",
            preset.mac_app,
            format_exit_detail(output.status.code()),
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let Some(program) = program_candidates(preset).into_iter().next() else {
            return Err(format!(
                "{} isn't installed on this computer.",
                preset.mac_app
            ));
        };
        let mut command = crate::engines::resolve::command_for(&program);
        command
            .arg(path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        crate::engines::turn::own_group(&mut command);
        command
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("{} could not be opened: {error}", preset.mac_app))
    }
}
