use serde::Serialize;
use std::fmt;

pub const SAMPLE_RATE: u32 = 16_000;

pub const SHARE_SAMPLE_RATE: u32 = 48_000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Format {
    #[default]
    Speech,
    Share,
}

impl Format {
    pub fn sample_rate(self) -> u32 {
        match self {
            Format::Speech => SAMPLE_RATE,
            Format::Share => SHARE_SAMPLE_RATE,
        }
    }

    pub fn channels(self) -> u32 {
        match self {
            Format::Speech => 1,
            Format::Share => 2,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AudioSource {
    Mic,
    System { exclude_self: bool },
    Processes(Vec<u32>),
}

impl AudioSource {
    pub fn channel(&self) -> Channel {
        match self {
            AudioSource::Mic => Channel::Mic,
            _ => Channel::System,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Mic,
    System,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PcmChunk {
    pub channel: Channel,
    pub start_frame: u64,
    pub samples: Vec<i16>,
}

impl PcmChunk {
    pub fn end_frame(&self) -> u64 {
        self.start_frame + self.samples.len() as u64
    }

    pub fn duration_ms(&self) -> u64 {
        self.samples.len() as u64 * 1000 / SAMPLE_RATE as u64
    }

    pub fn to_le_bytes(&self) -> Vec<u8> {
        self.samples
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect()
    }

    pub fn power(&self) -> f32 {
        if self.samples.is_empty() {
            return 0.0;
        }
        let sum: f32 = self
            .samples
            .iter()
            .map(|s| (*s as f32 / 32768.0).powi(2))
            .sum();
        (sum / self.samples.len() as f32).sqrt()
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub mic: bool,
    pub system_audio: bool,
    pub process_audio: bool,
    pub exclude_self: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSource {
    pub name: String,
    pub pids: Vec<u32>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSources {
    pub microphone: String,
    pub applications: Vec<CaptureSource>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CaptureError {
    PermissionDenied,
    Unsupported(&'static str),
    NoSuchProcess,
    Device(String),
}

impl fmt::Display for CaptureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CaptureError::PermissionDenied => f.write_str("Audio access was not allowed."),
            CaptureError::Unsupported(what) => {
                write!(f, "{what} isn't available on this computer.")
            }
            CaptureError::NoSuchProcess => f.write_str("That app isn't playing audio right now."),
            CaptureError::Device(message) => write!(f, "The audio device stopped: {message}"),
        }
    }
}

impl std::error::Error for CaptureError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_report_duration_bytes_and_power() {
        let chunk = PcmChunk {
            channel: Channel::Mic,
            start_frame: 160,
            samples: vec![16384; 1600],
        };
        assert_eq!(chunk.duration_ms(), 100);
        assert_eq!(chunk.end_frame(), 1760);
        assert_eq!(&chunk.to_le_bytes()[..2], &16384i16.to_le_bytes());
        assert!((chunk.power() - 0.5).abs() < 1e-3);
    }

    #[test]
    fn mic_is_its_own_channel() {
        assert_eq!(AudioSource::Mic.channel(), Channel::Mic);
        assert_eq!(
            AudioSource::System { exclude_self: true }.channel(),
            Channel::System
        );
        assert_eq!(AudioSource::Processes(vec![7]).channel(), Channel::System);
    }
}
