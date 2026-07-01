//! Disposable WebView2 acceptance probe. Run on Windows with an installed
//! WebView2 runtime: cargo run --example windows_cookie_probe
//! No network navigation, live provider accounts, or existing browser profiles.
#[cfg(windows)]
#[path = "../src/infra/browser_cookie_cdp.rs"]
mod browser_cookie_cdp;
#[cfg(windows)]
#[path = "../src/infra/browser_cookie_restore.rs"]
mod browser_cookie_restore;
#[cfg(windows)]
#[path = "../src/infra/browser_cookie_store_windows.rs"]
mod browser_cookie_store;
#[cfg(windows)]
#[path = "../src/infra/browser_profile.rs"]
mod browser_profile;

// The adapter's expected-folder resolver is scoped to the supervisor's disposable
// root. The adapter itself still reads and validates actual WebView2 COM state.
#[cfg(windows)]
mod browser {
    use tauri::Manager;
    pub(super) struct ProbeRoot(pub std::path::PathBuf);
    pub(super) fn browser_data_directory(
        app: &tauri::AppHandle,
        profile: Option<&str>,
    ) -> Result<std::path::PathBuf, String> {
        let profile = profile.ok_or("missing probe profile")?;
        super::browser_profile::data_store_identifier(Some(profile))?;
        let path = app.state::<ProbeRoot>().0.join(profile);
        std::fs::create_dir_all(&path).map_err(|_| "could not create probe directory")?;
        Ok(path)
    }
}

#[cfg(windows)]
mod probe {
    use super::{
        browser, browser_cookie_restore::StagedCookieProfile, browser_cookie_store as cookies,
    };
    use misty_browser_sync::{
        document::{
            credentials::{Area, Cookie, SameSite},
            CredentialRecord,
        },
        restore::QuiescentProfile,
    };
    use serde_json::json;
    use std::{
        path::PathBuf,
        sync::{
            atomic::{AtomicI32, Ordering},
            Arc,
        },
    };
    use tauri::{LogicalPosition, LogicalSize, Webview, WebviewBuilder, WebviewUrl};
    type Result<T> = std::result::Result<T, &'static str>;
    fn id() -> String {
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
    fn canonical(cookies: Vec<Cookie>) -> Result<serde_json::Value> {
        Area::Cookies
            .canonical_payload(&json!(cookies))
            .map_err(|_| "invalid cookie readback")
    }
    async fn read(view: &Webview, id: &str) -> Result<Vec<Cookie>> {
        cookies::read(view, id)
            .await
            .map_err(|_| "native cookie read failed")
    }
    async fn check(
        a: &Webview,
        peer: &Webview,
        b: &Webview,
        private: &Webview,
        host: &Webview,
        a_id: &str,
        b_id: &str,
    ) -> Result<()> {
        if !read(a, a_id).await?.is_empty() || !read(b, b_id).await?.is_empty() {
            return Err("random profiles must start empty");
        }
        for (view, profile) in [(a, b_id), (private, a_id), (host, a_id)] {
            if cookies::read(view, profile).await.err() != Some(cookies::CookieStoreError::Profile)
            {
                return Err("profile read guard failed");
            }
            if cookies::write(view, profile, fixture(), false).await.err()
                != Some(cookies::CookieStoreError::Profile)
            {
                return Err("profile write guard failed");
            }
        }
        let expiry = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "clock unavailable")?
            .as_secs() as i64
            + 86400;
        let mut target = Vec::new();
        // Explicit policies + unspecified policy; host/domain; session/persistent;
        // HttpOnly and readable cookies all coexist in the same native profile.
        for host_only in [true, false] {
            for persistent in [true, false] {
                for http_only in [true, false] {
                    for policy in [
                        None,
                        Some(SameSite::Lax),
                        Some(SameSite::Strict),
                        Some(SameSite::None),
                    ] {
                        let mut cookie = fixture();
                        cookie.name = format!("probe_{}", target.len());
                        cookie.host_only = host_only;
                        cookie.expires_unix_seconds = persistent.then_some(expiry);
                        cookie.http_only = http_only;
                        cookie.same_site = policy;
                        cookies::write(a, a_id, cookie.clone(), false)
                            .await
                            .map_err(|_| "cookie write completion failed")?;
                        target.push(cookie);
                    }
                }
            }
        }
        if canonical(read(a, a_id).await?)? != canonical(target.clone())? {
            return Err("native round trip changed cookie attributes");
        }
        if canonical(read(peer, a_id).await?)? != canonical(target.clone())? {
            return Err("same-profile view did not observe cookies");
        }
        if !read(b, b_id).await?.is_empty() {
            return Err("profile isolation failed");
        }
        let mut host_cookie = fixture();
        host_cookie.name = "same_name".into();
        let mut domain_cookie = host_cookie.clone();
        domain_cookie.host_only = false;
        cookies::write(a, a_id, host_cookie.clone(), false)
            .await
            .map_err(|_| "host cookie write failed")?;
        cookies::write(a, a_id, domain_cookie.clone(), false)
            .await
            .map_err(|_| "domain cookie write failed")?;
        cookies::write(a, a_id, host_cookie, true)
            .await
            .map_err(|_| "host cookie delete failed")?;
        let observed = read(a, a_id).await?;
        if observed.iter().filter(|v| v.name == "same_name").count() != 1
            || observed
                .iter()
                .find(|v| v.name == "same_name")
                .unwrap()
                .host_only
        {
            return Err("exact deletion removed the wrong cookie scope");
        }
        let logical = "a".repeat(64);
        let record = CredentialRecord {
            sequence: 1,
            profile_id: logical.clone(),
            area: Area::Cookies,
            payload: json!(target),
        };
        let mut backend = StagedCookieProfile::for_generation(b.clone(), logical, b_id.into());
        backend
            .preflight(&[record.clone()])
            .await
            .map_err(|_| "restore preflight failed")?;
        backend
            .apply(&[record.clone()])
            .await
            .map_err(|_| "restore apply failed")?;
        let actual = backend
            .readback(&[record.clone()])
            .await
            .map_err(|_| "restore readback failed")?;
        if Area::Cookies
            .canonical_payload(&actual[0].payload)
            .map_err(|_| "invalid readback")?
            != Area::Cookies
                .canonical_payload(&record.payload)
                .map_err(|_| "invalid target")?
        {
            return Err("restored profile differs from target");
        }
        let logout = CredentialRecord {
            payload: json!([]),
            sequence: 2,
            ..record
        };
        backend
            .apply(&[logout.clone()])
            .await
            .map_err(|_| "logout apply failed")?;
        if !read(b, b_id).await?.is_empty() {
            return Err("logout did not clear restored profile");
        }
        if read(a, a_id).await?.is_empty() {
            return Err("logout changed source profile");
        }
        println!("PASS: 32 cookie variants, native callbacks, profile boundaries, host/domain deletion, restore readback and logout isolation");
        Ok(())
    }
    fn child(root: PathBuf) -> i32 {
        let (a_id, b_id) = (id(), id());
        let status = Arc::new(AtomicI32::new(1));
        let output = status.clone();
        tauri::Builder::default().manage(browser::ProbeRoot(root)).setup(move |app| {
            let window=tauri::WindowBuilder::new(app,"windows-cookie-probe").title("Misty synthetic cookie probe").visible(false).build()?;
            let add=|label:&str,profile:&str,private:bool| -> std::result::Result<Webview,Box<dyn std::error::Error>> {
                Ok(window.add_child(WebviewBuilder::new(label,WebviewUrl::External("about:blank".parse()?))
                    .data_directory(browser::browser_data_directory(app.handle(),Some(profile))?).incognito(private),
                    LogicalPosition::new(0.,0.),LogicalSize::new(100.,100.))?)
            };
            let a=add("misty-browser-probe-a",&a_id,false)?;
            let b=add("misty-browser-probe-b",&b_id,false)?;
            let peer=add("misty-browser-probe-peer",&a_id,false)?;
            let private=add("misty-browser-probe-private",&a_id,true)?;
            let host=add("main",&a_id,false)?;
            let handle=app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let result=tokio::time::timeout(std::time::Duration::from_secs(90),check(&a,&peer,&b,&private,&host,&a_id,&b_id)).await.unwrap_or(Err("probe timeout"));
                for view in [a,b,peer,private,host] { let _=view.close(); }
                if let Err(message)=result { eprintln!("FAIL: {message}"); }
                let code=if result.is_ok(){0}else{1};status.store(code,Ordering::SeqCst);handle.exit(code);
            });
            Ok(())
        }).build(tauri::generate_context!("examples/cookie-store-probe/tauri.conf.json")).expect("build isolated Windows probe").run_return(|_,_|{});
        output.load(Ordering::SeqCst)
    }
    pub fn run() -> i32 {
        let args: Vec<_> = std::env::args_os().skip(1).collect();
        if args.len() == 2 && args[0] == "--exercise" {
            return child(PathBuf::from(&args[1]));
        }
        if !args.is_empty() {
            eprintln!("Invalid probe arguments");
            return 1;
        }
        let root = tempfile::tempdir().expect("create disposable profiles");
        let success =
            std::process::Command::new(std::env::current_exe().expect("probe executable"))
                .arg("--exercise")
                .arg(root.path())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
        // The native process must exit before cleanup: WebView2 keeps profile
        // files open beyond view.close(). Retry only this supervisor-owned root.
        let path = root.keep();
        let mut cleaned = false;
        for _ in 0..50 {
            if std::fs::remove_dir_all(&path).is_ok() {
                cleaned = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        if cleaned {
            println!("PASS: disposable Windows profiles removed");
        } else {
            eprintln!("FAIL: cleanup incomplete at {}", path.display());
        }
        if success && cleaned {
            0
        } else {
            1
        }
    }
}
#[cfg(windows)]
fn main() {
    std::process::exit(probe::run());
}
#[cfg(not(windows))]
fn main() {
    eprintln!("This probe requires Windows and WebView2");
    std::process::exit(1);
}
