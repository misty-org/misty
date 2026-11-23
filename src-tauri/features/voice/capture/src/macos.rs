mod microphone;
mod sources;
mod system_audio;

use crate::capture::{FailureSink, FrameCounter, Sink};
use crate::{AudioSource, Capabilities, CaptureError, Channel, Format};
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::AnyThread;
use objc2_avf_audio::{
    AVAudioBuffer, AVAudioCommonFormat, AVAudioConverter, AVAudioConverterInputStatus,
    AVAudioFormat, AVAudioPCMBuffer, AVAudioPacketCount,
};
use objc2_core_audio::{
    kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject,
    AudioObjectID, AudioObjectPropertyAddress, AudioObjectPropertySelector,
};
use objc2_foundation::NSError;
use std::cell::Cell;
use std::ptr::{self, NonNull};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

pub(crate) use sources::capture_sources;

const SYSTEM: AudioObjectID = kAudioObjectSystemObject as AudioObjectID;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StartFailure {
    Denied,
    Device,
    Unsupported,
    NoSuchProcess,
}

impl StartFailure {
    fn into_error(self) -> CaptureError {
        match self {
            StartFailure::Denied => CaptureError::PermissionDenied,
            StartFailure::Unsupported => {
                CaptureError::Unsupported("System audio capture (macOS 14.2 or later)")
            }
            StartFailure::NoSuchProcess => CaptureError::NoSuchProcess,
            StartFailure::Device => CaptureError::Device("the audio device could not start".into()),
        }
    }
}

struct DeliveryState {
    open: bool,
    frames: FrameCounter,
}

struct Delivery {
    state: Mutex<DeliveryState>,
    channel: Channel,
    sink: Sink,
    failure: FailureSink,
}

impl Delivery {
    fn new(channel: Channel, sink: Sink, failure: FailureSink) -> Self {
        Self {
            state: Mutex::new(DeliveryState {
                open: true,
                frames: FrameCounter::new(),
            }),
            channel,
            sink,
            failure,
        }
    }

    fn state(&self) -> MutexGuard<'_, DeliveryState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn send(&self, samples: &[i16]) {
        let mut state = self.state();
        if state.open {
            let chunk = state.frames.chunk(self.channel, samples.to_vec());
            (self.sink)(chunk);
        }
    }

    fn fail(&self) {
        let mut state = self.state();
        if state.open {
            (self.failure)(CaptureError::Device("the audio device changed".into()));
            state.open = false;
        }
    }

    fn close(&self) {
        self.state().open = false;
    }
}

fn global(selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress {
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain,
    }
}

fn output_format(format: Format) -> Option<Retained<AVAudioFormat>> {
    // SAFETY: a plain initialiser with valid arguments; nil comes back as None.
    unsafe {
        AVAudioFormat::initWithCommonFormat_sampleRate_channels_interleaved(
            AVAudioFormat::alloc(),
            AVAudioCommonFormat::PCMFormatInt16,
            format.sample_rate() as f64,
            format.channels(),
            true,
        )
    }
}

fn convert_and_send(
    converter: &AVAudioConverter,
    input: &AVAudioPCMBuffer,
    frames: u32,
    input_rate: f64,
    output: &AVAudioFormat,
    delivery: &Delivery,
) {
    // SAFETY: plain property reads on a live format.
    let (output_rate, output_channels) = unsafe { (output.sampleRate(), output.channelCount()) };
    let capacity = ((frames as f64 * output_rate / input_rate).ceil() + 32.0) as u32;
    // SAFETY: a plain initialiser; nil comes back as None.
    let Some(pcm) = (unsafe {
        AVAudioPCMBuffer::initWithPCMFormat_frameCapacity(
            AVAudioPCMBuffer::alloc(),
            output,
            capacity,
        )
    }) else {
        return;
    };
    let supplied = Cell::new(false);
    let source: *mut AVAudioBuffer = (input as *const AVAudioPCMBuffer).cast_mut().cast();
    let block: RcBlock<
        dyn Fn(AVAudioPacketCount, NonNull<AVAudioConverterInputStatus>) -> *mut AVAudioBuffer,
    > = RcBlock::new(
        move |_packets: AVAudioPacketCount, status: NonNull<AVAudioConverterInputStatus>| {
            // SAFETY: the converter passes a status it lets the block write,
            // and `input` outlives the synchronous conversion below.
            unsafe {
                if supplied.replace(true) {
                    *status.as_ptr() = AVAudioConverterInputStatus::NoDataNow;
                    return ptr::null_mut();
                }
                *status.as_ptr() = AVAudioConverterInputStatus::HaveData;
            }
            source
        },
    );
    let mut error: Option<Retained<NSError>> = None;
    // SAFETY: the block and both buffers stay alive for the call, which runs
    // the block synchronously.
    unsafe {
        converter.convertToBuffer_error_withInputFromBlock(
            &pcm,
            Some(&mut error),
            RcBlock::as_ptr(&block),
        );
    }
    if error.is_some() {
        return;
    }
    // SAFETY: plain property reads on a buffer this function owns.
    let (channels, length) = unsafe { (pcm.int16ChannelData(), pcm.frameLength()) };
    if channels.is_null() || length == 0 {
        return;
    }
    // SAFETY: an interleaved PCM16 buffer has one pointer, holding
    // `frameLength` frames of every channel while `pcm` lives.
    let samples = unsafe {
        std::slice::from_raw_parts(
            (*channels).as_ptr(),
            length as usize * output_channels as usize,
        )
    };
    delivery.send(samples);
}

enum NativeCapture {
    Microphone(microphone::MicrophoneCapture),
    System(system_audio::SystemAudioCapture),
}

pub(crate) struct Running {
    native: NativeCapture,
}

// SAFETY: the native objects are only touched again by `stop`, which
// AVAudioEngine and Core Audio allow from any thread; their callbacks only
// reach the caller through the thread-safe `Delivery`.
unsafe impl Send for Running {}

impl Running {
    pub fn stop(self) {
        match self.native {
            NativeCapture::Microphone(mut capture) => capture.stop(),
            NativeCapture::System(mut capture) => capture.stop(),
        }
    }
}

pub(crate) fn start(
    source: AudioSource,
    sink: Sink,
    failure: FailureSink,
) -> Result<Running, CaptureError> {
    let delivery = Arc::new(Delivery::new(source.channel(), sink, failure));
    let native = match &source {
        AudioSource::Mic => microphone::start(delivery).map(NativeCapture::Microphone),
        AudioSource::System { exclude_self } => {
            system_audio::start(&[], *exclude_self, Format::Speech, delivery)
                .map(NativeCapture::System)
        }
        AudioSource::Processes(pids) => {
            let pids: Vec<i32> = pids.iter().map(|pid| *pid as i32).collect();
            system_audio::start(&pids, false, Format::Speech, delivery).map(NativeCapture::System)
        }
    }
    .map_err(StartFailure::into_error)?;
    Ok(Running { native })
}

pub(crate) fn start_share(sink: Sink, failure: FailureSink) -> Result<Running, CaptureError> {
    let delivery = Arc::new(Delivery::new(Channel::System, sink, failure));
    let capture = system_audio::start(&[], true, Format::Share, delivery)
        .map_err(StartFailure::into_error)?;
    Ok(Running {
        native: NativeCapture::System(capture),
    })
}

pub(crate) fn capabilities() -> Capabilities {
    let system = system_audio::supported();
    Capabilities {
        mic: true,
        system_audio: system,
        process_audio: system,
        exclude_self: system,
    }
}
