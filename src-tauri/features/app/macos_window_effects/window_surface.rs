//! The window's own surface, behind its page.
//!
//! While a window is resized the page trails the window by a frame or two (WebKit draws it in its
//! own process and AppKit doesn't wait), and the grown edge shows whatever is behind the page. The
//! page's view draws no background (it is transparent so native browser pages can sit beneath
//! it), so that is the window's content view. Painted in the page's own color, the strip reads as
//! the page instead of a gray band.

use tauri::{window::Color, Runtime, Webview};

/// "#rrggbb" as its three channels.
fn parse_hex(color: &str) -> Option<(u8, u8, u8)> {
    let hex = color.strip_prefix('#')?;
    if hex.len() != 6 || !hex.is_ascii() {
        return None;
    }
    let channel = |at: usize| u8::from_str_radix(&hex[at..at + 2], 16).ok();
    Some((channel(0)?, channel(2)?, channel(4)?))
}

/// Paints the window behind its page in `color`, the page's background ("#rrggbb"). The app
/// sends it once its theme is applied and again whenever the theme changes.
#[tauri::command]
pub fn set_window_surface<R: Runtime>(window: Webview<R>, color: String) -> Result<(), String> {
    let (red, green, blue) = parse_hex(&color).ok_or_else(|| format!("Not a color: {color}"))?;
    window
        .window()
        .set_background_color(Some(Color(red, green, blue, 255)))
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    window
        .with_webview(move |webview| unsafe {
            paint_content_view(webview.ns_window().cast(), red, green, blue);
        })
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// The content view holds the page's view and grows with the window in the same commit, so its
/// layer fills the grown edge before the page has drawn there. Native browser pages are its
/// subviews and draw above it.
#[cfg(target_os = "macos")]
unsafe fn paint_content_view(ns_window: *mut objc2_app_kit::NSWindow, red: u8, green: u8, blue: u8) {
    use objc2::rc::Retained;
    use objc2_core_graphics::CGColor;
    use objc2_quartz_core::CALayer;

    let Some(window) = ns_window.as_ref() else {
        return;
    };
    let Some(content) = window.contentView() else {
        return;
    };
    content.setWantsLayer(true);
    let layer: Option<Retained<CALayer>> = objc2::msg_send![&*content, layer];
    if let Some(layer) = layer {
        let color = CGColor::new_srgb(
            f64::from(red) / 255.0,
            f64::from(green) / 255.0,
            f64::from(blue) / 255.0,
            1.0,
        );
        layer.setBackgroundColor(Some(&color));
    }
}

#[cfg(test)]
mod tests {
    use super::parse_hex;

    #[test]
    fn reads_six_digit_hex() {
        assert_eq!(parse_hex("#131313"), Some((0x13, 0x13, 0x13)));
        assert_eq!(parse_hex("#F6F6F6"), Some((0xf6, 0xf6, 0xf6)));
        assert_eq!(parse_hex("131313"), None);
        assert_eq!(parse_hex("#13131"), None);
        assert_eq!(parse_hex("#zzzzzz"), None);
    }
}
