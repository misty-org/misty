use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{State, Webview};

use super::speech::require_person;

const INSTALL_EVENT: &str = "misty://speech-install";
const COMPLETE: &str = ".complete";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(3600);

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Package {
    pub url: String,
    pub sha256: String,
    pub size: u64,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mirror: Option<String>,
}

impl Package {
    pub fn download_url(&self) -> &str {
        self.mirror
            .as_deref()
            .filter(|mirror| {
                *mirror == format!("https://registry.mistysys.com/blobs/{}", self.sha256)
            })
            .unwrap_or(&self.url)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct HearingEntry {
    pub id: String,
    pub name: String,
    pub maker: String,
    pub source: String,
    pub license: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credit: Option<String>,
    pub description: String,
    pub languages: Vec<String>,
    pub detects_language: bool,
    pub family: String,
    pub package: Package,
    pub files: HashMap<String, String>,
    pub disk_mb: u64,
    pub memory_mb: u64,
    pub accuracy: u8,
    pub speed: u8,
    pub words: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SupportEntry {
    pub id: String,
    pub name: String,
    pub maker: String,
    pub source: String,
    pub license: String,
    pub role: String,
    pub package: Package,
    pub files: HashMap<String, String>,
}

#[derive(Debug, Default, Deserialize)]
struct Catalog {
    #[serde(default)]
    hearing: Vec<HearingEntry>,
    #[serde(default)]
    support: Vec<SupportEntry>,
}

static CATALOG: LazyLock<Catalog> = LazyLock::new(|| {
    serde_json::from_value(crate::registry::current().speech()).unwrap_or_default()
});

pub fn hearing(id: &str) -> Option<&'static HearingEntry> {
    CATALOG.hearing.iter().find(|entry| entry.id == id)
}

fn vad_entry() -> Option<&'static SupportEntry> {
    CATALOG.support.iter().find(|entry| entry.role == "vad")
}

fn models_dir() -> Option<PathBuf> {
    file_access::paths::misty_shared_dir("models")
}

fn package_dir(package: &Package) -> Option<PathBuf> {
    let key: String = package.sha256.chars().take(16).collect();
    models_dir().map(|dir| dir.join(key))
}

fn files_dir(package: &Package) -> Option<PathBuf> {
    let dir = package_dir(package)?;
    Some(match package.folder.as_deref() {
        Some(folder) if package.kind == "tar.bz2" => dir.join(folder),
        _ => dir,
    })
}

fn installed(package: &Package) -> bool {
    package_dir(package).is_some_and(|dir| file_access::fs::is_file(dir.join(COMPLETE)))
}

fn pins() -> HashMap<String, String> {
    models_dir()
        .and_then(|dir| file_access::fs::read_to_string(dir.join("installed.json")).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

static PINS: Mutex<()> = Mutex::new(());

fn set_pin(id: &str, sha256: Option<&str>) {
    let _guard = PINS.lock();
    let Some(dir) = models_dir() else { return };
    let mut pins = pins();
    match sha256 {
        Some(sha256) => pins.insert(id.to_string(), sha256.to_string()),
        None => pins.remove(id),
    };
    if let Ok(text) = serde_json::to_string_pretty(&pins) {
        let _ = file_access::fs::create_dir_all(&dir);
        let _ = file_access::fs::write(dir.join("installed.json"), text);
    }
}

fn outdated(id: &str, package: &Package, pins: &HashMap<String, String>) -> bool {
    let Some(pinned) = pins.get(id) else {
        return false;
    };
    if pinned.eq_ignore_ascii_case(&package.sha256) {
        return false;
    }
    let old = Package {
        sha256: pinned.clone(),
        ..package.clone()
    };
    installed(&old)
}

pub fn vad_spec() -> Option<voice_speech::VadSpec> {
    let entry = vad_entry()?;
    if !installed(&entry.package) {
        return None;
    }
    let model = files_dir(&entry.package)?.join(entry.files.get("model")?);
    Some(voice_speech::VadSpec { model })
}

pub fn hearing_spec(id: &str) -> Option<voice_speech::HearingSpec> {
    let entry = hearing(id)?;
    if !installed(&entry.package) {
        return None;
    }
    let family = voice_speech::HearingFamily::parse(&entry.family)?;
    Some(voice_speech::HearingSpec {
        family,
        dir: files_dir(&entry.package)?,
        files: entry.files.clone(),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Machine {
    pub memory_mb: u64,
    pub cores: u32,
    pub apple_silicon: bool,
    pub disk_free_mb: Option<u64>,
}

fn machine() -> Machine {
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    let cores = std::thread::available_parallelism()
        .map(|count| count.get() as u32)
        .unwrap_or(2);
    let disk_free_mb = models_dir().and_then(|dir| {
        let disks = sysinfo::Disks::new_with_refreshed_list();
        disks
            .list()
            .iter()
            .filter(|disk| dir.starts_with(disk.mount_point()))
            .max_by_key(|disk| disk.mount_point().as_os_str().len())
            .map(|disk| disk.available_space() / 1_000_000)
    });
    Machine {
        memory_mb: system.total_memory() / 1_000_000,
        cores,
        apple_silicon: cfg!(all(target_os = "macos", target_arch = "aarch64")),
        disk_free_mb,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Listed<T: Serialize> {
    #[serde(flatten)]
    entry: T,
    installed: bool,
    outdated: bool,
    package_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechCatalog {
    hearing: Vec<Listed<HearingEntry>>,
    support_installed: bool,
    machine: Machine,
    installing: Vec<String>,
}

fn package_key(package: &Package) -> String {
    package.sha256.chars().take(16).collect()
}

#[tauri::command]
pub async fn speech_catalog(
    webview: Webview,
    state: State<'_, SpeechModelsState>,
) -> Result<SpeechCatalog, String> {
    require_person(&webview)?;
    let installing = state
        .installing
        .lock()
        .map(|running| running.keys().cloned().collect())
        .unwrap_or_default();
    let pins = pins();
    let machine = tokio::task::spawn_blocking(machine)
        .await
        .map_err(|_| "Misty couldn't read this computer's measure.".to_string())?;
    Ok(SpeechCatalog {
        hearing: CATALOG
            .hearing
            .iter()
            .map(|entry| Listed {
                installed: installed(&entry.package),
                outdated: outdated(&entry.id, &entry.package, &pins),
                package_key: package_key(&entry.package),
                entry: entry.clone(),
            })
            .collect(),
        support_installed: vad_entry().is_some_and(|entry| installed(&entry.package)),
        machine,
        installing,
    })
}

#[derive(Default)]
pub struct SpeechModelsState {
    installing: Mutex<HashMap<String, String>>,
}

fn entries_sharing(package: &Package) -> Vec<String> {
    let key = package_key(package);
    CATALOG
        .hearing
        .iter()
        .filter(|entry| package_key(&entry.package) == key)
        .map(|entry| entry.id.clone())
        .collect()
}

fn package_of(id: &str) -> Option<Package> {
    hearing(id).map(|entry| entry.package.clone())
}

#[tauri::command]
pub async fn speech_remove(
    webview: Webview,
    state: State<'_, super::speech::SpeechState>,
    id: String,
) -> Result<(), String> {
    require_person(&webview)?;
    let package = package_of(&id).ok_or_else(|| "Misty doesn't know that model.".to_string())?;
    for other in entries_sharing(&package) {
        super::speech::forget_model(&state, &other);
    }
    super::speech::forget_model(&state, &id);
    let pins = pins();
    let mut gone = vec![package.clone()];
    if let Some(pinned) = pins.get(&id) {
        gone.push(Package {
            sha256: pinned.clone(),
            ..package.clone()
        });
    }
    for (other, pin) in &pins {
        if pin.eq_ignore_ascii_case(&package.sha256) || other == &id {
            set_pin(other, None);
        }
    }
    for package in gone {
        if let Some(dir) = package_dir(&package) {
            if file_access::fs::exists(&dir) {
                file_access::fs::remove_dir_all(&dir)
                    .map_err(|_| "Misty couldn't remove the model.".to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn speech_measure(webview: Webview, id: String) -> Result<f64, String> {
    require_person(&webview)?;
    let spec = hearing_spec(&id).ok_or_else(|| voice_speech::reason("no_model"))?;
    tokio::task::spawn_blocking(move || {
        let sample = sample_recording(&spec.dir).ok_or_else(|| voice_speech::reason("model"))?;
        let samples = voice_speech::decode_file(&sample)?;
        let samples = &samples[..samples.len().min(8 * voice_speech::SAMPLE_RATE as usize)];
        if samples.is_empty() {
            return Err(voice_speech::reason("model"));
        }
        let recognizer = voice_speech::Recognizer::open(&spec, None)?;
        let started = Instant::now();
        let _ = recognizer.recognize(samples, 0.0);
        let seconds = samples.len() as f64 / voice_speech::SAMPLE_RATE as f64;
        Ok(started.elapsed().as_secs_f64() / seconds)
    })
    .await
    .map_err(|_| voice_speech::reason("failed"))?
}

fn sample_recording(dir: &Path) -> Option<PathBuf> {
    let folder = dir.join("test_wavs");
    let mut wavs: Vec<PathBuf> = file_access::fs::read_dir(&folder)
        .ok()?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|extension| extension == "wav"))
        .collect();
    wavs.sort();
    wavs.iter()
        .find(|path| {
            path.file_stem()
                .and_then(|stem| stem.to_str())
                .is_some_and(|stem| stem.starts_with("en") || stem == "0")
        })
        .cloned()
        .or_else(|| wavs.first().cloned())
}

mod install;
pub use install::*;

#[cfg(test)]
mod tests {
    use super::Package;

    fn package(mirror: Option<&str>) -> Package {
        Package {
            url:
                "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx"
                    .into(),
            sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6".into(),
            size: 643854,
            kind: "file".into(),
            folder: None,
            mirror: mirror.map(str::to_string),
        }
    }

    #[test]
    fn a_model_downloads_from_its_registry_blob_only_when_that_is_its_own() {
        let own = "https://registry.mistysys.com/blobs/9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6";
        assert_eq!(package(Some(own)).download_url(), own);
        assert_eq!(package(None).download_url(), package(None).url);
        assert_eq!(
            package(Some("https://example.com/silero_vad.onnx")).download_url(),
            package(None).url
        );
    }
}
