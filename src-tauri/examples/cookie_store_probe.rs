//! Explicit macOS integration probe. Uses synthetic cookies, random named
//! stores, no renderer IPC, and no network pages or existing Misty profiles.
//! Run: cargo run --manifest-path src-tauri/Cargo.toml --example cookie_store_probe

#[cfg(target_os = "macos")]
#[path = "../src/infra/browser_cookie_restore.rs"]
mod browser_cookie_restore;
#[cfg(target_os = "macos")]
#[path = "../src/infra/browser_cookie_store.rs"]
mod browser_cookie_store;
#[cfg(target_os = "macos")]
#[path = "../src/infra/browser_profile.rs"]
mod browser_profile;

#[cfg(target_os = "macos")]
mod probe {
    use super::{browser_cookie_store as cookies, browser_profile};
    use block2::RcBlock;
    use misty_browser_sync::document::credentials::{Cookie, SameSite};
    use objc2_foundation::{NSError, NSUUID};
    use objc2_web_kit::WKWebsiteDataStore;
    use std::sync::{
        atomic::{AtomicI32, Ordering},
        Arc, Mutex,
    };
    use tauri::{LogicalPosition, LogicalSize, Webview, WebviewBuilder, WebviewUrl};

    type Result<T> = std::result::Result<T, &'static str>;

    fn profile() -> String {
        format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        )
    }

    fn fixture() -> Cookie {
        Cookie {
            name: "misty_synthetic_session".into(),
            value: "synthetic-only".into(),
            domain: "example.test".into(),
            path: "/".into(),
            host_only: true,
            secure: true,
            http_only: true,
            same_site: Some(SameSite::Lax),
            expires_unix_seconds: None,
            partition_key: None,
        }
    }

    async fn read(view: &Webview, id: &str) -> Result<Vec<Cookie>> {
        cookies::read(view, id)
            .await
            .map_err(|_| "native read failed")
    }

    async fn write(view: &Webview, id: &str, cookie: Cookie, delete: bool) -> Result<()> {
        cookies::write(view, id, cookie, delete)
            .await
            .map_err(|_| "native write failed")
    }

    async fn check(
        a: &Webview,
        b: &Webview,
        peer: &Webview,
        ephemeral: &Webview,
        host: &Webview,
        a_id: &str,
        b_id: &str,
    ) -> Result<()> {
        if !read(a, a_id).await?.is_empty() || !read(b, b_id).await?.is_empty() {
            return Err("random profiles were not empty");
        }
        for (view, id) in [(a, b_id), (ephemeral, a_id), (host, a_id)] {
            if !matches!(
                cookies::read(view, id).await,
                Err(cookies::CookieStoreError::Profile)
            ) {
                return Err("profile read guard failed");
            }
            if !matches!(
                cookies::write(view, id, fixture(), false).await,
                Err(cookies::CookieStoreError::Profile)
            ) {
                return Err("profile write guard failed");
            }
        }
        let tomorrow = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "clock unavailable")?
            .as_secs() as i64
            + 86_400;
        let mut count = 0;
        for domain in ["example.test", ".example.test"] {
            for expires in [None, Some(tomorrow)] {
                for policy in [SameSite::Lax, SameSite::Strict, SameSite::None] {
                    for secure in [true, false] {
                        if !secure && matches!(policy, SameSite::None) {
                            continue;
                        }
                        for http_only in [true, false] {
                            let mut cookie = fixture();
                            cookie.domain = domain.into();
                            cookie.host_only = !domain.starts_with('.');
                            cookie.expires_unix_seconds = expires;
                            cookie.same_site = Some(policy.clone());
                            cookie.secure = secure;
                            cookie.http_only = http_only;
                            write(a, a_id, cookie.clone(), false).await?;
                            let actual = read(peer, a_id).await?;
                            if actual.len() != 1
                                || serde_json::to_value(&actual[0]).ok()
                                    != serde_json::to_value(&cookie).ok()
                            {
                                return Err("cookie attributes changed in the live store");
                            }
                            if !read(b, b_id).await?.is_empty() {
                                return Err("cookie crossed profile boundary");
                            }
                            write(a, a_id, cookie, true).await?;
                            if !read(peer, a_id).await?.is_empty() {
                                return Err("cookie deletion did not complete");
                            }
                            count += 1;
                        }
                    }
                }
            }
        }
        // Host and domain cookies share a name/path but have distinct scope.
        let host_cookie = fixture();
        let mut domain_cookie = fixture();
        domain_cookie.host_only = false;
        domain_cookie.domain = ".example.test".into();
        write(a, a_id, host_cookie.clone(), false).await?;
        write(a, a_id, domain_cookie.clone(), false).await?;
        if read(peer, a_id).await?.len() != 2 {
            return Err("host/domain scope collapsed");
        }
        write(a, a_id, host_cookie, true).await?;
        let remaining = read(peer, a_id).await?;
        if remaining.len() != 1 || remaining[0].host_only {
            return Err("host deletion changed the domain cookie");
        }
        write(a, a_id, domain_cookie, true).await?;
        if !read(peer, a_id).await?.is_empty() {
            return Err("final store not empty");
        }
        println!("PASS: {count} live cookie round trips, completion callbacks, profile guards, same-profile visibility, isolation, and host/domain coexistence");
        staged_restore(a, b, a_id, b_id).await?;
        Ok(())
    }

    async fn staged_restore(a: &Webview, b: &Webview, a_id: &str, b_id: &str) -> Result<()> {
        use super::browser_cookie_restore::StagedCookieProfile;
        use misty_browser_sync::{
            crypto::{generate_sync_secret, DeviceKey, VaultRoot, VaultScope},
            document::{self, credentials::Area, Document},
            protocol::Event,
            restore::{
                restore_profile, restore_staged_profile, verify_active_profile, QuiescentProfile,
                RestoreOutcome,
            },
            store::{BrowserCaptureState, BrowserObservation, Store},
            transport::SyncApi,
            worker::Worker,
        };
        // No sockets are accepted and no network pages are loaded. This drives
        // the real worker/SQLite import path while its transport is offline.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| "probe listener")?;
        let base = format!(
            "http://{}",
            listener.local_addr().map_err(|_| "probe address")?
        );
        let directory = tempfile::tempdir().map_err(|_| "probe directory")?;
        let path = directory.path().join("sync.sqlite");
        let scope = VaultScope {
            deployment: base.clone(),
            account_id: "synthetic-probe".into(),
            workspace_id: uuid::Uuid::new_v4().to_string(),
        };
        let root = VaultRoot::generate();
        let device = DeviceKey::generate();
        let grant = root
            .grant(&scope, &uuid::Uuid::new_v4().to_string(), 1, &device)
            .map_err(|_| "probe grant")?;
        let secret = generate_sync_secret();
        let wrapped = root
            .wrap(&scope, "synthetic-probe-password", &secret)
            .map_err(|_| "probe wrapper")?;
        let public = root.public_key().map_err(|_| "probe public identity")?;
        let mut store = Store::initialize(
            &path,
            scope.clone(),
            grant.clone(),
            &root,
            &device,
            &Document::default().encode().map_err(|_| "probe document")?,
        )
        .map_err(|_| "probe database")?;
        let target = serde_json::json!([fixture()]);
        let commit = |store: &mut Store,
                      root: &VaultRoot,
                      device: &DeviceKey,
                      sequence: u64,
                      payload: serde_json::Value|
         -> Result<()> {
            let bytes = serde_json::to_vec(&serde_json::json!({"kind":"credentials", "version":1, "batch":{"profile_id":a_id, "updates":[{"area":{"kind":"cookies"}, "base_sequence":sequence-1, "payload":payload}]}})).map_err(|_| "probe payload")?;
            let mutation = store
                .enqueue(root, device, &bytes)
                .map_err(|_| "probe enqueue")?;
            store
                .apply_events(
                    root,
                    &[(Event { mutation, sequence }, grant.clone())],
                    document::reduce,
                )
                .map_err(|_| "probe replay")?;
            Ok(())
        };
        let mut expired = fixture();
        expired.name = "expired-synthetic-token".into();
        expired.expires_unix_seconds = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "probe clock")?
                .as_secs() as i64
                - 60,
        );
        commit(
            &mut store,
            &root,
            &device,
            1,
            serde_json::json!([fixture(), expired]),
        )?;
        let _ = rustls::crypto::ring::default_provider().install_default();
        let api = || SyncApi::new(&base, reqwest::Client::new()).map_err(|_| "probe API");
        let (worker, handle) =
            Worker::new(api()?, scope.clone(), root, device, store, document::reduce)
                .map_err(|_| "probe worker")?;
        let task = tokio::spawn(worker.run());
        let mut generation_views = Vec::new();
        let first = async {
            // A complete cookie area removes cookies absent from the target.
            let mut retired = fixture();
            retired.name = "retired-synthetic-token".into();
            write(a, a_id, retired, false).await?;
            let mut backend = StagedCookieProfile::new(a.clone(), a_id.to_owned());
            let mut partitioned = fixture();
            partitioned.name = "partitioned-synthetic-token".into();
            partitioned.partition_key = Some(document::credentials::PartitionKey {
                top_level_site: "https://example.test".into(),
                has_cross_site_ancestor: false,
            });
            let rejected = document::CredentialRecord {
                sequence: 1,
                profile_id: a_id.into(),
                area: Area::Cookies,
                payload: serde_json::json!([fixture(), partitioned]),
            };
            if backend.preflight(&[rejected]).await.is_ok() {
                return Err("partitioned cookies were silently broadened");
            }
            let unsupported_storage = document::CredentialRecord {
                sequence: 1,
                profile_id: a_id.into(),
                area: Area::LocalStorage {
                    origin: "https://example.test".into(),
                },
                payload: serde_json::json!({}),
            };
            if backend.preflight(&[unsupported_storage]).await.is_ok() {
                return Err("cookie adapter acknowledged unsupported storage");
            }
            let unchanged = read(a, a_id).await?;
            if unchanged.len() != 1 || unchanged[0].name != "retired-synthetic-token" {
                return Err("unsupported preflight changed browser cookies");
            }
            if !matches!(
                restore_profile(&handle, a_id, &mut backend)
                    .await
                    .map_err(|_| "journalled native restore failed")?,
                RestoreOutcome::Applied { sequence: 1 }
            ) {
                return Err("wrong imported cursor");
            }
            let actual = serde_json::to_value(read(a, a_id).await?)
                .map_err(|_| "probe readback encoding")?;
            if Area::Cookies
                .canonical_payload(&actual)
                .map_err(|_| "probe actual format")?
                != Area::Cookies
                    .canonical_payload(&target)
                    .map_err(|_| "probe target format")?
            {
                return Err("journalled cookie attributes changed");
            }
            if !read(b, b_id).await?.is_empty() {
                return Err("restore crossed profile boundary");
            }
            handle
                .imports_applied(1)
                .await
                .map_err(|_| "verified import not acknowledged")?;
            let generation = uuid::Uuid::new_v4().to_string();
            let binding = handle
                .stage_browser_profile(a_id.into(), 0, generation.clone())
                .await
                .map_err(|_| "allocate first generation")?;
            let physical = binding
                .staged
                .as_ref()
                .ok_or("missing first stage")?
                .physical_id
                .clone();
            let view = generation_view(a, &physical)?;
            generation_views.push(view.clone());
            let mut isolated =
                StagedCookieProfile::for_generation(view.clone(), a_id.into(), physical.clone());
            restore_staged_profile(&handle, a_id, &generation, &mut isolated)
                .await
                .map_err(|_| "restore allocated first generation")?;
            if handle.imports_applied(1).await.is_ok() {
                return Err("staged profile was marked ready before activation");
            }
            handle
                .activate_browser_profile(a_id.into(), binding.revision, generation)
                .await
                .map_err(|_| "activate first generation")?;
            if read(&view, &physical).await?.len() != 1 || read(a, a_id).await?.len() != 1 {
                return Err("generation activation lost its own or predecessor cookies");
            }
            verify_active_profile(&handle, a_id, &mut isolated)
                .await
                .map_err(|_| "activated native profile could not be reverified")?;
            let original = read(&view, &physical)
                .await?
                .into_iter()
                .next()
                .ok_or("missing active cookie")?;
            let mut changed = original.clone();
            changed.value = "native-value-changed-after-receipt".into();
            write(&view, &physical, changed.clone(), false).await?;
            if verify_active_profile(&handle, a_id, &mut isolated)
                .await
                .is_ok()
            {
                return Err("durable receipt substituted for changed native cookie observations");
            }
            if read(&view, &physical)
                .await?
                .first()
                .map(|cookie| &cookie.value)
                != Some(&changed.value)
            {
                return Err("active verification overwrote native browser state");
            }
            write(&view, &physical, original, false).await?;
            verify_active_profile(&handle, a_id, &mut isolated)
                .await
                .map_err(|_| "restored native observation could not be reverified")?;
            handle
                .imports_applied(1)
                .await
                .map_err(|_| "activated generation not acknowledged")?;
            Ok(())
        }
        .await;
        handle.stop();
        task.await
            .map_err(|_| "first worker join")?
            .map_err(|_| "first worker shutdown")?;
        first?;
        let root = VaultRoot::unlock(
            &scope,
            &wrapped,
            "synthetic-probe-password",
            &secret,
            &public,
        )
        .map_err(|_| "probe unlock")?;
        let (mut store, device) =
            Store::unlock(&path, scope.clone(), &root).map_err(|_| "probe reopen")?;
        if store
            .browser_import_journal(&root, a_id)
            .map_err(|_| "probe receipt")?
            .applied
            .is_none()
        {
            return Err("verified receipt lost on restart");
        }
        commit(&mut store, &root, &device, 2, serde_json::json!([]))?;
        let (worker, handle) = Worker::new(api()?, scope, root, device, store, document::reduce)
            .map_err(|_| "second worker")?;
        let task = tokio::spawn(worker.run());
        let second = async {
            if handle.imports_applied(2).await.is_ok() {
                return Err("old receipt covered newer logout");
            }
            let before = handle
                .browser_profile_binding(a_id.into())
                .await
                .map_err(|_| "recover generation binding")?;
            let previous = before
                .active
                .as_ref()
                .ok_or("active generation lost on restart")?
                .physical_id
                .clone();
            let generation = uuid::Uuid::new_v4().to_string();
            let binding = handle
                .stage_browser_profile(a_id.into(), before.revision, generation.clone())
                .await
                .map_err(|_| "allocate logout generation")?;
            let physical = binding
                .staged
                .as_ref()
                .ok_or("missing logout stage")?
                .physical_id
                .clone();
            let view = generation_view(a, &physical)?;
            generation_views.push(view.clone());
            // Seed a stale cookie so the empty area must actually remove data.
            write(&view, &physical, fixture(), false).await?;
            let mut backend =
                StagedCookieProfile::for_generation(view.clone(), a_id.into(), physical.clone());
            if !matches!(
                restore_staged_profile(&handle, a_id, &generation, &mut backend)
                    .await
                    .map_err(|_| "native logout restore failed")?,
                RestoreOutcome::Applied { sequence: 2 }
            ) {
                return Err("wrong logout cursor");
            }
            if !read(&view, &physical).await?.is_empty() {
                return Err("native logout retained cookies");
            }
            if read(&generation_views[0], &previous).await?.len() != 1 {
                return Err("staged logout changed previous generation");
            }
            let activated = handle
                .activate_browser_profile(a_id.into(), binding.revision, generation)
                .await
                .map_err(|_| "activate logout generation")?;
            if activated.retired.len() != 1 || activated.retired[0].physical_id != previous {
                return Err("activation discarded recoverable predecessor");
            }
            handle
                .imports_applied(2)
                .await
                .map_err(|_| "logout receipt not acknowledged")?;
            let active_generation = activated
                .active
                .as_ref()
                .ok_or("missing capture generation")?;
            for value in ["first-native-observation", "latest-native-observation"] {
                let mut cookie = fixture();
                cookie.value = value.into();
                write(&view, &physical, cookie, false).await?;
                let actual = read(&view, &physical).await?;
                if handle
                    .observe_browser_profile(
                        a_id.into(),
                        active_generation.id.clone(),
                        vec![BrowserObservation {
                            area: Area::Cookies,
                            payload: serde_json::to_value(actual)
                                .map_err(|_| "encode native capture")?,
                        }],
                    )
                    .await
                    .map_err(|_| "capture native observation")?
                    != BrowserCaptureState::Queued
                {
                    return Err("native cookie observation was not queued");
                }
                let pending = handle
                    .pending_snapshot()
                    .await
                    .map_err(|_| "capture outbox snapshot")?;
                if pending.operation_ids.len() != 1 {
                    return Err("offline native observations were not coalesced");
                }
                let document: Document = serde_json::from_slice(&pending.snapshot)
                    .map_err(|_| "decode captured document")?;
                let captured = document
                    .credentials
                    .values()
                    .find(|record| record.profile_id == a_id)
                    .ok_or("missing captured cookie area")?;
                if captured.payload[0]["value"] != "first-native-observation" {
                    return Err("coalesced observation replaced an unacknowledged operation");
                }
            }
            if !read(b, b_id).await?.is_empty() {
                return Err("native capture changed another profile");
            }
            Ok(())
        }
        .await;
        handle.stop();
        task.await
            .map_err(|_| "second worker join")?
            .map_err(|_| "second worker shutdown")?;
        for view in generation_views {
            let _ = view.close();
        }
        second?;
        println!("PASS: encrypted worker journal drives native cookie replacement, profile isolation, restart receipt recovery, and explicit logout");
        println!("PASS: active profile verification uses actual cookie readback and preserves changed native values on mismatch");
        println!("PASS: native-allocated generations restore and activate after verification, recover mappings after worker restart, and preserve predecessor cookies during logout");
        println!("PASS: actual native cookie observations enter the encrypted worker outbox and coalesce while offline without replacing an unacknowledged operation");
        Ok(())
    }

    fn generation_view(owner: &Webview, physical: &str) -> Result<Webview> {
        use std::io::Write;
        // Record before creating a native store. The supervisor always launches
        // cleanup after this process exits, including panic/error/timeout paths.
        let log = std::env::var_os("MISTY_COOKIE_PROBE_PROFILE_LOG")
            .ok_or("missing profile cleanup log")?;
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(log)
            .map_err(|_| "open cleanup log")?;
        writeln!(file, "{physical}").map_err(|_| "write cleanup log")?;
        file.sync_all().map_err(|_| "sync cleanup log")?;
        owner
            .window()
            .add_child(
                WebviewBuilder::new(
                    format!("misty-browser-generation-{}", &physical[..16]),
                    WebviewUrl::External("about:blank".parse().unwrap()),
                )
                .data_store_identifier(
                    browser_profile::data_store_identifier(Some(physical))
                        .map_err(|_| "generation store ID")?,
                ),
                LogicalPosition::new(0., 0.),
                LogicalSize::new(100., 100.),
            )
            .map_err(|_| "create generation view")
    }

    // Remove only freshly generated IDs; no profile paths are traversed.
    async fn remove_store(app: &tauri::AppHandle, id: &str) -> Result<()> {
        let bytes =
            browser_profile::data_store_identifier(Some(&id)).map_err(|_| "invalid cleanup ID")?;
        let (sender, receiver) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || unsafe {
            let sender = Mutex::new(Some(sender));
            let callback = RcBlock::new(move |error: *mut NSError| {
                if let Some(sender) = sender.lock().unwrap().take() {
                    let _ = sender.send(error.is_null());
                }
            });
            WKWebsiteDataStore::removeDataStoreForIdentifier_completionHandler(
                &NSUUID::from_bytes(bytes),
                &callback,
                objc2::MainThreadMarker::new().expect("cleanup on main thread"),
            );
        })
        .map_err(|_| "cleanup scheduling failed")?;
        if tokio::time::timeout(std::time::Duration::from_secs(15), receiver)
            .await
            .map_err(|_| "cleanup timeout")?
            .map_err(|_| "cleanup unavailable")?
        {
            Ok(())
        } else {
            Err("profile cleanup failed")
        }
    }

    fn run_child(a_id: String, b_id: String, cleanup: bool) -> i32 {
        if objc2_foundation::NSProcessInfo::processInfo()
            .operatingSystemVersion()
            .majorVersion
            < 14
        {
            eprintln!("This probe requires macOS 14 or later");
            return 1;
        }
        let status = Arc::new(AtomicI32::new(1));
        let output_status = status.clone();
        tauri::Builder::default()
            .setup(move |app| {
                let window = tauri::WindowBuilder::new(app, "cookie-probe")
                    .title("Misty synthetic cookie probe")
                    .visible(false)
                    .build()?;
                if cleanup {
                    // Initialize WebKit's main run loop without opening either
                    // named store. Some runtimes crash if removal is the first
                    // WebKit API used by the process.
                    window.add_child(
                        WebviewBuilder::new(
                            "cleanup-runtime",
                            WebviewUrl::External("about:blank".parse().unwrap()),
                        )
                        .incognito(true),
                        LogicalPosition::new(0., 0.),
                        LogicalSize::new(100., 100.),
                    )?;
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        let mut ids = vec![a_id, b_id];
                        let additional = std::env::var_os("MISTY_COOKIE_PROBE_PROFILE_LOG")
                            .and_then(|path| std::fs::read_to_string(path).ok())
                            .unwrap_or_default();
                        let mut result = Ok(());
                        for id in additional.lines() {
                            if ids.len() >= 10
                                || browser_profile::data_store_identifier(Some(id)).is_err()
                            {
                                result = Err("invalid allocated cleanup profile");
                                break;
                            }
                            if !ids.iter().any(|existing| existing == id) {
                                ids.push(id.into());
                            }
                        }
                        for id in ids {
                            let removed = remove_store(&handle, &id).await;
                            result = result.and(removed);
                        }
                        if let Err(message) = result {
                            eprintln!("FAIL: {message}");
                        }
                        let code = if result.is_ok() { 0 } else { 1 };
                        status.store(code, Ordering::SeqCst);
                        handle.exit(code);
                    });
                    return Ok(());
                }
                let add = |label: &str, id: &str, incognito: bool| -> tauri::Result<Webview> {
                    window.add_child(
                        WebviewBuilder::new(
                            label,
                            WebviewUrl::External("about:blank".parse().unwrap()),
                        )
                        .data_store_identifier(
                            browser_profile::data_store_identifier(Some(id)).unwrap(),
                        )
                        .incognito(incognito),
                        LogicalPosition::new(0., 0.),
                        LogicalSize::new(100., 100.),
                    )
                };
                let a = add("misty-browser-probe-a", &a_id, false)?;
                let b = add("misty-browser-probe-b", &b_id, false)?;
                let peer = add("misty-browser-probe-peer", &a_id, false)?;
                let ephemeral = add("misty-browser-probe-ephemeral", &a_id, true)?;
                let host = add("main", &a_id, false)?;
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let result = tokio::time::timeout(
                        std::time::Duration::from_secs(60),
                        check(&a, &b, &peer, &ephemeral, &host, &a_id, &b_id),
                    )
                    .await
                    .unwrap_or(Err("probe timeout"));
                    for view in [a, b, peer, ephemeral, host] {
                        let _ = view.close();
                    }
                    if let Err(message) = result {
                        eprintln!("FAIL: {message}");
                    }
                    let code = if result.is_ok() { 0 } else { 1 };
                    status.store(code, Ordering::SeqCst);
                    handle.exit(code);
                });
                Ok(())
            })
            .build(tauri::generate_context!(
                "examples/cookie-store-probe/tauri.conf.json"
            ))
            .expect("build isolated cookie probe")
            .run_return(|_, _| {});
        output_status.load(Ordering::SeqCst)
    }

    pub fn run() -> i32 {
        let args: Vec<_> = std::env::args().skip(1).collect();
        if args.len() == 3 && matches!(args[0].as_str(), "--exercise" | "--cleanup") {
            if args[1..]
                .iter()
                .any(|id| browser_profile::data_store_identifier(Some(id)).is_err())
            {
                eprintln!("Invalid probe profile identity");
                return 1;
            }
            return run_child(args[1].clone(), args[2].clone(), args[0] == "--cleanup");
        }
        if !args.is_empty() {
            eprintln!("Invalid probe arguments");
            return 1;
        }
        let a = profile();
        let b = profile();
        let executable = std::env::current_exe().expect("probe executable");
        let cleanup_directory = tempfile::tempdir().expect("probe cleanup directory");
        let cleanup_log = cleanup_directory.path().join("allocated-profiles");
        std::fs::write(&cleanup_log, "").expect("initialize cleanup log");
        let child = |mode: &str| {
            std::process::Command::new(&executable)
                .args([mode, &a, &b])
                .env("MISTY_COOKIE_PROBE_PROFILE_LOG", &cleanup_log)
                .status()
                .map(|status| status.success())
                .unwrap_or(false)
        };
        // WebKit retains network-process references past view.close(). End the
        // exercise process before deleting its exact random profiles through
        // WebKit's public removal API in a fresh process. Always attempt cleanup.
        let success = child("--exercise");
        let clean = child("--cleanup");
        if success && clean {
            println!("PASS: temporary native profiles removed");
            0
        } else {
            1
        }
    }
}

#[cfg(target_os = "macos")]
fn main() {
    std::process::exit(probe::run());
}
#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("This probe requires macOS 14 or later");
    std::process::exit(1);
}
