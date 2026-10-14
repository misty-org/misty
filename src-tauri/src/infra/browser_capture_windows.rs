//! Page captures on WebView2. Chromium renders them, so cross-origin frames,
//! video and canvas look exactly as they do on screen.
use serde_json::{json, Value};
use tauri::Webview;

use super::webview2::{self, CdpError};

/// A rectangle in CSS pixels, relative to the page's visible viewport.
#[derive(Clone, Copy)]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// What a capture is for: its encoding and its largest side in pixels.
#[derive(Clone, Copy)]
pub enum Purpose {
    /// Tab previews and agent screenshots: lossless, up to 2560 pixels.
    Page,
    /// A selected area attached to a message: JPEG, up to 1280 pixels.
    Region,
}

impl Purpose {
    fn max_side(self) -> f64 {
        match self {
            Self::Page => 2560.0,
            Self::Region => 1280.0,
        }
    }
}

/// The visible page, as `{ dataUrl, width, height }`.
pub async fn capture(webview: Webview) -> Result<Value, String> {
    screenshot(&webview, None, Purpose::Page).await
}

/// One area of the visible page, as `{ dataUrl, width, height }`.
pub async fn capture_region(webview: Webview, region: Region) -> Result<Value, String> {
    if !(region.width.is_finite() && region.height.is_finite())
        || region.width < 1.0
        || region.height < 1.0
    {
        return Err("Capture region is invalid.".to_owned());
    }
    screenshot(&webview, Some(region), Purpose::Region).await
}

async fn screenshot(
    view: &Webview,
    region: Option<Region>,
    purpose: Purpose,
) -> Result<Value, String> {
    let metrics = webview2::cdp(view, "Page.getLayoutMetrics", &json!({})).await?;
    let css = &metrics["cssVisualViewport"];
    let number = |value: &Value| value.as_f64().filter(|value| value.is_finite());
    let (page_x, page_y) = (
        number(&css["pageX"]).unwrap_or(0.0),
        number(&css["pageY"]).unwrap_or(0.0),
    );
    let viewport_width = number(&css["clientWidth"]).ok_or(CdpError::Invalid)?;
    let viewport_height = number(&css["clientHeight"]).ok_or(CdpError::Invalid)?;
    let device_ratio = number(&metrics["visualViewport"]["clientWidth"])
        .map(|device| device / viewport_width.max(1.0))
        .filter(|ratio| *ratio > 0.0)
        .unwrap_or(1.0);
    let area = region.unwrap_or(Region {
        x: 0.0,
        y: 0.0,
        width: viewport_width,
        height: viewport_height,
    });
    // Never upscale; keep the longest side within the purpose's limit.
    let scale = (purpose.max_side() / (area.width.max(area.height) * device_ratio)).min(1.0);
    let format = match purpose {
        Purpose::Page => json!({ "format": "png" }),
        Purpose::Region => json!({ "format": "jpeg", "quality": 82 }),
    };
    let mut parameters = json!({
        "clip": {
            "x": page_x + area.x,
            "y": page_y + area.y,
            "width": area.width,
            "height": area.height,
            "scale": scale,
        },
        "fromSurface": true,
    });
    parameters
        .as_object_mut()
        .expect("object literal")
        .extend(format.as_object().expect("object literal").clone());
    let mime = if matches!(purpose, Purpose::Page) {
        "image/png"
    } else {
        "image/jpeg"
    };

    // Misty's own overlay is drawn into the page; leave it out of the picture.
    let _ = webview2::evaluate(view, OVERLAY_HIDE.to_owned(), None).await;
    let shot = webview2::cdp(view, "Page.captureScreenshot", &parameters).await;
    let _ = webview2::evaluate(view, OVERLAY_SHOW.to_owned(), None).await;
    let data = shot?["data"].as_str().ok_or(CdpError::Invalid)?.to_owned();
    let (width, height) = dimensions(&data).ok_or(CdpError::Invalid)?;
    Ok(json!({
        "dataUrl": format!("data:{mime};base64,{data}"),
        "width": width,
        "height": height,
    }))
}

// Misty's companion and control ring are drawn into the page on WebView2.
const OVERLAY_HIDE: &str = "(() => { for (const id of ['misty-native-companion', 'misty-agent-ring']) { const e = document.getElementById(id); if (e) { e.dataset.mistyCaptureDisplay = e.style.display; e.style.setProperty('display', 'none', 'important'); } } })()";
const OVERLAY_SHOW: &str = "(() => { for (const id of ['misty-native-companion', 'misty-agent-ring']) { const e = document.getElementById(id); if (e && 'mistyCaptureDisplay' in e.dataset) { e.style.display = e.dataset.mistyCaptureDisplay; delete e.dataset.mistyCaptureDisplay; } } })()";

/// The pixel size of a base64 PNG or JPEG, read from its header only.
fn dimensions(base64_data: &str) -> Option<(u32, u32)> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .ok()?;
    image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_dimensions_from_a_png_header() {
        let mut png = Vec::new();
        image::RgbaImage::new(3, 2)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(png);
        assert_eq!(dimensions(&encoded), Some((3, 2)));
        assert_eq!(dimensions("not base64"), None);
    }
}
