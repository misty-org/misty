use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::json;

use super::{keys::xxh64, *};

fn root(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "misty-clipboard-{label}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ))
}

fn remote_key(path: &str) -> ClipboardRemoteFileCacheKey {
    ClipboardRemoteFileCacheKey {
        remote_name: "dropbox-mattdev727".into(),
        remote_path: path.into(),
        size: 42,
        last_modified: "2026-06-13T01:02:03Z".into(),
        is_dir: false,
    }
}

#[test]
fn xxhash64_matches_reference_vector() {
    assert_eq!(xxh64(b"", 0), 0xef46db3751d8e999);
}

#[test]
fn remote_file_miss_store_and_hit() {
    let root = root("remote");
    let mut cache = ClipboardCache::new(root.clone());
    let key = remote_key("Projects/List.h");
    let temp = cache.temp_path_for(&ClipboardCache::remote_file_key(&key), "List.h");
    fs::write(&temp, b"payload").expect("write partial cache file");
    let stored = cache
        .store_remote_file(&key, &temp, "List.h")
        .expect("store remote cache file");
    assert_eq!(cache.lookup_remote_file(&key), Some(stored));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn downloaded_remote_file_is_copied_into_cache() {
    let root = root("remote-copy");
    let mut cache = ClipboardCache::new(root.clone());
    let key = remote_key("Projects/List.h");
    let downloaded = root.join("Downloads").join("List.h");
    fs::create_dir_all(downloaded.parent().unwrap()).expect("create downloads dir");
    fs::write(&downloaded, b"downloaded payload").expect("write downloaded file");

    let stored = cache
        .copy_remote_file_into_cache(&key, &downloaded, "List.h")
        .expect("copy downloaded file into cache");

    assert!(downloaded.exists());
    assert_eq!(
        fs::read(&stored).expect("read cached file"),
        b"downloaded payload",
    );
    assert_eq!(cache.lookup_remote_file(&key), Some(stored));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn remote_file_cache_imports_legacy_remote_open_entries() {
    let root = root("remote-import");
    let legacy_root = root.join("remote-open").join("v1");
    let current_root = root.join("remote-files").join("v1");
    let key = remote_key("Projects/List.h");
    let cache_key = ClipboardCache::remote_file_key(&key);
    let legacy_file = legacy_root
        .join("remote-files")
        .join(&cache_key)
        .join("List.h");
    fs::create_dir_all(legacy_file.parent().unwrap()).expect("create legacy cache dir");
    fs::write(&legacy_file, b"legacy payload").expect("write legacy file");
    fs::create_dir_all(&legacy_root).expect("create legacy root");
    fs::write(
        legacy_root.join("index.json"),
        serde_json::to_vec_pretty(&json!({
            "version": 1,
            "entries": {
                cache_key: {
                    "type": "remote_file",
                    "path": legacy_file.display().to_string(),
                    "created_unix_ms": 1,
                    "last_access_unix_ms": 1,
                    "ttl_hours": ClipboardCache::DEFAULT_TTL_HOURS,
                    "remote_name": key.remote_name,
                    "remote_path": key.remote_path,
                    "remote_size": key.size,
                    "remote_last_modified": key.last_modified,
                    "is_dir": key.is_dir,
                }
            }
        }))
        .unwrap(),
    )
    .expect("write legacy index");

    let mut cache = ClipboardCache::new(current_root.clone());
    cache.import_remote_file_entries_from(&legacy_root);

    assert_eq!(
        cache.lookup_remote_file(&remote_key("Projects/List.h")),
        Some(legacy_file)
    );
    assert!(current_root.join("index.json").exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn remote_file_cache_imports_metadata_light_legacy_entries() {
    let root = root("remote-import-light");
    let legacy_root = root.join("remote-open").join("v1");
    let current_root = root.join("remote-files").join("v1");
    let legacy_file = legacy_root
        .join("remote-files")
        .join("legacy-key")
        .join("List.h");
    fs::create_dir_all(legacy_file.parent().unwrap()).expect("create legacy cache dir");
    fs::write(&legacy_file, vec![0; 42]).expect("write legacy file");
    fs::create_dir_all(&legacy_root).expect("create legacy root");
    fs::write(
        legacy_root.join("index.json"),
        serde_json::to_vec_pretty(&json!({
            "version": 1,
            "entries": {
                "legacy-key": {
                    "type": "remote_file",
                    "path": legacy_file.display().to_string(),
                    "created_unix_ms": 1,
                    "last_access_unix_ms": 1,
                    "ttl_hours": ClipboardCache::DEFAULT_TTL_HOURS,
                }
            }
        }))
        .unwrap(),
    )
    .expect("write legacy index");

    let mut cache = ClipboardCache::new(current_root);
    cache.import_remote_file_entries_from(&legacy_root);

    assert_eq!(
        cache.lookup_remote_file(&remote_key("Projects/List.h")),
        Some(legacy_file)
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn remote_file_can_be_stored_at_mounted_route() {
    let cache_root = root("remote-mounted-route-cache");
    let mount_root = root("remote-mounted-route-mnt");
    let mut cache = ClipboardCache::new(cache_root.clone());
    let key = remote_key("Projects/List.h");
    let temp = cache.temp_path_for(&ClipboardCache::remote_file_key(&key), "List.h");
    let mounted_file = mount_root
        .join("mattdev727")
        .join("Projects")
        .join("List.h");
    fs::write(&temp, b"mounted route payload").expect("write staging file");

    let stored = cache
        .store_remote_file_at_path(&key, &temp, &mounted_file)
        .expect("store remote file at mounted path");

    assert_eq!(stored, mounted_file);
    assert!(!temp.exists());
    assert_eq!(
        fs::read(&stored).expect("read mounted cached file"),
        b"mounted route payload",
    );
    assert_eq!(cache.lookup_remote_file(&key), Some(stored.clone()));
    let _ = fs::remove_dir_all(cache_root);
    let _ = fs::remove_dir_all(mount_root);
}

#[test]
fn mounted_route_cache_entry_persists_while_visible_file_exists() {
    let cache_root = root("remote-mounted-expiry-cache");
    let mount_root = root("remote-mounted-expiry-mnt");
    let mut cache = ClipboardCache::new(cache_root.clone());
    let key = remote_key("Projects/List.h");
    let mounted_file = mount_root
        .join("mattdev727")
        .join("Projects")
        .join("List.h");
    fs::create_dir_all(mounted_file.parent().unwrap()).expect("create mounted parent");
    fs::write(&mounted_file, b"visible payload").expect("write mounted file");
    cache.set_now_for_tests(1000 * 60 * 60 * 1000);
    cache
        .copy_remote_file_to_path(&key, &mounted_file, &mounted_file)
        .expect("record mounted cache entry");

    cache.set_now_for_tests(1000 * 60 * 60 * 1000 + 73 * 60 * 60 * 1000);
    cache.cleanup_expired();

    assert!(mounted_file.exists());
    assert_eq!(cache.lookup_remote_file(&key), Some(mounted_file.clone()));
    let _ = fs::remove_dir_all(cache_root);
    let _ = fs::remove_dir_all(mount_root);
}

#[test]
fn remote_file_lookup_reuses_legacy_cache_entry_for_same_file() {
    let root = root("remote-legacy");
    let mut cache = ClipboardCache::new(root.clone());
    let stored = root
        .join("remote-files")
        .join("legacy-key")
        .join("Melissa Chen_Ryman Arts.jpg");
    fs::create_dir_all(stored.parent().unwrap()).expect("create legacy cache directory");
    fs::write(&stored, b"legacy image payload").expect("write legacy cache file");
    cache.record_entry("legacy-key", "remote_file", &stored);

    let mut key = remote_key("Photos/Melissa Chen_Ryman Arts.jpg");
    key.size = b"legacy image payload".len() as i64;
    key.last_modified = "2026-06-26T01:02:03Z".into();

    assert_eq!(cache.lookup_remote_file(&key), Some(stored.clone()));
    assert_eq!(cache.lookup_remote_file(&key), Some(stored));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn remote_file_lookup_rejects_stale_source_metadata() {
    let root = root("remote-stale-source");
    let mut cache = ClipboardCache::new(root.clone());
    let key = remote_key("Projects/List.h");
    let temp = cache.temp_path_for(&ClipboardCache::remote_file_key(&key), "List.h");
    fs::write(&temp, b"payload").expect("write staging file");
    cache
        .store_remote_file(&key, &temp, "List.h")
        .expect("store remote cache file");

    let mut changed = key.clone();
    changed.size = 9001;

    assert_eq!(cache.lookup_remote_file(&changed), None);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn temp_paths_are_unique_for_parallel_downloads() {
    let root = root("unique-partial");
    let mut cache = ClipboardCache::new(root.clone());
    cache.set_now_for_tests(1_800_000_000_000);
    let cache_key = ClipboardCache::remote_file_key(&remote_key("Photos/IMG_0481.jpeg"));

    let first = cache.temp_path_for(&cache_key, "IMG_0481.jpeg"); // gitleaks:allow -- test filename
    let second = cache.temp_path_for(&cache_key, "IMG_0481.jpeg"); // gitleaks:allow -- test filename

    assert_ne!(first, second);
    assert_eq!(first.parent(), second.parent());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn image_blob_miss_store_and_hit() {
    let root = root("image");
    let mut cache = ClipboardCache::new(root.clone());
    let key = ClipboardImageBlobCacheKey {
        blob_id: "blob-123".into(),
        checksum: "sha256:abc".into(),
        size_bytes: 4,
        mime_type: "image/png".into(),
    };
    assert!(cache.store_image_blob(&key, &[1, 2, 3, 4]));
    assert_eq!(cache.lookup_image_blob(&key), Some(vec![1, 2, 3, 4]));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn cleanup_expires_only_stale_entries() {
    let root = root("ttl");
    let mut cache = ClipboardCache::new(root.clone());
    let fresh = remote_key("Projects/List.h");
    let expired = remote_key("Projects/Old.h");
    let base = 1000 * 60 * 60 * 1000;
    cache.set_now_for_tests(base);
    for (key, name) in [(&fresh, "List.h"), (&expired, "Old.h")] {
        let temp = cache.temp_path_for(&ClipboardCache::remote_file_key(key), name);
        fs::write(&temp, name).expect("write partial cache file");
        cache
            .store_remote_file(key, &temp, name)
            .expect("store cache file");
    }
    cache.set_now_for_tests(base + 2 * 60 * 60 * 1000);
    assert!(cache.lookup_remote_file(&fresh).is_some());
    cache.set_now_for_tests(base + 73 * 60 * 60 * 1000);
    cache.cleanup_expired();
    assert!(cache.lookup_remote_file(&expired).is_none());
    assert!(cache.lookup_remote_file(&fresh).is_some());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn cleanup_removes_stale_partial_files_without_index() {
    let root = root("partial");
    let mut cache = ClipboardCache::new(root.clone());
    let partial = cache.temp_path_for("stale-key", "download.bin");
    fs::write(&partial, b"partial").expect("write partial file");

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64;
    cache.set_now_for_tests(now_ms + 73 * 60 * 60 * 1000);
    cache.cleanup_expired();

    assert!(!partial.exists());
    let _ = fs::remove_dir_all(root);
}
