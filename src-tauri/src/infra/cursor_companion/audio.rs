use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

pub struct Recording {
    _stream: cpal::Stream,
    samples: Arc<Mutex<Vec<i16>>>,
    rate: u32,
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
        })
    }
    pub fn finish(self) -> (Vec<u8>, u64) {
        drop(self._stream);
        let samples = self.samples.lock().unwrap();
        encode_wav(&samples, self.rate)
    }
}
// Bound upload size even with 96/192 kHz devices; speech is sent as 24 kHz mono PCM.
fn encode_wav(samples: &[i16], source_rate: u32) -> (Vec<u8>, u64) {
    let rate = source_rate.min(24_000);
    let frames = samples.len() * rate as usize / source_rate as usize;
    let size = (frames * 2) as u32;
    let mut wav = Vec::with_capacity(44 + size as usize);
    wav.extend(b"RIFF");
    wav.extend((size + 36).to_le_bytes());
    wav.extend(b"WAVEfmt ");
    wav.extend(16u32.to_le_bytes());
    wav.extend(1u16.to_le_bytes());
    wav.extend(1u16.to_le_bytes());
    wav.extend(rate.to_le_bytes());
    wav.extend((rate * 2).to_le_bytes());
    wav.extend(2u16.to_le_bytes());
    wav.extend(16u16.to_le_bytes());
    wav.extend(b"data");
    wav.extend(size.to_le_bytes());
    for i in 0..frames {
        let start = i * source_rate as usize / rate as usize;
        let end = ((i + 1) * source_rate as usize / rate as usize)
            .min(samples.len())
            .max(start + 1);
        let value = samples[start..end]
            .iter()
            .map(|sample| *sample as i64)
            .sum::<i64>()
            / (end - start) as i64;
        wav.extend((value as i16).to_le_bytes());
    }
    (wav, samples.len() as u64 * 1000 / source_rate as u64)
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
    fn high_sample_rate_recordings_fit_the_proxy_limit() {
        let (wav, duration) = encode_wav(&vec![1200; 192_000 * 60], 192_000);
        assert_eq!(duration, 60_000);
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(wav[24..28].try_into().unwrap()), 24_000);
        assert_eq!(wav.len(), 44 + 24_000 * 60 * 2);
        assert_eq!(i16::from_le_bytes(wav[44..46].try_into().unwrap()), 1200);
    }
    #[test]
    fn empty_and_rapid_recordings_have_consistent_headers() {
        let (empty, duration) = encode_wav(&[], 48_000);
        assert_eq!(empty.len(), 44);
        assert_eq!(duration, 0);
        let (short, duration) = encode_wav(&vec![0; 480], 48_000);
        assert_eq!(short.len(), 524);
        assert_eq!(duration, 10);
    }
}
