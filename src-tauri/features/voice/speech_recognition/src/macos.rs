//! Speech on macOS, straight from Rust through objc2: Apple's Speech framework recognizes what is
//! said (on-device wherever the language has an on-device model), AVAudioEngine opens the
//! microphone, and AVSpeechSynthesizer reads sentences aloud in a system voice.
//!
//! Speech has no objc2 bindings of its own, so its few classes are messaged by name. Every call
//! runs inside an autorelease pool, since the callers are Rust threads with none of their own.

use crate::{reason, Heard, Phrase, StreamHeard};
use block2::RcBlock;
use objc2::rc::{autoreleasepool, Allocated, Retained};
use objc2::runtime::{AnyClass, AnyObject, Bool, NSObject, NSObjectProtocol};
use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass};
use std::ffi::{c_char, CStr, CString};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

#[link(name = "Speech", kind = "framework")]
extern "C" {}

#[link(name = "AVFoundation", kind = "framework")]
extern "C" {
    static AVMediaTypeAudio: &'static AnyObject;
}

#[link(name = "AVFAudio", kind = "framework")]
extern "C" {
    static AVSpeechUtteranceDefaultSpeechRate: f32;
    static AVSpeechUtteranceMinimumSpeechRate: f32;
    static AVSpeechUtteranceMaximumSpeechRate: f32;
}

/// The rate of the audio Misty feeds in (a capture's channel: 16 kHz mono PCM16).
const FED_RATE: f64 = 16_000.0;

fn class(name: &CStr) -> Option<&'static AnyClass> {
    AnyClass::get(name)
}

fn ns_string(text: &str) -> Option<Retained<AnyObject>> {
    let text = CString::new(text.replace('\0', " ")).ok()?;
    let strings = class(c"NSString")?;
    // SAFETY: the C string outlives the call; NSString copies it.
    unsafe { msg_send![strings, stringWithUTF8String: text.as_ptr()] }
}

fn rust_string(value: Option<&AnyObject>) -> String {
    let Some(value) = value else {
        return String::new();
    };
    // SAFETY: `value` is an NSString; its UTF-8 lives as long as the string, which outlives this.
    let raw: *const c_char = unsafe { msg_send![value, UTF8String] };
    if raw.is_null() {
        return String::new();
    }
    // SAFETY: a NUL-terminated string from NSString.
    unsafe { CStr::from_ptr(raw) }
        .to_string_lossy()
        .into_owned()
}

/// `SFSpeechRecognizerAuthorizationStatus.authorized`, and `AVAuthorizationStatus.authorized`.
const AUTHORIZED: isize = 3;
/// Both enums start at "not determined".
const NOT_DETERMINED: isize = 0;

/// Asks once for permission to recognize speech; answers whether it's given.
fn authorized() -> bool {
    let Some(recognizers) = class(c"SFSpeechRecognizer") else {
        return false;
    };
    // SAFETY: a class method with no arguments, answering an NSInteger.
    let status: isize = unsafe { msg_send![recognizers, authorizationStatus] };
    match status {
        AUTHORIZED => true,
        NOT_DETERMINED => {
            let (tell, told) = mpsc::channel();
            let answered = RcBlock::new(move |status: isize| {
                let _ = tell.send(status == AUTHORIZED);
            });
            // SAFETY: the block is copied by the framework and called once.
            let _: () = unsafe { msg_send![recognizers, requestAuthorization: &*answered] };
            told.recv_timeout(Duration::from_secs(120)).unwrap_or(false)
        }
        _ => false,
    }
}

/// Asks once for the microphone; answers whether it's allowed. Speech recognition being allowed
/// says nothing about the microphone, and an engine opened on a microphone that isn't allowed yet
/// reports an empty format, which AVAudioEngine answers with an exception that ends the app.
fn microphone_allowed() -> bool {
    let Some(devices) = class(c"AVCaptureDevice") else {
        return false;
    };
    // SAFETY: AVMediaTypeAudio is a constant NSString exported by AVFoundation.
    let audio = unsafe { AVMediaTypeAudio };
    // SAFETY: a class method taking a media type, answering an NSInteger.
    let status: isize = unsafe { msg_send![devices, authorizationStatusForMediaType: audio] };
    match status {
        AUTHORIZED => true,
        NOT_DETERMINED => {
            let (tell, told) = mpsc::channel();
            let answered = RcBlock::new(move |allowed: Bool| {
                let _ = tell.send(allowed.as_bool());
            });
            // SAFETY: the block is copied by the framework and called once.
            let _: () = unsafe {
                msg_send![devices, requestAccessForMediaType: audio, completionHandler: &*answered]
            };
            told.recv_timeout(Duration::from_secs(120)).unwrap_or(false)
        }
        _ => false,
    }
}

/// A recognizer for `locale`, or the system's language when none is given.
fn recognizer(locale: Option<&str>) -> Option<Retained<AnyObject>> {
    let recognizers = class(c"SFSpeechRecognizer")?;
    let wanted = locale.map(str::trim).filter(|value| !value.is_empty());
    let made: Option<Retained<AnyObject>> = match wanted {
        // SAFETY: plain `new`; nil when the system's language has no recognizer.
        None => unsafe { msg_send![recognizers, new] },
        Some(identifier) => {
            let identifier = ns_string(identifier)?;
            let locales = class(c"NSLocale")?;
            // SAFETY: a class method taking an identifier, answering a locale.
            let locale: Retained<AnyObject> =
                unsafe { msg_send![locales, localeWithLocaleIdentifier: &*identifier] };
            // SAFETY: alloc then the designated initializer; nil for a language with none.
            let blank: Allocated<AnyObject> = unsafe { msg_send![recognizers, alloc] };
            unsafe { msg_send![blank, initWithLocale: &*locale] }
        }
    };
    let made = made?;
    // Results arrive on a queue of their own, never the main one a caller may be waiting on.
    if let Some(queues) = class(c"NSOperationQueue") {
        // SAFETY: plain `new`, and a property taking a queue.
        let queue: Retained<AnyObject> = unsafe { msg_send![queues, new] };
        let _: () = unsafe { msg_send![&made, setQueue: &*queue] };
    }
    Some(made)
}

fn available(recognizer: &AnyObject) -> bool {
    // SAFETY: a BOOL property.
    unsafe { msg_send![recognizer, isAvailable] }
}

/// On-device wherever the language allows, with punctuation.
fn prepare(request: &AnyObject, recognizer: &AnyObject) {
    // SAFETY: BOOL properties of SFSpeechRecognizer and SFSpeechRecognitionRequest (macOS 13+).
    unsafe {
        let on_device: bool = msg_send![recognizer, supportsOnDeviceRecognition];
        if on_device {
            let _: () = msg_send![request, setRequiresOnDeviceRecognition: true];
        }
        let _: () = msg_send![request, setAddsPunctuation: true];
    }
}

/// The words of a recognition result so far, and whether they're final.
fn result_words(result: &AnyObject) -> (String, bool) {
    // SAFETY: SFSpeechRecognitionResult's transcription and its formatted string.
    unsafe {
        let best: Option<Retained<AnyObject>> = msg_send![result, bestTranscription];
        let text: Option<Retained<AnyObject>> = best
            .as_deref()
            .and_then(|best| msg_send![best, formattedString]);
        let done: bool = msg_send![result, isFinal];
        (rust_string(text.as_deref()), done)
    }
}

/// What a recognition task's handler gets: a result, an error, or both.
type TaskHandler = RcBlock<dyn Fn(*mut AnyObject, *mut AnyObject)>;

/// Starts recognizing `request`; `handler` is kept alive by the caller for the task's life.
fn start_task(
    recognizer: &AnyObject,
    request: &AnyObject,
    handler: &TaskHandler,
) -> Option<Retained<AnyObject>> {
    // SAFETY: the request and handler outlive the task; the framework copies the block.
    unsafe { msg_send![recognizer, recognitionTaskWithRequest: request, resultHandler: &**handler] }
}

pub fn supported() -> bool {
    autoreleasepool(|_| recognizer(None).is_some_and(|made| available(&made)))
}

/// Recognizes a recorded file; blocks until done.
pub fn recognize_file(path: &str, locale: Option<&str>) -> Result<String, String> {
    autoreleasepool(|_| {
        if !authorized() {
            return Err(reason("denied"));
        }
        let made = recognizer(locale)
            .filter(|made| available(made))
            .ok_or_else(|| reason("unavailable"))?;
        let path = ns_string(path).ok_or_else(|| reason("failed"))?;
        let urls = class(c"NSURL").ok_or_else(|| reason("failed"))?;
        let requests =
            class(c"SFSpeechURLRecognitionRequest").ok_or_else(|| reason("unavailable"))?;
        // SAFETY: a file URL, then the request's designated initializer.
        let request: Retained<AnyObject> = unsafe {
            let url: Retained<AnyObject> = msg_send![urls, fileURLWithPath: &*path];
            let blank: Allocated<AnyObject> = msg_send![requests, alloc];
            msg_send![blank, initWithURL: &*url]
        };
        // SAFETY: a BOOL property.
        let _: () = unsafe { msg_send![&request, setShouldReportPartialResults: false] };
        prepare(&request, &made);

        struct Seen {
            text: String,
            failed: bool,
        }
        let seen = Arc::new(Mutex::new(Seen {
            text: String::new(),
            failed: false,
        }));
        let (finish, finished) = mpsc::channel::<()>();
        let handler: TaskHandler = {
            let seen = seen.clone();
            RcBlock::new(move |result: *mut AnyObject, error: *mut AnyObject| {
                let mut seen = seen.lock().unwrap();
                // SAFETY: the framework passes a live result, or nil.
                if let Some(result) = unsafe { result.as_ref() } {
                    let (text, done) = result_words(result);
                    seen.text = text;
                    if done {
                        let _ = finish.send(());
                    }
                } else if !error.is_null() {
                    seen.failed = true;
                    let _ = finish.send(());
                }
            })
        };
        let task = start_task(&made, &request, &handler);
        if finished.recv_timeout(Duration::from_secs(900)).is_err() {
            if let Some(task) = &task {
                // SAFETY: cancelling a live task.
                let _: () = unsafe { msg_send![task, cancel] };
            }
            return Err(reason("failed"));
        }
        let seen = seen.lock().unwrap();
        // Words heard before a late failure are still the recording's words.
        if seen.text.is_empty() && seen.failed {
            return Err(reason("failed"));
        }
        Ok(seen.text.clone())
    })
}

/// What the microphone has been heard to say, shared with the recognizer's handler.
#[derive(Default)]
struct ListenState {
    text: String,
    finished: bool,
    failed: bool,
}

/// The microphone, recognized as it's spoken, until stopped.
pub struct Listening {
    engine: Retained<AnyObject>,
    input: Retained<AnyObject>,
    request: Retained<AnyObject>,
    task: Option<Retained<AnyObject>>,
    state: Arc<Mutex<ListenState>>,
    // Kept alive for as long as the engine and task may call them.
    _tap: RcBlock<dyn Fn(*mut AnyObject, *mut AnyObject)>,
    _handler: TaskHandler,
}

// SAFETY: the Objective-C objects are only messaged through `&self`/`self` from the one thread
// that owns the listen at a time (speech.rs keeps each on a thread of its own); the shared state
// is behind a mutex.
unsafe impl Send for Listening {}

impl Listening {
    pub fn heard(&self) -> Heard {
        let state = self.state.lock().unwrap();
        Heard {
            text: state.text.clone(),
            done: state.finished,
            error: state.failed.then(|| "failed".to_string()),
        }
    }

    /// Stops listening and waits a moment for the last words to settle.
    pub fn stop(self) -> Heard {
        autoreleasepool(|_| {
            // SAFETY: stopping the engine before taking the tap off the bus it was put on, so no
            // buffer arrives after it, then ending the request's audio.
            unsafe {
                let _: () = msg_send![&self.engine, stop];
                let _: () = msg_send![&self.input, removeTapOnBus: 0usize];
                let _: () = msg_send![&self.request, endAudio];
            }
            let deadline = Instant::now() + Duration::from_secs(2);
            while Instant::now() < deadline {
                if self.state.lock().unwrap().finished {
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            if let Some(task) = &self.task {
                // SAFETY: finishing a live task.
                let _: () = unsafe { msg_send![task, finish] };
            }
            self.heard()
        })
    }
}

/// Starts recognizing the microphone in `locale`.
pub fn listen(locale: Option<&str>) -> Result<Listening, String> {
    autoreleasepool(|_| {
        if !authorized() {
            return Err(reason("denied"));
        }
        if !microphone_allowed() {
            return Err(reason("microphone_denied"));
        }
        let made = recognizer(locale)
            .filter(|made| available(made))
            .ok_or_else(|| reason("unavailable"))?;
        open_microphone(&made).ok_or_else(|| reason("microphone"))
    })
}

fn open_microphone(made: &AnyObject) -> Option<Listening> {
    let requests = class(c"SFSpeechAudioBufferRecognitionRequest")?;
    let engines = class(c"AVAudioEngine")?;
    // SAFETY: plain `new`s, and a BOOL property.
    let request: Retained<AnyObject> = unsafe { msg_send![requests, new] };
    let _: () = unsafe { msg_send![&request, setShouldReportPartialResults: true] };
    prepare(&request, made);
    let engine: Retained<AnyObject> = unsafe { msg_send![engines, new] };
    // SAFETY: the engine's input node, and the format of the hardware feeding it.
    let input: Retained<AnyObject> = unsafe { msg_send![&engine, inputNode] };
    let hardware: Retained<AnyObject> = unsafe { msg_send![&input, inputFormatForBus: 0usize] };
    // No microphone, or one the system hasn't opened: an empty format here would raise an
    // exception in installTap that Rust can't catch, so it is turned down instead.
    let rate: f64 = unsafe { msg_send![&hardware, sampleRate] };
    let channels: u32 = unsafe { msg_send![&hardware, channelCount] };
    if rate <= 0.0 || channels == 0 {
        return None;
    }
    let tap = {
        let request = request.clone();
        RcBlock::new(move |buffer: *mut AnyObject, _when: *mut AnyObject| {
            // SAFETY: the engine hands over a live buffer; appending is safe from its thread.
            if let Some(buffer) = unsafe { buffer.as_ref() } {
                let _: () = unsafe { msg_send![&request, appendAudioPCMBuffer: buffer] };
            }
        })
    };
    // No format of its own: the tap takes the node's, so a headset that changes its rate as its
    // microphone opens (AirPods do) doesn't mismatch it, which would also raise.
    let no_format: Option<&AnyObject> = None;
    // SAFETY: bus 0 of the input node; the block is copied and lives until the tap is removed.
    unsafe {
        let _: () = msg_send![
            &input,
            installTapOnBus: 0usize,
            bufferSize: 1024u32,
            format: no_format,
            block: &*tap
        ];
        let _: () = msg_send![&engine, prepare];
    }
    let no_error: *mut *mut AnyObject = std::ptr::null_mut();
    // SAFETY: starting the engine; a failure answers NO, which is handled.
    let started: bool = unsafe { msg_send![&engine, startAndReturnError: no_error] };
    if !started {
        let _: () = unsafe { msg_send![&input, removeTapOnBus: 0usize] };
        return None;
    }
    let state = Arc::new(Mutex::new(ListenState::default()));
    let handler: TaskHandler = {
        let state = state.clone();
        RcBlock::new(move |result: *mut AnyObject, error: *mut AnyObject| {
            let mut state = state.lock().unwrap();
            // SAFETY: the framework passes a live result, or nil.
            if let Some(result) = unsafe { result.as_ref() } {
                let (text, done) = result_words(result);
                state.text = text;
                if done {
                    state.finished = true;
                }
            }
            if !error.is_null() {
                if state.text.is_empty() {
                    state.failed = true;
                }
                state.finished = true;
            }
        })
    };
    let task = start_task(made, &request, &handler);
    Some(Listening {
        engine,
        input,
        request,
        task,
        state,
        _tap: tap,
        _handler: handler,
    })
}

/// Audio Misty already has (a capture's channel: 16 kHz mono PCM16), recognized as it's fed.
/// Each phrase the recognizer finishes is kept with its time, and a fresh request takes over,
/// so a long capture is heard to its end.
struct StreamInner {
    recognizer: Retained<AnyObject>,
    format: Retained<AnyObject>,
    state: Mutex<StreamState>,
}

struct StreamState {
    request: Retained<AnyObject>,
    task: Option<Retained<AnyObject>>,
    /// The handler of the current task, kept alive while it may still be called.
    handler: Option<TaskHandler>,
    samples: usize,
    phrase_start: usize,
    current: String,
    finished: Vec<Phrase>,
    stopping: bool,
}

fn seconds(count: usize) -> f64 {
    count as f64 / FED_RATE
}

impl StreamState {
    fn keep_current(&mut self) {
        let text = self.current.trim();
        if !text.is_empty() {
            self.finished.push(Phrase {
                text: text.to_string(),
                start: seconds(self.phrase_start),
                end: seconds(self.samples),
            });
        }
        self.current.clear();
    }

    fn heard(&self) -> StreamHeard {
        StreamHeard {
            segments: self.finished.clone(),
            current: (!self.current.is_empty()).then(|| Phrase {
                text: self.current.clone(),
                start: seconds(self.phrase_start),
                end: seconds(self.samples),
            }),
        }
    }
}

/// Starts a request for the next phrase. Called with the state locked, or before it's shared.
fn begin(inner: &Arc<StreamInner>, state: &mut StreamState) -> Option<()> {
    let requests = class(c"SFSpeechAudioBufferRecognitionRequest")?;
    // SAFETY: plain `new`, and a BOOL property.
    let next: Retained<AnyObject> = unsafe { msg_send![requests, new] };
    let _: () = unsafe { msg_send![&next, setShouldReportPartialResults: true] };
    prepare(&next, &inner.recognizer);
    let mine = Retained::as_ptr(&next) as usize;
    let handler: TaskHandler = {
        let inner = Arc::downgrade(inner);
        RcBlock::new(move |result: *mut AnyObject, error: *mut AnyObject| {
            on_phrase(&inner, mine, result, error);
        })
    };
    let task = start_task(&inner.recognizer, &next, &handler);
    state.request = next;
    state.task = task;
    state.handler = Some(handler);
    state.phrase_start = state.samples;
    state.current.clear();
    Some(())
}

fn on_phrase(
    inner: &Weak<StreamInner>,
    mine: usize,
    result: *mut AnyObject,
    error: *mut AnyObject,
) {
    let Some(inner) = inner.upgrade() else {
        return;
    };
    autoreleasepool(|_| {
        let mut state = inner.state.lock().unwrap();
        // Only the current request's words count; an older one finishing late is let go.
        if Retained::as_ptr(&state.request) as usize != mine {
            return;
        }
        let mut done = !error.is_null();
        // SAFETY: the framework passes a live result, or nil.
        if let Some(result) = unsafe { result.as_ref() } {
            let (text, last) = result_words(result);
            state.current = text;
            done |= last;
        }
        if !done {
            return;
        }
        state.keep_current();
        if !state.stopping {
            begin(&inner, &mut state);
        }
    });
}

pub struct Streaming {
    inner: Arc<StreamInner>,
}

// SAFETY: every Objective-C object in the stream is reached through its mutex, and the requests
// it messages are safe to feed from any thread.
unsafe impl Send for Streaming {}

impl Streaming {
    pub fn push(&self, pcm: &[i16]) {
        if pcm.is_empty() {
            return;
        }
        autoreleasepool(|_| {
            let Some(buffers) = class(c"AVAudioPCMBuffer") else {
                return;
            };
            let count = pcm.len() as u32;
            // SAFETY: a float buffer in the stream's own mono format, filled to its length.
            let buffer: Option<Retained<AnyObject>> = unsafe {
                let blank: Allocated<AnyObject> = msg_send![buffers, alloc];
                msg_send![blank, initWithPCMFormat: &*self.inner.format, frameCapacity: count]
            };
            let Some(buffer) = buffer else {
                return;
            };
            unsafe {
                let _: () = msg_send![&buffer, setFrameLength: count];
                let channels: *const *mut f32 = msg_send![&buffer, floatChannelData];
                if channels.is_null() || (*channels).is_null() {
                    return;
                }
                let out = std::slice::from_raw_parts_mut(*channels, pcm.len());
                for (slot, sample) in out.iter_mut().zip(pcm) {
                    *slot = f32::from(*sample) / 32_768.0;
                }
            }
            let mut state = self.inner.state.lock().unwrap();
            if state.stopping {
                return;
            }
            state.samples += pcm.len();
            // SAFETY: appending a full buffer to the current request.
            let _: () = unsafe { msg_send![&state.request, appendAudioPCMBuffer: &*buffer] };
        })
    }

    pub fn heard(&self) -> StreamHeard {
        self.inner.state.lock().unwrap().heard()
    }

    /// Ends the audio and waits a moment for the last phrase.
    pub fn stop(self) -> StreamHeard {
        autoreleasepool(|_| {
            let last = {
                let mut state = self.inner.state.lock().unwrap();
                state.stopping = true;
                state.request.clone()
            };
            // SAFETY: ending the audio of the last request.
            let _: () = unsafe { msg_send![&last, endAudio] };
            let deadline = Instant::now() + Duration::from_secs(3);
            while Instant::now() < deadline {
                let state = self.inner.state.lock().unwrap();
                let open = !state.current.is_empty()
                    && Retained::as_ptr(&state.request) == Retained::as_ptr(&last);
                drop(state);
                if !open {
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            let mut state = self.inner.state.lock().unwrap();
            state.keep_current();
            if let Some(task) = &state.task {
                // SAFETY: finishing a live task.
                let _: () = unsafe { msg_send![task, finish] };
            }
            state.heard()
        })
    }
}

/// Starts recognizing fed audio in `locale`.
pub fn stream(locale: Option<&str>) -> Result<Streaming, String> {
    autoreleasepool(|_| {
        if !authorized() {
            return Err(reason("denied"));
        }
        let made = recognizer(locale)
            .filter(|made| available(made))
            .ok_or_else(|| reason("unavailable"))?;
        let formats = class(c"AVAudioFormat").ok_or_else(|| reason("unavailable"))?;
        let requests =
            class(c"SFSpeechAudioBufferRecognitionRequest").ok_or_else(|| reason("unavailable"))?;
        // SAFETY: a standard (float, deinterleaved) mono format at the fed rate.
        let format: Option<Retained<AnyObject>> = unsafe {
            let blank: Allocated<AnyObject> = msg_send![formats, alloc];
            msg_send![blank, initStandardFormatWithSampleRate: FED_RATE, channels: 1u32]
        };
        let format = format.ok_or_else(|| reason("unavailable"))?;
        // A placeholder until `begin` puts the first real request in.
        // SAFETY: plain `new`.
        let placeholder: Retained<AnyObject> = unsafe { msg_send![requests, new] };
        let inner = Arc::new(StreamInner {
            recognizer: made,
            format,
            state: Mutex::new(StreamState {
                request: placeholder,
                task: None,
                handler: None,
                samples: 0,
                phrase_start: 0,
                current: String::new(),
                finished: Vec::new(),
                stopping: false,
            }),
        });
        {
            let mut state = inner.state.lock().unwrap();
            begin(&inner, &mut state).ok_or_else(|| reason("unavailable"))?;
        }
        Ok(Streaming { inner })
    })
}

/// What the voice has done with what it was given.
struct SpeakerCounts {
    /// Sentences queued and not yet finished or canceled.
    waiting: usize,
    /// Sentences the voice has begun reading, so what's drawn can keep pace with what's said.
    begun: usize,
    last_queued: Option<Instant>,
}

type Counts = Arc<Mutex<SpeakerCounts>>;

define_class!(
    // SAFETY: NSObject has no subclassing requirements, and this class has no Drop.
    #[unsafe(super(NSObject))]
    #[name = "MistySpeakerDelegate"]
    #[ivars = Counts]
    struct SpeakerDelegate;

    unsafe impl NSObjectProtocol for SpeakerDelegate {}

    impl SpeakerDelegate {
        #[unsafe(method(speechSynthesizer:didStartSpeechUtterance:))]
        fn did_start(&self, _synthesizer: &AnyObject, _utterance: &AnyObject) {
            self.ivars().lock().unwrap().begun += 1;
        }

        #[unsafe(method(speechSynthesizer:didFinishSpeechUtterance:))]
        fn did_finish(&self, _synthesizer: &AnyObject, _utterance: &AnyObject) {
            self.settled();
        }

        #[unsafe(method(speechSynthesizer:didCancelSpeechUtterance:))]
        fn did_cancel(&self, _synthesizer: &AnyObject, _utterance: &AnyObject) {
            self.settled();
        }
    }
);

impl SpeakerDelegate {
    fn new(counts: Counts) -> Retained<Self> {
        let this = Self::alloc().set_ivars(counts);
        // SAFETY: NSObject's `init`.
        unsafe { msg_send![super(this), init] }
    }

    fn settled(&self) {
        let mut counts = self.ivars().lock().unwrap();
        counts.waiting = counts.waiting.saturating_sub(1);
    }
}

/// A system voice reading sentences one after another as they're handed over, with no gap
/// between them (AVSpeechSynthesizer), and no new process for each.
pub struct Speaker {
    synthesizer: Retained<AnyObject>,
    // The synthesizer holds its delegate weakly, so the speaker keeps it.
    _delegate: Retained<SpeakerDelegate>,
    voice: Option<Retained<AnyObject>>,
    rate: f32,
    counts: Counts,
}

// SAFETY: AVSpeechSynthesizer may be used from any one thread at a time, which the owner of the
// speaker guarantees; the counts are behind a mutex.
unsafe impl Send for Speaker {}

/// `AVSpeechSynthesisVoiceQuality`.
const ENHANCED: isize = 2;
const PREMIUM: isize = 3;

/// The voice Settings › Voice names, as `say -v ?` lists it ("Eddy (English (US))",
/// "Ava (Premium)"), or the system's when unset or not found.
fn voice_named(name: Option<&str>) -> Option<Retained<AnyObject>> {
    let name = name.map(str::trim).filter(|value| !value.is_empty())?;
    let voices_class = class(c"AVSpeechSynthesisVoice")?;
    // SAFETY: the class's list of voices, an NSArray of AVSpeechSynthesisVoice.
    let voices: Retained<AnyObject> = unsafe { msg_send![voices_class, speechVoices] };
    let count: usize = unsafe { msg_send![&voices, count] };
    let all: Vec<Retained<AnyObject>> = (0..count)
        .map(|index| unsafe { msg_send![&voices, objectAtIndex: index] })
        .collect();
    let name_of = |voice: &AnyObject| -> String {
        let name: Option<Retained<AnyObject>> = unsafe { msg_send![voice, name] };
        rust_string(name.as_deref())
    };
    if let Some(exact) = all.iter().find(|voice| name_of(voice) == name) {
        return Some(exact.clone());
    }
    let base = name.split(" (").next().unwrap_or(name);
    let quality = if name.contains("Premium") {
        Some(PREMIUM)
    } else if name.contains("Enhanced") {
        Some(ENHANCED)
    } else {
        None
    };
    let language = class(c"NSLocale")
        .map(|locales| {
            // SAFETY: the current locale and its language code.
            let current: Retained<AnyObject> = unsafe { msg_send![locales, currentLocale] };
            let code: Option<Retained<AnyObject>> = unsafe { msg_send![&current, languageCode] };
            rust_string(code.as_deref())
        })
        .unwrap_or_default();
    let score = |voice: &AnyObject| -> u8 {
        let own: isize = unsafe { msg_send![voice, quality] };
        let spoken: Option<Retained<AnyObject>> = unsafe { msg_send![voice, language] };
        u8::from(quality == Some(own)) * 2
            + u8::from(rust_string(spoken.as_deref()).starts_with(&language))
    };
    all.into_iter()
        .filter(|voice| name_of(voice) == base)
        .max_by_key(|voice| score(voice))
}

impl Speaker {
    /// A speaker in `voice` (a name from `say -v ?`; the system's when unset) at `pace`, 1 being
    /// the voice's usual pace.
    pub fn new(voice: Option<&str>, pace: f64) -> Result<Self, String> {
        autoreleasepool(|_| {
            let couldnt = || "This computer's voice couldn't read it.".to_string();
            let synthesizers = class(c"AVSpeechSynthesizer").ok_or_else(couldnt)?;
            // SAFETY: plain `new`.
            let synthesizer: Retained<AnyObject> = unsafe { msg_send![synthesizers, new] };
            let counts: Counts = Arc::new(Mutex::new(SpeakerCounts {
                waiting: 0,
                begun: 0,
                last_queued: None,
            }));
            let delegate = SpeakerDelegate::new(counts.clone());
            // SAFETY: the delegate lives as long as the speaker, which owns the synthesizer.
            let _: () = unsafe { msg_send![&synthesizer, setDelegate: &*delegate] };
            // Settings › Voice paces from 0.5 to 2, 1 being the voice's usual pace.
            // SAFETY: constants exported by AVFAudio.
            let (usual, least, most) = unsafe {
                (
                    AVSpeechUtteranceDefaultSpeechRate,
                    AVSpeechUtteranceMinimumSpeechRate,
                    AVSpeechUtteranceMaximumSpeechRate,
                )
            };
            let paced = usual + (pace.clamp(0.5, 2.0) - 1.0) as f32 * (most - usual) * 0.5;
            Ok(Self {
                synthesizer,
                _delegate: delegate,
                voice: voice_named(voice),
                rate: paced.clamp(least, most),
                counts,
            })
        })
    }

    /// Queues `text` after what's already queued.
    pub fn say(&self, text: &str) {
        autoreleasepool(|_| {
            let Some(utterances) = class(c"AVSpeechUtterance") else {
                return;
            };
            let Some(text) = ns_string(text) else {
                return;
            };
            // SAFETY: an utterance for the text, in the chosen voice and rate, queued.
            unsafe {
                let utterance: Retained<AnyObject> =
                    msg_send![utterances, speechUtteranceWithString: &*text];
                let _: () = msg_send![&utterance, setVoice: self.voice.as_deref()];
                let _: () = msg_send![&utterance, setRate: self.rate];
                {
                    let mut counts = self.counts.lock().unwrap();
                    counts.waiting += 1;
                    counts.last_queued = Some(Instant::now());
                }
                let _: () = msg_send![&self.synthesizer, speakUtterance: &*utterance];
            }
        })
    }

    /// Whether anything queued is still being read. Should the synthesizer's callbacks not
    /// arrive, it counts as done once nothing has been read for a moment.
    pub fn busy(&self) -> bool {
        let counts = self.counts.lock().unwrap();
        if counts.waiting == 0 {
            return false;
        }
        let recent = counts
            .last_queued
            .is_some_and(|at| at.elapsed() < Duration::from_secs(2));
        drop(counts);
        // SAFETY: a BOOL property.
        let speaking: bool = unsafe { msg_send![&self.synthesizer, isSpeaking] };
        speaking || recent
    }

    /// How many of the queued sentences the voice has begun reading.
    pub fn started(&self) -> u32 {
        self.counts.lock().unwrap().begun as u32
    }
}

impl Drop for Speaker {
    /// Stops reading and lets the voice go.
    fn drop(&mut self) {
        autoreleasepool(|_| {
            // SAFETY: `AVSpeechBoundaryImmediate` is 0.
            let _: bool = unsafe { msg_send![&self.synthesizer, stopSpeakingAtBoundary: 0isize] };
        });
        self.counts.lock().unwrap().waiting = 0;
    }
}
