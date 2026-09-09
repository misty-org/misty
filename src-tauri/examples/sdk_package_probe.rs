#[cfg(all(debug_assertions, target_os = "macos"))]
fn main() {
    misty_native::sdk_package_probe::run(tauri::generate_context!());
}

#[cfg(not(all(debug_assertions, target_os = "macos")))]
fn main() {
    panic!("The SDK package probe requires a macOS debug build.");
}
