use serde::Serialize;
use std::{
    env,
    fs::{self, File},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    process::Command,
};
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

use crate::infra::paths;

const TEMPLATE_DIR_NAME: &str = ".template";
const TEMPLATE_ARCHIVE_NAME: &str = "misty-template.zip";
const INSTALLED_VERSION_FILE: &str = ".version";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MistyTemplateEntryKind {
    Dir,
    File,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MistyTemplateCheck {
    relative_path: String,
    path: String,
    source_path: Option<String>,
    kind: MistyTemplateEntryKind,
    required: bool,
    exists: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MistyTemplateStatus {
    misty_home: String,
    template_dir: String,
    template_archive: String,
    template_exists: bool,
    ready: bool,
    entries: Vec<MistyTemplateCheck>,
}

#[derive(Debug, Clone)]
struct MistyTemplateEntry {
    relative_path: String,
    source_path: Option<PathBuf>,
    kind: MistyTemplateEntryKind,
    required: bool,
}

#[derive(Debug, Default)]
struct MistyTemplatePlan {
    entries: Vec<MistyTemplateEntry>,
}

impl MistyTemplatePlan {
    fn dir(mut self, relative_path: &str) -> Self {
        self.entries.push(MistyTemplateEntry {
            relative_path: normalize_template_path(relative_path),
            source_path: None,
            kind: MistyTemplateEntryKind::Dir,
            required: true,
        });
        self
    }

    fn file(mut self, home: &Path, relative_path: &str) -> Self {
        let relative_path = normalize_template_path(relative_path);
        self.entries.push(MistyTemplateEntry {
            source_path: Some(home.join(&relative_path)),
            relative_path,
            kind: MistyTemplateEntryKind::File,
            required: true,
        });
        self
    }

    fn optional_file(mut self, home: &Path, relative_path: &str) -> Self {
        let relative_path = normalize_template_path(relative_path);
        self.entries.push(MistyTemplateEntry {
            source_path: Some(home.join(&relative_path)),
            relative_path,
            kind: MistyTemplateEntryKind::File,
            required: false,
        });
        self
    }

    fn tree(mut self, home: &Path, relative_path: &str) -> Self {
        let relative_path = normalize_template_path(relative_path);
        let root = home.join(&relative_path);
        self.entries.push(MistyTemplateEntry {
            relative_path: relative_path.clone(),
            source_path: None,
            kind: MistyTemplateEntryKind::Dir,
            required: true,
        });

        if !root.exists() {
            return self;
        }

        let mut discovered = Vec::new();
        for entry in WalkDir::new(&root)
            .follow_links(false)
            .into_iter()
            .flatten()
        {
            let path = entry.path();
            if path == root || skip_template_source_path(path) {
                continue;
            }
            let Ok(child_relative) = path.strip_prefix(home) else {
                continue;
            };
            let child_relative = normalize_template_path(&child_relative.to_string_lossy());
            let kind = if entry.file_type().is_dir() {
                MistyTemplateEntryKind::Dir
            } else if entry.file_type().is_file() {
                MistyTemplateEntryKind::File
            } else {
                continue;
            };
            discovered.push(MistyTemplateEntry {
                relative_path: child_relative,
                source_path: (kind == MistyTemplateEntryKind::File).then(|| path.to_path_buf()),
                kind,
                required: true,
            });
        }

        discovered.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        self.entries.extend(discovered);
        self
    }
}

#[tauri::command]
pub fn misty_template_status() -> Result<MistyTemplateStatus, String> {
    let home = misty_home_dir()?;
    Ok(template_status(&home))
}

#[tauri::command]
pub fn build_misty_template() -> Result<MistyTemplateStatus, String> {
    let home = misty_home_dir()?;
    build_template_archive(&home)
        .map_err(|error| format!("Could not build Misty template: {error}"))?;
    Ok(template_status(&home))
}

#[tauri::command]
pub fn install_misty_template(version: String) -> Result<String, String> {
    let home = misty_home_dir()?;
    let version = version.trim();
    if version.is_empty() {
        return Err("Misty version is required.".to_string());
    }
    let archive_path = template_archive_path(&home);
    if !archive_path.is_file() {
        build_template_archive(&home)
            .map_err(|error| format!("Could not build Misty template before install: {error}"))?;
    }
    let extracted = extract_template_archive(&home, &archive_path)
        .map_err(|error| format!("Could not extract Misty template: {error}"))?;
    write_installed_version(&home, version)
        .map_err(|error| format!("Could not write installed Misty version: {error}"))?;
    let app_install_message = install_current_app_bundle(&home)?;
    let app_install_message = app_install_message
        .map(|message| format!(" {message}"))
        .unwrap_or_default();
    Ok(format!(
        "Installed Misty {version} with {extracted} item(s) from {}.{app_install_message}",
        archive_path.display()
    ))
}

#[tauri::command]
pub fn restart_misty_app(app: tauri::AppHandle) -> Result<String, String> {
    if let Some(path) = restart_launch_path().filter(|path| path.exists()) {
        spawn_delayed_app_launch(&path)?;
        app.exit(0);
    } else {
        app.restart();
    }
    Ok("Restarting Misty.".to_string())
}

fn template_status(home: &Path) -> MistyTemplateStatus {
    let template_archive = template_archive_path(home);
    let entries = misty_template_plan(home)
        .entries
        .into_iter()
        .map(|entry| {
            let target = home.join(&entry.relative_path);
            let exists = match entry.kind {
                MistyTemplateEntryKind::Dir => target.is_dir(),
                MistyTemplateEntryKind::File => target.is_file(),
            };
            MistyTemplateCheck {
                relative_path: entry.relative_path,
                path: target.display().to_string(),
                source_path: entry.source_path.map(|path| path.display().to_string()),
                kind: entry.kind,
                required: entry.required,
                exists,
            }
        })
        .collect::<Vec<_>>();
    let ready = entries.iter().all(|entry| !entry.required || entry.exists);

    MistyTemplateStatus {
        misty_home: home.display().to_string(),
        template_dir: template_dir(home).display().to_string(),
        template_archive: template_archive.display().to_string(),
        template_exists: template_archive.is_file(),
        ready,
        entries,
    }
}

fn build_template_archive(home: &Path) -> io::Result<()> {
    let template_dir = template_dir(home);
    fs::create_dir_all(&template_dir)?;
    let archive_path = template_archive_path(home);
    let temp_path = template_dir.join(format!("{TEMPLATE_ARCHIVE_NAME}.tmp"));
    let file = File::create(&temp_path)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for entry in misty_template_plan(home).entries {
        if !safe_template_relative_path(&entry.relative_path) {
            continue;
        }

        match entry.kind {
            MistyTemplateEntryKind::Dir => {
                zip.add_directory(zip_dir_name(&entry.relative_path), options)?;
            }
            MistyTemplateEntryKind::File => {
                let Some(source_path) = entry.source_path.as_ref() else {
                    continue;
                };
                if !source_path.is_file() {
                    if entry.required {
                        return Err(io::Error::new(
                            io::ErrorKind::NotFound,
                            format!("required template file missing: {}", source_path.display()),
                        ));
                    }
                    continue;
                }
                add_file_to_zip(&mut zip, source_path, &entry.relative_path, options)?;
            }
        }
    }

    zip.finish()?;
    fs::rename(temp_path, archive_path)?;
    Ok(())
}

fn add_file_to_zip(
    zip: &mut ZipWriter<File>,
    source_path: &Path,
    relative_path: &str,
    options: SimpleFileOptions,
) -> io::Result<()> {
    let mut file = File::open(source_path)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;

    #[cfg(unix)]
    let options = {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(source_path)?.permissions().mode();
        options.unix_permissions(mode)
    };

    zip.start_file(relative_path, options)?;
    zip.write_all(&bytes)?;
    Ok(())
}

fn extract_template_archive(home: &Path, archive_path: &Path) -> io::Result<usize> {
    let file = File::open(archive_path)?;
    let mut archive = ZipArchive::new(file)?;
    let mut extracted = 0;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let Some(out_path) = template_entry_destination(home, entry.name()) else {
            continue;
        };

        if entry.is_dir() {
            fs::create_dir_all(&out_path)?;
            extracted += 1;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut out_file = File::create(&out_path)?;
        io::copy(&mut entry, &mut out_file)?;

        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&out_path, fs::Permissions::from_mode(mode))?;
        }
        extracted += 1;
    }

    Ok(extracted)
}

fn misty_template_plan(home: &Path) -> MistyTemplatePlan {
    MistyTemplatePlan::default()
        .dir(".local")
        .dir(".local/bin")
        .file(home, ".local/bin/misty")
        .dir("local")
        .dir("local/bin")
        .dir("local/plugins")
        .tree(home, "assets")
        .tree(home, "scripts")
        .tree(home, "plugins/public")
        .dir("plugins/private")
        .dir("public")
        .dir("public/plugins")
        .dir("public/keys")
        .dir("config")
        .dir("config/sessions")
        .dir("db")
        .dir("forms")
        .dir("restic")
        .dir("restic/passwords")
        .dir("tmp")
        .dir("tmp/transfers")
        .dir("tmp/downloads")
        .dir(".cache")
        .dir(".cache/trash")
        .dir(".cache/remotes")
        .dir(".cache/sessions")
        .dir("mnt")
}

fn template_dir(home: &Path) -> PathBuf {
    home.join(TEMPLATE_DIR_NAME)
}

fn template_archive_path(home: &Path) -> PathBuf {
    template_dir(home).join(TEMPLATE_ARCHIVE_NAME)
}

fn write_installed_version(home: &Path, version: &str) -> io::Result<()> {
    fs::create_dir_all(home)?;
    fs::write(home.join(INSTALLED_VERSION_FILE), format!("{version}\n"))
}

#[cfg(target_os = "macos")]
fn install_current_app_bundle(home: &Path) -> Result<Option<String>, String> {
    let Some(source) = current_app_bundle()
        .map_err(|error| format!("Could not locate current Misty.app bundle: {error}"))?
    else {
        return Ok(None);
    };
    let target = home.join(".local").join("bin").join("Misty.app");
    fs::create_dir_all(target.parent().expect("Misty.app target has a parent"))
        .map_err(|error| format!("Could not create Misty app install directory: {error}"))?;

    if !paths_equivalent(&source, &target) {
        let staging = target.with_file_name(".Misty.app.installing");
        remove_path_if_exists(&staging)
            .map_err(|error| format!("Could not clear staged Misty.app install: {error}"))?;
        copy_directory(&source, &staging)
            .map_err(|error| format!("Could not copy Misty.app into ~/.misty: {error}"))?;
        replace_path(&staging, &target)
            .map_err(|error| format!("Could not install Misty.app into ~/.misty: {error}"))?;
    }

    let link = user_misty_app_link_path()
        .ok_or_else(|| "Could not resolve ~/Applications/Misty.app".to_string())?;
    fs::create_dir_all(link.parent().expect("Misty.app link has a parent"))
        .map_err(|error| format!("Could not create ~/Applications: {error}"))?;
    remove_path_if_exists(&link)
        .map_err(|error| format!("Could not replace ~/Applications/Misty.app: {error}"))?;
    std::os::unix::fs::symlink(&target, &link)
        .map_err(|error| format!("Could not link ~/Applications/Misty.app: {error}"))?;

    Ok(Some(format!(
        "Linked {} to {}.",
        link.display(),
        target.display()
    )))
}

#[cfg(not(target_os = "macos"))]
fn install_current_app_bundle(_home: &Path) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(target_os = "macos")]
fn restart_launch_path() -> Option<PathBuf> {
    user_misty_app_link_path()
}

#[cfg(not(target_os = "macos"))]
fn restart_launch_path() -> Option<PathBuf> {
    None
}

#[cfg(target_os = "macos")]
fn spawn_delayed_app_launch(path: &Path) -> Result<(), String> {
    Command::new("/bin/sh")
        .arg("-c")
        .arg("sleep 1; /usr/bin/open \"$1\"")
        .arg("misty-restart")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not schedule Misty restart: {error}"))
}

#[cfg(not(target_os = "macos"))]
fn spawn_delayed_app_launch(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn current_app_bundle() -> io::Result<Option<PathBuf>> {
    let exe = env::current_exe()?;
    Ok(exe
        .ancestors()
        .find(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
        })
        .map(Path::to_path_buf))
}

#[cfg(target_os = "macos")]
fn user_misty_app_link_path() -> Option<PathBuf> {
    paths::misty_data_root().map(|root| root.join("Applications").join("Misty.app"))
}

#[cfg(target_os = "macos")]
fn paths_equivalent(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

#[cfg(target_os = "macos")]
fn replace_path(source: &Path, destination: &Path) -> io::Result<()> {
    remove_path_if_exists(destination)?;
    fs::rename(source, destination)
}

#[cfg(target_os = "macos")]
fn remove_path_if_exists(path: &Path) -> io::Result<()> {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return Ok(());
    };
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

#[cfg(target_os = "macos")]
fn copy_directory(source: &Path, destination: &Path) -> io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in WalkDir::new(source).follow_links(false) {
        let entry = entry?;
        let path = entry.path();
        let relative = path.strip_prefix(source).map_err(io::Error::other)?;
        if relative.as_os_str().is_empty() {
            continue;
        }
        let target = destination.join(relative);
        let metadata = fs::symlink_metadata(path)?;

        if metadata.file_type().is_symlink() {
            let link_target = fs::read_link(path)?;
            std::os::unix::fs::symlink(link_target, target)?;
        } else if metadata.is_dir() {
            fs::create_dir_all(&target)?;
            fs::set_permissions(&target, metadata.permissions())?;
        } else if metadata.is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(path, &target)?;
            fs::set_permissions(&target, metadata.permissions())?;
        }
    }
    Ok(())
}

fn misty_home_dir() -> Result<PathBuf, String> {
    paths::misty_home_dir().ok_or_else(|| "Could not resolve Misty data directory".to_string())
}

fn template_entry_destination(home: &Path, entry_name: &str) -> Option<PathBuf> {
    if !safe_template_relative_path(entry_name) {
        return None;
    }
    Some(home.join(normalize_template_path(entry_name)))
}

fn safe_template_relative_path(relative_path: &str) -> bool {
    let path = Path::new(relative_path);
    if path.is_absolute() {
        return false;
    }
    path.components()
        .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

fn normalize_template_path(relative_path: &str) -> String {
    relative_path
        .replace('\\', "/")
        .trim_matches('/')
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
        .collect::<Vec<_>>()
        .join("/")
}

fn zip_dir_name(relative_path: &str) -> String {
    format!("{}/", normalize_template_path(relative_path))
}

fn skip_template_source_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == ".DS_Store")
        || path.components().any(
            |component| matches!(component, Component::Normal(name) if name == TEMPLATE_DIR_NAME),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_home() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be available")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("misty-template-test-{unique}"));
        fs::create_dir_all(&path).expect("temp home should be created");
        path
    }

    #[test]
    fn template_plan_discovers_assets_from_tree_calls() {
        let home = temp_home();
        fs::create_dir_all(home.join("assets/themes")).unwrap();
        fs::write(home.join("assets/themes/default.css"), "theme").unwrap();
        fs::create_dir_all(home.join(".local/bin")).unwrap();
        fs::write(home.join(".local/bin/misty"), "bin").unwrap();

        let entries = misty_template_plan(&home).entries;

        assert!(entries.iter().any(|entry| entry.relative_path == "assets"));
        assert!(entries
            .iter()
            .any(|entry| entry.relative_path == "assets/themes/default.css"));
        assert!(entries
            .iter()
            .any(|entry| entry.relative_path == ".local/bin/misty"));

        fs::remove_dir_all(home).ok();
    }

    #[test]
    fn template_archive_round_trips_planned_files() {
        let home = temp_home();
        fs::create_dir_all(home.join(".local/bin")).unwrap();
        fs::write(home.join(".local/bin/misty"), "misty-bin").unwrap();
        fs::create_dir_all(home.join("assets/themes")).unwrap();
        fs::write(home.join("assets/themes/default.css"), "theme").unwrap();

        build_template_archive(&home).expect("template archive should build");
        fs::remove_file(home.join(".local/bin/misty")).unwrap();
        fs::remove_file(home.join("assets/themes/default.css")).unwrap();

        let extracted = extract_template_archive(&home, &template_archive_path(&home))
            .expect("template should extract");

        assert!(extracted > 0);
        assert_eq!(
            fs::read_to_string(home.join(".local/bin/misty")).unwrap(),
            "misty-bin"
        );
        assert_eq!(
            fs::read_to_string(home.join("assets/themes/default.css")).unwrap(),
            "theme"
        );

        fs::remove_dir_all(home).ok();
    }

    #[test]
    fn rejects_unsafe_template_entries() {
        let home = PathBuf::from("/tmp/misty-home");

        assert!(template_entry_destination(&home, "assets/theme.css").is_some());
        assert!(template_entry_destination(&home, "../assets/theme.css").is_none());
        assert!(template_entry_destination(&home, "/assets/theme.css").is_none());
    }
}
