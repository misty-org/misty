//! Plaintext framing for tree nodes and slots: compress first (ciphertext does
//! not compress), then pad so the server cannot infer content from exact sizes.
//!
//! Frame: `[codec: u8][len: u32 LE][payload][zero padding]`.
use crate::{Error, Result};

const RAW: u8 = 0;
const ZSTD: u8 = 1;
const HEADER: usize = 5;
/// Decompression bound: larger than any slot, far below memory pressure.
const MAX_PLAINTEXT: usize = 4 << 20;

#[derive(Clone, Copy)]
pub enum Padding {
    /// Nodes are small and frequent: round up to 64 bytes.
    Node,
    /// Slots and blobs: power-of-two buckets, minimum 256 bytes.
    Bucket,
}

fn padded_len(len: usize, padding: Padding) -> usize {
    match padding {
        Padding::Node => len.div_ceil(64) * 64,
        Padding::Bucket => len.max(256).next_power_of_two(),
    }
}

pub fn encode(plaintext: &[u8], padding: Padding) -> Result<Vec<u8>> {
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
    let mut out = Vec::with_capacity(padded_len(HEADER + payload.len(), padding));
    out.push(codec);
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(payload);
    out.resize(padded_len(out.len(), padding), 0);
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
        ZSTD => zstd::bulk::decompress(payload, MAX_PLAINTEXT).map_err(|_| Error::Invalid),
        _ => Err(Error::Recovery),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_and_pads_to_buckets() {
        let small = b"{\"kind\":\"tab\"}";
        let node = encode(small, Padding::Node).unwrap();
        assert_eq!(node.len() % 64, 0);
        assert_eq!(decode(&node).unwrap(), small);

        let repetitive = vec![b'a'; 10_000];
        let slot = encode(&repetitive, Padding::Bucket).unwrap();
        assert!(slot.len().is_power_of_two() && slot.len() < repetitive.len());
        assert_eq!(decode(&slot).unwrap(), repetitive);
        assert_eq!(encode(b"", Padding::Bucket).unwrap().len(), 256);
    }

    #[test]
    fn rejects_tampered_padding_and_unknown_codecs() {
        let mut frame = encode(b"hello", Padding::Node).unwrap();
        *frame.last_mut().unwrap() = 1;
        assert!(decode(&frame).is_err());
        let mut frame = encode(b"hello", Padding::Node).unwrap();
        frame[0] = 9;
        assert!(matches!(decode(&frame), Err(Error::Recovery)));
    }
}
