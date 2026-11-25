use std::collections::{BTreeSet, HashMap};
use std::io::{BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};

use crate::protocol::{self, bytes_to_samples, samples_to_bytes, Answer, Call, Message, Request};
use crate::{reason, HearingEvent, HearingSpec, Phrase, VadSpec, SAMPLE_RATE};

pub type Launch = fn() -> Result<Command, String>;

type Reply = (Result<Answer, String>, Vec<u8>);
type Notify = Arc<dyn Fn(HearingEvent) + Send + Sync>;

static LAUNCH: OnceLock<Launch> = OnceLock::new();
static CURRENT: Mutex<Option<Arc<Connection>>> = Mutex::new(None);
static CALLS: AtomicU64 = AtomicU64::new(1);

pub fn use_helper(launch: Launch) {
    let _ = LAUNCH.set(launch);
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

struct Route {
    notify: Notify,
    closing: bool,
}

struct Connection {
    input: Mutex<ChildStdin>,
    waiting: Mutex<HashMap<u64, Sender<Reply>>>,
    routes: Mutex<HashMap<u64, Route>>,
    alive: AtomicBool,
}

impl Connection {
    fn alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    fn write(&self, id: u64, request: Request, payload: &[u8]) -> Result<(), String> {
        let frame =
            protocol::encode(&Call { id, request }, payload).map_err(|_| reason("failed"))?;
        let mut input = lock(&self.input);
        let written = input.write_all(&frame).and_then(|_| input.flush());
        drop(input);
        if written.is_err() {
            self.fail();
            return Err(reason("failed"));
        }
        Ok(())
    }

    fn call(&self, request: Request, payload: &[u8]) -> Result<(Answer, Vec<u8>), String> {
        let id = CALLS.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = channel();
        {
            let mut waiting = lock(&self.waiting);
            if !self.alive() {
                return Err(reason("failed"));
            }
            waiting.insert(id, sender);
        }
        if let Err(error) = self.write(id, request, payload) {
            lock(&self.waiting).remove(&id);
            return Err(error);
        }
        match receiver.recv() {
            Ok((Ok(answer), bytes)) => Ok((answer, bytes)),
            Ok((Err(error), _)) => Err(error),
            Err(_) => Err(reason("failed")),
        }
    }

    fn send(&self, request: Request) {
        if self.alive() {
            let _ = self.write(CALLS.fetch_add(1, Ordering::SeqCst), request, &[]);
        }
    }

    fn follow(&self, hearing: u64, notify: Notify) {
        lock(&self.routes).insert(
            hearing,
            Route {
                notify,
                closing: false,
            },
        );
    }

    fn closing(&self, hearing: u64) {
        if let Some(route) = lock(&self.routes).get_mut(&hearing) {
            route.closing = true;
        }
    }

    fn route(&self, hearing: u64, event: HearingEvent) {
        let notify = {
            let mut routes = lock(&self.routes);
            let notify = routes.get(&hearing).map(|route| route.notify.clone());
            if event == HearingEvent::Closed {
                routes.remove(&hearing);
            }
            notify
        };
        if let Some(notify) = notify {
            notify(event);
        }
    }

    fn fail(&self) {
        let waiting = {
            let mut waiting = lock(&self.waiting);
            self.alive.store(false, Ordering::SeqCst);
            std::mem::take(&mut *waiting)
        };
        drop(waiting);
        let closing: Vec<Notify> = lock(&self.routes)
            .drain()
            .filter(|(_, route)| route.closing)
            .map(|(_, route)| route.notify)
            .collect();
        for notify in closing {
            notify(HearingEvent::Closed);
        }
    }

    fn read(&self, output: ChildStdout, mut child: Child) {
        let mut output = BufReader::new(output);
        while let Ok(Some((message, payload))) = protocol::read_frame::<Message>(&mut output) {
            match message {
                Message::Reply { id, answer } => {
                    if let Some(waiting) = lock(&self.waiting).remove(&id) {
                        let _ = waiting.send((answer, payload));
                    }
                }
                Message::Event { hearing, event } => self.route(hearing, event),
            }
        }
        let _ = child.kill();
        let _ = child.wait();
        self.fail();
    }
}

fn connection() -> Result<Arc<Connection>, String> {
    let mut current = lock(&CURRENT);
    if let Some(open) = current.as_ref().filter(|open| open.alive()) {
        return Ok(open.clone());
    }
    let launch = LAUNCH.get().ok_or_else(|| reason("failed"))?;
    let mut command = launch()?;
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    let mut child = command.spawn().map_err(|_| reason("failed"))?;
    let (Some(input), Some(output)) = (child.stdin.take(), child.stdout.take()) else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(reason("failed"));
    };
    let opened = Arc::new(Connection {
        input: Mutex::new(input),
        waiting: Mutex::default(),
        routes: Mutex::default(),
        alive: AtomicBool::new(true),
    });
    let reader = opened.clone();
    std::thread::Builder::new()
        .name("misty-speech".into())
        .spawn(move || reader.read(output, child))
        .map_err(|_| reason("failed"))?;
    *current = Some(opened.clone());
    Ok(opened)
}

struct Held {
    slot: Mutex<Option<(Arc<Connection>, u64)>>,
}

impl Held {
    fn new() -> Self {
        Self {
            slot: Mutex::new(None),
        }
    }

    fn get(&self, open: impl FnOnce() -> Request) -> Result<(Arc<Connection>, u64), String> {
        let mut slot = lock(&self.slot);
        if let Some((connection, handle)) = slot.as_ref().filter(|(open, _)| open.alive()) {
            return Ok((connection.clone(), *handle));
        }
        let connection = connection()?;
        let Answer::Opened { handle } = connection.call(open(), &[])?.0 else {
            return Err(reason("failed"));
        };
        *slot = Some((connection.clone(), handle));
        Ok((connection, handle))
    }
}

impl Drop for Held {
    fn drop(&mut self) {
        if let Some((connection, handle)) = lock(&self.slot).take() {
            connection.send(Request::Forget { handle });
        }
    }
}

pub struct Recognizer {
    spec: HearingSpec,
    language: Option<String>,
    held: Held,
}

impl Recognizer {
    pub fn open(spec: &HearingSpec, language: Option<&str>) -> Result<Self, String> {
        let recognizer = Self {
            spec: spec.clone(),
            language: language.map(str::to_string),
            held: Held::new(),
        };
        recognizer.handle()?;
        Ok(recognizer)
    }

    fn handle(&self) -> Result<(Arc<Connection>, u64), String> {
        self.held.get(|| Request::OpenRecognizer {
            spec: self.spec.clone(),
            language: self.language.clone(),
        })
    }

    pub fn recognize(&self, samples: &[f32], offset: f64) -> Phrase {
        let heard = self.handle().and_then(|(connection, recognizer)| {
            connection.call(
                Request::Recognize { recognizer, offset },
                &samples_to_bytes(samples),
            )
        });
        match heard {
            Ok((Answer::Phrase { phrase }, _)) => phrase,
            _ => Phrase {
                start: offset,
                end: offset + samples.len() as f64 / SAMPLE_RATE as f64,
                ..Phrase::default()
            },
        }
    }
}

fn phrases(answer: (Answer, Vec<u8>)) -> Result<Vec<crate::Phrase>, String> {
    match answer.0 {
        Answer::Phrases { phrases } => Ok(phrases),
        _ => Err(reason("failed")),
    }
}

pub fn recognize_file(
    recognizer: &Recognizer,
    vad: &VadSpec,
    path: &Path,
) -> Result<Vec<Phrase>, String> {
    let (connection, handle) = recognizer.handle()?;
    phrases(connection.call(
        Request::RecognizeFile {
            recognizer: handle,
            vad: vad.clone(),
            path: path.to_path_buf(),
        },
        &[],
    )?)
}

pub fn recognize_samples(
    recognizer: &Recognizer,
    vad: &VadSpec,
    samples: &[f32],
) -> Result<Vec<Phrase>, String> {
    let (connection, handle) = recognizer.handle()?;
    phrases(connection.call(
        Request::RecognizeSamples {
            recognizer: handle,
            vad: vad.clone(),
        },
        &samples_to_bytes(samples),
    )?)
}

pub fn decode_file(path: &Path) -> Result<Vec<f32>, String> {
    let (answer, bytes) = connection()?.call(
        Request::DecodeFile {
            path: path.to_path_buf(),
        },
        &[],
    )?;
    match answer {
        Answer::Samples => Ok(bytes_to_samples(&bytes)),
        _ => Err(reason("file")),
    }
}

pub fn resample(samples: &[f32], rate: i32) -> Vec<f32> {
    if rate == SAMPLE_RATE || samples.is_empty() {
        return samples.to_vec();
    }
    let resampled = connection().and_then(|connection| {
        connection.call(Request::Resample { rate }, &samples_to_bytes(samples))
    });
    match resampled {
        Ok((Answer::Samples, bytes)) => bytes_to_samples(&bytes),
        _ => samples.to_vec(),
    }
}

pub struct Hearing {
    recognizer: Arc<Recognizer>,
    vad: VadSpec,
    notify: Notify,
    slot: Mutex<Option<(Arc<Connection>, u64)>>,
    inputs: Mutex<BTreeSet<String>>,
    closed: AtomicBool,
}

impl Hearing {
    pub fn open(
        recognizer: Arc<Recognizer>,
        vad: VadSpec,
        notify: impl Fn(HearingEvent) + Send + Sync + 'static,
    ) -> Self {
        Self {
            recognizer,
            vad,
            notify: Arc::new(notify),
            slot: Mutex::new(None),
            inputs: Mutex::default(),
            closed: AtomicBool::new(false),
        }
    }

    fn held(&self) -> Result<(Arc<Connection>, u64), String> {
        let mut slot = lock(&self.slot);
        if let Some((connection, hearing)) = slot.as_ref().filter(|(open, _)| open.alive()) {
            return Ok((connection.clone(), *hearing));
        }
        let (connection, recognizer) = self.recognizer.handle()?;
        let Answer::Opened { handle } = connection
            .call(
                Request::OpenHearing {
                    recognizer,
                    vad: self.vad.clone(),
                },
                &[],
            )?
            .0
        else {
            return Err(reason("failed"));
        };
        connection.follow(handle, self.notify.clone());
        *slot = Some((connection.clone(), handle));
        Ok((connection, handle))
    }

    fn open_now(&self) -> Option<(Arc<Connection>, u64)> {
        lock(&self.slot)
            .as_ref()
            .filter(|(open, _)| open.alive())
            .cloned()
    }

    pub fn push(&self, input: &str, samples: &[f32]) -> Result<(), String> {
        if self.closed.load(Ordering::SeqCst) {
            return Ok(());
        }
        let (connection, hearing) = self.held()?;
        connection.call(
            Request::Push {
                hearing,
                input: input.to_string(),
            },
            &samples_to_bytes(samples),
        )?;
        lock(&self.inputs).insert(input.to_string());
        Ok(())
    }

    pub fn flush(&self, input: &str) {
        if let Some((connection, hearing)) = self.open_now() {
            let input = input.to_string();
            let _ = connection.call(Request::Flush { hearing, input }, &[]);
        }
    }

    pub fn reset(&self, input: &str) {
        if let Some((connection, hearing)) = self.open_now() {
            let input = input.to_string();
            let _ = connection.call(Request::Reset { hearing, input }, &[]);
        }
    }

    pub fn remove(&self, input: &str) {
        lock(&self.inputs).remove(input);
        if let Some((connection, hearing)) = self.open_now() {
            let input = input.to_string();
            let _ = connection.call(Request::Remove { hearing, input }, &[]);
        }
    }

    pub fn inputs(&self) -> Vec<String> {
        lock(&self.inputs).iter().cloned().collect()
    }

    pub fn close(&self) {
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        lock(&self.inputs).clear();
        let open = lock(&self.slot).take().filter(|(open, _)| open.alive());
        match open {
            Some((connection, hearing)) => {
                connection.closing(hearing);
                let _ = connection.call(Request::CloseHearing { hearing }, &[]);
            }
            None => (self.notify)(HearingEvent::Closed),
        }
    }
}

impl Drop for Hearing {
    fn drop(&mut self) {
        self.close();
    }
}
