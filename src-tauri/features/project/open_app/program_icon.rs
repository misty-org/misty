// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! A program's own icon as a small PNG data URL, for the "Open in" menu.
//!
//! macOS asks the workspace for the icon of the app bundle; Windows asks the shell for the
//! icon associated with the executable, in this process rather than through a hidden
//! PowerShell (which security software reads as screen-capture tooling). Elsewhere there is
//! none and the menu shows the app's first letter.

use std::path::Path;

/// The edge the icon is scaled to: sharp at the menu's 16 px on a 2x screen, and small.
const ICON_EDGE: u32 = 64;

/// Largest icon edge accepted from the Windows shell (guards the pixel buffer size).
#[cfg_attr(not(windows), allow(dead_code))]
const MAX_ICON_EDGE: u32 = 256;

pub(super) fn icon_data_url(path: &Path) -> Option<String> {
    use base64::Engine as _;
    let png = program_icon_png(path)?;
    let png = shrink(&png).unwrap_or(png);
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    ))
}

/// Scales a PNG down to `ICON_EDGE`, so a 1024 px app icon doesn't cross into the window.
fn shrink(png: &[u8]) -> Option<Vec<u8>> {
    let image = image::load_from_memory_with_format(png, image::ImageFormat::Png).ok()?;
    if image.width() <= ICON_EDGE && image.height() <= ICON_EDGE {
        return None;
    }
    let small = image.resize(ICON_EDGE, ICON_EDGE, image::imageops::FilterType::Lanczos3);
    let mut out = std::io::Cursor::new(Vec::new());
    small.write_to(&mut out, image::ImageFormat::Png).ok()?;
    Some(out.into_inner())
}

/// Top-down 32bpp BGRA rows to RGBA. Icons without an alpha channel (every alpha byte 0) take
/// transparency from the AND mask read as 32bpp: a set (white) mask pixel is transparent.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn bgra_to_rgba(color: &[u8], mask: Option<&[u8]>) -> Vec<u8> {
    let has_alpha = color.chunks_exact(4).any(|pixel| pixel[3] != 0);
    color
        .chunks_exact(4)
        .enumerate()
        .flat_map(|(index, pixel)| {
            let alpha = if has_alpha {
                pixel[3]
            } else {
                match mask.and_then(|mask| mask.get(index * 4)) {
                    Some(&bit) if bit != 0 => 0,
                    _ => 255,
                }
            };
            [pixel[2], pixel[1], pixel[0], alpha]
        })
        .collect()
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn encode_png(width: u32, height: u32, rgba: Vec<u8>) -> Option<Vec<u8>> {
    let image = image::RgbaImage::from_raw(width, height, rgba)?;
    let mut out = std::io::Cursor::new(Vec::new());
    image.write_to(&mut out, image::ImageFormat::Png).ok()?;
    Some(out.into_inner())
}

/// The bundle's icon at its largest size up to 512 px, as PNG.
#[cfg(target_os = "macos")]
fn program_icon_png(path: &Path) -> Option<Vec<u8>> {
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSWorkspace};
    use objc2_foundation::{NSDictionary, NSString};

    let image =
        NSWorkspace::sharedWorkspace().iconForFile(&NSString::from_str(&path.to_string_lossy()));
    let tiff = image.TIFFRepresentation()?;
    let reps = NSBitmapImageRep::imageRepsWithData(&tiff);
    let best = reps
        .iter()
        .filter_map(|rep| rep.downcast::<NSBitmapImageRep>().ok())
        .filter(|rep| rep.pixelsWide() <= 512)
        .max_by_key(|rep| rep.pixelsWide())?;
    let properties = NSDictionary::<NSString, AnyObject>::new();
    // SAFETY: the properties dictionary is empty, so its value type can't be wrong.
    let png = unsafe {
        best.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)
    }?;
    Some(png.to_vec())
}

/// The shell's associated (large) icon for `path` as PNG bytes.
#[cfg(windows)]
fn program_icon_png(path: &Path) -> Option<Vec<u8>> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED,
    };
    use windows_sys::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
    use windows_sys::Win32::UI::WindowsAndMessaging::DestroyIcon;

    if !file_access::fs::is_file(path) {
        return None;
    }
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: SHFILEINFOW is plain data; all-zero is its empty value.
    let mut info: SHFILEINFOW = unsafe { std::mem::zeroed() };
    // SHGetFileInfo needs COM on this (blocking-pool) thread. S_FALSE (already initialized)
    // still needs its CoUninitialize; RPC_E_CHANGED_MODE (a negative HRESULT) must not get one.
    let com = unsafe { CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32) };
    // SAFETY: `wide` is NUL-terminated and `info` is the size passed.
    let found = unsafe {
        SHGetFileInfoW(
            wide.as_ptr(),
            0,
            &mut info,
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };
    if com >= 0 {
        unsafe { CoUninitialize() };
    }
    if found == 0 || info.hIcon.is_null() {
        return None;
    }
    let png = icon_to_png(info.hIcon);
    // SAFETY: the shell handed this icon to us to free.
    unsafe { DestroyIcon(info.hIcon) };
    png
}

#[cfg(windows)]
fn icon_to_png(icon: windows_sys::Win32::UI::WindowsAndMessaging::HICON) -> Option<Vec<u8>> {
    use windows_sys::Win32::Graphics::Gdi::{CreateCompatibleDC, DeleteDC, DeleteObject};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetIconInfo, ICONINFO};

    // SAFETY: ICONINFO is plain data; GetIconInfo fills it.
    let mut info: ICONINFO = unsafe { std::mem::zeroed() };
    if unsafe { GetIconInfo(icon, &mut info) } == 0 {
        return None;
    }
    // GetIconInfo hands back bitmap copies the caller owns: free them on every path. A
    // monochrome icon (no color bitmap) gives none, and the menu shows a letter.
    let dc = unsafe { CreateCompatibleDC(std::ptr::null_mut()) };
    let png = if dc.is_null() || info.hbmColor.is_null() {
        None
    } else {
        dib_bgra(dc, info.hbmColor).and_then(|(width, height, color)| {
            let mask = (!info.hbmMask.is_null())
                .then(|| dib_bgra(dc, info.hbmMask))
                .flatten()
                .filter(|(w, h, _)| (*w, *h) == (width, height))
                .map(|(_, _, mask)| mask);
            encode_png(width, height, bgra_to_rgba(&color, mask.as_deref()))
        })
    };
    unsafe {
        if !dc.is_null() {
            DeleteDC(dc);
        }
        if !info.hbmColor.is_null() {
            DeleteObject(info.hbmColor);
        }
        if !info.hbmMask.is_null() {
            DeleteObject(info.hbmMask);
        }
    }
    png
}

/// A bitmap as top-down 32bpp BGRA rows.
#[cfg(windows)]
fn dib_bgra(
    dc: windows_sys::Win32::Graphics::Gdi::HDC,
    bitmap: windows_sys::Win32::Graphics::Gdi::HBITMAP,
) -> Option<(u32, u32, Vec<u8>)> {
    use windows_sys::Win32::Graphics::Gdi::{
        GetDIBits, GetObjectW, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };

    // SAFETY: BITMAP is plain data; GetObjectW fills at most its size.
    let mut header: BITMAP = unsafe { std::mem::zeroed() };
    let read = unsafe {
        GetObjectW(
            bitmap,
            std::mem::size_of::<BITMAP>() as i32,
            (&mut header as *mut BITMAP).cast(),
        )
    };
    if read == 0 || header.bmWidth <= 0 || header.bmHeight <= 0 {
        return None;
    }
    let (width, height) = (header.bmWidth as u32, header.bmHeight as u32);
    if width > MAX_ICON_EDGE || height > MAX_ICON_EDGE {
        return None;
    }
    // SAFETY: BITMAPINFO is plain data; the header fields that matter are set below.
    let mut info: BITMAPINFO = unsafe { std::mem::zeroed() };
    info.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: width as i32,
        // A negative height asks for top-down rows, the order RgbaImage expects.
        biHeight: -(height as i32),
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB,
        biSizeImage: 0,
        biXPelsPerMeter: 0,
        biYPelsPerMeter: 0,
        biClrUsed: 0,
        biClrImportant: 0,
    };
    let mut pixels = vec![0u8; (width * height * 4) as usize];
    let lines = unsafe {
        GetDIBits(
            dc,
            bitmap,
            0,
            height,
            pixels.as_mut_ptr().cast(),
            &mut info,
            DIB_RGB_COLORS,
        )
    };
    (lines == height as i32).then_some((width, height, pixels))
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn program_icon_png(_path: &Path) -> Option<Vec<u8>> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alpha_icons_keep_their_alpha_and_swap_channels() {
        let bgra = [10, 20, 30, 255, 1, 2, 3, 0];
        // A mask must not override a real alpha channel.
        let mask = [255, 255, 255, 0, 255, 255, 255, 0];
        assert_eq!(
            bgra_to_rgba(&bgra, Some(&mask)),
            vec![30, 20, 10, 255, 3, 2, 1, 0]
        );
    }

    #[test]
    fn alphaless_icons_take_transparency_from_the_mask() {
        let bgra = [10, 20, 30, 0, 1, 2, 3, 0];
        let mask = [0, 0, 0, 0, 255, 255, 255, 0];
        assert_eq!(
            bgra_to_rgba(&bgra, Some(&mask)),
            vec![30, 20, 10, 255, 3, 2, 1, 0]
        );
    }

    #[test]
    fn alphaless_icons_without_a_mask_are_opaque() {
        assert_eq!(bgra_to_rgba(&[10, 20, 30, 0], None), vec![30, 20, 10, 255]);
    }

    #[test]
    fn encodes_a_png_and_rejects_a_short_buffer() {
        let png = encode_png(1, 1, vec![1, 2, 3, 4]).expect("png");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        assert!(encode_png(2, 2, vec![0; 4]).is_none());
    }

    #[test]
    fn large_icons_are_scaled_down() {
        let big = encode_png(200, 100, vec![255; 200 * 100 * 4]).unwrap();
        let small = shrink(&big).expect("scaled");
        let image = image::load_from_memory(&small).unwrap();
        assert_eq!((image.width(), image.height()), (64, 32));
        let tiny = encode_png(16, 16, vec![255; 16 * 16 * 4]).unwrap();
        assert!(shrink(&tiny).is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn finder_has_an_icon() {
        let url = icon_data_url(Path::new("/System/Library/CoreServices/Finder.app"));
        assert!(url.is_some_and(|url| url.starts_with("data:image/png;base64,")));
    }
}
