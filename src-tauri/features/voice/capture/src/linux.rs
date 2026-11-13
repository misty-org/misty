//! PulseAudio capture, which PipeWire serves too through `pipewire-pulse`: the default microphone,
//! everything the default output plays (its monitor), and what single apps play (monitor streams on
//! their sink inputs). The server converts every stream to 16 kHz mono PCM16 itself.
//!
//! System audio without Misty records each app's stream on its own and mixes them on a clock, so an
//! app that pauses or starts playing midway never stalls or shifts the others.

use crate::capture::{FailureSink, FrameCounter, Sink};
use crate::{AudioSource, Capabilities, CaptureError, CaptureSource, CaptureSources, SAMPLE_RATE};
use libpulse_binding as pulse;
use pulse::callbacks::ListResult;
use pulse::context::subscribe::{Facility, InterestMaskSet, Operation as Event};
use pulse::context::{Context, FlagSet as ContextFlags, State as ContextState};
use pulse::def::BufferAttr;
use pulse::mainloop::standard::{IterateResult, Mainloop};
use pulse::operation::{Operation, State as OperationState};
use pulse::proplist::{properties, Proplist};
use pulse::sample::{Format, Spec};
use pulse::stream::{FlagSet as StreamFlags, PeekResult, State as StreamState, Stream};
use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::rc::Rc;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc,
};
use std::thread;
use std::time::{Duration, Instant};

/// How long connecting, or any one request to the sound server, may take.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
/// How far the mixed system channel runs behind the clock, so every stream has delivered its part.
const MIX_DELAY: Duration = Duration::from_millis(120);
/// The most one stream may run ahead of the mix before its oldest audio is dropped.
const MAX_BACKLOG: usize = SAMPLE_RATE as usize / 2;
/// About 20 ms of audio per read.
const FRAGMENT_BYTES: u32 = SAMPLE_RATE / 50 * 2;

pub(crate) struct Running {
    stop: Arc<AtomicBool>,
    worker: thread::JoinHandle<()>,
}

impl Running {
    pub fn stop(self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = self.worker.join();
    }
}

pub(crate) fn capabilities() -> Capabilities {
    Capabilities {
        mic: true,
        system_audio: true,
        process_audio: true,
        exclude_self: true,
    }
}

fn unavailable() -> CaptureError {
    CaptureError::Unsupported("Audio capture")
}

fn device_error(what: &str) -> CaptureError {
    CaptureError::Device(what.to_owned())
}

/// A connection to the sound server, on the thread that made it.
struct Connection {
    mainloop: Mainloop,
    context: Context,
}

impl Connection {
    fn open() -> Result<Self, CaptureError> {
        let mut mainloop = Mainloop::new().ok_or_else(unavailable)?;
        let mut properties = Proplist::new().ok_or_else(unavailable)?;
        let _ = properties.set_str(properties::APPLICATION_NAME, "Misty");
        let _ = properties.set_str(properties::APPLICATION_ID, "app.misty");
        let mut context = Context::new_with_proplist(&mainloop, "Misty", &properties)
            .ok_or_else(unavailable)?;
        context
            .connect(None, ContextFlags::NOAUTOSPAWN, None)
            .map_err(|_| unavailable())?;
        let deadline = Instant::now() + REQUEST_TIMEOUT;
        loop {
            match context.get_state() {
                ContextState::Ready => break,
                ContextState::Failed | ContextState::Terminated => return Err(unavailable()),
                _ => {}
            }
            if Instant::now() > deadline {
                return Err(unavailable());
            }
            step(&mut mainloop)?;
        }
        Ok(Self { mainloop, context })
    }

    /// Runs the loop until `operation` is done.
    fn wait<T: ?Sized>(&mut self, operation: &Operation<T>) -> Result<(), CaptureError> {
        let deadline = Instant::now() + REQUEST_TIMEOUT;
        while matches!(operation.get_state(), OperationState::Running) {
            if Instant::now() > deadline {
                return Err(device_error("the sound server didn't answer"));
            }
            step(&mut self.mainloop)?;
        }
        if matches!(operation.get_state(), OperationState::Cancelled) {
            return Err(device_error("the sound server went away"));
        }
        Ok(())
    }

    /// The apps playing now, each with the sink it plays to.
    fn sink_inputs(&mut self) -> Result<Vec<SinkInput>, CaptureError> {
        let found = Rc::new(RefCell::new(Vec::new()));
        let collect = found.clone();
        let operation = self
            .context
            .introspect()
            .get_sink_input_info_list(move |result| {
                if let ListResult::Item(info) = result {
                    let read = |key: &str| info.proplist.get_str(key);
                    let mut pids: Vec<u32> = [properties::APPLICATION_PROCESS_ID, "pipewire.sec.pid"]
                        .iter()
                        .filter_map(|key| read(key)?.trim().parse().ok())
                        .collect();
                    pids.dedup();
                    let name = read(properties::APPLICATION_NAME)
                        .or_else(|| read(properties::APPLICATION_PROCESS_BINARY))
                        .or_else(|| info.name.as_ref().map(|name| name.to_string()))
                        .unwrap_or_default();
                    collect.borrow_mut().push(SinkInput {
                        index: info.index,
                        sink: info.sink,
                        pids,
                        name,
                    });
                }
            });
        self.wait(&operation)?;
        let list = found.borrow_mut().drain(..).collect();
        Ok(list)
    }

    /// The source that hears everything `sink` plays.
    fn monitor_of(&mut self, sink: u32) -> Result<String, CaptureError> {
        let found = Rc::new(RefCell::new(None));
        let collect = found.clone();
        let operation = self
            .context
            .introspect()
            .get_sink_info_by_index(sink, move |result| {
                if let ListResult::Item(info) = result {
                    *collect.borrow_mut() = info.monitor_source_name.as_ref().map(|n| n.to_string());
                }
            });
        self.wait(&operation)?;
        let name = found.borrow_mut().take();
        name.ok_or_else(|| device_error("that output has no monitor"))
    }

    /// Opens a 16 kHz mono record stream on `device` (the default microphone when `None`), limited
    /// to one app's sound when `sink_input` is given.
    fn record(&mut self, device: Option<&str>, sink_input: Option<u32>) -> Result<Stream, CaptureError> {
        let spec = Spec {
            format: Format::S16NE,
            rate: SAMPLE_RATE,
            channels: 1,
        };
        let mut stream = Stream::new(&mut self.context, "Misty capture", &spec, None)
            .ok_or_else(|| device_error("the sound server refused a stream"))?;
        if let Some(index) = sink_input {
            stream
                .set_monitor_stream(index)
                .map_err(|_| CaptureError::NoSuchProcess)?;
        }
        let attributes = BufferAttr {
            maxlength: u32::MAX,
            tlength: u32::MAX,
            prebuf: u32::MAX,
            minreq: u32::MAX,
            fragsize: FRAGMENT_BYTES,
        };
        stream
            .connect_record(device, Some(&attributes), StreamFlags::ADJUST_LATENCY)
            .map_err(|_| device_error("the sound server refused a stream"))?;
        let deadline = Instant::now() + REQUEST_TIMEOUT;
        loop {
            match stream.get_state() {
                StreamState::Ready => return Ok(stream),
                StreamState::Failed | StreamState::Terminated => {
                    return Err(match sink_input {
                        Some(_) => CaptureError::NoSuchProcess,
                        None => device_error("the input couldn't be opened"),
                    })
                }
                _ => {}
            }
            if Instant::now() > deadline {
                return Err(device_error("the input didn't open in time"));
            }
            step(&mut self.mainloop)?;
        }
    }

    fn default_source_description(&mut self) -> Result<String, CaptureError> {
        let default = Rc::new(RefCell::new(None));
        let collect = default.clone();
        let operation = self.context.introspect().get_server_info(move |info| {
            *collect.borrow_mut() = info.default_source_name.as_ref().map(|n| n.to_string());
        });
        self.wait(&operation)?;
        let Some(name) = default.borrow_mut().take() else {
            return Ok("Microphone".into());
        };
        let described = Rc::new(RefCell::new(None));
        let collect = described.clone();
        let operation = self
            .context
            .introspect()
            .get_source_info_by_name(&name, move |result| {
                if let ListResult::Item(info) = result {
                    *collect.borrow_mut() = info.description.as_ref().map(|d| d.to_string());
                }
            });
        self.wait(&operation)?;
        let description = described.borrow_mut().take();
        Ok(description.unwrap_or_else(|| "Microphone".into()))
    }
}

/// One pass of the loop without blocking, then a short rest so the thread doesn't spin.
fn step(mainloop: &mut Mainloop) -> Result<(), CaptureError> {
    match mainloop.iterate(false) {
        IterateResult::Success(0) => thread::sleep(Duration::from_millis(5)),
        IterateResult::Success(_) => {}
        IterateResult::Quit(_) | IterateResult::Err(_) => {
            return Err(device_error("the sound server connection failed"))
        }
    }
    Ok(())
}

struct SinkInput {
    index: u32,
    sink: u32,
    pids: Vec<u32>,
    name: String,
}

/// The parent of `pid`, from `/proc/<pid>/stat` (the field after the command name, which may hold
/// spaces and parentheses itself). `/proc` is the kernel's view of processes, not anyone's files.
#[allow(clippy::disallowed_methods)]
fn parent_of(pid: u32) -> Option<u32> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let rest = &stat[stat.rfind(')')? + 1..];
    rest.split_whitespace().nth(1)?.parse().ok()
}

/// Whether `pid` is one of `roots` or started under one of them, as Windows counts a process tree.
fn in_tree(pid: u32, roots: &[u32]) -> bool {
    let mut current = pid;
    for _ in 0..64 {
        if roots.contains(&current) {
            return true;
        }
        match parent_of(current) {
            Some(parent) if parent > 1 && parent != current => current = parent,
            _ => return false,
        }
    }
    false
}

/// Which apps' sound a capture hears.
enum Wanted {
    /// Every app except Misty and the processes it started (its web content included).
    AllBut(Vec<u32>),
    /// These processes and the ones they started.
    Only(Vec<u32>),
}

impl Wanted {
    fn takes(&self, input: &SinkInput) -> bool {
        match self {
            Wanted::AllBut(own) => !input.pids.iter().any(|pid| in_tree(*pid, own)),
            Wanted::Only(roots) => input.pids.iter().any(|pid| in_tree(*pid, roots)),
        }
    }
}

pub(crate) fn start(
    source: AudioSource,
    sink: Sink,
    failure: FailureSink,
) -> Result<Running, CaptureError> {
    let stop = Arc::new(AtomicBool::new(false));
    let (started_tx, started_rx) = mpsc::sync_channel(1);
    let worker_stop = stop.clone();
    let worker = thread::Builder::new()
        .name(match source {
            AudioSource::Mic => "misty-pulse-microphone".into(),
            _ => "misty-pulse-monitor".into(),
        })
        .spawn(move || {
            if let Err(error) = capture_loop(&source, &worker_stop, &started_tx, &sink) {
                if started_tx.try_send(Err(error.clone())).is_err() {
                    failure(error);
                }
            }
        })
        .map_err(|error| CaptureError::Device(error.to_string()))?;
    match started_rx.recv_timeout(REQUEST_TIMEOUT * 2) {
        Ok(Ok(())) => Ok(Running { stop, worker }),
        Ok(Err(error)) => {
            let _ = worker.join();
            Err(error)
        }
        Err(_) => {
            stop.store(true, Ordering::SeqCst);
            let _ = worker.join();
            Err(device_error("audio did not start in time"))
        }
    }
}

/// Moves whatever `stream` has ready into `samples`.
fn read(stream: &mut Stream, samples: &mut VecDeque<i16>) -> Result<(), CaptureError> {
    loop {
        match stream.readable_size() {
            Some(0) => return Ok(()),
            Some(_) => {}
            None => return Err(device_error("the stream closed")),
        }
        match stream.peek().map_err(|_| device_error("the stream failed"))? {
            PeekResult::Empty => return Ok(()),
            PeekResult::Hole(bytes) => {
                samples.extend(std::iter::repeat(0).take(bytes / 2));
                stream.discard().map_err(|_| device_error("the stream failed"))?;
            }
            PeekResult::Data(bytes) => {
                samples.extend(
                    bytes
                        .chunks_exact(2)
                        .map(|pair| i16::from_ne_bytes([pair[0], pair[1]])),
                );
                stream.discard().map_err(|_| device_error("the stream failed"))?;
            }
        }
    }
}

fn capture_loop(
    source: &AudioSource,
    stop: &AtomicBool,
    started: &mpsc::SyncSender<Result<(), CaptureError>>,
    sink: &Sink,
) -> Result<(), CaptureError> {
    let mut connection = Connection::open()?;
    let channel = source.channel();
    let mut frames = FrameCounter::new();
    let wanted = match source {
        AudioSource::Mic => None,
        AudioSource::System {
            exclude_self: false,
        } => None,
        AudioSource::System { exclude_self: true } => Some(Wanted::AllBut(vec![std::process::id()])),
        AudioSource::Processes(pids) => Some(Wanted::Only(pids.clone())),
    };
    let Some(wanted) = wanted else {
        // One stream: the microphone, or the default output's whole mix.
        let device = match source {
            AudioSource::Mic => None,
            _ => Some("@DEFAULT_MONITOR@"),
        };
        let mut stream = connection.record(device, None)?;
        let _ = started.send(Ok(()));
        let mut samples = VecDeque::new();
        while !stop.load(Ordering::SeqCst) {
            step(&mut connection.mainloop)?;
            if !stream.get_state().is_good() {
                return Err(device_error("the input went away"));
            }
            read(&mut stream, &mut samples)?;
            if !samples.is_empty() {
                sink(frames.chunk(channel, samples.drain(..).collect()));
            }
        }
        let _ = stream.disconnect();
        return Ok(());
    };

    // Apps come and go while a capture runs, so the sound server reports each one.
    let changed = Rc::new(RefCell::new(true));
    let notice = changed.clone();
    connection
        .context
        .set_subscribe_callback(Some(Box::new(move |facility, event, _| {
            if facility == Some(Facility::SinkInput) && matches!(event, Some(Event::New | Event::Removed)) {
                *notice.borrow_mut() = true;
            }
        })));
    let subscribed = connection.context.subscribe(InterestMaskSet::SINK_INPUT, |_| {});
    connection.wait(&subscribed)?;

    let mut streams: HashMap<u32, (Stream, VecDeque<i16>)> = HashMap::new();
    let mut monitors: HashMap<u32, String> = HashMap::new();
    let mut opened_any = false;
    let mut announced = false;
    let clock = Instant::now();
    let mut emitted: u64 = 0;
    while !stop.load(Ordering::SeqCst) {
        if changed.replace(false) {
            let inputs = connection.sink_inputs()?;
            streams.retain(|index, _| inputs.iter().any(|input| input.index == *index));
            for input in inputs.iter().filter(|input| wanted.takes(input)) {
                if streams.contains_key(&input.index) {
                    continue;
                }
                let monitor = match monitors.get(&input.sink) {
                    Some(monitor) => monitor.clone(),
                    None => {
                        let Ok(monitor) = connection.monitor_of(input.sink) else {
                            continue;
                        };
                        monitors.insert(input.sink, monitor.clone());
                        monitor
                    }
                };
                // An app can stop between the list and the stream; the next change brings it back.
                if let Ok(stream) = connection.record(Some(&monitor), Some(input.index)) {
                    streams.insert(input.index, (stream, VecDeque::new()));
                    opened_any = true;
                }
            }
            if !announced {
                if matches!(wanted, Wanted::Only(_)) && !opened_any {
                    return Err(CaptureError::NoSuchProcess);
                }
                announced = true;
                let _ = started.send(Ok(()));
            }
        }
        step(&mut connection.mainloop)?;
        streams.retain(|_, (stream, _)| stream.get_state().is_good());
        for (stream, samples) in streams.values_mut() {
            // A stream that fails is dropped above on the next pass; the rest keep going.
            let _ = read(stream, samples);
        }
        let due = (clock.elapsed().saturating_sub(MIX_DELAY).as_micros() as u64
            * u64::from(SAMPLE_RATE)
            / 1_000_000)
            .saturating_sub(emitted) as usize;
        if due == 0 {
            continue;
        }
        let mut mixed = vec![0i32; due];
        for (_, samples) in streams.values_mut() {
            let take = due.min(samples.len());
            for (total, sample) in mixed.iter_mut().zip(samples.drain(..take)) {
                *total += i32::from(sample);
            }
            if samples.len() > MAX_BACKLOG {
                let extra = samples.len() - MAX_BACKLOG;
                samples.drain(..extra);
            }
        }
        emitted += due as u64;
        sink(frames.chunk(
            channel,
            mixed
                .into_iter()
                .map(|sample| sample.clamp(i32::from(i16::MIN), i32::from(i16::MAX)) as i16)
                .collect(),
        ));
    }
    for (mut stream, _) in streams.into_values() {
        let _ = stream.disconnect();
    }
    Ok(())
}

/// The default microphone's name and the apps playing sound now, Misty's own left out.
pub(crate) fn capture_sources() -> Result<CaptureSources, CaptureError> {
    let mut connection = Connection::open()?;
    let microphone = connection.default_source_description()?;
    let own = [std::process::id()];
    let mut apps: BTreeMap<String, Vec<u32>> = BTreeMap::new();
    for input in connection.sink_inputs()? {
        let Some(&pid) = input.pids.first() else {
            continue;
        };
        if in_tree(pid, &own) {
            continue;
        }
        let name = if input.name.trim().is_empty() {
            format!("Application {pid}")
        } else {
            input.name.trim().to_owned()
        };
        let pids = apps.entry(name).or_default();
        if !pids.contains(&pid) {
            pids.push(pid);
        }
    }
    Ok(CaptureSources {
        microphone,
        applications: apps
            .into_iter()
            .map(|(name, pids)| CaptureSource { name, pids })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn this_process_is_in_its_own_tree_and_not_in_another() {
        let own = std::process::id();
        assert!(in_tree(own, &[own]));
        assert!(!in_tree(own, &[u32::MAX - 1]));
    }
}
