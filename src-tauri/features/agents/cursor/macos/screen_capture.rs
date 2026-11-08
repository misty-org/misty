//! ScreenCaptureKit stills shared by the companion's captures, window control,
//! and screen context. Every wait ends after eight seconds; the completion
//! blocks own their state even after that.
use std::{sync::mpsc, time::Duration};

use base64::Engine;
use block2::RcBlock;
use objc2::{rc::Retained, AllocAnyThread};
use objc2_core_graphics::CGImage;
use objc2_foundation::{NSArray, NSError};
use objc2_screen_capture_kit::{
    SCContentFilter, SCDisplay, SCScreenshotManager, SCShareableContent, SCStreamConfiguration,
    SCWindow,
};
use serde_json::{json, Map, Value};

use super::support::{error_json, jpeg};

pub(crate) const WAIT: Duration = Duration::from_secs(8);

/// A framework error's description.
pub(crate) fn error_text(error: *mut NSError) -> Option<String> {
    // SAFETY: the framework passes null or a live error for the call's duration.
    unsafe { error.as_ref() }.map(|error| error.localizedDescription().to_string())
}

/// The JSON a finished capture reports: the JPEG as base64 and its pixel size.
pub(crate) fn image_json(image: &CGImage, quality: f64, empty: &str) -> Value {
    match jpeg(image, quality) {
        Some(bytes) => json!({
            "jpeg": base64::engine::general_purpose::STANDARD.encode(bytes),
            "width": CGImage::width(Some(image)),
            "height": CGImage::height(Some(image)),
        }),
        None => error_json(empty),
    }
}

/// Windows of this process whose title is one of `titles`, to leave out.
pub(crate) fn own_windows(
    content: &SCShareableContent,
    titles: &[&str],
) -> Vec<Retained<SCWindow>> {
    let own = std::process::id() as i32;
    // SAFETY: plain property reads on live framework objects.
    unsafe {
        content
            .windows()
            .iter()
            .filter(|window| {
                window
                    .owningApplication()
                    .is_some_and(|app| app.processID() == own)
                    && window
                        .title()
                        .is_some_and(|title| titles.contains(&title.to_string().as_str()))
            })
            .collect()
    }
}

pub(crate) fn display_for(content: &SCShareableContent, id: u32) -> Option<Retained<SCDisplay>> {
    // SAFETY: plain property reads on live framework objects.
    unsafe {
        content
            .displays()
            .iter()
            .find(|display| display.displayID() == id)
    }
}

/// Words for the errors of one still capture.
pub(crate) struct StillMessages {
    pub disconnected: &'static str,
    pub timeout: &'static str,
    pub no_image: &'static str,
    pub empty: &'static str,
}

/// A still of one display, leaving out this app's cursor overlays. `configure`
/// sets the size and area; its map is merged into the result.
pub(crate) fn display_still(
    display_id: u32,
    quality: f64,
    messages: StillMessages,
    configure: impl Fn(
            &SCDisplay,
            &SCContentFilter,
            &SCStreamConfiguration,
        ) -> Result<Map<String, Value>, String>
        + 'static,
) -> Value {
    let (send, receive) = mpsc::channel::<Value>();
    let StillMessages {
        disconnected,
        no_image,
        empty,
        timeout,
    } = messages;
    let handler = RcBlock::new(
        move |content: *mut SCShareableContent, error: *mut NSError| {
            if let Some(text) = error_text(error) {
                let _ = send.send(error_json(text));
                return;
            }
            // SAFETY: with no error the framework passes live content.
            let Some(content) = (unsafe { content.as_ref() }) else {
                let _ = send.send(error_json(disconnected));
                return;
            };
            let Some(target) = display_for(content, display_id) else {
                let _ = send.send(error_json(disconnected));
                return;
            };
            let excluded = NSArray::from_retained_slice(&own_windows(content, &["Misty cursor"]));
            // SAFETY: a display and windows from the same content.
            let filter = unsafe {
                SCContentFilter::initWithDisplay_excludingWindows(
                    SCContentFilter::alloc(),
                    &target,
                    &excluded,
                )
            };
            // SAFETY: a fresh configuration, set before the capture starts.
            let config = unsafe { SCStreamConfiguration::new() };
            let extra = match configure(&target, &filter, &config) {
                Ok(extra) => extra,
                Err(message) => {
                    let _ = send.send(error_json(message));
                    return;
                }
            };
            unsafe {
                config.setShowsCursor(false);
                config.setCapturesAudio(false);
            }
            let send = send.clone();
            let done = RcBlock::new(move |image: *mut CGImage, error: *mut NSError| {
                // SAFETY: null or a live image for the call's duration.
                let image = unsafe { image.as_ref() };
                let mut result = match (error_text(error), image) {
                    (None, Some(image)) => image_json(image, quality, empty),
                    (text, _) => error_json(text.unwrap_or_else(|| no_image.into())),
                };
                if result.get("jpeg").is_some() {
                    if let Some(map) = result.as_object_mut() {
                        map.extend(extra.clone());
                    }
                }
                let _ = send.send(result);
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
            false, true, &handler,
        );
    }
    receive
        .recv_timeout(WAIT)
        .unwrap_or_else(|_| error_json(timeout))
}
