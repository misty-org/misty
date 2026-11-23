use tauri::{window::Color, Runtime, Webview};

fn parse_hex(color: &str) -> Option<(u8, u8, u8)> {
    let hex = color.strip_prefix('#')?;
    if hex.len() != 6 || !hex.is_ascii() {
        return None;
    }
    let channel = |at: usize| u8::from_str_radix(&hex[at..at + 2], 16).ok();
    Some((channel(0)?, channel(2)?, channel(4)?))
}

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

#[cfg(target_os = "macos")]
unsafe fn paint_content_view(
    ns_window: *mut objc2_app_kit::NSWindow,
    red: u8,
    green: u8,
    blue: u8,
) {
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
