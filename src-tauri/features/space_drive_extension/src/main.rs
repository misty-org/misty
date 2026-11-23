#![no_main]
#![cfg(target_os = "macos")]

mod enumerator;
mod extension;
mod group;
mod item;
mod link;
mod send;

extern "C" fn register_classes() {
    use objc2::ClassType;
    let _ = extension::MistyDriveExtension::class();
    let _ = enumerator::DriveEnumerator::class();
    let _ = item::DriveItem::class();
}

#[used]
#[link_section = "__DATA,__mod_init_func"]
static REGISTER_CLASSES: extern "C" fn() = register_classes;
