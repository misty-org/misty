//! Installing a speech package: downloaded from the maker's release as sherpa-onnx publishes it,
//! hashed as it arrives and kept only when it matches its pinned SHA-256, then unpacked into
//! `~/.misty/shared/models`, with its progress pushed to the window that asked.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use serde_json::json;
use sha2::{Digest as _, Sha256};
use tauri::{AppHandle, Emitter, State, Webview};

use super::*;

/// Installs a hearing model or a voice (and the voice activity detector a hearing model needs),
/// reporting progress as `misty://speech-install` events: `{ id, received, total }` as it
/// downloads, then `{ id, phase: "unpacking" }`, then `{ id, phase: "done" }` or
/// `{ id, phase: "failed", error }`. Resolves once it is installed or has failed.
#[tauri::command]
pub async fn speech_install(
    app: AppHandle,
    webview: Webview,
    state: State<'_, SpeechModelsState>,
    id: String,
) -> Result<(), String> {
    require_person(&webview)?;
    let package = package_of(&id).ok_or_else(|| "Misty doesn't know that model.".to_string())?;
    // One install per download at a time: voices that share a model share its folder.
    let key = package_key(&package);
    {
        let mut installing = state.installing.lock().map_err(|_| "Busy.".to_string())?;
        if installing.values().any(|busy| *busy == key) {
            return Ok(());
        }
        installing.insert(id.clone(), key);
    }
    let owner = webview.label().to_string();
    let result = install_all(&app, &owner, &id, &package).await;
    if let Ok(mut installing) = state.installing.lock() {
        installing.remove(&id);
    }
    let payload = match &result {
        Ok(()) => json!({ "id": id, "phase": "done" }),
        Err(error) => json!({ "id": id, "phase": "failed", "error": error }),
    };
    let _ = app.emit_to(owner.as_str(), INSTALL_EVENT, payload);
    result
}

/// Held while the voice activity detector installs, so two hearing installs never fetch it at once.
static VAD_INSTALL: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));

async fn install_all(app: &AppHandle, owner: &str, id: &str, package: &Package) -> Result<(), String> {
    // A hearing model can't run without the detector, so it comes first, quietly: it's small.
    if hearing(id).is_some() {
        if let Some(vad) = vad_entry() {
            let _held = VAD_INSTALL.lock().await;
            if !installed(&vad.package) {
                install_package(app, owner, &vad.id, &vad.package, false).await?;
            }
        }
    }
    let previous = pins().get(id).cloned();
    if !installed(package) {
        install_package(app, owner, id, package, true).await?;
    }
    // Every entry this download brings is now at this pin (voices that share one model).
    for entry in entries_sharing(package) {
        set_pin(&entry, Some(&package.sha256));
    }
    set_pin(id, Some(&package.sha256));
    // The older pin goes once the newer one is in, unless another entry still uses it.
    if let Some(previous) = previous.filter(|previous| !previous.eq_ignore_ascii_case(&package.sha256)) {
        let still_used = pins().values().any(|pin| pin.eq_ignore_ascii_case(&previous));
        if !still_used {
            let old = Package {
                sha256: previous,
                ..package.clone()
            };
            if let Some(dir) = package_dir(&old) {
                let _ = file_access::fs::remove_dir_all(dir);
            }
        }
    }
    Ok(())
}

async fn install_package(
    app: &AppHandle,
    owner: &str,
    id: &str,
    package: &Package,
    report: bool,
) -> Result<(), String> {
    let dir = package_dir(package).ok_or_else(|| "Misty has no folder for models.".to_string())?;
    let parent = dir.parent().ok_or_else(|| "Misty has no folder for models.".to_string())?;
    file_access::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    // A half-finished earlier try is started over.
    if dir.exists() {
        file_access::fs::remove_dir_all(&dir).map_err(|error| error.to_string())?;
    }
    let file_name = package
        .url
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty() && !name.contains(".."))
        .ok_or_else(|| "That model's address isn't one Misty can use.".to_string())?
        .to_string();
    let download = parent.join(format!("{}.partial", package_key(package)));
    let progress = |received: u64, total: u64| {
        if report {
            let _ = app.emit_to(
                owner,
                INSTALL_EVENT,
                json!({ "id": id, "received": received, "total": total }),
            );
        }
    };
    let matched = download_to(&package.url, &download, package.size, &progress).await;
    let matched = match matched {
        Ok(hash) => hash.eq_ignore_ascii_case(&package.sha256),
        Err(error) => {
            let _ = file_access::fs::remove_file(&download);
            return Err(error);
        }
    };
    if !matched {
        let _ = file_access::fs::remove_file(&download);
        return Err(
            "The download didn't match its published checksum, so it was thrown away. Try again."
                .into(),
        );
    }
    if report {
        let _ = app.emit_to(owner, INSTALL_EVENT, json!({ "id": id, "phase": "unpacking" }));
    }
    file_access::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let placed = if package.kind == "tar.bz2" {
        let unpacked = unpack(&download, &dir).await;
        let _ = file_access::fs::remove_file(&download);
        unpacked
    } else {
        file_access::fs::rename(&download, dir.join(&file_name)).map_err(|error| error.to_string())
    };
    if let Err(error) = placed {
        let _ = file_access::fs::remove_dir_all(&dir);
        return Err(error);
    }
    file_access::fs::write(dir.join(COMPLETE), package.sha256.as_bytes())
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Streams `url` to `path`, hashing as it arrives; answers the file's SHA-256.
async fn download_to(
    url: &str,
    path: &Path,
    expected: u64,
    progress: &impl Fn(u64, u64),
) -> Result<String, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = crate::engine_config::proxy::apply_to_client(
        reqwest::Client::builder()
            .user_agent(concat!("Misty/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(DOWNLOAD_TIMEOUT),
    )
    .build()
    .map_err(|error| error.to_string())?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "Misty couldn't reach where the model is kept. Try again.".to_string())?;
    if !response.status().is_success() {
        return Err(format!("The model's download answered {}.", response.status()));
    }
    let total = response.content_length().unwrap_or(expected);
    let mut file = file_access::fs::File::create(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut last = Instant::now();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The download stopped. Try again.".to_string())?
    {
        hasher.update(&chunk);
        file.write_all(&chunk).map_err(|error| error.to_string())?;
        received += chunk.len() as u64;
        // Progress at most every quarter second: it's pushed, never asked for.
        if last.elapsed() >= Duration::from_millis(250) {
            last = Instant::now();
            progress(received, total);
        }
        if received > expected.saturating_mul(2).max(1024) {
            return Err("The download is larger than the model should be.".into());
        }
    }
    file.flush().map_err(|error| error.to_string())?;
    progress(received, total);
    Ok(hex::encode(hasher.finalize()))
}

/// Unpacks a `.tar.bz2` with the system's own `tar` (bsdtar on macOS and Windows, GNU tar on
/// Linux; both read bzip2), as engine installs do.
async fn unpack(archive: &Path, into: &Path) -> Result<(), String> {
    let mut command = tokio::process::Command::new(system_tar());
    command.arg("-xf").arg(archive).arg("-C").arg(into);
    command.kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(900), command.output())
        .await
        .map_err(|_| "Unpacking the model took too long.".to_string())?
        .map_err(|_| "Misty couldn't unpack the model.".to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err("Misty couldn't unpack the model.".into())
    }
}

fn system_tar() -> PathBuf {
    if cfg!(windows) {
        let root = std::env::var("SystemRoot")
            .ok()
            .filter(|root| !root.trim().is_empty())
            .unwrap_or_else(|| "C:\\Windows".to_string());
        return PathBuf::from(root).join("System32").join("tar.exe");
    }
    for candidate in ["/usr/bin/tar", "/bin/tar"] {
        if Path::new(candidate).is_file() {
            return PathBuf::from(candidate);
        }
    }
    PathBuf::from("tar")
}
