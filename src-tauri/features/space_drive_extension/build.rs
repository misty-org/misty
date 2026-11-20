//! An app extension has no `main`: Foundation's `NSExtensionMain` is its entry point, and the
//! binary is linked as extension-safe. Scoped to this binary, so build scripts of dependencies
//! (which `RUSTFLAGS` would also reach) still link normally.
fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg-bin=misty-drive-ext=-Wl,-e,_NSExtensionMain");
        println!("cargo:rustc-link-arg-bin=misty-drive-ext=-Wl,-application_extension");
    }
}
