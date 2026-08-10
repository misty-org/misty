use super::*;
use crate::services::environment::AppEnvironmentService;
use std::sync::atomic::AtomicBool;

#[test]
fn upload_filter_ignores_provider_disallowed_metadata() {
    assert!(ignored_upload_name(".DS_Store"));
    assert!(ignored_upload_name("._photo.jpg"));
    assert!(ignored_upload_name("Thumbs.db"));
    assert!(ignored_upload_name("desktop.ini"));
    assert!(ignored_upload_name("notes.tmp"));
    assert!(!ignored_upload_name("photo.jpg"));
}

#[test]
fn remote_job_progress_adds_partial_provider_bytes_to_transfer_base() {
    let status = test_remote_job_status(25, 25);
    let progress = TransferProgress {
        base_bytes: 100,
        total_bytes: 300,
    };

    assert_eq!(remote_job_transferred_bytes(&status, Some(progress)), 125);
    assert_eq!(remote_job_total_bytes(&status, Some(progress)), 300);
}

#[test]
fn remote_job_progress_keeps_raw_bytes_without_aggregate_context() {
    let status = test_remote_job_status(25, 80);

    assert_eq!(remote_job_transferred_bytes(&status, None), 25);
    assert_eq!(remote_job_total_bytes(&status, None), 80);
}

#[tokio::test]
async fn directory_size_excludes_ignored_upload_metadata() {
    let root = unique_test_dir("upload-size");
    let folder = root.join("folder");
    let nested = folder.join("nested");
    tokio::fs::create_dir_all(&nested).await.unwrap();
    tokio::fs::write(folder.join("a.bin"), vec![1_u8; 10])
        .await
        .unwrap();
    tokio::fs::write(nested.join("b.bin"), vec![2_u8; 15])
        .await
        .unwrap();
    tokio::fs::write(folder.join(".DS_Store"), vec![3_u8; 99])
        .await
        .unwrap();
    tokio::fs::write(nested.join("._b.bin"), vec![4_u8; 99])
        .await
        .unwrap();

    assert_eq!(local_item_size(&folder, true).await, 25);

    let _ = tokio::fs::remove_dir_all(&root).await;
}

#[tokio::test]
async fn remote_to_remote_paste_skips_provider_disallowed_metadata() {
    let home = unique_test_dir("remote-metadata-skip-home");
    let service = test_explorer_service_for_home(home.clone());
    let source = service.mount_root.join("source-remote").join(".DS_Store");
    let destination = service.mount_root.join("dest-remote");
    let before = service
        .transfers
        .snapshot(crate::services::transfers::TransferFilter::default())
        .await
        .unwrap()
        .rows
        .len();

    let result = service
        .paste_items(PasteItemsRequest {
            sources: vec![PasteItem {
                path: display_path(&source),
                is_directory: false,
                size_bytes: None,
                remote_modified: None,
            }],
            destination_directory: display_path(&destination),
            operation: crate::core::explorer::ClipboardOperation::Copy,
            target_name: None,
        })
        .await
        .unwrap();

    assert!(result.affected_paths.is_empty());
    let transfers = service
        .transfers
        .snapshot(crate::services::transfers::TransferFilter::default())
        .await
        .unwrap();
    assert_eq!(transfers.rows.len(), before);

    let _ = tokio::fs::remove_dir_all(&home).await;
}

#[tokio::test]
async fn remote_job_cancel_requests_proxy_stop() {
    let cancellations = Arc::new(Mutex::new(Vec::new()));
    let service = test_explorer_service().with_remote_job_cancellation_log(cancellations.clone());
    let cancellation = AtomicBool::new(true);

    let result = service
        .wait_for_job("job-1", None, None, Some(&cancellation))
        .await;

    assert!(result.as_ref().is_err_and(is_cancellation_error));
    let cancellations = cancellations.lock().await.clone();
    assert!(
        cancellations
            .iter()
            .any(|request| request == "DELETE /api/remote/file/jobs/job-1"),
        "expected cancellation to delete the remote job, saw {cancellations:?}",
    );
}

#[tokio::test]
async fn cancellation_cleanup_removes_partial_destination() {
    let root = unique_test_dir("cancel-cleanup");
    let destination = root.join("destination.bin");
    tokio::fs::create_dir_all(&root).await.unwrap();
    tokio::fs::write(&destination, b"partial").await.unwrap();

    let result: ApiResult<()> = Err(ApiError::Message("Operation canceled.".to_string()));
    let result = cleanup_partial_destination_on_cancel(&destination, false, result).await;
    assert!(result.as_ref().is_err_and(is_cancellation_error));
    assert!(!destination.exists());

    let _ = tokio::fs::remove_dir_all(&root).await;
}

#[tokio::test]
async fn drag_preparation_session_can_be_canceled() {
    let service = test_explorer_service();
    service.cancel_drag_preparation("session").await;
    let cancellation = service
        .drag_preparation_cancellations
        .lock()
        .await
        .get("session")
        .cloned()
        .expect("cancel flag should survive an early cancel request");
    assert!(cancellation.load(Ordering::Relaxed));
}

#[tokio::test]
async fn prepared_remote_file_reuses_mounted_file_as_cache() {
    let home = unique_test_dir("remote-files-cache-home");
    let service = test_explorer_service_for_home(home.clone());
    let source = RemoteBrowseTarget {
        provider_type: "drive".into(),
        remote_name: "work".into(),
        remote_path: "/Photos/IMG_7313.PNG".into(),
    };
    let mounted_file = source.virtual_path(&service.mount_root);
    tokio::fs::create_dir_all(mounted_file.parent().unwrap())
        .await
        .unwrap();
    tokio::fs::write(&mounted_file, b"cached image")
        .await
        .unwrap();

    let prepared = service
        .prepare_remote_file_for_local_use(
            &source,
            Some(b"cached image".len() as i64),
            Some("2026-06-26T21:58:36Z"),
            "Preparing remote file to open",
            false,
            None,
        )
        .await
        .unwrap();

    let prepared_path = PathBuf::from(&prepared.local_path);
    assert!(prepared.cached);
    assert!(prepared.cache_hit);
    assert_ne!(prepared_path, mounted_file);
    assert!(prepared_path.starts_with(home.join(".misty/.cache/remote-files/v1")));
    assert!(!prepared_path.starts_with(home.join(".misty/.cache/remote-files/v1/remote-files")));
    assert_eq!(
        prepared.source_path.as_deref(),
        Some(mounted_file.to_string_lossy().as_ref())
    );
    assert_eq!(
        prepared.cache_path.as_deref(),
        Some(prepared.local_path.as_str())
    );
    assert_eq!(
        tokio::fs::read(prepared_path).await.unwrap(),
        b"cached image"
    );

    let _ = tokio::fs::remove_dir_all(home).await;
}

#[tokio::test]
async fn remote_to_local_download_reuses_cached_remote_file() {
    let home = unique_test_dir("remote-paste-cache-home");
    let service = test_explorer_service_for_home(home.clone());
    let source = RemoteBrowseTarget {
        provider_type: "drive".into(),
        remote_name: "work".into(),
        remote_path: "/Photos/IMG_7313.PNG".into(),
    };
    let file_name = "IMG_7313.PNG";
    let payload = b"cached download payload";
    let cache_key = ClipboardRemoteFileCacheKey {
        remote_name: source.remote_name.clone(),
        remote_path: source.remote_path.clone(),
        size: payload.len() as i64,
        last_modified: "2026-06-26T21:58:36Z".into(),
        is_dir: false,
    };
    let temp_path = {
        let cache = service.remote_file_cache.lock().await;
        cache.temp_path_for(&ClipboardCache::remote_file_key(&cache_key), file_name)
    };
    tokio::fs::write(&temp_path, payload).await.unwrap();
    service
        .remote_file_cache
        .lock()
        .await
        .store_remote_file(&cache_key, &temp_path, file_name)
        .unwrap();
    let destination = home.join("Downloads");
    tokio::fs::create_dir_all(&destination).await.unwrap();

    let result = service
        .paste_items(PasteItemsRequest {
            sources: vec![PasteItem {
                path: display_path(&source.virtual_path(&service.mount_root)),
                is_directory: false,
                size_bytes: Some(payload.len() as i64),
                remote_modified: Some("2026-06-26T21:58:36Z".into()),
            }],
            destination_directory: display_path(&destination),
            operation: crate::core::explorer::ClipboardOperation::Copy,
            target_name: None,
        })
        .await
        .unwrap();

    let downloaded = destination.join(file_name);
    assert_eq!(result.affected_paths, vec![display_path(&downloaded)]);
    assert_eq!(tokio::fs::read(downloaded).await.unwrap(), payload);

    let _ = tokio::fs::remove_dir_all(home).await;
}
