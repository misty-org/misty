//! The probe itself: synthetic cookies through the live WebKit stores.
use super::{browser_profile, website_data::cookie_store as cookies};
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

mod app;
mod live;
mod restore;

use app::run_child;
use live::check;
use restore::staged_restore;

pub(crate) fn profile() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

pub(crate) fn fixture() -> Cookie {
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

pub(crate) async fn read(view: &Webview, id: &str) -> Result<Vec<Cookie>> {
    let read = cookies::read(view, id)
        .await
        .map_err(|_| "native read failed")?;
    // Every probe cookie is synthetic and valid; a skip is a regression.
    if !read.skipped.is_empty() {
        return Err("native read skipped a cookie");
    }
    Ok(read.cookies)
}

pub(crate) async fn write(view: &Webview, id: &str, cookie: Cookie, delete: bool) -> Result<()> {
    cookies::write(view, id, cookie, delete)
        .await
        .map_err(|_| "native write failed")
}

pub(crate) fn generation_view(owner: &Webview, physical: &str) -> Result<Webview> {
    use std::io::Write;
    // Record before creating a native store. The supervisor always launches
    // cleanup after this process exits, including panic/error/timeout paths.
    let log =
        std::env::var_os("MISTY_COOKIE_PROBE_PROFILE_LOG").ok_or("missing profile cleanup log")?;
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
pub(crate) async fn remove_store(app: &tauri::AppHandle, id: &str) -> Result<()> {
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
