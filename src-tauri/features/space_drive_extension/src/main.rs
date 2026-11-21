//! Misty's File Provider extension (`MistyDrive.appex`): the account's drive as one File Provider
//! domain, one place in Finder under Locations, with a folder in it for each Space the person
//! belongs to, each linked from `~/.misty/mnt/<Space>`.
//!
//! The extension holds no sign-in and no state of its own. Every call macOS makes into it is relayed
//! to Misty over a socket in the app group (`link`), where the `space_drive` core answers from
//! `drive.db` and the server. While Misty isn't running, calls answer "server unreachable": macOS
//! keeps local edits pending and retries, and files already on the Mac keep working.
//!
//! There is no `main`. `build.rs` links Foundation's `NSExtensionMain` as the entry point, which looks
//! up `NSExtensionPrincipalClass` (`MistyDriveExtension`) by name, so the classes are registered from
//! a constructor that runs as the binary loads, before `NSExtensionMain` does.
#![no_main]
#![cfg(target_os = "macos")]

mod enumerator;
mod extension;
mod group;
mod item;
mod link;
mod send;

/// Registers the Objective-C classes before `NSExtensionMain` looks the principal class up.
/// `define_class!` registers a class lazily, on its first `class()` call, so this makes that call.
extern "C" fn register_classes() {
    use objc2::ClassType;
    let _ = extension::MistyDriveExtension::class();
    let _ = enumerator::DriveEnumerator::class();
    let _ = item::DriveItem::class();
}

/// dyld runs every function in `__mod_init_func` as the binary loads.
#[used]
#[link_section = "__DATA,__mod_init_func"]
static REGISTER_CLASSES: extern "C" fn() = register_classes;
