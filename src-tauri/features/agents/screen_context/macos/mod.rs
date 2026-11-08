//! Screen context on macOS: whether Misty may see other windows, and a still of
//! the window the person was in, to attach to an ask.
use std::sync::{
    atomic::{AtomicI32, Ordering},
    mpsc,
};

use block2::RcBlock;
use objc2::AllocAnyThread;
use objc2_app_kit::NSWorkspace;
use objc2_core_graphics::{CGImage, CGPreflightScreenCaptureAccess, CGRequestScreenCaptureAccess};
use objc2_foundation::NSError;
use objc2_screen_capture_kit::{
    SCContentFilter, SCScreenshotManager, SCShareableContent, SCStreamConfiguration,
};
use serde_json::{json, Value};

use crate::agents::cursor::macos::{
    screen_capture::{error_text, WAIT},
    support::{error_json, jpeg, macos_at_least, on_main_queued, on_screen_windows},
};

/// The process whose window was last attached when Misty itself is in front.
static SOURCE_PID: AtomicI32 = AtomicI32::new(0);

pub(super) fn main_focused() {
    SOURCE_PID.store(0, Ordering::SeqCst);
}

pub(super) fn status(request: bool) -> Value {
    let external = SOURCE_PID.load(Ordering::SeqCst) != 0;
    if !macos_at_least(14, 0) {
        return json!({"supported": false, "allowed": false, "shortcutRegistered": false, "external": external});
    }
    let mut allowed = CGPreflightScreenCaptureAccess();
    if request && !allowed {
        allowed = CGRequestScreenCaptureAccess();
    }
    json!({"supported": true, "allowed": allowed, "shortcutRegistered": false, "external": external})
}

/// Called on a Rust blocking worker. AppKit work is dispatched to the main queue.
pub(super) fn capture() -> Value {
    if !macos_at_least(14, 0) {
        return error_json("Screen context requires macOS 14 or later.");
    }
    if !CGPreflightScreenCaptureAccess() {
        return error_json("Enable screen access to attach this window.");
    }
    let (send, receive) = mpsc::channel::<Value>();
    on_main_queued(move |_| {
        let front = NSWorkspace::sharedWorkspace()
            .frontmostApplication()
            .map(|app| app.processIdentifier())
            .unwrap_or(0);
        let pid = if front == std::process::id() as i32 {
            SOURCE_PID.load(Ordering::SeqCst)
        } else {
            front
        };
        let handler = RcBlock::new(
            move |content: *mut SCShareableContent, error: *mut NSError| {
                if let Some(text) = error_text(error) {
                    let _ = send.send(error_json(text));
                    return;
                }
                // SAFETY: with no error the framework passes live content.
                let Some(content) = (unsafe { content.as_ref() }) else {
                    let _ = send.send(error_json(
                        "The source window is unavailable. Return to it and try again.",
                    ));
                    return;
                };
                // The first window of the source app, front to back, that can be captured.
                // SAFETY: plain property reads on live framework objects.
                let target = on_screen_windows()
                    .into_iter()
                    .filter(|info| info.pid == pid && info.layer == 0)
                    .find_map(|info| unsafe {
                        content
                            .windows()
                            .iter()
                            .find(|window| i64::from(window.windowID()) == info.number)
                    });
                let Some(target) = target else {
                    let _ = send.send(error_json(
                        "The source window is unavailable. Return to it and try again.",
                    ));
                    return;
                };
                // SAFETY: a window from the same content; the configuration is set before capture.
                let (filter, config, title, app_name) = unsafe {
                    let filter = SCContentFilter::initWithDesktopIndependentWindow(
                        SCContentFilter::alloc(),
                        &target,
                    );
                    let config = SCStreamConfiguration::new();
                    let size = target.frame().size;
                    let scale = 1.0_f64.min(1600.0 / size.width.max(size.height));
                    config.setWidth(((size.width * scale) as usize).max(1));
                    config.setHeight(((size.height * scale) as usize).max(1));
                    config.setShowsCursor(false);
                    (
                        filter,
                        config,
                        target
                            .title()
                            .map(|t| t.to_string())
                            .unwrap_or_else(|| "Window".into()),
                        target
                            .owningApplication()
                            .map(|app| app.applicationName().to_string())
                            .unwrap_or_else(|| "App".into()),
                    )
                };
                let send = send.clone();
                let done = RcBlock::new(move |image: *mut CGImage, error: *mut NSError| {
                    // SAFETY: null or a live image for the call's duration.
                    let image = unsafe { image.as_ref() };
                    let Some(image) = image.filter(|_| error_text(error).is_none()) else {
                        let _ = send.send(error_json(
                            error_text(error)
                                .unwrap_or_else(|| "This window cannot be captured.".into()),
                        ));
                        return;
                    };
                    let Some(bytes) = jpeg(image, 0.7) else {
                        let _ = send.send(error_json("This window cannot be captured."));
                        return;
                    };
                    use base64::Engine;
                    let data = base64::engine::general_purpose::STANDARD.encode(bytes);
                    let _ = send.send(json!({
                        "dataUrl": format!("data:image/jpeg;base64,{data}"),
                        "width": CGImage::width(Some(image)),
                        "height": CGImage::height(Some(image)),
                        "title": title,
                        "appName": app_name,
                    }));
                });
                // SAFETY: the filter and configuration are fully set.
                unsafe {
                    SCScreenshotManager::captureImageWithFilter_configuration_completionHandler(
                        &filter,
                        &config,
                        Some(&done),
                    );
                }
            },
        );
        // SAFETY: the handler is a valid block for the call.
        unsafe {
            SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(
                true, true, &handler,
            );
        }
    });
    receive
        .recv_timeout(WAIT)
        .unwrap_or_else(|_| error_json("Screen capture timed out. Try again."))
}
