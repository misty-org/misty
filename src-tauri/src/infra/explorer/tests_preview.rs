use super::*;

#[tokio::test]
async fn preview_editor_saves_image_edits_and_numbered_copies() {
    let root = unique_test_dir("preview-editor-save");
    tokio::fs::create_dir_all(&root).await.unwrap();
    let source = root.join("photo.png");
    let red = encoded_test_png([255, 0, 0, 255]);
    let blue = encoded_test_png([0, 80, 255, 255]);
    let green = encoded_test_png([0, 200, 90, 255]);
    tokio::fs::write(&source, red).await.unwrap();
    let service = test_explorer_service();

    let saved = service
        .save_preview_item(SavePreviewRequest {
            path: display_path(&source),
            bytes: blue,
            save_as_copy: false,
        })
        .await
        .unwrap();
    assert_eq!(saved.affected_paths, vec![display_path(&source)]);
    assert_eq!(decoded_test_pixel(&source), [0, 80, 255, 255]);

    let first_copy = service
        .save_preview_item(SavePreviewRequest {
            path: display_path(&source),
            bytes: green.clone(),
            save_as_copy: true,
        })
        .await
        .unwrap();
    let second_copy = service
        .save_preview_item(SavePreviewRequest {
            path: display_path(&source),
            bytes: green,
            save_as_copy: true,
        })
        .await
        .unwrap();
    assert_eq!(
        first_copy.affected_paths,
        vec![display_path(&root.join("photo copy.png"))]
    );
    assert_eq!(
        second_copy.affected_paths,
        vec![display_path(&root.join("photo copy 2.png"))]
    );
    assert_eq!(
        decoded_test_pixel(&root.join("photo copy.png")),
        [0, 200, 90, 255]
    );
    assert_eq!(decoded_test_pixel(&source), [0, 80, 255, 255]);

    let _ = tokio::fs::remove_dir_all(&root).await;
}

fn encoded_test_png(pixel: [u8; 4]) -> Vec<u8> {
    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(2, 2, image::Rgba(pixel)))
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}

fn decoded_test_pixel(path: &Path) -> [u8; 4] {
    image::open(path).unwrap().to_rgba8().get_pixel(0, 0).0
}
use crate::infra::environment::AppEnvironmentService;
use std::sync::atomic::AtomicBool;

#[test]
fn preview_format_matches_imgui_radiance_pic_support() {
    assert!(matches!(
        preview_format(Path::new("studio-lighting.pic")),
        Some(PreviewFormat::TranscodeImage(image::ImageFormat::Hdr))
    ));
    assert!(matches!(
        preview_format(Path::new("photo.jpg")),
        Some(PreviewFormat::Image(image::ImageFormat::Jpeg))
    ));
    assert!(matches!(
        preview_format(Path::new("thumbnail.psd")),
        Some(PreviewFormat::Psd)
    ));
    assert!(matches!(
        preview_format(Path::new("report.docx")),
        Some(PreviewFormat::Direct(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ))
    ));
}

#[tokio::test]
async fn pdf_preview_path_tracks_file_identity() {
    let root = unique_test_dir("pdf-preview-path");
    let first = root.join("first.pdf");
    let second = root.join("second.pdf");
    tokio::fs::create_dir_all(&root).await.unwrap();
    tokio::fs::write(&first, b"%PDF-first").await.unwrap();
    tokio::fs::write(&second, b"%PDF-second").await.unwrap();

    let first_metadata = tokio::fs::metadata(&first).await.unwrap();
    let second_metadata = tokio::fs::metadata(&second).await.unwrap();
    let first_path = pdf_preview_path(&first, &first_metadata);
    let repeated_first_path = pdf_preview_path(&first, &first_metadata);
    let second_path = pdf_preview_path(&second, &second_metadata);

    assert_eq!(first_path, repeated_first_path);
    assert_ne!(first_path, second_path);
    assert_eq!(
        first_path.extension().and_then(|value| value.to_str()),
        Some("png")
    );

    let _ = tokio::fs::remove_dir_all(&root).await;
}

#[test]
fn drag_stage_file_names_are_sanitized() {
    assert_eq!(sanitize_drag_file_name("report.pdf"), "report.pdf");
    assert_eq!(sanitize_drag_file_name("../bad:name"), "_bad_name");
    assert_eq!(sanitize_drag_file_name("..."), "item");
    assert_eq!(sanitize_drag_file_name("  "), "item");
    assert_eq!(
        sanitize_drag_file_name("bad\u{0007}name.txt"),
        "bad_name.txt"
    );
}

#[test]
fn drag_stage_expiration_uses_remote_file_cache_ttl() {
    let ttl_ms = ClipboardCache::DEFAULT_TTL_HOURS * 60 * 60 * 1000;
    let now_ms = ttl_ms * 2;

    assert!(!drag_stage_entry_expired(now_ms - ttl_ms, now_ms, ttl_ms));
    assert!(drag_stage_entry_expired(
        now_ms - ttl_ms - 1,
        now_ms,
        ttl_ms
    ));
    assert!(drag_stage_entry_expired(0, now_ms, ttl_ms));
}

#[tokio::test]
async fn cancellable_file_copy_stops_when_token_is_set() {
    let root = unique_test_dir("cancel-copy");
    let source = root.join("source.bin");
    let destination = root.join("destination.bin");
    tokio::fs::create_dir_all(&root).await.unwrap();
    tokio::fs::write(&source, vec![7u8; 1024]).await.unwrap();

    let cancellation = AtomicBool::new(true);
    let result = copy_local_file_cancellable(&source, &destination, &cancellation).await;
    assert!(result.as_ref().is_err_and(is_cancellation_error));
    assert!(!destination.exists());

    let _ = tokio::fs::remove_dir_all(&root).await;
}

#[tokio::test]
async fn canceled_create_item_stops_before_touching_filesystem() {
    let root = unique_test_dir("cancel-create-item");
    tokio::fs::create_dir_all(&root).await.unwrap();
    let service = test_explorer_service();
    let cancellation = Arc::new(AtomicBool::new(true));

    let result = service
        .create_item_with_cancellation(
            CreateItemRequest {
                directory: display_path(&root),
                name: "never-created.txt".to_string(),
                kind: crate::domain::explorer::CreateItemKind::File,
            },
            cancellation,
        )
        .await;

    assert!(result.as_ref().is_err_and(is_cancellation_error));
    assert!(!root.join("never-created.txt").exists());

    let _ = tokio::fs::remove_dir_all(&root).await;
}

#[tokio::test]
async fn canceled_rename_item_stops_before_touching_filesystem() {
    let root = unique_test_dir("cancel-rename-item");
    let source = root.join("original.txt");
    let destination = root.join("renamed.txt");
    tokio::fs::create_dir_all(&root).await.unwrap();
    tokio::fs::write(&source, b"keep name").await.unwrap();
    let service = test_explorer_service();
    let cancellation = Arc::new(AtomicBool::new(true));

    let result = service
        .rename_item_with_cancellation(
            RenameItemRequest {
                path: display_path(&source),
                new_name: "renamed.txt".to_string(),
                source_is_directory: Some(false),
            },
            cancellation,
        )
        .await;

    assert!(result.as_ref().is_err_and(is_cancellation_error));
    assert!(source.exists());
    assert!(!destination.exists());

    let _ = tokio::fs::remove_dir_all(&root).await;
}

#[tokio::test]
async fn late_canceled_create_cleans_created_item() {
    let root = unique_test_dir("late-cancel-create-item");
    let name = format!("created-then-canceled-{}.txt", unique_test_name(&root));
    let target = root.join(&name);
    tokio::fs::create_dir_all(&root).await.unwrap();
    let service = test_explorer_service();
    let cancellation = Arc::new(AtomicBool::new(false));
    let completed = Arc::new(tokio::sync::Barrier::new(2));
    let operation = service.create_item_with_cancellation(
        CreateItemRequest {
            directory: display_path(&root),
            name: name.clone(),
            kind: crate::domain::explorer::CreateItemKind::File,
        },
        cancellation.clone(),
    );
    let trigger_cancel = async {
        wait_until_path_exists(&target).await;
        cancellation.store(true, Ordering::SeqCst);
        completed.wait().await;
    };

    let (result, _) = tokio::join!(
        MUTATION_COMPLETED.scope(completed.clone(), operation),
        trigger_cancel
    );

    assert!(result.as_ref().is_err_and(is_cancellation_error));
    assert!(!target.exists());

    let _ = tokio::fs::remove_dir_all(&root).await;
}

#[tokio::test]
async fn late_canceled_rename_reverts_item() {
    let root = unique_test_dir("late-cancel-rename-item");
    let source = root.join("original.txt");
    let name = format!("renamed-{}.txt", unique_test_name(&root));
    let destination = root.join(&name);
    tokio::fs::create_dir_all(&root).await.unwrap();
    tokio::fs::write(&source, b"keep original").await.unwrap();
    let service = test_explorer_service();
    let cancellation = Arc::new(AtomicBool::new(false));
    let completed = Arc::new(tokio::sync::Barrier::new(2));
    let operation = service.rename_item_with_cancellation(
        RenameItemRequest {
            path: display_path(&source),
            new_name: name.clone(),
            source_is_directory: Some(false),
        },
        cancellation.clone(),
    );
    let trigger_cancel = async {
        wait_until_path_exists(&destination).await;
        cancellation.store(true, Ordering::SeqCst);
        completed.wait().await;
    };

    let (result, _) = tokio::join!(
        MUTATION_COMPLETED.scope(completed.clone(), operation),
        trigger_cancel
    );

    assert!(result.as_ref().is_err_and(is_cancellation_error));
    assert!(source.exists());
    assert!(!destination.exists());

    let _ = tokio::fs::remove_dir_all(&root).await;
}

#[tokio::test]
async fn cancellable_delete_stops_when_token_is_set() {
    let root = unique_test_dir("cancel-delete");
    let source = root.join("source.txt");
    tokio::fs::create_dir_all(&root).await.unwrap();
    tokio::fs::write(&source, b"keep me").await.unwrap();

    let cancellation = AtomicBool::new(true);
    let result = delete_local_path_cancellable(&source, Some(&cancellation)).await;
    assert!(result.as_ref().is_err_and(is_cancellation_error));
    assert!(source.exists());

    let _ = tokio::fs::remove_dir_all(&root).await;
}

#[tokio::test]
async fn cancellable_delete_removes_nested_directory() {
    let root = unique_test_dir("delete-nested");
    let source = root.join("source");
    let nested = source.join("nested");
    tokio::fs::create_dir_all(&nested).await.unwrap();
    tokio::fs::write(nested.join("file.txt"), b"gone")
        .await
        .unwrap();

    let result = delete_local_path_cancellable(&source, None).await;
    assert!(result.is_ok());
    assert!(!source.exists());

    let _ = tokio::fs::remove_dir_all(&root).await;
}
