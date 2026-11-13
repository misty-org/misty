//! An audio overview spoken by the computer's own voices, for someone with no speech key: `say` on
//! macOS, the built-in speech engine on Windows, `espeak-ng` on Linux. Everything stays on this
//! computer. The result is the same 24 kHz, 16-bit mono WAV the speech models give
//! (`calls::tutor_overview_make`), two voices taking turns.
use std::path::Path;

const RATE: u32 = 24_000;
/// A short pause between lines, so two voices don't run into each other.
const PAUSE_SAMPLES: usize = (RATE as usize) / 4;

/// Speaks each line in its speaker's voice and joins them into one WAV.
pub(crate) async fn speak_dialogue(lines: &[(u8, String)]) -> Result<Vec<u8>, String> {
    let dir = std::env::temp_dir().join(format!("misty-speech-{}", uuid::Uuid::new_v4()));
    file_access::fs_async::create_dir_all(&dir)
        .await
        .map_err(|_| unavailable())?;
    let spoken = speak_all(&dir, lines).await;
    let _ = file_access::fs::remove_dir_all(&dir);
    let samples = spoken?;
    if samples.is_empty() {
        return Err(unavailable());
    }
    Ok(wav(&samples))
}

async fn speak_all(dir: &Path, lines: &[(u8, String)]) -> Result<Vec<i16>, String> {
    let voices = voices().await;
    let mut samples = Vec::new();
    for (index, (speaker, text)) in lines.iter().enumerate() {
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        let input = dir.join(format!("{index}.txt"));
        let output = dir.join(format!("{index}.wav"));
        file_access::fs_async::write(&input, text)
            .await
            .map_err(|_| unavailable())?;
        let voice = voices.get(usize::from(*speaker)).map(String::as_str);
        speak_line(&input, &output, voice).await?;
        let bytes = file_access::fs::read(&output).map_err(|_| unavailable())?;
        let line = pcm_at_rate(&bytes, RATE).ok_or_else(unavailable)?;
        if !samples.is_empty() {
            samples.extend(std::iter::repeat_n(0, PAUSE_SAMPLES));
        }
        samples.extend(line);
    }
    Ok(samples)
}

fn unavailable() -> String {
    if cfg!(target_os = "linux") {
        "This computer has no voice to read it. Install espeak-ng, or add a speech key in Settings → Models."
            .into()
    } else {
        "This computer's voices couldn't read it. Add a speech key in Settings → Models.".into()
    }
}

/// Two different voices where the system has them, the first for speaker 0. Empty means the
/// system's default voice for everyone.
async fn voices() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        let listed = tokio::process::Command::new("say")
            .args(["-v", "?"])
            .output()
            .await
            .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
            .unwrap_or_default();
        let installed: Vec<&str> = listed
            .lines()
            .filter(|line| line.contains("en_") || line.contains("en-"))
            .filter_map(|line| line.split("  ").next().map(str::trim))
            .collect();
        let pick = |wanted: &[&str]| {
            wanted
                .iter()
                .find(|name| installed.contains(name))
                .map(|name| (*name).to_string())
        };
        let first = pick(&["Samantha", "Ava", "Allison", "Karen"]);
        let second = pick(&["Daniel", "Alex", "Tom", "Fred"]);
        first.into_iter().chain(second).collect()
    }
    #[cfg(target_os = "linux")]
    {
        vec!["en-us+f3".into(), "en-us+m3".into()]
    }
    #[cfg(windows)]
    {
        // Picked by position among the installed voices, in the PowerShell below.
        vec!["0".into(), "1".into()]
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
        Vec::new()
    }
}

async fn speak_line(input: &Path, output: &Path, voice: Option<&str>) -> Result<(), String> {
    let mut command = speech_command(input, output, voice)?;
    let done = tokio::time::timeout(std::time::Duration::from_secs(120), command.output())
        .await
        .map_err(|_| unavailable())?
        .map_err(|_| unavailable())?;
    if !done.status.success() || !file_access::fs::exists(output) {
        return Err(unavailable());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn speech_command(
    input: &Path,
    output: &Path,
    voice: Option<&str>,
) -> Result<tokio::process::Command, String> {
    let mut command = tokio::process::Command::new("say");
    if let Some(voice) = voice {
        command.args(["-v", voice]);
    }
    command
        .arg("-o")
        .arg(output)
        .args(["--file-format=WAVE", "--data-format=LEI16@24000", "-f"])
        .arg(input);
    Ok(command)
}

#[cfg(target_os = "linux")]
fn speech_command(
    input: &Path,
    output: &Path,
    voice: Option<&str>,
) -> Result<tokio::process::Command, String> {
    let program = ["espeak-ng", "espeak"]
        .into_iter()
        .find(|name| on_path(name))
        .ok_or_else(unavailable)?;
    let mut command = tokio::process::Command::new(program);
    command.args(["-v", voice.unwrap_or("en-us"), "-s", "165", "-w"]);
    command.arg(output).arg("-f").arg(input);
    Ok(command)
}

#[cfg(target_os = "linux")]
fn on_path(name: &str) -> bool {
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).any(|dir| dir.join(name).is_file()))
        .unwrap_or(false)
}

#[cfg(windows)]
fn speech_command(
    input: &Path,
    output: &Path,
    voice: Option<&str>,
) -> Result<tokio::process::Command, String> {
    // Paths and the voice go in through the environment, so nothing needs quoting.
    const SCRIPT: &str = "Add-Type -AssemblyName System.Speech; \
        $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; \
        $v = @($s.GetInstalledVoices() | Where-Object { $_.Enabled }); \
        $i = [int]$env:MISTY_VOICE; \
        if ($v.Count -gt $i) { $s.SelectVoice($v[$i].VoiceInfo.Name) }; \
        $f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, \
            [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, \
            [System.Speech.AudioFormat.AudioChannel]::Mono); \
        $s.SetOutputToWaveFile($env:MISTY_OUT, $f); \
        $s.Speak([IO.File]::ReadAllText($env:MISTY_IN)); \
        $s.Dispose()";
    let mut command = tokio::process::Command::new("powershell");
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .env("MISTY_IN", input)
        .env("MISTY_OUT", output)
        .env("MISTY_VOICE", voice.unwrap_or("0"));
    crate::engine_config::support::hide_console_tokio(&mut command);
    Ok(command)
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn speech_command(
    _input: &Path,
    _output: &Path,
    _voice: Option<&str>,
) -> Result<tokio::process::Command, String> {
    Err(unavailable())
}

/// A WAV file's 16-bit samples as mono at `rate`, whatever rate and channel count it came in.
fn pcm_at_rate(bytes: &[u8], rate: u32) -> Option<Vec<i16>> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return None;
    }
    let mut at = 12;
    let (mut channels, mut source_rate, mut bits) = (0u16, 0u32, 0u16);
    let mut data: Option<&[u8]> = None;
    while at + 8 <= bytes.len() {
        let id = &bytes[at..at + 4];
        let size = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().ok()?) as usize;
        let body = &bytes[at + 8..(at + 8).saturating_add(size).min(bytes.len())];
        if id == b"fmt " && body.len() >= 16 {
            channels = u16::from_le_bytes([body[2], body[3]]);
            source_rate = u32::from_le_bytes(body[4..8].try_into().ok()?);
            bits = u16::from_le_bytes([body[14], body[15]]);
        } else if id == b"data" {
            data = Some(body);
            break;
        }
        at += 8 + size + (size & 1);
    }
    let data = data?;
    if bits != 16 || channels == 0 || source_rate == 0 {
        return None;
    }
    let frames: Vec<i16> = data
        .chunks_exact(2 * usize::from(channels))
        .map(|frame| {
            let sum: i32 = frame
                .chunks_exact(2)
                .map(|sample| i32::from(i16::from_le_bytes([sample[0], sample[1]])))
                .sum();
            (sum / i32::from(channels)) as i16
        })
        .collect();
    if source_rate == rate || frames.is_empty() {
        return Some(frames);
    }
    let length = (frames.len() as u64 * u64::from(rate) / u64::from(source_rate)) as usize;
    Some(
        (0..length)
            .map(|index| {
                let position = index as f64 * f64::from(source_rate) / f64::from(rate);
                let before = position.floor() as usize;
                let after = (before + 1).min(frames.len() - 1);
                let share = position - before as f64;
                let a = f64::from(frames[before.min(frames.len() - 1)]);
                let b = f64::from(frames[after]);
                (a + (b - a) * share).round() as i16
            })
            .collect(),
    )
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

    fn stereo_wav(rate: u32, frames: &[(i16, i16)]) -> Vec<u8> {
        let data: Vec<u8> = frames
            .iter()
            .flat_map(|(l, r)| [l.to_le_bytes(), r.to_le_bytes()].concat())
            .collect();
        let mut out = b"RIFF\0\0\0\0WAVE".to_vec();
        out.extend_from_slice(b"FLLR");
        out.extend_from_slice(&4u32.to_le_bytes());
        out.extend_from_slice(&[0; 4]);
        out.extend_from_slice(b"fmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&2u16.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * 4).to_le_bytes());
        out.extend_from_slice(&4u16.to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&data);
        out
    }

    #[test]
    fn reads_any_chunk_layout_and_mixes_to_mono() {
        let bytes = stereo_wav(RATE, &[(100, 300), (-200, 0)]);
        assert_eq!(pcm_at_rate(&bytes, RATE).unwrap(), vec![200, -100]);
    }

    #[test]
    fn resamples_to_the_overview_rate() {
        let frames: Vec<(i16, i16)> = (0..12_000).map(|_| (1000, 1000)).collect();
        let samples = pcm_at_rate(&stereo_wav(12_000, &frames), RATE).unwrap();
        assert_eq!(samples.len(), 24_000);
        assert!(samples.iter().all(|sample| *sample == 1000));
    }

    #[test]
    fn writes_a_24_khz_mono_wav() {
        let out = wav(&[1, 2, 3]);
        assert_eq!(out.len(), 44 + 6);
        assert_eq!(pcm_at_rate(&out, RATE).unwrap(), vec![1, 2, 3]);
        assert!(pcm_at_rate(b"nope", RATE).is_none());
    }
}
