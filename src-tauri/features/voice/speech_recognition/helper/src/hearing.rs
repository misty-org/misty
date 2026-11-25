use std::collections::{HashMap, VecDeque};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};

use sherpa_onnx::{SileroVadModelConfig, VadModelConfig, VoiceActivityDetector};

use voice_speech::{reason, HearingEvent, VadSpec, SAMPLE_RATE};

use crate::recognizer::Recognizer;

pub(crate) const WINDOW: usize = 512;
pub(crate) const LEAD: usize = SAMPLE_RATE as usize / 2;
const KEPT: usize = SAMPLE_RATE as usize * 2;

pub(crate) fn lead_in(from: i64, kept: &[f32], start: i64) -> &[f32] {
    let first = (start - LEAD as i64).max(from);
    let last = start.min(from + kept.len() as i64);
    if last <= first {
        return &[];
    }
    &kept[(first - from) as usize..(last - from) as usize]
}

pub(crate) fn detector(vad: &VadSpec) -> Option<VoiceActivityDetector> {
    let config = VadModelConfig {
        silero_vad: SileroVadModelConfig {
            model: Some(vad.model.to_string_lossy().into_owned()),
            threshold: 0.5,
            min_silence_duration: 0.55,
            min_speech_duration: 0.05,
            window_size: WINDOW as i32,
            max_speech_duration: 60.0,
        },
        sample_rate: SAMPLE_RATE,
        num_threads: 1,
        provider: Some("cpu".into()),
        debug: false,
        ..VadModelConfig::default()
    };
    VoiceActivityDetector::create(&config, 90.0)
}

struct Input {
    detector: VoiceActivityDetector,
    pending: Vec<f32>,
    speaking: bool,
    generation: u64,
    fed: i64,
    recent: VecDeque<f32>,
    lead: Vec<f32>,
    lead_from: i64,
}

impl Input {
    fn accept(&mut self, window: &[f32]) {
        self.detector.accept_waveform(window);
        self.fed += window.len() as i64;
        self.recent.extend(window.iter().copied());
        let over = self.recent.len().saturating_sub(KEPT);
        self.recent.drain(..over);
    }

    fn forget(&mut self) {
        self.fed = 0;
        self.recent.clear();
        self.lead.clear();
        self.lead_from = 0;
    }
}

struct Job {
    input: String,
    generation: u64,
    samples: Vec<f32>,
    offset: f64,
}

type Notify = Arc<dyn Fn(HearingEvent) + Send + Sync>;

pub struct Hearing {
    vad: VadSpec,
    inputs: Mutex<HashMap<String, Input>>,
    jobs: Mutex<Option<Sender<Job>>>,
    generations: Arc<Mutex<HashMap<String, u64>>>,
    next_generation: std::sync::atomic::AtomicU64,
    notify: Notify,
}

impl Hearing {
    pub fn open(
        recognizer: Arc<Recognizer>,
        vad: VadSpec,
        notify: impl Fn(HearingEvent) + Send + Sync + 'static,
    ) -> Self {
        let notify: Notify = Arc::new(notify);
        let (jobs, queue) = channel::<Job>();
        let generations: Arc<Mutex<HashMap<String, u64>>> = Arc::default();
        let worker_notify = notify.clone();
        let worker_generations = generations.clone();
        std::thread::spawn(move || {
            for job in queue {
                let current = worker_generations
                    .lock()
                    .ok()
                    .and_then(|map| map.get(&job.input).copied());
                if current != Some(job.generation) {
                    continue;
                }
                let phrase = recognizer.recognize(&job.samples, job.offset);
                let still = worker_generations
                    .lock()
                    .ok()
                    .and_then(|map| map.get(&job.input).copied());
                if still == Some(job.generation) {
                    worker_notify(HearingEvent::Heard {
                        input: job.input,
                        phrase,
                    });
                }
            }
            worker_notify(HearingEvent::Closed);
        });
        Self {
            vad,
            inputs: Mutex::default(),
            jobs: Mutex::new(Some(jobs)),
            generations,
            next_generation: std::sync::atomic::AtomicU64::new(0),
            notify,
        }
    }

    fn generation(&self) -> u64 {
        self.next_generation
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            + 1
    }

    pub fn push(&self, input: &str, samples: &[f32]) -> Result<(), String> {
        let mut told = Vec::new();
        {
            let mut inputs = self.inputs.lock().map_err(|_| reason("failed"))?;
            if !inputs.contains_key(input) {
                let detector = detector(&self.vad).ok_or_else(|| reason("model"))?;
                let generation = self.generation();
                inputs.insert(
                    input.to_string(),
                    Input {
                        detector,
                        pending: Vec::new(),
                        speaking: false,
                        generation,
                        fed: 0,
                        recent: VecDeque::new(),
                        lead: Vec::new(),
                        lead_from: 0,
                    },
                );
                if let Ok(mut map) = self.generations.lock() {
                    map.insert(input.to_string(), generation);
                }
            }
            let Some(state) = inputs.get_mut(input) else {
                return Ok(());
            };
            state.pending.extend_from_slice(samples);
            let whole = state.pending.len() / WINDOW * WINDOW;
            let ready: Vec<f32> = state.pending.drain(..whole).collect();
            for window in ready.chunks(WINDOW) {
                state.accept(window);
                self.step(input, state, &mut told);
            }
        }
        for event in told {
            (self.notify)(event);
        }
        Ok(())
    }

    pub fn flush(&self, input: &str) {
        let mut told = Vec::new();
        {
            let Ok(mut inputs) = self.inputs.lock() else {
                return;
            };
            if let Some(state) = inputs.get_mut(input) {
                if !state.pending.is_empty() {
                    let mut last = std::mem::take(&mut state.pending);
                    last.resize(WINDOW, 0.0);
                    state.accept(&last);
                }
                state.detector.flush();
                self.step(input, state, &mut told);
                if state.speaking {
                    state.speaking = false;
                    state.lead.clear();
                    told.push(HearingEvent::Stopped {
                        input: input.to_string(),
                    });
                }
            }
        }
        for event in told {
            (self.notify)(event);
        }
    }

    pub fn reset(&self, input: &str) {
        let Ok(mut inputs) = self.inputs.lock() else {
            return;
        };
        if let Some(state) = inputs.get_mut(input) {
            state.detector.reset();
            state.forget();
            state.pending.clear();
            state.speaking = false;
            state.generation = self.generation();
            if let Ok(mut map) = self.generations.lock() {
                map.insert(input.to_string(), state.generation);
            }
        }
    }

    pub fn remove(&self, input: &str) {
        if let Ok(mut inputs) = self.inputs.lock() {
            inputs.remove(input);
        }
        if let Ok(mut map) = self.generations.lock() {
            map.remove(input);
        }
    }

    pub fn inputs(&self) -> Vec<String> {
        self.inputs
            .lock()
            .map(|inputs| inputs.keys().cloned().collect())
            .unwrap_or_default()
    }

    pub fn close(&self) {
        for input in self.inputs() {
            self.flush(&input);
        }
        if let Ok(mut inputs) = self.inputs.lock() {
            inputs.clear();
        }
        if let Ok(mut jobs) = self.jobs.lock() {
            jobs.take();
        }
    }

    fn step(&self, input: &str, state: &mut Input, told: &mut Vec<HearingEvent>) {
        let detected = state.detector.detected();
        if detected && !state.speaking {
            state.speaking = true;
            state.lead = state.recent.iter().copied().collect();
            state.lead_from = state.fed - state.lead.len() as i64;
            told.push(HearingEvent::Started {
                input: input.to_string(),
            });
        }
        let mut finished = false;
        while let Some(segment) = state.detector.front() {
            let start = segment.start() as i64;
            let lead = lead_in(state.lead_from, &state.lead, start);
            let mut samples = Vec::with_capacity(lead.len() + segment.samples().len());
            samples.extend_from_slice(lead);
            samples.extend_from_slice(segment.samples());
            let job = Job {
                input: input.to_string(),
                generation: state.generation,
                samples,
                offset: (start - lead.len() as i64) as f64 / SAMPLE_RATE as f64,
            };
            drop(segment);
            state.detector.pop();
            if let Ok(jobs) = self.jobs.lock() {
                if let Some(jobs) = jobs.as_ref() {
                    let _ = jobs.send(job);
                }
            }
            finished = true;
        }
        if finished && !detected && state.speaking {
            state.speaking = false;
            state.lead.clear();
            told.push(HearingEvent::Stopped {
                input: input.to_string(),
            });
        }
    }
}

impl Drop for Hearing {
    fn drop(&mut self) {
        self.close();
    }
}
