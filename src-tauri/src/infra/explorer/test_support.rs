use super::*;
use crate::infra::environment::AppEnvironmentService;
use std::sync::atomic::AtomicBool;

pub(super) fn remote_list_item_default() -> RemoteListItem {
    RemoteListItem {
        name: String::new(),
        path: String::new(),
        is_dir: false,
        size: 0,
        mod_time: String::new(),
        mime_type: String::new(),
    }
}

pub(super) fn minimal_rgb_psd() -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"8BPS");
    bytes.extend_from_slice(&1u16.to_be_bytes());
    bytes.extend_from_slice(&[0; 6]);
    bytes.extend_from_slice(&3u16.to_be_bytes());
    bytes.extend_from_slice(&1u32.to_be_bytes());
    bytes.extend_from_slice(&1u32.to_be_bytes());
    bytes.extend_from_slice(&8u16.to_be_bytes());
    bytes.extend_from_slice(&3u16.to_be_bytes());
    bytes.extend_from_slice(&0u32.to_be_bytes());
    bytes.extend_from_slice(&0u32.to_be_bytes());
    bytes.extend_from_slice(&0u32.to_be_bytes());
    bytes.extend_from_slice(&0u16.to_be_bytes());
    bytes.extend_from_slice(&[255, 0, 0]);
    bytes
}

pub(super) fn test_remote_job_status(bytes_completed: i64, bytes_total: i64) -> RemoteJobStatus {
    RemoteJobStatus {
        job_id: String::new(),
        operation: String::new(),
        state: String::new(),
        phase: String::new(),
        bytes_completed,
        bytes_total,
        bytes_per_second: 0.0,
        source_remote: String::new(),
        source_path: String::new(),
        dest_remote: String::new(),
        dest_path: String::new(),
        message: String::new(),
        result_ready: false,
        result_kind: String::new(),
    }
}

pub(super) fn test_explorer_service() -> ExplorerService {
    test_explorer_service_for_home(unique_test_dir("explorer-service-home"))
}

pub(super) fn test_explorer_service_for_home(home_dir: PathBuf) -> ExplorerService {
    let environment = AppEnvironmentService::for_test_home(home_dir);
    if let Some(db_dir) = environment.misty_db_path().parent() {
        let _ = std::fs::create_dir_all(db_dir);
    }
    let proxy = StorageService::new(environment.clone());
    let providers = ProviderService::new(proxy.clone());
    let transfers = TransferService::new(environment.clone());
    let explorer_library = ExplorerLibraryService::new(environment.clone());
    ExplorerService::new(environment, proxy, providers, transfers, explorer_library)
}

pub(super) async fn wait_until_path_exists(path: &Path) {
    for _ in 0..100 {
        if path.exists() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("{} did not appear before timeout", path.display());
}

pub(super) fn unique_test_dir(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "misty-{name}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

pub(super) fn unique_test_name(path: &Path) -> String {
    path.file_name()
        .and_then(OsStr::to_str)
        .unwrap_or("item")
        .replace(['/', '\\', ':'], "-")
}
