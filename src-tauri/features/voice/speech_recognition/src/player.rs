//! Playing speech through the computer's default output (cpal). Each playback runs on a thread
//! of its own, which owns the output stream until the speech has been played or is stopped.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};

use crate::{reason, Speech};

/// A playback under way; `wait` returns once it has ended, played through or stopped.
pub struct Playback {
    done: std::sync::mpsc::Receiver<Result<(), String>>,
}

impl Playback {
    pub fn wait(self) -> Result<(), String> {
        self.done.recv().unwrap_or(Ok(()))
    }
}

/// Plays `speech` on the default output and returns at once with its playback. Setting `stopped`
/// ends it: the output reads it with every buffer it fills, so nothing has to watch it.
pub fn play(speech: Speech, stopped: Arc<AtomicBool>) -> Playback {
    let (done, finished) = channel();
    std::thread::spawn(move || {
        let _ = done.send(run(speech, stopped));
    });
    Playback { done: finished }
}

fn run(speech: Speech, stopped: Arc<AtomicBool>) -> Result<(), String> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or_else(|| reason("output"))?;
    let supported = device
        .default_output_config()
        .map_err(|_| reason("output"))?;
    let format = supported.sample_format();
    let config: StreamConfig = supported.config();
    let channels = config.channels.max(1) as usize;
    let rate = config.sample_rate.0;
    // The speech at the output's own rate, by linear interpolation: plenty for a voice.
    let samples = Arc::new(at_rate(&speech.samples, speech.rate, rate));
    let position = Arc::new(Mutex::new(0usize));
    let (ended, end) = channel::<()>();
    let error = |_: cpal::StreamError| {};

    macro_rules! stream_of {
        ($kind:ty, $convert:expr) => {{
            let samples = samples.clone();
            let position = position.clone();
            let stopped = stopped.clone();
            let ended = ended.clone();
            device.build_output_stream(
                &config,
                move |data: &mut [$kind], _: &cpal::OutputCallbackInfo| {
                    let mut at = position.lock().map(|guard| *guard).unwrap_or(usize::MAX);
                    let stop = stopped.load(Ordering::SeqCst);
                    for frame in data.chunks_mut(channels) {
                        let value = if stop { None } else { samples.get(at).copied() };
                        let sample: f32 = value.unwrap_or(0.0);
                        for slot in frame.iter_mut() {
                            *slot = $convert(sample);
                        }
                        if value.is_some() {
                            at += 1;
                        }
                    }
                    if let Ok(mut guard) = position.lock() {
                        *guard = at;
                    }
                    if stop || at >= samples.len() {
                        let _ = ended.send(());
                    }
                },
                error,
                None,
            )
        }};
    }

    let stream = match format {
        SampleFormat::F32 => stream_of!(f32, |sample: f32| sample),
        SampleFormat::I16 => stream_of!(i16, |sample: f32| (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16),
        SampleFormat::U16 => stream_of!(u16, |sample: f32| ((sample.clamp(-1.0, 1.0) * 0.5 + 0.5) * u16::MAX as f32) as u16),
        SampleFormat::I32 => stream_of!(i32, |sample: f32| (sample.clamp(-1.0, 1.0) as f64 * i32::MAX as f64) as i32),
        _ => return Err(reason("output")),
    }
    .map_err(|_| reason("output"))?;
    stream.play().map_err(|_| reason("output"))?;
    // The longest it can take, so a device that stops calling back never holds the thread.
    let seconds = samples.len() as f64 / rate.max(1) as f64;
    let _ = end.recv_timeout(Duration::from_secs_f64(seconds + 2.0));
    // Let the last buffer reach the speakers before the stream closes.
    std::thread::sleep(Duration::from_millis(60));
    drop(stream);
    Ok(())
}

fn at_rate(samples: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || samples.is_empty() || from == 0 {
        return samples.to_vec();
    }
    let ratio = from as f64 / to as f64;
    let length = (samples.len() as f64 / ratio).floor() as usize;
    (0..length)
        .map(|index| {
            let position = index as f64 * ratio;
            let left = position.floor() as usize;
            let right = (left + 1).min(samples.len() - 1);
            let fraction = (position - left as f64) as f32;
            samples[left] * (1.0 - fraction) + samples[right] * fraction
        })
        .collect()
}
