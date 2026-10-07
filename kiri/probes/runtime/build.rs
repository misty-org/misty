// Tauri needs an app icon (and an .ico on Windows) to build. The repo ignores
// image files, so the probe writes its 32x32 gray placeholder here.
const ICON_PNG: &[u8] = &[137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 32, 0, 0, 0, 32, 8, 6, 0, 0, 0, 115, 122, 122, 244, 0, 0, 0, 45, 73, 68, 65, 84, 120, 156, 237, 206, 33, 1, 0, 0, 12, 2, 48, 162, 209, 191, 212, 31, 3, 51, 49, 191, 180, 189, 165, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 172, 3, 15, 162, 178, 252, 91, 56, 249, 5, 64, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];

fn main() {
    std::fs::create_dir_all("icons").expect("icons directory");
    std::fs::write("icons/icon.png", ICON_PNG).expect("icon.png");
    // An .ico holding the same PNG image.
    let mut ico = vec![0, 0, 1, 0, 1, 0, 32, 32, 0, 0, 1, 0, 32, 0];
    ico.extend((ICON_PNG.len() as u32).to_le_bytes());
    ico.extend(22u32.to_le_bytes());
    ico.extend_from_slice(ICON_PNG);
    std::fs::write("icons/icon.ico", ico).expect("icon.ico");
    tauri_build::build()
}
