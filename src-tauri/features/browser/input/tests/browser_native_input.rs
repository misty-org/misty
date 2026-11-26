#[cfg(target_os = "macos")]
#[path = "browser_native_input_macos.rs"]
mod macos;

#[cfg(target_os = "macos")]
fn main() {
    macos::main();
}

#[cfg(not(target_os = "macos"))]
fn main() {}
