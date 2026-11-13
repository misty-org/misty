//! Capture owns one live ScreenCaptureKit stream; pixels never go to disk.
use std::{
    sync::{Arc, Condvar, Mutex, MutexGuard},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::Engine;
use block2::RcBlock;
use dispatch2::{DispatchQueue, DispatchQueueAttr};
use objc2::{
    define_class, msg_send,
    rc::Retained,
    runtime::{AnyObject, ProtocolObject},
    AllocAnyThread, DefinedClass,
};
use objc2_core_graphics::CGImage;
use objc2_core_image::{CIContext, CIImage};
use objc2_core_media::{CMSampleBuffer, CMTime};
use objc2_core_video::CVPixelBuffer;
use objc2_foundation::{NSDictionary, NSError, NSNumber, NSObject, NSObjectProtocol, NSString};
use objc2_screen_capture_kit::{
    SCContentFilter, SCFrameStatus, SCShareableContent, SCStream, SCStreamConfiguration,
    SCStreamDelegate, SCStreamFrameInfoStatus, SCStreamOutput, SCStreamOutputType,
};
use serde_json::{json, Value};

use crate::agents::cursor::macos::{
    ring::RING_TITLE,
    screen_capture::{display_for, error_text, own_windows},
    support::{error_json, jpeg, macos_at_least},
};

/// `kCVPixelFormatType_32BGRA`.
const PIXEL_FORMAT_BGRA: u32 = 0x4247_5241;

#[derive(Default)]
struct Inner {
    stream: Option<SendStream>,
    jpeg: Option<Vec<u8>>,
    failure: Option<String>,
    width: usize,
    height: usize,
    sequence: u64,
    stopped: bool,
    captured_at: f64,
}

struct SendStream(Retained<SCStream>);
// SAFETY: SCStream is used from several queues by design; this only starts and stops it.
unsafe impl Send for SendStream {}

struct Shared {
    inner: Mutex<Inner>,
    changed: Condvar,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn failed(&self, message: String) {
        let mut inner = self.lock();
        inner.failure = Some(message);
        self.changed.notify_all();
    }

    fn stop(&self) {
        let stream = {
            let mut inner = self.lock();
            inner.stopped = true;
            inner.jpeg = None;
            let stream = inner.stream.take();
            self.changed.notify_all();
            stream
        };
        if let Some(stream) = stream {
            stop_stream(&stream.0);
        }
    }
}

fn stop_stream(stream: &SCStream) {
    let ignore = RcBlock::new(|_: *mut NSError| {});
    // SAFETY: the block is valid for the call.
    unsafe { stream.stopCaptureWithCompletionHandler(Some(&ignore)) };
}

fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

struct StreamIvars {
    shared: Arc<Shared>,
    images: Retained<CIContext>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "MistyDesktopStream"]
    #[ivars = StreamIvars]
    struct DesktopStream;

    unsafe impl NSObjectProtocol for DesktopStream {}

    unsafe impl SCStreamDelegate for DesktopStream {
        #[unsafe(method(stream:didStopWithError:))]
        fn stream_did_stop_with_error(&self, _stream: &SCStream, error: &NSError) {
            self.ivars()
                .shared
                .failed(error.localizedDescription().to_string());
        }
    }

    unsafe impl SCStreamOutput for DesktopStream {
        #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
        fn stream_did_output_sample_buffer(
            &self,
            _stream: &SCStream,
            sample: &CMSampleBuffer,
            kind: SCStreamOutputType,
        ) {
            self.output(sample, kind);
        }
    }
);

impl DesktopStream {
    fn new(shared: Arc<Shared>) -> Retained<Self> {
        // SAFETY: a plain options dictionary asking for GPU rendering.
        let images = unsafe { CIContext::contextWithOptions(None) };
        let this = Self::alloc().set_ivars(StreamIvars { shared, images });
        // SAFETY: NSObject's designated initializer.
        unsafe { msg_send![super(this), init] }
    }

    fn frame_status(sample: &CMSampleBuffer) -> Option<isize> {
        // SAFETY: reading attachments of a live sample buffer.
        let list = unsafe { sample.sample_attachments_array(false) }?;
        let first = unsafe { list.value_at_index(0) };
        if first.is_null() {
            return None;
        }
        // SAFETY: the attachment is a dictionary, bridged to NSDictionary.
        let info = unsafe { &*first.cast::<NSDictionary<NSString, AnyObject>>() };
        // SAFETY: a framework key constant.
        let key = unsafe { SCStreamFrameInfoStatus };
        info.objectForKey(key)
            .and_then(|value| value.downcast_ref::<NSNumber>().map(NSNumber::as_isize))
    }

    fn output(&self, sample: &CMSampleBuffer, kind: SCStreamOutputType) {
        // SAFETY: plain queries on a live sample buffer.
        if !unsafe { sample.is_valid() } || kind != SCStreamOutputType::Screen {
            return;
        }
        let Some(status) = Self::frame_status(sample) else {
            return;
        };
        let shared = &self.ivars().shared;
        if status == SCFrameStatus::Idle.0 {
            // ScreenCaptureKit explicitly reports an unchanged display; retained pixels
            // are current, unlike replaying a frame after a stopped/lost stream.
            let mut inner = shared.lock();
            if !inner.stopped && inner.jpeg.is_some() {
                inner.captured_at = now();
                shared.changed.notify_all();
            }
            return;
        }
        if status != SCFrameStatus::Complete.0 {
            return;
        }
        // SAFETY: the image buffer of a complete screen frame is a pixel buffer.
        let Some(pixels) = (unsafe { sample.image_buffer() }) else {
            return;
        };
        let pixels: &CVPixelBuffer = unsafe { &*(&*pixels as *const _ as *const CVPixelBuffer) };
        // SAFETY: images are created and rendered on the serial sample queue.
        let frame = unsafe {
            let image = CIImage::imageWithCVPixelBuffer(pixels);
            self.ivars()
                .images
                .createCGImage_fromRect(&image, image.extent())
        };
        let Some(frame) = frame else { return };
        let Some(bytes) = jpeg(&frame, 0.85) else {
            return;
        };
        let mut inner = shared.lock();
        if !inner.stopped {
            inner.jpeg = Some(bytes);
            inner.width = CGImage::width(Some(&frame));
            inner.height = CGImage::height(Some(&frame));
            inner.sequence += 1;
            inner.captured_at = now();
            shared.changed.notify_all();
        }
    }
}

struct Active {
    display: u32,
    shared: Arc<Shared>,
    /// Keeps the stream's delegate alive for as long as the stream runs.
    #[allow(dead_code)]
    delegate: SendDelegate,
}

#[allow(dead_code)]
struct SendDelegate(Retained<DesktopStream>);
// SAFETY: the delegate is only kept alive here; the framework calls it from its own queue.
unsafe impl Send for SendDelegate {}

static ACTIVE: Mutex<Option<Active>> = Mutex::new(None);

fn active() -> MutexGuard<'static, Option<Active>> {
    ACTIVE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(super) fn capture_stop() {
    if !macos_at_least(14, 0) {
        return;
    }
    if let Some(active) = active().take() {
        active.shared.stop();
    }
}

/// Starts the stream for `display`: finds it, leaves Misty's overlays out, and begins capture.
fn start(display: u32, shared: Arc<Shared>, delegate: Retained<DesktopStream>) {
    let handler = RcBlock::new(
        move |content: *mut SCShareableContent, error: *mut NSError| {
            // SAFETY: with no error the framework passes live content.
            let content = unsafe { content.as_ref() };
            let target = content.and_then(|content| display_for(content, display));
            let (Some(content), Some(target), None) = (content, target, error_text(error)) else {
                let message = error_text(error)
                    .unwrap_or_else(|| "The captured display disconnected.".to_owned());
                shared.failed(message);
                return;
            };
            let excluded = objc2_foundation::NSArray::from_retained_slice(&own_windows(
                content,
                &["Misty cursor", RING_TITLE],
            ));
            // SAFETY: a display and windows from the same content; the configuration is
            // fully set before the stream is created.
            unsafe {
                let filter = SCContentFilter::initWithDisplay_excludingWindows(
                    SCContentFilter::alloc(),
                    &target,
                    &excluded,
                );
                let config = SCStreamConfiguration::new();
                let (width, height) = (target.width() as f64, target.height() as f64);
                let scale = 2.0_f64.min(2000.0 / width.max(height));
                config.setWidth(((width * scale) as usize).max(1));
                config.setHeight(((height * scale) as usize).max(1));
                config.setMinimumFrameInterval(CMTime::new(1, 5));
                config.setQueueDepth(3);
                config.setPixelFormat(PIXEL_FORMAT_BGRA);
                config.setShowsCursor(false);
                let stream = SCStream::initWithFilter_configuration_delegate(
                    SCStream::alloc(),
                    &filter,
                    &config,
                    Some(ProtocolObject::from_ref(&*delegate)),
                );
                let queue = DispatchQueue::new("misty.desktop.frames", DispatchQueueAttr::SERIAL);
                if let Err(error) = stream.addStreamOutput_type_sampleHandlerQueue_error(
                    ProtocolObject::from_ref(&*delegate),
                    SCStreamOutputType::Screen,
                    Some(&queue),
                ) {
                    shared.failed(error.localizedDescription().to_string());
                    return;
                }
                let mut inner = shared.lock();
                if inner.stopped {
                    return;
                }
                inner.stream = Some(SendStream(stream.clone()));
                let after = shared.clone();
                let for_block = stream.clone();
                let started = RcBlock::new(move |failure: *mut NSError| {
                    if let Some(text) = error_text(failure) {
                        after.failed(text);
                    }
                    let stopped = after.lock().stopped;
                    if stopped {
                        stop_stream(&for_block);
                    }
                });
                stream.startCaptureWithCompletionHandler(Some(&started));
            }
            let _ = &delegate;
        },
    );
    // SAFETY: the handler is a valid block for the call.
    unsafe {
        SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(
            false, true, &handler,
        );
    }
}

/// One frame of the display, captured after `after` (seconds since 1970).
pub(crate) fn capture_frame(display: u32, after: f64) -> Value {
    if !macos_at_least(14, 0) {
        return error_json("Desktop control requires macOS 14 or later.");
    }
    let (shared, begin) = {
        let mut slot = active();
        if slot
            .as_ref()
            .is_some_and(|active| active.display != display)
        {
            if let Some(old) = slot.take() {
                old.shared.stop();
            }
        }
        match slot.as_ref() {
            Some(active) => (active.shared.clone(), None),
            None => {
                let shared = Arc::new(Shared {
                    inner: Mutex::new(Inner::default()),
                    changed: Condvar::new(),
                });
                let delegate = DesktopStream::new(shared.clone());
                *slot = Some(Active {
                    display,
                    shared: shared.clone(),
                    delegate: SendDelegate(delegate.clone()),
                });
                (shared, Some(delegate))
            }
        }
    };
    if let Some(delegate) = begin {
        start(display, shared.clone(), delegate);
    }
    let deadline = Instant::now() + Duration::from_secs(6);
    let mut inner = shared.lock();
    while (inner.jpeg.is_none() || inner.captured_at < after)
        && inner.failure.is_none()
        && !inner.stopped
    {
        let Some(left) = deadline.checked_duration_since(Instant::now()) else {
            break;
        };
        let (guard, timeout) = shared
            .changed
            .wait_timeout(inner, left)
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner = guard;
        if timeout.timed_out() {
            break;
        }
    }
    match (
        &inner.jpeg,
        inner.stopped || inner.failure.is_some() || inner.captured_at < after,
    ) {
        (Some(bytes), false) => json!({
            "dataUrl": format!(
                "data:image/jpeg;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            ),
            "width": inner.width, "height": inner.height, "sequence": inner.sequence,
            "capturedAt": inner.captured_at * 1000.0, "source": "screencapturekit-stream",
        }),
        _ => error_json(inner.failure.clone().unwrap_or_else(|| {
            if inner.stopped {
                "Desktop control stopped.".into()
            } else {
                "ScreenCaptureKit did not produce a frame.".into()
            }
        })),
    }
}
