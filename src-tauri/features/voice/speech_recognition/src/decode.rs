//! Audio as the models take it: 16 kHz mono samples between -1 and 1, read from a recorded file
//! (symphonia) or resampled from any other rate.

use std::fs::File;
use std::path::Path;

use sherpa_onnx::LinearResampler;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as DecodeError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::reason;

/// The rate every hearing model and the voice activity detector take.
pub const SAMPLE_RATE: i32 = 16_000;

/// The longest recording read at once: three hours.
const MOST_SECONDS: usize = 3 * 60 * 60;

/// Reads a recorded file (AAC in MP4 or M4A, WAV, MP3, FLAC, Ogg Vorbis, ALAC) as 16 kHz mono.
pub fn decode_file(path: &Path) -> Result<Vec<f32>, String> {
    let file = File::open(path).map_err(|_| reason("file"))?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|extension| extension.to_str()) {
        hint.with_extension(extension);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, stream, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|_| reason("file"))?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|track| track.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| reason("file"))?;
    let track_id = track.id;
    let rate = track.codec_params.sample_rate.ok_or_else(|| reason("file"))?;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|_| reason("file"))?;

    let most = MOST_SECONDS * rate as usize;
    let mut mono: Vec<f32> = Vec::new();
    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            // The end of the file.
            Err(DecodeError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(DecodeError::ResetRequired) => break,
            Err(_) => return Err(reason("file")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            // A damaged packet is skipped, as players do.
            Err(DecodeError::DecodeError(_)) | Err(DecodeError::IoError(_)) => continue,
            Err(_) => return Err(reason("file")),
        };
        let spec = *decoded.spec();
        let channels = spec.channels.count().max(1);
        let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        buffer.copy_interleaved_ref(decoded);
        for frame in buffer.samples().chunks(channels) {
            mono.push(frame.iter().sum::<f32>() / channels as f32);
        }
        if mono.len() > most {
            break;
        }
    }
    Ok(resample(&mono, rate as i32))
}

/// `samples` at `rate`, as 16 kHz.
pub fn resample(samples: &[f32], rate: i32) -> Vec<f32> {
    if rate == SAMPLE_RATE || samples.is_empty() {
        return samples.to_vec();
    }
    match LinearResampler::create(rate, SAMPLE_RATE) {
        Some(resampler) => resampler.resample(samples, true),
        None => samples.to_vec(),
    }
}
