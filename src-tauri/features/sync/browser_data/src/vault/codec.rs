//! Plaintext framing for records: compress first (ciphertext doesn't compress), then pad so the
//! server can't infer content from exact sizes.
//!
//! Frame: `[codec: u8][len: u32 LE][payload][zero padding]`.
use crate::{Error, Result};

const RAW: u8 = 0;
const ZSTD: u8 = 1;
const HEADER: usize = 5;
/// Decompression bound: larger than any record, far below memory pressure.
const MAX_PLAINTEXT: usize = 4 << 20;

/// Past this, doubling would waste too much and could push a record over the server's limit.
const BUCKETS_UP_TO: usize = 64 << 10;
const LARGE_STEP: usize = 16 << 10;

/// Power-of-two buckets from 256 bytes, then steady steps.
fn padded_len(len: usize) -> usize {
    if len <= BUCKETS_UP_TO {
        len.max(256).next_power_of_two()
    } else {
        len.div_ceil(LARGE_STEP) * LARGE_STEP
    }
}

pub fn encode(plaintext: &[u8]) -> Result<Vec<u8>> {
    if plaintext.len() > MAX_PLAINTEXT {
        return Err(Error::TooLarge);
    }
    // Tiny payloads rarely shrink; skip the codec when it would not help.
    let compressed = if plaintext.len() >= 128 {
        zstd::bulk::compress(plaintext, 3).map_err(|_| Error::Invalid)?
    } else {
        Vec::new()
    };
    let (codec, payload) = if !compressed.is_empty() && compressed.len() < plaintext.len() {
        (ZSTD, compressed.as_slice())
    } else {
        (RAW, plaintext)
    };
    let mut out = Vec::with_capacity(padded_len(HEADER + payload.len()));
    out.push(codec);
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(payload);
    out.resize(padded_len(out.len()), 0);
    Ok(out)
}

pub fn decode(frame: &[u8]) -> Result<Vec<u8>> {
    if frame.len() < HEADER {
        return Err(Error::Invalid);
    }
    let len = u32::from_le_bytes(frame[1..HEADER].try_into().map_err(|_| Error::Invalid)?) as usize;
    let payload = frame.get(HEADER..HEADER + len).ok_or(Error::Invalid)?;
    if frame[HEADER + len..].iter().any(|b| *b != 0) {
        return Err(Error::Invalid);
    }
    match frame[0] {
        RAW => Ok(payload.to_vec()),
        ZSTD => {
            // The frame says how big it is. Asking for the maximum every time would allocate
            // megabytes for each small record, which is most of them.
            let size = zstd::zstd_safe::get_frame_content_size(payload)
                .map_err(|_| Error::Invalid)?
                .filter(|size| *size <= MAX_PLAINTEXT as u64)
                .ok_or(Error::Invalid)? as usize;
            let mut out = Vec::with_capacity(size);
            let mut context = zstd::zstd_safe::DCtx::create();
            context
                .decompress(&mut out, payload)
                .map_err(|_| Error::Invalid)?;
            Ok(out)
        }
        _ => Err(Error::Invalid),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_small_large_and_incompressible() {
        for data in [
            Vec::new(),
            b"x".to_vec(),
            vec![7u8; 100_000],
            (0..=255u8).cycle().take(4096).collect::<Vec<_>>(),
        ] {
            assert_eq!(decode(&encode(&data).unwrap()).unwrap(), data);
        }
    }

    #[test]
    fn frames_land_in_buckets() {
        assert_eq!(encode(b"x").unwrap().len(), 256);
        assert_eq!(encode(&[1u8; 100]).unwrap().len(), 256);
        assert_eq!(padded_len(300), 512);
        assert_eq!(padded_len(64 << 10), 64 << 10);
        assert_eq!(padded_len((64 << 10) + 1), 80 << 10);
        assert_eq!(padded_len(200 << 10), 208 << 10);
    }

    #[test]
    fn bad_frames_are_refused() {
        assert!(decode(b"").is_err());
        assert!(decode(&[9, 0, 0, 0, 0]).is_err());
        assert!(decode(&[0, 200, 0, 0, 0, 1]).is_err());
        let mut padded = encode(b"x").unwrap();
        *padded.last_mut().unwrap() = 1;
        assert!(decode(&padded).is_err());
    }

    #[test]
    fn a_frame_claiming_to_be_huge_is_refused_before_anything_is_allocated() {
        // A zstd frame header saying 1 GiB of content, with nothing behind it.
        let bomb = zstd::bulk::compress(&vec![0u8; MAX_PLAINTEXT + 1], 1).unwrap();
        let mut frame = vec![ZSTD];
        frame.extend_from_slice(&(bomb.len() as u32).to_le_bytes());
        frame.extend_from_slice(&bomb);
        assert!(decode(&frame).is_err());
    }

    #[test]
    fn too_much_is_refused() {
        assert!(matches!(
            encode(&vec![0u8; MAX_PLAINTEXT + 1]),
            Err(Error::TooLarge)
        ));
    }
}
