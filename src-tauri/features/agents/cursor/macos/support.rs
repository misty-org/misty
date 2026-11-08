//! Helpers the agent's macOS drawings and captures share: running on the main
//! queue, Reduce motion, display geometry, and a JPEG of a captured image.
use dispatch2::DispatchQueue;
use objc2::runtime::AnyObject;
use objc2::{rc::Retained, AnyThread, MainThreadMarker};
use objc2_app_kit::{
    NSBitmapImageFileType, NSBitmapImageRep, NSImageCompressionFactor, NSWorkspace,
};
use objc2_core_graphics::{CGDisplayBounds, CGImage, CGMainDisplayID};
use objc2_foundation::{NSDictionary, NSNumber, NSOperatingSystemVersion, NSProcessInfo, NSRect};
use serde_json::{json, Value};

/// Runs `work` on the main queue and waits; direct when already there.
pub(crate) fn on_main<R: Send>(work: impl FnOnce(MainThreadMarker) -> R + Send) -> R {
    dispatch2::run_on_main(work)
}

/// Runs `work` on the main queue without waiting; direct when already there.
pub(crate) fn on_main_later(work: impl FnOnce(MainThreadMarker) + Send + 'static) {
    match MainThreadMarker::new() {
        Some(mtm) => work(mtm),
        None => DispatchQueue::main().exec_async(move || {
            // SAFETY: the main queue only runs on the main thread.
            work(unsafe { MainThreadMarker::new_unchecked() })
        }),
    }
}

/// Queues `work` on the main queue even when already on it.
pub(crate) fn on_main_queued(work: impl FnOnce(MainThreadMarker) + Send + 'static) {
    DispatchQueue::main().exec_async(move || {
        // SAFETY: the main queue only runs on the main thread.
        work(unsafe { MainThreadMarker::new_unchecked() })
    });
}

/// A value that is only touched on the main thread, carried across a queue hop.
pub(crate) struct MainOnly<T>(pub T);
// SAFETY: every use of the inner value happens inside `on_main*` closures.
unsafe impl<T> Send for MainOnly<T> {}
impl<T> MainOnly<T> {
    /// Takes the value out whole, so a closure captures the wrapper and not a field.
    pub(crate) fn into_inner(self) -> T {
        self.0
    }
}

pub(crate) fn reduce_motion() -> bool {
    NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion()
}

/// Whether macOS is at least `major.minor`; ScreenCaptureKit stills need 14.
pub(crate) fn macos_at_least(major: isize, minor: isize) -> bool {
    NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(NSOperatingSystemVersion {
        majorVersion: major,
        minorVersion: minor,
        patchVersion: 0,
    })
}

pub(crate) fn main_display_height() -> f64 {
    CGDisplayBounds(CGMainDisplayID()).size.height
}

/// Global top-left display coordinates to a Cocoa frame.
pub(crate) fn cocoa_rect(x: f64, y: f64, width: f64, height: f64) -> NSRect {
    NSRect::new(
        objc2_foundation::NSPoint::new(x, main_display_height() - (y + height)),
        objc2_foundation::NSSize::new(width, height),
    )
}

/// A JPEG of a captured image at `quality` (0 to 1).
pub(crate) fn jpeg(image: &CGImage, quality: f64) -> Option<Vec<u8>> {
    let rep = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), image);
    let factor = NSNumber::new_f64(quality);
    // SAFETY: the key is a framework constant and the value an NSNumber.
    let properties: Retained<NSDictionary<_, AnyObject>> = unsafe {
        NSDictionary::from_retained_objects(
            &[NSImageCompressionFactor],
            &[Retained::into_super(Retained::into_super(factor)).into()],
        )
    };
    // SAFETY: the properties are a valid representation dictionary.
    let data = unsafe {
        rep.representationUsingType_properties(NSBitmapImageFileType::JPEG, &properties)
    }?;
    (!data.is_empty()).then(|| data.to_vec())
}

pub(crate) fn error_json(message: impl Into<String>) -> Value {
    json!({ "error": message.into() })
}

/// One entry of the on-screen window list, front to back.
pub(crate) struct WindowInfo {
    pub number: i64,
    pub pid: i32,
    pub layer: i32,
    pub alpha: f64,
    pub bounds: Option<objc2_foundation::NSRect>,
    pub owner: String,
    pub title: String,
}

/// The on-screen windows of every app, front to back, without desktop elements.
pub(crate) fn on_screen_windows() -> Vec<WindowInfo> {
    use objc2_core_foundation::{CFDictionary, CFRetained, CFString};
    use objc2_core_graphics::{
        kCGNullWindowID, kCGWindowAlpha, kCGWindowBounds, kCGWindowLayer, kCGWindowName,
        kCGWindowNumber, kCGWindowOwnerName, kCGWindowOwnerPID,
        CGRectMakeWithDictionaryRepresentation, CGWindowListCopyWindowInfo, CGWindowListOption,
    };
    use objc2_foundation::{NSArray, NSString};

    let Some(list) = CGWindowListCopyWindowInfo(
        CGWindowListOption::OptionOnScreenOnly | CGWindowListOption::ExcludeDesktopElements,
        kCGNullWindowID,
    ) else {
        return Vec::new();
    };
    // SAFETY: CFArray and NSArray are toll-free bridged; the entries are dictionaries.
    let windows: &NSArray<NSDictionary<NSString, AnyObject>> =
        unsafe { &*(&*list as *const objc2_core_foundation::CFArray).cast() };
    let key = |constant: &'static CFString| -> &NSString {
        // SAFETY: CFString and NSString are toll-free bridged.
        unsafe { &*(constant as *const CFString).cast::<NSString>() }
    };
    let _: Option<CFRetained<CFDictionary>> = None;
    windows
        .iter()
        .map(|window| {
            let number = |constant: &'static CFString| {
                window
                    .objectForKey(key(constant))
                    .and_then(|value| value.downcast_ref::<NSNumber>().map(|n| n.as_f64()))
                    .unwrap_or(0.0)
            };
            let text = |constant: &'static CFString| {
                window
                    .objectForKey(key(constant))
                    .and_then(|value| value.downcast_ref::<NSString>().map(|s| s.to_string()))
                    .unwrap_or_default()
            };
            let bounds = window
                .objectForKey(key(unsafe { kCGWindowBounds }))
                .and_then(|value| {
                    let mut rect = objc2_foundation::NSRect::ZERO;
                    // SAFETY: the bounds entry is a rect dictionary; the out pointer is valid.
                    let ok = unsafe {
                        CGRectMakeWithDictionaryRepresentation(
                            Some(&*(&*value as *const AnyObject).cast::<CFDictionary>()),
                            &mut rect,
                        )
                    };
                    ok.then_some(rect)
                });
            // SAFETY: framework key constants.
            unsafe {
                WindowInfo {
                    number: window
                        .objectForKey(key(kCGWindowNumber))
                        .and_then(|value| value.downcast_ref::<NSNumber>().map(|n| n.as_i64()))
                        .unwrap_or(0),
                    pid: number(kCGWindowOwnerPID) as i32,
                    layer: number(kCGWindowLayer) as i32,
                    alpha: number(kCGWindowAlpha),
                    bounds,
                    owner: text(kCGWindowOwnerName),
                    title: text(kCGWindowName),
                }
            }
        })
        .collect()
}
