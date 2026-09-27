use super::*;
use crate::infra::environment::AppEnvironmentService;
use std::sync::atomic::AtomicBool;

#[tokio::test]
async fn soft_delete_uses_unique_trash_name() {
    let root = unique_test_dir("trash-local-path");
    let source = root.join("notes.txt");
    let trash_dir = root.join("trash");
    let original_trash_item = trash_dir.join("notes.txt");
    let unique_trash_item = trash_dir.join("notes 1.txt");
    tokio::fs::create_dir_all(&root).await.unwrap();
    tokio::fs::write(&source, b"first").await.unwrap();

    let destination = trash_local_path_cancellable(&source, &trash_dir, None)
        .await
        .unwrap();
    assert_eq!(destination, original_trash_item);
    assert!(!source.exists());
    assert_eq!(tokio::fs::read(&destination).await.unwrap(), b"first");

    tokio::fs::write(&source, b"second").await.unwrap();
    let destination = trash_local_path_cancellable(&source, &trash_dir, None)
        .await
        .unwrap();
    assert_eq!(destination, unique_trash_item);
    assert!(!source.exists());
    assert_eq!(tokio::fs::read(&destination).await.unwrap(), b"second");
    assert_eq!(
        tokio::fs::read(&original_trash_item).await.unwrap(),
        b"first"
    );

    let _ = tokio::fs::remove_dir_all(&root).await;
}

#[test]
fn trash_virtual_entries_are_marked_deleted() {
    let root = unique_test_dir("trash-virtual");
    let trashed = root.join("deleted.txt");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(&trashed, b"deleted").unwrap();

    let entries = trash_virtual_entries(&root).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].name, "deleted.txt");
    assert!(entries[0].is_deleted);
    assert!(matches!(entries[0].kind, FileKind::File));

    let _ = std::fs::remove_dir_all(&root);
}

#[cfg(unix)]
#[tokio::test]
async fn local_directory_inspection_follows_symlink_targets() {
    use std::os::unix::fs::symlink;

    let root = unique_test_dir("symlink-directory-inspection");
    let directory = root.join("folder");
    let file = root.join("file.txt");
    let directory_link = root.join("folder-link");
    let file_link = root.join("file-link");
    tokio::fs::create_dir_all(&directory).await.unwrap();
    tokio::fs::write(&file, b"file").await.unwrap();
    symlink(&directory, &directory_link).unwrap();
    symlink(&file, &file_link).unwrap();

    let service = test_explorer_service();
    assert_eq!(
        service
            .item_is_directory(&display_path(&directory_link))
            .await
            .unwrap(),
        Some(true)
    );
    assert_eq!(
        service
            .item_is_directory(&display_path(&file_link))
            .await
            .unwrap(),
        Some(false)
    );

    let _ = tokio::fs::remove_dir_all(&root).await;
}

#[cfg(not(target_os = "macos"))]
#[tokio::test]
async fn local_preview_payload_is_typed_and_rejects_unsupported_files() {
    let root = unique_test_dir("preview-payload");
    let image = root.join("image.png");
    let svg = root.join("vector.svg");
    let pnm = root.join("pixel.ppm");
    let psd = root.join("pixel.psd");
    let text = root.join("notes.txt");
    let unsupported = root.join("payload.bin");
    tokio::fs::create_dir_all(&root).await.unwrap();
    let mut png = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        1,
        1,
        image::Rgba([255, 0, 0, 255]),
    ))
    .write_to(&mut png, image::ImageFormat::Png)
    .unwrap();
    tokio::fs::write(&image, png.into_inner()).await.unwrap();
    tokio::fs::write(&svg, br#"<svg xmlns="http://www.w3.org/2000/svg"/>"#)
        .await
        .unwrap();
    tokio::fs::write(&pnm, b"P3\n1 1\n255\n255 0 0\n")
        .await
        .unwrap();
    tokio::fs::write(&psd, minimal_rgb_psd()).await.unwrap();
    tokio::fs::write(&text, b"notes").await.unwrap();
    tokio::fs::write(&unsupported, b"binary").await.unwrap();

    let service = test_explorer_service();
    let preview = service.preview_item(&display_path(&image)).await.unwrap();
    assert_eq!(preview.mime_type, "image/png");
    assert!(preview.bytes.starts_with(&[0x89, b'P', b'N', b'G']));
    let svg_preview = service.preview_item(&display_path(&svg)).await.unwrap();
    assert_eq!(svg_preview.mime_type, "image/svg+xml");
    assert_eq!(
        svg_preview.bytes,
        br#"<svg xmlns="http://www.w3.org/2000/svg"/>"#
    );
    let transcoded = service.preview_item(&display_path(&pnm)).await.unwrap();
    assert_eq!(transcoded.mime_type, "image/png");
    assert!(transcoded.bytes.starts_with(&[0x89, b'P', b'N', b'G']));
    let psd_preview = service.preview_item(&display_path(&psd)).await.unwrap();
    assert_eq!(psd_preview.mime_type, "image/png");
    assert!(psd_preview.bytes.starts_with(&[0x89, b'P', b'N', b'G']));
    let text_preview = service.preview_item(&display_path(&text)).await.unwrap();
    assert_eq!(text_preview.mime_type, "text/plain; charset=utf-8");
    assert_eq!(text_preview.bytes, b"notes");
    assert!(service
        .preview_item(&display_path(&unsupported))
        .await
        .is_err());

    let _ = tokio::fs::remove_dir_all(&root).await;
}

#[cfg(not(target_os = "macos"))]
#[tokio::test]
async fn generated_image_thumbnail_is_cached_and_dimensioned() {
    let root = unique_test_dir("image-thumbnail-cache");
    let image = root.join("wide.png");
    tokio::fs::create_dir_all(&root).await.unwrap();
    let mut png = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        1000,
        500,
        image::Rgba([0, 128, 255, 255]),
    ))
    .write_to(&mut png, image::ImageFormat::Png)
    .unwrap();
    tokio::fs::write(&image, png.into_inner()).await.unwrap();

    let service = test_explorer_service();
    let first = service
        .generate_image_thumbnail(&display_path(&image), 384, None, None, None)
        .await
        .unwrap();
    let second = service
        .generate_image_thumbnail(&display_path(&image), 384, None, None, None)
        .await
        .unwrap();
    assert_eq!(first.mime_type, "image/png");
    assert_eq!(first.path, second.path);
    assert!(Path::new(&first.path).starts_with(&service.image_thumbnail_cache_dir));
    assert_eq!(
        service.image_thumbnail_cache_dir,
        service
            .home_dir
            .join(".misty")
            .join(".cache")
            .join("thumbnails")
    );
    let thumbnail = image::open(&first.path).unwrap();
    assert!(thumbnail.width() <= 384);
    assert!(thumbnail.height() <= 384);

    let _ = tokio::fs::remove_dir_all(&root).await;
}

#[cfg(not(target_os = "macos"))]
#[tokio::test]
async fn generated_image_thumbnail_writes_small_images_to_cache() {
    let root = unique_test_dir("image-thumbnail-original");
    let image = root.join("small.png");
    tokio::fs::create_dir_all(&root).await.unwrap();
    let mut png = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        16,
        16,
        image::Rgba([0, 128, 255, 255]),
    ))
    .write_to(&mut png, image::ImageFormat::Png)
    .unwrap();
    tokio::fs::write(&image, png.into_inner()).await.unwrap();

    let service = test_explorer_service();
    let thumbnail = service
        .generate_image_thumbnail(&display_path(&image), 384, None, None, None)
        .await
        .unwrap();

    assert_eq!(thumbnail.mime_type, "image/png");
    assert_ne!(thumbnail.path, display_path(&image));
    assert!(Path::new(&thumbnail.path).starts_with(&service.image_thumbnail_cache_dir));

    let _ = tokio::fs::remove_dir_all(&root).await;
}

#[tokio::test]
async fn lists_local_files_and_rejects_retired_cloud_locations() {
    let root = unique_test_dir("local-only-listing");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("notes.txt"), b"local").unwrap();
    let service = test_explorer_service_for_home(root.clone());
    let request = |path: String| ListDirectoryRequest {
        path: Some(path),
        show_hidden: Some(false),
        force_remote_refresh: None,
    };
    let listing = service
        .list_directory(request(display_path(&root)))
        .await
        .unwrap();
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "notes.txt"));
    for path in [
        "misty://drive/notes.txt".to_owned(),
        display_path(&service.mount_root.join("drive")),
    ] {
        assert!(service.list_directory(request(path)).await.is_err());
    }
    std::fs::remove_dir_all(root).unwrap();
}
