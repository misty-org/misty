use tauri::{AppHandle, Wry};

#[derive(Clone, Copy)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) enum Glyph {
    Symbol(&'static str),
    Named(&'static str),
}

#[cfg(target_os = "macos")]
pub(super) fn set_glyphs(_app: &AppHandle<Wry>, glyphs: Vec<Option<Glyph>>) {
    if let Ok(mut current) = macos::GLYPHS.lock() {
        *current = glyphs;
    }
    macos::install();
}

#[cfg(not(target_os = "macos"))]
pub(super) fn set_glyphs(_app: &AppHandle<Wry>, _glyphs: Vec<Option<Glyph>>) {}

#[cfg(target_os = "macos")]
mod macos {
    use std::sync::{Mutex, OnceLock};

    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2_app_kit::{NSImage, NSMenu};
    use objc2_foundation::NSString;

    use super::Glyph;

    pub(super) static GLYPHS: Mutex<Vec<Option<Glyph>>> = Mutex::new(Vec::new());
    static SET_MENU: OnceLock<usize> = OnceLock::new();

    type SetMenu = unsafe extern "C-unwind" fn(&AnyObject, Sel, *mut NSMenu);

    pub(super) fn install() {
        if SET_MENU.get().is_some() {
            return;
        }
        let Some(class) = AnyClass::get(c"NSStatusItem") else {
            return;
        };
        let selector = objc2::sel!(setMenu:);
        let methods = class.instance_methods();
        let Some(method) = methods.iter().find(|method| method.name() == selector) else {
            return;
        };
        if SET_MENU.set(method.implementation() as usize).is_err() {
            return;
        }
        let replacement: SetMenu = set_menu;
        unsafe {
            let _ = method.set_implementation(std::mem::transmute::<SetMenu, Imp>(replacement));
        }
    }

    fn apply(menu: &NSMenu) {
        let Ok(glyphs) = GLYPHS.lock() else {
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
    }

    unsafe extern "C-unwind" fn set_menu(item: &AnyObject, command: Sel, menu: *mut NSMenu) {
        if let Some(menu) = menu.as_ref() {
            apply(menu);
        }
        let Some(original) = SET_MENU.get().copied() else {
            return;
        };
        let call = std::mem::transmute::<usize, SetMenu>(original);
        call(item, command, menu);
    }
}
