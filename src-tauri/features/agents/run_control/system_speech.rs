const RATE: u32 = 24_000;
const PAUSE_SAMPLES: usize = (RATE as usize) / 4;

pub(crate) async fn speak_dialogue(
    app: &tauri::AppHandle,
    lines: &[(u8, String)],
    first: Option<&str>,
) -> Result<Vec<u8>, String> {
    let app = app.clone();
    let lines = lines.to_vec();
    let first = first.map(str::to_string);
    let samples = tokio::task::spawn_blocking(move || speak_all(&app, &lines, first.as_deref()))
        .await
        .map_err(|_| unavailable())??;
    if samples.is_empty() {
        return Err(unavailable());
    }
    Ok(wav(&samples))
}

fn speak_all(
    app: &tauri::AppHandle,
    lines: &[(u8, String)],
    first: Option<&str>,
) -> Result<Vec<i16>, String> {
    let voices = crate::voice::speech::dialogue_voices(app, first)?;
    let mut samples = Vec::new();
    for (speaker, text) in lines {
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        let voice = voices
            .get(usize::from(*speaker))
            .or_else(|| voices.first())
            .ok_or_else(unavailable)?;
        let speech = voice.speak(text, 1.0)?;
        let line = at_rate(&speech.samples, speech.rate, RATE);
        if !samples.is_empty() {
            samples.extend(std::iter::repeat_n(0, PAUSE_SAMPLES));
        }
        samples.extend(
            line.iter()
                .map(|sample| (sample.clamp(-1.0, 1.0) * f32::from(i16::MAX)) as i16),
        );
    }
    Ok(samples)
}

fn unavailable() -> String {
    "Voicebox isn't on this computer. Get it in Explore to hear Misty.".into()
}

fn at_rate(samples: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || samples.is_empty() || from == 0 {
        return samples.to_vec();
    }
    let ratio = f64::from(from) / f64::from(to);
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

fn wav(samples: &[i16]) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&RATE.to_le_bytes());
    out.extend_from_slice(&(RATE * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_24_khz_mono_wav() {
        let bytes = wav(&[0, 1, -1]);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(bytes[24..28].try_into().unwrap()), RATE);
        assert_eq!(bytes.len(), 44 + 6);
    }

    #[test]
    fn resamples_to_the_overview_rate() {
        assert_eq!(at_rate(&[0.0; 48], 48_000, 24_000).len(), 24);
        assert_eq!(at_rate(&[0.5; 10], 24_000, 24_000), vec![0.5; 10]);
    }
}
