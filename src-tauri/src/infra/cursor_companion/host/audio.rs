//! Push-to-talk microphone for the agent at your cursor, on audeeo-core.
//! Captures 16 kHz mono and hands the realtime voice session 24 kHz PCM16.
use audeeo_core::{AudioSource, Capture, Resampler};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// One minute of 16 kHz audio; the host also stops the turn at 60 s.
const LIMIT: usize = 16_000 * 60;

pub struct Recording {
    capture: Option<Capture>,
    samples: Arc<Mutex<Vec<i16>>>,
    resampler: Resampler,
    delivered: usize,
    sequence: usize,
}
impl Recording {
    pub fn start(app: AppHandle, turn: u64) -> Result<Self, String> {
        super::platform::microphone_access()?;
        let samples = Arc::new(Mutex::new(Vec::new()));
        let target = samples.clone();
        let meter_app = app.clone();
        let capture = audeeo_core::start(
            AudioSource::Mic,
            move |chunk| {
                if let Ok(mut samples) = target.lock() {
                    let room = LIMIT.saturating_sub(samples.len());
                    samples.extend(chunk.samples.iter().take(room));
                }
                let _ = meter_app.emit(
                    "misty://cursor-meter",
                    serde_json::json!({"turn":turn,"power":chunk.power()}),
                );
            },
            move |e| {
                let _ = crate::infra::space_windows::emit_to_primary(
                    &app,
                    "misty://cursor-error",
                    serde_json::json!({"turn":turn,"error":format!("Microphone stopped: {e}")}),
                );
            },
        )
        .map_err(|e| format!("Microphone unavailable: {e}"))?;
        Ok(Self {
            capture: Some(capture),
            samples,
            resampler: Resampler::to_rate(16_000, 1, 24_000),
            delivered: 0,
            sequence: 0,
        })
    }
    pub fn drain(&mut self) -> Option<(usize, Vec<u8>)> {
        let pcm = self.pending()?;
        if pcm.is_empty() {
            return None;
        }
        let sequence = self.sequence;
        self.sequence += 1;
        Some((sequence, pcm))
    }
    pub fn finish(mut self) -> (usize, Vec<u8>, u64) {
        if let Some(capture) = self.capture.take() {
            capture.stop();
        }
        let pcm = self.pending().unwrap_or_default();
        let duration = self
            .samples
            .lock()
            .map(|s| s.len() as u64 * 1000 / 16_000)
            .unwrap_or(0);
        (self.sequence, pcm, duration)
    }
    /// Audio captured since the last call, as 24 kHz mono PCM16 bytes. The
    /// resampler keeps its phase across calls, so chunks join seamlessly.
    fn pending(&mut self) -> Option<Vec<u8>> {
        let fresh: Vec<i16> = {
            let samples = self.samples.lock().ok()?;
            let fresh = samples[self.delivered..].to_vec();
            self.delivered = samples.len();
            fresh
        };
        let mut out = Vec::with_capacity(fresh.len() * 3 / 2 + 2);
        self.resampler.push_i16(&fresh, &mut out);
        Some(out.into_iter().flat_map(i16::to_le_bytes).collect())
    }
}
