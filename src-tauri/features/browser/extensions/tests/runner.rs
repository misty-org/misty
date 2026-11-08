// SPDX-License-Identifier: MIT
//! Runs the probes in order against fixture copies and a local web server, as separate
//! processes, and fails on the first probe that does.
// Tests build fixtures with the standard library, as clippy.toml allows.
#![allow(clippy::disallowed_methods)]
use super::fixtures::{
    add_compat_layer, add_sync_bridge, copy_dir, fixture, fixtures, serve, tauri,
};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

fn uuid() -> String {
    objc2_foundation::NSUUID::new().UUIDString().to_string()
}

/// One probe in its own process, with a time limit.
fn probe(executable: &Path, arguments: &[&str], environment: &[(&str, &str)]) {
    let mut command = Command::new(executable);
    command.arg("--probe").args(arguments).stdin(Stdio::null());
    for (key, value) in environment {
        command.env(key, value);
    }
    let mut child = command.spawn().expect("start the probe");
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().expect("wait for the probe") {
            break status;
        }
        if started.elapsed() > Duration::from_secs(300) {
            let _ = child.kill();
            panic!("probe {} timed out", arguments[0]);
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    assert!(status.success(), "probe {} failed: {status}", arguments[0]);
}

fn text(path: &Path) -> &str {
    path.to_str().expect("utf-8 path")
}

pub fn run(args: &[String]) {
    if !args
        .iter()
        .any(|arg| arg == "--ignored" || arg == "--include-ignored")
    {
        println!(
            "SKIP: pass --ignored to run the native extension tests (they need macOS 15.4+ and a desktop session)"
        );
        return;
    }
    let executable = std::env::current_exe().expect("test executable");
    let root = std::env::temp_dir().join(format!("misty-extension-tests-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("create temporary folder");
    let page = serve(fixtures().join("mv3"));
    let page = page.as_str();
    let mut mv3 = PathBuf::new();
    for version in [2, 3] {
        let folder = fixture(&root, &format!("mv{version}"));
        probe(&executable, &["probe", text(&folder)], &[]);
        add_sync_bridge(&folder);
        probe(&executable, &["host", text(&folder), page], &[]);
        probe(&executable, &["lifecycle", text(&folder), page], &[]);
        mv3 = folder;
    }
    // The fixture's manifest and page already reference the layer, as compat::apply writes
    // them; the runner installs the real assets.
    let compat = fixture(&root, "compat");
    add_compat_layer(&compat);
    probe(&executable, &["compat", text(&compat), page], &[]);
    // An extension asking for far more than it's granted, trying to use all of it.
    let permissions = fixture(&root, "permissions");
    add_compat_layer(&permissions);
    probe(&executable, &["permissions", text(&permissions), page], &[]);
    // Two Spaces' controllers at once: storage stays in its Space, survives a restart (a
    // second process) and goes with the Space.
    let identities: Vec<String> = (0..4).map(|_| uuid()).collect();
    let space = fixtures().join("space");
    for mode in ["write", "verify", "cleanup"] {
        let mut arguments = vec!["spaces", text(&space), page, mode];
        arguments.extend(identities.iter().map(String::as_str));
        probe(&executable, &arguments, &[]);
    }
    if args.iter().any(|arg| arg == "--notifications") {
        notifications(&executable, &compat);
    }
    for count in ["0", "1", "3"] {
        probe(&executable, &["benchmark", text(&mv3), count], &[]);
    }
    messaging(&executable);
    let _ = fs::remove_dir_all(&root);
    println!("PASS: every native extension probe");
}

/// A native messaging manifest in the system's own folder (as Firefox reads it) for a
/// temporary companion: this test binary.
fn messaging(executable: &Path) {
    let name = format!("com.misty.test_{}", uuid().replace('-', "").to_lowercase());
    let manifests = PathBuf::from(std::env::var("HOME").expect("HOME"))
        .join("Library/Application Support/Mozilla/NativeMessagingHosts");
    fs::create_dir_all(&manifests).expect("create the manifest folder");
    let manifest = manifests.join(format!("{name}.json"));
    let body = serde_json::json!({
        "name": name, "description": "Temporary Misty test host", "type": "stdio",
        "path": text(executable), "allowed_extensions": ["native-fixture@misty.test"],
    });
    fs::write(&manifest, body.to_string()).expect("write the manifest");
    let outcome = std::panic::catch_unwind(|| {
        probe(
            executable,
            &["messaging", &name],
            &[("MISTY_NATIVE_FIXTURE_HOST", "1")],
        )
    });
    let _ = fs::remove_file(&manifest);
    if let Err(failure) = outcome {
        std::panic::resume_unwind(failure);
    }
}

/// UserNotifications serves only registered app bundles outside temporary folders. A stable
/// path, bundle identifier and signing identity keep the permission granted on the first run.
fn notifications(executable: &Path, fixture: &Path) {
    let identity = std::env::var("MISTY_DEV_SIGNING_IDENTITY")
        .ok()
        .unwrap_or_else(|| {
            let listing = Command::new("security")
                .args(["find-identity", "-v", "-p", "codesigning"])
                .output()
                .expect("security");
            let listing = String::from_utf8_lossy(&listing.stdout).into_owned();
            let names: Vec<&str> = listing
                .split('"')
                .skip(1)
                .step_by(2)
                .filter(|name| {
                    name.starts_with("Apple Development: ") || name.starts_with("Mac Developer: ")
                })
                .collect();
            assert!(
            names.len() == 1,
            "--notifications needs one Apple Development identity, or MISTY_DEV_SIGNING_IDENTITY."
        );
            names[0].to_owned()
        });
    let bundle = tauri().join("target/notification-probe/MistyNotificationProbe.app");
    let _ = fs::remove_dir_all(&bundle);
    fs::create_dir_all(bundle.join("Contents/MacOS")).expect("create the bundle");
    fs::write(
        bundle.join("Contents/Info.plist"),
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><plist version=\"1.0\"><dict>\
         <key>CFBundleIdentifier</key><string>com.misty.test.notification-probe</string>\
         <key>CFBundleName</key><string>Misty Notification Probe</string>\
         <key>CFBundleExecutable</key><string>notification-probe</string>\
         <key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>",
    )
    .expect("write Info.plist");
    fs::copy(executable, bundle.join("Contents/MacOS/notification-probe")).expect("copy the probe");
    let signed = Command::new("codesign")
        .args(["--force", "--sign", &identity, "--timestamp=none"])
        .arg(&bundle)
        .status()
        .expect("codesign");
    assert!(signed.success(), "codesign failed");
    let output = std::env::temp_dir().join("notification-probe.log");
    println!("Notification probe: allow Misty Notification Probe in System Settings > Notifications if asked.");
    let opened = Command::new("open")
        .args(["-W", "-n", "--stdout"])
        .arg(&output)
        .arg("--stderr")
        .arg(&output)
        .arg(&bundle)
        .args(["--args", "--probe", "notifications"])
        .arg(fixture)
        .status()
        .expect("open");
    let log = fs::read_to_string(&output).unwrap_or_default();
    print!("{log}");
    assert!(
        opened.success() && log.contains("PASS:"),
        "Notification probe failed"
    );
    let _ = copy_dir;
}
