#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::collections::HashMap;
use std::io::{self, BufReader, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use voice_speech::protocol::{
    self, bytes_to_samples, samples_to_bytes, Answer, Call, Message, Request,
};
use voice_speech::{reason, HearingEvent};

mod decode;
mod file;
mod hearing;
mod model;
mod recognizer;
mod voice;

use hearing::Hearing;
use recognizer::Recognizer;
use voice::Voice;

type Reply = (Result<Answer, String>, Vec<u8>);

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

struct Helper {
    output: Mutex<Box<dyn Write + Send>>,
    next: AtomicU64,
    recognizers: Mutex<HashMap<u64, Arc<Recognizer>>>,
    voices: Mutex<HashMap<u64, Arc<Voice>>>,
    hearings: Mutex<HashMap<u64, Arc<Hearing>>>,
}

fn done() -> Reply {
    (Ok(Answer::Done), Vec::new())
}

fn failed(error: String) -> Reply {
    (Err(error), Vec::new())
}

impl Helper {
    fn write(&self, message: &Message, payload: &[u8]) {
        let mut output = lock(&self.output);
        if protocol::write_frame(&mut *output, message, payload).is_err() {
            std::process::exit(0);
        }
    }

    fn reply(&self, id: u64, (answer, payload): Reply) {
        self.write(&Message::Reply { id, answer }, &payload);
    }

    fn handle(&self) -> u64 {
        self.next.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn recognizer(&self, handle: u64) -> Result<Arc<Recognizer>, String> {
        lock(&self.recognizers)
            .get(&handle)
            .cloned()
            .ok_or_else(|| reason("model"))
    }

    fn hearing(&self, handle: u64) -> Option<Arc<Hearing>> {
        lock(&self.hearings).get(&handle).cloned()
    }

    fn take(self: &Arc<Self>, call: Call, payload: Vec<u8>) {
        let Call { id, request } = call;
        match request {
            Request::OpenHearing { .. }
            | Request::Push { .. }
            | Request::Flush { .. }
            | Request::Reset { .. }
            | Request::Remove { .. }
            | Request::CloseHearing { .. }
            | Request::Forget { .. } => {
                let reply = self.quick(request, &payload);
                self.reply(id, reply);
            }
            _ => {
                let helper = self.clone();
                let started = std::thread::Builder::new().spawn(move || {
                    let reply = helper.slow(request, payload);
                    helper.reply(id, reply);
                });
                if started.is_err() {
                    self.reply(id, failed(reason("failed")));
                }
            }
        }
    }

    fn quick(self: &Arc<Self>, request: Request, payload: &[u8]) -> Reply {
        match request {
            Request::OpenHearing { recognizer, vad } => {
                let recognizer = match self.recognizer(recognizer) {
                    Ok(recognizer) => recognizer,
                    Err(error) => return failed(error),
                };
                let handle = self.handle();
                let helper = self.clone();
                let hearing = Hearing::open(recognizer, vad, move |event: HearingEvent| {
                    helper.write(
                        &Message::Event {
                            hearing: handle,
                            event,
                        },
                        &[],
                    );
                });
                lock(&self.hearings).insert(handle, Arc::new(hearing));
                (Ok(Answer::Opened { handle }), Vec::new())
            }
            Request::Push { hearing, input } => match self.hearing(hearing) {
                Some(open) => match open.push(&input, &bytes_to_samples(payload)) {
                    Ok(()) => done(),
                    Err(error) => failed(error),
                },
                None => failed(reason("failed")),
            },
            Request::Flush { hearing, input } => {
                if let Some(open) = self.hearing(hearing) {
                    open.flush(&input);
                }
                done()
            }
            Request::Reset { hearing, input } => {
                if let Some(open) = self.hearing(hearing) {
                    open.reset(&input);
                }
                done()
            }
            Request::Remove { hearing, input } => {
                if let Some(open) = self.hearing(hearing) {
                    open.remove(&input);
                }
                done()
            }
            Request::CloseHearing { hearing } => {
                let open = lock(&self.hearings).remove(&hearing);
                if let Some(open) = open {
                    open.close();
                }
                done()
            }
            Request::Forget { handle } => {
                lock(&self.recognizers).remove(&handle);
                lock(&self.voices).remove(&handle);
                done()
            }
            _ => failed(reason("failed")),
        }
    }

    fn slow(&self, request: Request, payload: Vec<u8>) -> Reply {
        let phrases = |found: Result<Vec<voice_speech::Phrase>, String>| match found {
            Ok(phrases) => (Ok(Answer::Phrases { phrases }), Vec::new()),
            Err(error) => failed(error),
        };
        match request {
            Request::OpenRecognizer { spec, language } => {
                match Recognizer::open(&spec, language.as_deref()) {
                    Ok(recognizer) => {
                        let handle = self.handle();
                        lock(&self.recognizers).insert(handle, Arc::new(recognizer));
                        (Ok(Answer::Opened { handle }), Vec::new())
                    }
                    Err(error) => failed(error),
                }
            }
            Request::Recognize { recognizer, offset } => match self.recognizer(recognizer) {
                Ok(recognizer) => {
                    let phrase = recognizer.recognize(&bytes_to_samples(&payload), offset);
                    (Ok(Answer::Phrase { phrase }), Vec::new())
                }
                Err(error) => failed(error),
            },
            Request::RecognizeSamples { recognizer, vad } => {
                phrases(self.recognizer(recognizer).and_then(|recognizer| {
                    file::recognize_samples(&recognizer, &vad, &bytes_to_samples(&payload))
                }))
            }
            Request::RecognizeFile {
                recognizer,
                vad,
                path,
            } => phrases(
                self.recognizer(recognizer)
                    .and_then(|recognizer| file::recognize_file(&recognizer, &vad, &path)),
            ),
            Request::DecodeFile { path } => match decode::decode_file(&path) {
                Ok(samples) => (Ok(Answer::Samples), samples_to_bytes(&samples)),
                Err(error) => failed(error),
            },
            Request::Resample { rate } => {
                let samples = decode::resample(&bytes_to_samples(&payload), rate);
                (Ok(Answer::Samples), samples_to_bytes(&samples))
            }
            Request::OpenVoice { spec } => match Voice::open(&spec) {
                Ok(voice) => {
                    let handle = self.handle();
                    lock(&self.voices).insert(handle, Arc::new(voice));
                    (Ok(Answer::Opened { handle }), Vec::new())
                }
                Err(error) => failed(error),
            },
            Request::Speak {
                voice,
                text,
                speaker,
                speed,
            } => {
                let open = lock(&self.voices).get(&voice).cloned();
                match open.map(|open| open.speak(&text, speaker, speed)) {
                    Some(Ok(speech)) => (
                        Ok(Answer::Speech { rate: speech.rate }),
                        samples_to_bytes(&speech.samples),
                    ),
                    Some(Err(error)) => failed(error),
                    None => failed(reason("voice")),
                }
            }
            _ => failed(reason("failed")),
        }
    }
}

#[cfg(unix)]
fn answers() -> Box<dyn Write + Send> {
    use std::os::fd::FromRawFd;
    let kept = unsafe { libc::dup(libc::STDOUT_FILENO) };
    if kept < 0 || unsafe { libc::dup2(libc::STDERR_FILENO, libc::STDOUT_FILENO) } < 0 {
        return Box::new(io::stdout());
    }
    Box::new(unsafe { std::fs::File::from_raw_fd(kept) })
}

#[cfg(not(unix))]
fn answers() -> Box<dyn Write + Send> {
    Box::new(io::stdout())
}

fn main() {
    let helper = Arc::new(Helper {
        output: Mutex::new(answers()),
        next: AtomicU64::new(0),
        recognizers: Mutex::default(),
        voices: Mutex::default(),
        hearings: Mutex::default(),
    });
    let mut input = BufReader::new(io::stdin().lock());
    while let Ok(Some((call, payload))) = protocol::read_frame::<Call>(&mut input) {
        helper.take(call, payload);
    }
    std::process::exit(0);
}
