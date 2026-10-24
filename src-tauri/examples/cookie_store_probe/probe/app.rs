//! The exercise and cleanup processes: a hidden Tauri app with probe views.
use super::*;

pub(super) fn run_child(a_id: String, b_id: String, cleanup: bool) -> i32 {
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
