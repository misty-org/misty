fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg-bin=misty-drive-ext=-Wl,-e,_NSExtensionMain");
        println!("cargo:rustc-link-arg-bin=misty-drive-ext=-Wl,-application_extension");
    }
}
