use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

pub struct Recording {
    _stream: cpal::Stream,
    samples: Arc<Mutex<Vec<i16>>>,
    rate: u32,
    delivered: usize,
    sequence: usize,
}
impl Recording {
    pub fn start(app: AppHandle, turn: u64) -> Result<Self, String> {
        super::platform::microphone_access()?;
        let device = cpal::default_host()
            .default_input_device()
            .ok_or("No microphone is available.")?;
        let config = device.default_input_config().map_err(|e| e.to_string())?;
        let rate = config.sample_rate().0;
        let channels = config.channels() as usize;
        if rate == 0 || channels == 0 {
            return Err("The microphone's audio format is invalid.".into());
        }
        let samples = Arc::new(Mutex::new(Vec::new()));
        let error_app = app.clone();
        let error = move |e| {
            let _ = error_app.emit_to(
                "main",
                "misty://cursor-error",
                serde_json::json!({"turn":turn,"error":format!("Microphone stopped: {e}")}),
            );
        };
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => {
                let target = samples.clone();
                device.build_input_stream(
                    &config.into(),
                    move |data: &[f32], _| append(data, channels, rate, &target, &app, turn, |s| s),
                    error,
                    None,
                )
            }
            cpal::SampleFormat::I16 => {
                let target = samples.clone();
                device.build_input_stream(
                    &config.into(),
                    move |data: &[i16], _| {
                        append(data, channels, rate, &target, &app, turn, |s| {
                            s as f32 / 32768.
                        })
                    },
                    error,
                    None,
                )
            }
            cpal::SampleFormat::U16 => {
                let target = samples.clone();
                device.build_input_stream(
                    &config.into(),
                    move |data: &[u16], _| {
                        append(data, channels, rate, &target, &app, turn, |s| {
                            (s as f32 - 32768.) / 32768.
                        })
                    },
                    error,
                    None,
                )
            }
            _ => return Err("The microphone's sample format is unsupported.".into()),
        }
        .map_err(|e| format!("Microphone unavailable: {e}"))?;
        stream.play().map_err(|e| e.to_string())?;
        Ok(Self {
            _stream: stream,
            samples,
            rate,
            delivered: 0,
            sequence: 0,
        })
    }
    pub fn drain(&mut self) -> Option<(usize, Vec<u8>)> {
        let samples = self.samples.lock().ok()?;
        let (pcm, delivered) = pcm_since(&samples, self.rate, self.delivered);
        self.delivered = delivered;
        if pcm.is_empty() {
            return None;
        }
        let sequence = self.sequence;
        self.sequence += 1;
        Some((sequence, pcm))
    }
    pub fn finish(self) -> (usize, Vec<u8>, u64) {
        drop(self._stream);
        let samples = self.samples.lock().unwrap();
        let (pcm, _) = pcm_since(&samples, self.rate, self.delivered);
        (
            self.sequence,
            pcm,
            samples.len() as u64 * 1000 / self.rate as u64,
        )
    }
}
// Absolute frame indices preserve phase across chunks. Average source buckets
// when downsampling; duplicate the source sample when upsampling. Exactly 24 kHz
// mono signed PCM reaches the provider, including devices below 24 kHz.
fn pcm_since(samples: &[i16], source_rate: u32, delivered: usize) -> (Vec<u8>, usize) {
    let rate = 24_000;
    let frames = samples.len() * rate as usize / source_rate as usize;
    let mut pcm = Vec::with_capacity(frames.saturating_sub(delivered) * 2);
    for i in delivered..frames {
        let start = i * source_rate as usize / rate as usize;
        let end = ((i + 1) * source_rate as usize / rate as usize)
            .min(samples.len())
            .max(start + 1);
        let value = samples[start..end]
            .iter()
            .map(|sample| *sample as i64)
            .sum::<i64>()
            / (end - start) as i64;
        pcm.extend((value as i16).to_le_bytes());
    }
    (pcm, frames)
}
fn append<T: Copy>(
    input: &[T],
    channels: usize,
    rate: u32,
    target: &Mutex<Vec<i16>>,
    app: &AppHandle,
    turn: u64,
    convert: impl Fn(T) -> f32,
) {
    let Ok(mut samples) = target.lock() else {
        return;
    };
    let mut power = 0f32;
    for frame in input.chunks_exact(channels) {
        let value =
            (frame.iter().map(|v| convert(*v)).sum::<f32>() / channels as f32).clamp(-1., 1.);
        power += value * value;
        if samples.len() < rate as usize * 60 {
            samples.push((value * 32767.) as i16);
        }
    }
    let power = (power / (input.len() / channels).max(1) as f32).sqrt();
    let _ = app.emit(
        "misty://cursor-meter",
        serde_json::json!({"turn":turn,"power":power}),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_device_rates_produce_exactly_24khz_pcm() {
        for rate in [8000, 16000, 24000, 44100, 48000, 96000, 192000] {
            let (pcm, frames) = pcm_since(&vec![1200; rate as usize], rate, 0);
            assert_eq!(frames, 24000);
            assert_eq!(pcm.len(), 48000);
            assert!(pcm
                .chunks_exact(2)
                .all(|v| i16::from_le_bytes([v[0], v[1]]) == 1200));
        }
    }
    #[test]
    fn streaming_chunks_equal_a_single_conversion() {
        let samples: Vec<i16> = (0..44100).map(|i| (i % 16000) as i16).collect();
        let mut delivered = 0;
        let mut streamed = Vec::new();
        for end in (1..samples.len())
            .step_by(173)
            .chain(std::iter::once(samples.len()))
        {
            let (chunk, next) = pcm_since(&samples[..end], 44100, delivered);
            streamed.extend(chunk);
            delivered = next;
        }
        assert_eq!(streamed, pcm_since(&samples, 44100, 0).0);
        assert_eq!(pcm_since(&[], 48000, 0), (Vec::new(), 0));
    }
}
