//! The glyphs before the menu bar menu's items: SF Symbols and AppKit's named images on macOS,
//! nothing elsewhere.

use tauri::{AppHandle, Wry};

/// The small image before a menu item, on macOS: an SF Symbol by name, drawn as a template so
/// it follows light and dark mode and the highlighted row, or one of AppKit's named images (the
/// colored status dots). Both ship with macOS; nothing is bundled.
#[derive(Clone, Copy)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) enum Glyph {
    Symbol(&'static str),
    Named(&'static str),
}

/// Gives the menu's items their glyphs. The menu crate can't set an SF Symbol, so this sets each
/// item's image on the native menu the icon opens (handed out by the vendored `tray-icon`).
#[cfg(target_os = "macos")]
pub(super) fn set_glyphs(app: &AppHandle<Wry>, glyphs: Vec<Option<Glyph>>) {
    use objc2_app_kit::NSImage;
    use objc2_foundation::NSString;

    let Some(tray) = app.tray_by_id(super::TRAY_ID) else {
        return;
    };
    let _ = tray.with_inner_tray_icon(move |inner| {
        let Some(menu) = inner.ns_menu() else {
            return;
        };
        for (index, glyph) in glyphs.iter().enumerate() {
            let Some(glyph) = glyph else {
                continue;
            };
            let Some(item) = menu.itemAtIndex(index as isize) else {
                continue;
            };
            let image = match glyph {
                Glyph::Symbol(name) => NSImage::imageWithSystemSymbolName_accessibilityDescription(
                    &NSString::from_str(name),
                    None,
                ),
                Glyph::Named(name) => NSImage::imageNamed(&NSString::from_str(name)),
            };
            if let Some(image) = image {
                item.setImage(Some(&image));
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub(super) fn set_glyphs(_app: &AppHandle<Wry>, _glyphs: Vec<Option<Glyph>>) {}
