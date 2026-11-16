//! The default input device through AVAudioEngine.

use super::{convert_and_send, output_format, Delivery, StartFailure};
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool, ProtocolObject};
use objc2::AnyThread;
use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio};
use objc2_avf_audio::{
    AVAudioConverter, AVAudioEngine, AVAudioEngineConfigurationChangeNotification,
    AVAudioPCMBuffer, AVAudioTime,
};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol, NSThread};
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;

/// The default input device as 16 kHz mono PCM16, delivered
/// straight to the caller rather than the main queue.
pub(super) struct MicrophoneCapture {
    engine: Retained<AVAudioEngine>,
    delivery: Arc<Delivery>,
    // Shared with the configuration observer, which only reports a change
    // while the tap is installed.
    installed: Arc<AtomicBool>,
    observer: Option<Retained<ProtocolObject<dyn NSObjectProtocol>>>,
}

impl MicrophoneCapture {
    fn new(delivery: Arc<Delivery>) -> Self {
        // SAFETY: a plain initialiser.
        let engine = unsafe { AVAudioEngine::new() };
        let installed = Arc::new(AtomicBool::new(false));
        let block = {
            let installed = Arc::clone(&installed);
            let delivery = Arc::clone(&delivery);
            RcBlock::new(move |_notification: NonNull<NSNotification>| {
                // The input device changed under us. Report it; the caller decides
                // whether to reopen.
                if !installed.load(Ordering::Acquire) {
                    return;
                }
                delivery.fail();
            })
        };
        let object: &AnyObject = &engine;
        // SAFETY: the name is AVFAudio's own constant, the object is this
        // engine, and the block only touches thread-safe state, so any queue
        // may run it.
        let observer = unsafe {
            NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
                Some(AVAudioEngineConfigurationChangeNotification),
                Some(object),
                None,
                &block,
            )
        };
        Self {
            engine,
            delivery,
            installed,
            observer: Some(observer),
        }
    }

    // Every failure stops, not only a failed engine start: the configuration
    // observer holds the delivery itself rather than a weak reference to the
    // capture, so it has to be removed even when the format check fails.
    fn start(&mut self) -> Result<(), StartFailure> {
        let result = self.open();
        if result.is_err() {
            self.stop();
        }
        result
    }

    fn open(&mut self) -> Result<(), StartFailure> {
        // SAFETY: plain property reads on this engine's input node.
        let input = unsafe { self.engine.inputNode() };
        let format = unsafe { input.outputFormatForBus(0) };
        let (rate, channels) = unsafe { (format.sampleRate(), format.channelCount()) };
        if rate.is_nan() || rate <= 0.0 || channels == 0 {
            return Err(StartFailure::Device);
        }
        let output = output_format().ok_or(StartFailure::Device)?;
        // SAFETY: a plain initialiser; nil comes back as None.
        let converter = unsafe {
            AVAudioConverter::initFromFormat_toFormat(AVAudioConverter::alloc(), &format, &output)
        }
        .ok_or(StartFailure::Device)?;
        let delivery = Arc::clone(&self.delivery);
        let tap: RcBlock<dyn Fn(NonNull<AVAudioPCMBuffer>, NonNull<AVAudioTime>)> = RcBlock::new(
            move |buffer: NonNull<AVAudioPCMBuffer>, _when: NonNull<AVAudioTime>| {
                // SAFETY: the engine passes a live buffer for the duration of the call.
                let buffer = unsafe { buffer.as_ref() };
                let frames = unsafe { buffer.frameLength() };
                convert_and_send(&converter, buffer, frames, rate, &output, &delivery);
            },
        );
        // SAFETY: the format is the node's own output format, and the engine
        // copies the block before this returns.
        unsafe {
            input.installTapOnBus_bufferSize_format_block(
                0,
                1024,
                Some(&*format),
                RcBlock::as_ptr(&tap),
            );
        }
        self.installed.store(true, Ordering::Release);
        // SAFETY: starting an engine whose only graph is the tapped input.
        unsafe { self.engine.startAndReturnError() }.map_err(|_| StartFailure::Device)
    }

    pub(super) fn stop(&mut self) {
        self.delivery.close();
        // SAFETY: stopping and untapping this engine, as AVAudioEngine allows from any thread.
        unsafe {
            self.engine.stop();
            if self.installed.swap(false, Ordering::AcqRel) {
                self.engine.inputNode().removeTapOnBus(0);
            }
        }
        if let Some(observer) = self.observer.take() {
            let observer: &AnyObject = (*observer).as_ref();
            // SAFETY: the token this capture got back from the same center.
            unsafe { NSNotificationCenter::defaultCenter().removeObserver(observer) };
        }
    }
}

/// Asks for microphone access when needed. Off the main thread this waits
/// for the user's answer; on the main thread it never blocks and reports
/// "denied" until access is granted.
fn microphone_allowed() -> bool {
    // SAFETY: AVFoundation's own constant, set before any code runs.
    let Some(audio) = (unsafe { AVMediaTypeAudio }) else {
        return false;
    };
    // SAFETY: audio is one of the two media types this accepts.
    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(audio) };
    if status == AVAuthorizationStatus::Authorized {
        return true;
    }
    if status != AVAuthorizationStatus::NotDetermined {
        return false;
    }
    if NSThread::isMainThread_class() {
        let ignore = RcBlock::new(|_allowed: Bool| {});
        // SAFETY: the block ignores its argument and may run on any queue.
        unsafe { AVCaptureDevice::requestAccessForMediaType_completionHandler(audio, &ignore) };
        return false;
    }
    let (answer, answered) = mpsc::sync_channel(1);
    let handler = RcBlock::new(move |allowed: Bool| {
        let _ = answer.try_send(allowed.as_bool());
    });
    // SAFETY: the block only sends on a channel, which any queue may do.
    unsafe { AVCaptureDevice::requestAccessForMediaType_completionHandler(audio, &handler) };
    answered
        .recv_timeout(Duration::from_secs(60))
        .unwrap_or(false)
}

pub(super) fn start(delivery: Arc<Delivery>) -> Result<MicrophoneCapture, StartFailure> {
    if !microphone_allowed() {
        return Err(StartFailure::Denied);
    }
    let mut capture = MicrophoneCapture::new(delivery);
    capture.start()?;
    Ok(capture)
}
