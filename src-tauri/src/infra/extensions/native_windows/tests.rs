use super::package::*;
use super::*;
use base64::Engine;
use serde_json::json;

#[test]
fn only_granted_permissions_and_sites_reach_webview2() {
    let manifest = json!({
        "manifest_version": 3,
        "permissions": ["storage", "tabs", "cookies"],
        "optional_permissions": ["history"],
        "host_permissions": ["https://a.example/*", "https://b.example/*"],
        "content_scripts": [
            {"matches": ["https://a.example/*"], "js": ["a.js"]},
            {"matches": ["https://c.example/*"], "js": ["c.js"]},
        ],
    });
    let granted = granted_manifest(
        &manifest,
        "origin",
        &["storage".into(), "tabs".into()],
        &["https://a.example/*".into()],
    );
    assert_eq!(granted["permissions"], json!(["storage", "tabs"]));
    assert_eq!(granted["host_permissions"], json!(["https://a.example/*"]));
    assert_eq!(granted["content_scripts"].as_array().unwrap().len(), 1);
    assert!(granted.get("optional_permissions").is_none());
    let bare = granted_manifest(&json!({"manifest_version": 3}), "origin", &[], &[]);
    assert!(bare.get("host_permissions").is_none() && bare.get("permissions").is_none());
    // The key fixes the extension's page host.
    let key = base64::engine::general_purpose::STANDARD
        .decode(granted["key"].as_str().unwrap())
        .unwrap();
    assert_eq!(Some(crx_id(&key)), page_host("origin"));
}

#[test]
fn extension_ids_follow_chromium() {
    // SHA-256 of nothing starts e3 b0 c4 42…: one letter a–p per hex digit.
    assert_eq!(crx_id(b""), "odlameecjipmbmbejkplpemijjgpljce");
    assert_ne!(page_host("a"), page_host("b"));
}

#[test]
fn classic_extensions_are_blocked() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("manifest.json"),
        r#"{"manifest_version":2,"background":{"scripts":["b.js"]}}"#,
    )
    .unwrap();
    let review = validate(dir.path()).unwrap();
    assert_eq!(review["blocked"], true);
    std::fs::write(
        dir.path().join("manifest.json"),
        r#"{"manifest_version":3,"permissions":["notifications"],"host_permissions":["https://a.example/*"]}"#,
    )
    .unwrap();
    let review = validate(dir.path()).unwrap();
    assert_eq!(review["blocked"], false);
    assert_eq!(review["hosts"], json!(["https://a.example/*"]));
    assert_eq!(review["findings"].as_array().unwrap().len(), 1);
}

#[test]
fn manifest_paths_stay_inside_the_extension() {
    let folder = Path::new(r"C:\ext");
    assert!(inside(folder, "popup.html").is_some());
    assert!(inside(folder, "/ui/popup.html").is_some());
    assert!(inside(folder, "../secret").is_none());
    assert!(inside(folder, r"C:\Windows\x").is_none());
}

/// Loads the MV3 fixture into a real WebView2 profile the way Misty
/// does, then opens its options page and turns it off and removes it.
/// Run with `cargo test --lib webview2_runs -- --ignored`.
#[test]
#[ignore = "starts WebView2; run explicitly"]
fn webview2_runs_extensions_under_misty_ids() {
    std::thread::spawn(probe::run).join().unwrap();
}

mod probe {
    use super::super::{package::*, profile::*, *};
    use std::{sync::mpsc, time::Duration};
    use webview2_com::{
        wait_with_pump, BrowserExtensionEnableCompletedHandler,
        BrowserExtensionRemoveCompletedHandler, CoreWebView2EnvironmentOptions,
        CreateCoreWebView2ControllerCompletedHandler,
        CreateCoreWebView2EnvironmentCompletedHandler, ExecuteScriptCompletedHandler,
        Microsoft::Web::WebView2::Win32::{
            CreateCoreWebView2EnvironmentWithOptions, ICoreWebView2EnvironmentOptions,
        },
        NavigationCompletedEventHandler, ProfileAddBrowserExtensionCompletedHandler,
        ProfileGetBrowserExtensionsCompletedHandler,
    };
    use windows::{
        core::{BOOL, HSTRING, PCWSTR},
        Win32::{
            Foundation::HWND,
            System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED},
        },
    };

    fn wait<T>(receive: mpsc::Receiver<T>) -> T {
        wait_with_pump(receive).expect("WebView2 answered")
    }

    /// Pumps messages until `receive` has a value, keeping the channel.
    fn wait_with_pump_ref<T>(receive: &mpsc::Receiver<T>) -> T {
        use windows::Win32::UI::WindowsAndMessaging::{
            DispatchMessageW, PeekMessageW, MSG, PM_REMOVE,
        };
        loop {
            if let Ok(value) = receive.try_recv() {
                return value;
            }
            let mut message = MSG::default();
            while unsafe { PeekMessageW(&mut message, None, 0, 0, PM_REMOVE) }.as_bool() {
                unsafe { DispatchMessageW(&message) };
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    pub fn run() {
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.unwrap();
        let data = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let fixture =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/webextensions/fixtures/mv3");
        let manifest = granted_manifest(
            &read_manifest(&fixture).unwrap(),
            "probe-origin",
            &["storage".into()],
            &[],
        );
        let folder = stage(root.path(), &fixture, &manifest).unwrap();
        assert!(manifest.get("content_scripts").is_none());

        let options = CoreWebView2EnvironmentOptions::default();
        unsafe { options.set_are_browser_extensions_enabled(true) };
        let options: ICoreWebView2EnvironmentOptions = options.into();
        let (send, receive) = mpsc::channel();
        let handler = CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(
            move |status, environment| {
                status?;
                let _ = send.send(environment.unwrap());
                Ok(())
            },
        ));
        unsafe {
            CreateCoreWebView2EnvironmentWithOptions(
                PCWSTR::null(),
                &HSTRING::from(data.path().as_os_str()),
                &options,
                &handler,
            )
        }
        .unwrap();
        let environment = wait(receive);

        let parent = unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::CreateWindowExW(
                0,
                windows_sys::w!("STATIC"),
                std::ptr::null(),
                0,
                0,
                0,
                400,
                300,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            )
        };
        assert!(!parent.is_null());
        let (send, receive) = mpsc::channel();
        let handler = CreateCoreWebView2ControllerCompletedHandler::create(Box::new(
            move |status, controller| {
                status?;
                let _ = send.send(controller.unwrap());
                Ok(())
            },
        ));
        unsafe { environment.CreateCoreWebView2Controller(HWND(parent), &handler) }.unwrap();
        let controller = wait(receive);
        let core = unsafe { controller.CoreWebView2() }.unwrap();
        let profile = profile_of(&core).unwrap();

        // Installs under the ID Misty derives from the account origin.
        let (send, receive) = mpsc::channel();
        let handler = ProfileAddBrowserExtensionCompletedHandler::create(Box::new(
            move |status, extension| {
                let _ = send.send(status.map(|_| extension.unwrap()));
                Ok(())
            },
        ));
        unsafe { profile.AddBrowserExtension(&HSTRING::from(folder.as_os_str()), &handler) }
            .unwrap();
        let extension = wait(receive).expect("WebView2 accepts Misty's manifest key");
        let crx = id_of(&extension).unwrap();
        assert_eq!(Some(crx.clone()), page_host("probe-origin"));
        assert!(is_enabled(&extension));

        // Its pages load from the extension origin.
        let (send, navigated) = mpsc::channel();
        let handler = NavigationCompletedEventHandler::create(Box::new(move |_, args| {
            let mut ok = BOOL::default();
            if let Some(args) = args {
                unsafe { args.IsSuccess(&mut ok) }?;
            }
            let _ = send.send(ok.as_bool());
            Ok(())
        }));
        let mut token = Default::default();
        unsafe { core.add_NavigationCompleted(&handler, &mut token) }.unwrap();
        let url = format!(
            "{}://{crx}/options.html",
            super::super::super::EXTENSION_SCHEME
        );
        unsafe { core.Navigate(&HSTRING::from(url.as_str())) }.unwrap();
        let wait_navigation = || wait_with_pump_ref(&navigated);
        assert!(wait_navigation(), "the options page loads");

        // A new version installs over the old one and keeps its storage.
        let script = |code: &str| -> String {
            let (send, receive) = mpsc::channel();
            let handler = ExecuteScriptCompletedHandler::create(Box::new(move |_, result| {
                let _ = send.send(result);
                Ok(())
            }));
            unsafe { core.ExecuteScript(&HSTRING::from(code), &handler) }.unwrap();
            wait(receive)
        };
        let until = |expected: &str| {
            for _ in 0..100 {
                if script("document.title") == format!("\"{expected}\"") {
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            panic!("the page never showed {expected}");
        };
        script("chrome.storage.local.set({probe: 'kept'}, () => document.title = 'set')");
        until("set");
        let mut next = manifest.clone();
        next["version"] = json!("1.0.1");
        let updated = stage(root.path(), &fixture, &next).unwrap();
        assert_ne!(updated, folder);
        let (send, receive) = mpsc::channel();
        let handler = ProfileAddBrowserExtensionCompletedHandler::create(Box::new(
            move |status, extension| {
                let _ = send.send(status.map(|_| extension.unwrap()));
                Ok(())
            },
        ));
        unsafe { profile.AddBrowserExtension(&HSTRING::from(updated.as_os_str()), &handler) }
            .unwrap();
        let extension = wait(receive).expect("the new version installs");
        assert_eq!(id_of(&extension), Some(crx.clone()));
        // Updating restarts the extension; its pages return within a second or two.
        assert!(is_enabled(&extension));
        let mut opened = false;
        for _ in 0..20 {
            std::thread::sleep(Duration::from_millis(300));
            while navigated.try_recv().is_ok() {}
            unsafe { core.Navigate(&HSTRING::from(url.as_str())) }.unwrap();
            opened = wait_navigation();
            if opened {
                break;
            }
        }
        assert!(opened, "the options page opens again");
        script("chrome.storage.local.get('probe', (v) => document.title = String(v.probe))");
        until("kept");

        // Turning it off keeps it installed; removing uninstalls it.
        let (send, receive) = mpsc::channel();
        let handler = BrowserExtensionEnableCompletedHandler::create(Box::new(move |status| {
            let _ = send.send(status.is_ok());
            Ok(())
        }));
        unsafe { extension.Enable(false, &handler) }.unwrap();
        assert!(wait(receive));
        assert!(!is_enabled(&extension));
        let (send, receive) = mpsc::channel();
        let handler = BrowserExtensionRemoveCompletedHandler::create(Box::new(move |status| {
            let _ = send.send(status.is_ok());
            Ok(())
        }));
        unsafe { extension.Remove(&handler) }.unwrap();
        assert!(wait(receive));
        let (send, receive) = mpsc::channel();
        let handler =
            ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |_, list| {
                let ids: Vec<String> = list
                    .map(|list| extensions(&list).into_iter().map(|(id, _)| id).collect())
                    .unwrap_or_default();
                let _ = send.send(ids);
                Ok(())
            }));
        unsafe { profile.GetBrowserExtensions(&handler) }.unwrap();
        // WebView2's own extensions, such as its PDF viewer, stay.
        assert!(!wait(receive).contains(&crx));
        unsafe { controller.Close() }.unwrap();
    }
}

#[test]
fn staged_extensions_leave_out_mistys_own_folders() {
    // Chromium refuses an extension with a folder named like __misty_sync__ and WebView2
    // reports "Access is denied", so staging must not copy it (or the other __misty_ ones).
    let package = tempfile::tempdir().unwrap();
    let root = tempfile::tempdir().unwrap();
    std::fs::write(package.path().join("manifest.json"), r#"{"manifest_version":3}"#).unwrap();
    std::fs::create_dir(package.path().join("_locales")).unwrap();
    std::fs::create_dir(package.path().join("_metadata")).unwrap();
    std::fs::write(package.path().join("_metadata").join("verified_contents.json"), "{}").unwrap();
    for folder in ["__misty_sync__", "__misty_compat__", "__misty_user_scripts__"] {
        std::fs::create_dir(package.path().join(folder)).unwrap();
        std::fs::write(package.path().join(folder).join("bridge.js"), "//").unwrap();
    }
    std::fs::create_dir(package.path().join("js")).unwrap();
    std::fs::write(package.path().join("js").join("background.js"), "//").unwrap();
    let staged = stage(root.path(), package.path(), &json!({"manifest_version": 3})).unwrap();
    // The store's own reserved folders and the extension's files stay.
    assert!(staged.join("_locales").is_dir() && staged.join("_metadata").is_dir());
    assert!(staged.join("js").join("background.js").is_file());
    for folder in ["__misty_sync__", "__misty_compat__", "__misty_user_scripts__"] {
        assert!(!staged.join(folder).exists(), "{folder} was copied");
    }
}

#[test]
fn a_removed_extensions_pages_stop_being_allowed() {
    use super::super::{allow_origin, drop_origin, installation_host, is_extension_url};
    let host = installation_host("account", "guid-for-the-test");
    assert_eq!(host.len(), 32, "a Chromium extension ID, not the origin uuid");
    let url = url::Url::parse(&format!("chrome-extension://{host}/popup.html")).unwrap();
    assert!(!is_extension_url(&url));
    allow_origin("space-for-the-test", host.clone());
    assert!(is_extension_url(&url));
    // Dropping uses the same key, so removing the extension closes its pages to the browser.
    drop_origin("space-for-the-test", &installation_host("account", "guid-for-the-test"));
    assert!(!is_extension_url(&url));
}
