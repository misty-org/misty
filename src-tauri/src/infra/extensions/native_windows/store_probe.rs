//! Loads real Chrome Web Store extensions into a real WebView2 profile through
//! Misty's own steps: download and verify, unpack, grant what the install review
//! would, stage with Misty's manifest key, then `AddBrowserExtension`. It prints
//! what WebView2 said for each. Run with
//! `cargo test --lib webview2_loads_real_store_extensions -- --ignored --nocapture`.
use super::{package::*, profile::*, *};
use std::{sync::mpsc, time::Duration};
use webview2_com::{
    wait_with_pump, CoreWebView2EnvironmentOptions, CreateCoreWebView2ControllerCompletedHandler,
    CreateCoreWebView2EnvironmentCompletedHandler,
    Microsoft::Web::WebView2::Win32::{
        CreateCoreWebView2EnvironmentWithOptions, ICoreWebView2EnvironmentOptions,
    },
    NavigationCompletedEventHandler, ProfileAddBrowserExtensionCompletedHandler,
};
use windows::{
    core::{BOOL, HSTRING, PCWSTR},
    Win32::{
        Foundation::HWND,
        System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED},
    },
};

const STORE: [(&str, &str); 4] = [
    ("ddkjiahejlhfcafbddmgiahcphecmpfh", "uBlock Origin Lite"),
    ("nngceckbapebfimnlniiiahkandclblb", "Bitwarden"),
    ("aeblfdkhhhdcdjpifhhbdiojplfjncoa", "1Password"),
    ("eimadpbcbfnmbkopoojfekhnkhdbieeh", "Dark Reader"),
];

#[test]
#[ignore = "Downloads store packages and starts WebView2; run explicitly"]
fn webview2_loads_real_store_extensions() {
    std::thread::spawn(run).join().unwrap();
}

fn wait<T>(receive: mpsc::Receiver<T>) -> T {
    wait_with_pump(receive).expect("WebView2 answered")
}

fn pump() {
    use windows::Win32::UI::WindowsAndMessaging::{DispatchMessageW, PeekMessageW, MSG, PM_REMOVE};
    let mut message = MSG::default();
    while unsafe { PeekMessageW(&mut message, None, 0, 0, PM_REMOVE) }.as_bool() {
        unsafe { DispatchMessageW(&message) };
    }
}

fn run() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let root = tempfile::tempdir().unwrap();
    // (name, staged folder, origin, popup page)
    let mut staged = Vec::new();
    for (key, name) in STORE {
        let outcome = runtime.block_on(async {
            let detail = super::super::catalog::latest(key).await?;
            let bytes = super::super::catalog::bytes(&detail.download_url, 64 << 20).await?;
            let unpacked = root.path().join(format!("pkg-{key}"));
            let review =
                super::super::package::extract(&bytes, detail, &unpacked, "probe".into())?;
            let runtime_dir = unpacked.join("runtime");
            let original = read_manifest(&runtime_dir)?;
            let origin = format!("probe-origin-{key}");
            let manifest = granted_manifest(&original, &origin, &review.permissions, &review.hosts);
            let folder = stage(
                &root.path().join(format!("stage-{key}")),
                &runtime_dir,
                &manifest,
            )?;
            let popup = action_of(&manifest)["default_popup"]
                .as_str()
                .map(str::to_owned);
            Ok::<_, String>((folder, origin, popup, validate(&runtime_dir)?))
        });
        match outcome {
            Ok((folder, origin, popup, review)) => {
                println!("{name}: staged; Misty's Windows review: {review}");
                staged.push((name, folder, origin, popup));
            }
            Err(error) => println!("{name}: FAILED before WebView2: {error}"),
        }
    }

    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.unwrap();
    let data = tempfile::tempdir().unwrap();
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

    let mut failures = Vec::new();
    for (name, folder, origin, popup) in &staged {
        let (send, receive) = mpsc::channel();
        let handler = ProfileAddBrowserExtensionCompletedHandler::create(Box::new(
            move |status, extension| {
                let _ = send.send(status.map(|_| extension.unwrap()));
                Ok(())
            },
        ));
        unsafe { profile.AddBrowserExtension(&HSTRING::from(folder.as_os_str()), &handler) }
            .unwrap();
        match wait(receive) {
            Err(error) => {
                println!("{name}: WebView2 REFUSED it: {error:?}");
                failures.push(format!("{name}: AddBrowserExtension {error:?}"));
            }
            Ok(extension) => {
                let id = id_of(&extension).unwrap_or_default();
                println!(
                    "{name}: WebView2 accepted it as {id}; enabled={}; Misty expects {:?}",
                    is_enabled(&extension),
                    page_host(origin)
                );
                if Some(id.clone()) != page_host(origin) {
                    failures.push(format!("{name}: the ID is not the one Misty derives"));
                }
                if let Some(popup) = popup {
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
                        "{}://{id}/{}",
                        super::super::EXTENSION_SCHEME,
                        popup.trim_start_matches('/')
                    );
                    unsafe { core.Navigate(&HSTRING::from(url.as_str())) }.unwrap();
                    let opened = (0..200).find_map(|_| {
                        std::thread::sleep(Duration::from_millis(25));
                        pump();
                        navigated.try_recv().ok()
                    });
                    println!("{name}: popup {url} loaded: {opened:?}");
                    if opened != Some(true) {
                        failures.push(format!("{name}: popup did not load"));
                    }
                }
            }
        }
    }
    unsafe { controller.Close() }.unwrap();
    assert!(failures.is_empty(), "WebView2 problems: {failures:#?}");
}
