//! Dims a browser pane's native page while another pane has focus. The page view sits
//! above the app, so the pane's own dim layer cannot cover it. A layer laid over the page
//! view does instead: it takes no events, so the page keeps working, and nothing is
//! injected into the page itself.
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager, Webview};

/// Matches the strongest dimming the settings allow.
const MAX_DIM: f64 = 0.5;

static DIMS: OnceLock<Mutex<HashMap<String, f64>>> = OnceLock::new();

fn dims() -> &'static Mutex<HashMap<String, f64>> {
    DIMS.get_or_init(Default::default)
}

/// Lays the remembered strength over a page view. Runs on every bounds update, so a page
/// created after its pane was dimmed starts dimmed.
pub(super) fn apply(webview: &Webview, id: &str) -> Result<(), String> {
    let strength = dims()
        .lock()
        .map(|dims| dims.get(id).copied().unwrap_or(0.0))
        .unwrap_or(0.0);
    set_layer(webview, strength)
}

#[tauri::command]
pub fn browser_webview_set_pane_dim(
    app: AppHandle,
    id: String,
    strength: f64,
) -> Result<(), String> {
    let label = super::webview_label(&id)?;
    let strength = if strength.is_finite() {
        strength.clamp(0.0, MAX_DIM)
    } else {
        0.0
    };
    {
        let mut dims = dims()
            .lock()
            .map_err(|_| "Pane dimming is unavailable.".to_owned())?;
        if strength > 0.0 {
            dims.insert(id, strength);
        } else {
            dims.remove(&id);
        }
    }
    match app.get_webview(&label) {
        Some(webview) => set_layer(&webview, strength),
        // Not created yet: `apply` lays it on with the page's first bounds.
        None => Ok(()),
    }
}

#[cfg(target_os = "macos")]
fn set_layer(webview: &Webview, strength: f64) -> Result<(), String> {
    use objc2::{
        class,
        encode::{Encoding, RefEncode},
        msg_send,
        runtime::AnyObject,
    };
    use objc2_foundation::{NSRect, NSString};

    #[repr(C)]
    struct CGColor {
        _private: [u8; 0],
    }
    unsafe impl RefEncode for CGColor {
        const ENCODING_REF: Encoding = Encoding::Pointer(&Encoding::Struct("CGColor", &[]));
    }
    // kCALayerWidthSizable | kCALayerHeightSizable: the layer follows the page's size.
    const FILL: u32 = 2 | 16;

    webview
        .with_webview(move |platform_webview| unsafe {
            let view: &AnyObject = &*platform_webview.inner().cast();
            let _: () = msg_send![view, setWantsLayer: true];
            let layer: *mut AnyObject = msg_send![view, layer];
            let Some(layer) = layer.as_ref() else {
                return;
            };
            let name = NSString::from_str("misty.pane-dim");
            let mut dim: *mut AnyObject = std::ptr::null_mut();
            let sublayers: *mut AnyObject = msg_send![layer, sublayers];
            if let Some(sublayers) = sublayers.as_ref() {
                let count: usize = msg_send![sublayers, count];
                for index in 0..count {
                    let candidate: *mut AnyObject = msg_send![sublayers, objectAtIndex: index];
                    let candidate_name: *mut AnyObject = msg_send![candidate, name];
                    if let Some(candidate_name) = candidate_name.as_ref() {
                        let same: bool = msg_send![candidate_name, isEqualToString: &*name];
                        if same {
                            dim = candidate;
                            break;
                        }
                    }
                }
            }
            // Dimming switches at once, like the dim over other panes.
            let _: () = msg_send![class!(CATransaction), begin];
            let _: () = msg_send![class!(CATransaction), setDisableActions: true];
            if strength <= 0.0 {
                if let Some(dim) = dim.as_ref() {
                    let _: () = msg_send![dim, removeFromSuperlayer];
                }
            } else {
                if dim.is_null() {
                    dim = msg_send![class!(CALayer), layer];
                    let black: *mut AnyObject = msg_send![class!(NSColor), blackColor];
                    let color: *const CGColor = msg_send![black, CGColor];
                    let _: () = msg_send![dim, setBackgroundColor: color];
                    let _: () = msg_send![dim, setName: &*name];
                    // Above WebKit's own content layers, whatever order they take.
                    let _: () = msg_send![dim, setZPosition: 1.0e6_f64];
                    let _: () = msg_send![dim, setAutoresizingMask: FILL];
                    let _: () = msg_send![layer, addSublayer: dim];
                }
                let bounds: NSRect = msg_send![layer, bounds];
                let _: () = msg_send![dim, setFrame: bounds];
                let _: () = msg_send![dim, setOpacity: strength as f32];
            }
            let _: () = msg_send![class!(CATransaction), commit];
        })
        .map_err(|error| error.to_string())
}

/// Windows lays a click-through layered window over the page instead.
#[cfg(windows)]
fn set_layer(webview: &Webview, strength: f64) -> Result<(), String> {
    super::page_frame_windows::set_dim(webview, strength)
}

#[cfg(not(any(target_os = "macos", windows)))]
fn set_layer(_webview: &Webview, _strength: f64) -> Result<(), String> {
    Ok(())
}
